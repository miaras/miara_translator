import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('paid credit persists, webhook retries are safe, and concurrent usage cannot overspend', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'shiroko-billing-'));
    const port = 32000 + Math.floor(Math.random() * 20000);
    const base = `http://127.0.0.1:${port}`;
    const dataFile = path.join(directory, 'store.json');
    const orderFile = path.join(directory, 'order.json');
    const server = spawn(process.execPath, ['--import', './test/fixtures/billing-network.mjs', 'server.js'], { env: { ...process.env, PORT: String(port), SHIROKO_DATA_FILE: dataFile, TEST_ORDER_FILE: orderFile, OPENAI_API_KEY: 'test', POLAR_ACCESS_TOKEN: 'test', POLAR_WEBHOOK_SECRET: 'test-secret', POLAR_ENVIRONMENT: 'production', POLAR_PRODUCT_5_USD: 'product-5', POLAR_TOKEN_TOPUP_5: 'topup-product-5' }, stdio: 'ignore' });
    try {
        for (let i = 0; i < 100; i++) {
            try { await fetch(`${base}/api/me`); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
        }
        let cookie;
        async function call(route, body, extra = {}) {
            const response = await fetch(`${base}${route}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra }, ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
            return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
        }
        const input = { mode: 'regenerate', text: 'Hello.', targetLanguage: 'French' };
        assert.equal((await call('/api/translate', input)).status, 401);
        const account = await call('/api/register', { email: 'billing@example.com', password: 'long-test-password' });
        cookie = account.cookie;
        const userId = account.data.user.id;
        assert.equal(account.data.user.promotionPromptPending, true);
        assert.equal((await call('/api/billing/promotion-prompt', {})).status, 200);
        assert.equal((await call('/api/me')).data.user.promotionPromptPending, false);
        assert.equal((await call('/api/translate', input)).status, 402);
        assert.equal((await call('/api/billing/topup', { amount: 5 })).status, 200);
        assert.equal((await call('/api/billing/topup', { amount: 1 })).status, 400);
        const order = { id: '12345678-1234-4123-8123-123456789abc', product_id: 'product-5', customer: { external_id: userId }, paid: true, currency: 'usd', net_amount: 500, total_amount: 550, refunded_amount: 0 };
        await writeFile(orderFile, JSON.stringify(order));
        async function webhook(type = 'order.paid') {
            const raw = JSON.stringify({ type, data: { id: order.id } });
            const timestamp = String(Math.floor(Date.now() / 1000));
            const signature = createHmac('sha256', 'test-secret').update(`event.${timestamp}.${raw}`).digest('base64');
            return call('/api/billing/webhook', raw, { 'webhook-id': 'event', 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` });
        }
        assert.equal((await call('/api/billing/webhook', { type: 'order.paid' })).status, 403);
        assert.equal((await webhook()).status, 200);
        assert.equal((await webhook()).status, 200);
        assert.equal((await call('/api/billing')).data.balanceMicros, 5_000_000);
        // Even a very large provider output cannot increase the fixed two-source-token charge.
        const translated = await call('/api/translate', { ...input, instructions: 'EXTRA_USAGE', previousContext: 'Context is included. '.repeat(100) });
        assert.equal(translated.status, 200);
        assert.equal(translated.data.translation, 'Bonjour.');
        assert.equal(translated.data.balanceMicros, 5_000_000 - 100);
        assert.equal((await call('/api/translate', { ...input, text: 'FAIL_PROVIDER' })).status, 502);
        assert.equal((await call('/api/billing')).data.balanceMicros, 5_000_000 - 100);
        // Leave $0.01: enough for one 121-source-token request ($0.00605), but not two.
        order.refunded_amount = 499;
        await writeFile(orderFile, JSON.stringify(order));
        assert.equal((await webhook('order.refunded')).status, 200);
        const concurrentInput = { ...input, text: 'Hello. '.repeat(60) };
        const results = await Promise.all([call('/api/translate', concurrentInput), call('/api/translate', concurrentInput)]);
        assert.deepEqual(results.map(result => result.status).sort(), [200, 402]);
        const stored = JSON.parse(await readFile(dataFile, 'utf8'));
        const ledgerBalance = stored.billingLedger.reduce((sum, entry) => sum + entry.amountMicros, 0);
        assert.equal(ledgerBalance, 10_000 - 100 - 6050);
        order.refunded_amount = 500;
        await writeFile(orderFile, JSON.stringify(order));
        await webhook('order.refunded');
        assert.equal((await call('/api/translate', input)).status, 402);
        cookie = undefined;
        assert.equal((await call('/api/billing/promotion', { promotionCode: 'TRANSLATE.SHIROKO.TOOLS' })).status, 401);
        assert.equal((await call('/api/register', { email: 'promo@example.com', password: 'long-test-password', promotionCode: 'WRONG' })).status, 400);
        const promotional = await call('/api/register', { email: 'promo@example.com', password: 'long-test-password', promotionCode: ' translate.shiroko.tools ' });
        assert.equal(promotional.status, 201);
        assert.equal(promotional.data.user.promotionPromptPending, false);
        assert.equal(promotional.data.user.balanceMicros, 500_000);
        cookie = promotional.cookie;
        const retries = await Promise.all(Array.from({ length: 5 }, () => call('/api/billing/promotion', { promotionCode: 'TRANSLATE.SHIROKO.TOOLS' })));
        assert.ok(retries.every(result => result.status === 200 && result.data.balanceMicros === 500_000));
        assert.equal((await call('/api/billing/promotion', { promotionCode: 123 })).status, 400);
        assert.equal((await call('/api/translate', input)).data.balanceMicros, 499_900);
        const redeemedStore = JSON.parse(await readFile(dataFile, 'utf8'));
        assert.equal(redeemedStore.billingLedger.filter(entry => entry.userId === promotional.data.user.id && entry.kind === 'promotion').length, 1);
        cookie = account.cookie;
        const claims = await Promise.all(Array.from({ length: 5 }, () => call('/api/billing/promotion', { promotionCode: 'TRANSLATE.SHIROKO.TOOLS' })));
        assert.equal(claims.filter(result => result.data.message === '$0.50 promotional credit added.').length, 1);
        const finalStore = JSON.parse(await readFile(dataFile, 'utf8'));
        assert.equal(finalStore.billingLedger.filter(entry => entry.userId === userId && entry.kind === 'promotion').length, 1);
    } finally {
        server.kill();
        await new Promise(resolve => server.once('exit', resolve));
        await rm(directory, { recursive: true, force: true });
    }
});
