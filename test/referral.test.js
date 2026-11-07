import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureReferralCode, grantSignupReferral } from '../referral.js';

test('referrals credit both new signup and inviter once without stacking promotion credit', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'shiroko-referral-'));
    const dataFile = path.join(directory, 'store.json');
    const port = 32000 + Math.floor(Math.random() * 20000);
    const base = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), SHIROKO_DATA_FILE: dataFile }, stdio: 'ignore' });
    try {
        for (let i = 0; i < 100; i++) { try { await fetch(`${base}/api/me`); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
        async function call(route, body, cookie) {
            const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
            return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
        }
        const register = (email, extra = {}) => call('/api/register', { email, password: 'long-referral-password', ...extra });
        assert.equal((await call('/api/referrals')).status, 401);
        const inviter = await register('inviter@example.com', { promotionCode: 'TRANSLATE.SHIROKO.TOOLS' });
        const link = await call('/api/referrals', undefined, inviter.cookie);
        const code = new URL(link.data.url).searchParams.get('ref');
        assert.match(code, /^[a-f0-9]{32}$/);
        assert.equal((await call('/api/referrals', undefined, inviter.cookie)).data.url, link.data.url);
        assert.equal(link.data.creditTokens, 2500);
        assert.match(link.data.explanation, /5 pages/);
        const friend = await register('friend@example.com', { referralCode: code, promotionCode: 'TRANSLATE.SHIROKO.TOOLS' });
        assert.equal(friend.data.user.subscription.prepaidTokens, 2_500);
        const friendNotice = await call('/api/referrals/notifications', undefined, friend.cookie);
        const inviterNotice = await call('/api/referrals/notifications', undefined, inviter.cookie);
        assert.equal(friendNotice.data.notifications.length, 1);
        assert.equal(inviterNotice.data.notifications.length, 1);
        assert.equal(friendNotice.data.notifications[0].creditTokens, 2500);
        assert.equal((await call('/api/referrals/notifications')).status, 401);
        await call('/api/referrals/notifications', { ids: [friendNotice.data.notifications[0].id], creditTokens: 999999 }, inviter.cookie);
        assert.equal((await call('/api/referrals/notifications', undefined, friend.cookie)).data.notifications.length, 1);
        assert.equal((await call('/api/referrals/notifications', undefined, inviter.cookie)).data.notifications.length, 1);
        await call('/api/referrals/notifications', { ids: [friendNotice.data.notifications[0].id] }, friend.cookie);
        assert.equal((await call('/api/referrals/notifications', undefined, friend.cookie)).data.notifications.length, 0);

        assert.equal(friend.data.user.promotionPromptPending, false);
        assert.equal((await call('/api/me', undefined, inviter.cookie)).data.user.subscription.prepaidTokens, 12_500);
        const claims = await Promise.all(Array.from({ length: 4 }, () => call('/api/billing/promotion', { promotionCode: 'TRANSLATE.SHIROKO.TOOLS' }, friend.cookie)));
        assert.ok(claims.every(result => result.data.subscription.prepaidTokens === 2_500));
        assert.equal((await register('friend@example.com', { referralCode: code })).status, 409);
        await call('/api/login', { email: 'friend@example.com', password: 'long-referral-password', referralCode: code });
        assert.equal((await call('/api/referrals', undefined, inviter.cookie)).data.successfulInvites, 1);
        const invalid = await register('invalid@example.com', { referralCode: 'not-a-code' });
        assert.equal(invalid.data.user.subscription.prepaidTokens, 0);
        const second = await register('second@example.com', { referralCode: code });
        assert.equal(second.data.user.subscription.prepaidTokens, 2_500);
        assert.equal((await call('/api/me', undefined, inviter.cookie)).data.user.subscription.prepaidTokens, 15_000);
        const stored = JSON.parse(await readFile(dataFile, 'utf8'));
        const referred = stored.users.find(user => user.id === friend.data.user.id);
        assert.equal(grantSignupReferral(stored, referred, code), false);
        const self = stored.users.find(user => user.id === invalid.data.user.id);
        assert.equal(grantSignupReferral(stored, self, ensureReferralCode(stored, self)), false);
        assert.equal(stored.billingLedger.filter(entry => entry.userId === referred.id && entry.kind === 'referral_signup').length, 1);
    } finally {
        server.kill();
        await new Promise(resolve => server.once('exit', resolve));
        await rm(directory, { recursive: true, force: true });
    }
});
