import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { scryptSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { reviewQuote } from '../human-review-pricing.js';
import { reviewBacklog, REVIEW_ADMINS } from '../human-review.js';
import { createReviewNotifier, reviewMailOptions } from '../human-review-notifications.js';

test('review price uses the original English or Korean text and backlog counts only pending work at 20 pages/day', () => {
    const source = 'word '.repeat(1000);
    assert.deepEqual(reviewQuote('en-ko', source, '번역'), { wordCount: 1000, wordLanguage: 'en', pages: 4, priceMicros: 40_000_000 });
    assert.equal(reviewQuote('ko-en', '원문 '.repeat(1000), 'short draft').priceMicros, 40_000_000);
    assert.equal(reviewQuote('en-ko', 'Short text.', '번역').priceMicros, 10_000_000);
    assert.equal(reviewQuote('ko-en', '안녕하세요 세계. !!! ... 123', source).wordCount, 3);
    assert.equal(reviewQuote('ko-en', '안녕하세요세계', source).wordCount, 1);
    assert.equal(reviewQuote('ko-en', '!!! ...', source).wordCount, 0);
    assert.equal(reviewBacklog({ humanReviewRequests: [{ status: 'queued', wordCount: 5001, wordLanguage: 'ko', englishWords: 1 }] }).backlogDays, 2);
    const backlog = reviewBacklog({ humanReviewRequests: [{ status: 'queued', englishWords: 5000 }, { status: 'in_review', englishWords: 250 }, { status: 'completed', englishWords: 10000 }, { status: 'canceled', englishWords: 10000 }] });
    assert.equal(backlog.pages, 21);
    assert.equal(backlog.requests, 2);
    assert.equal(backlog.backlogDays, 2);
});

test('SMTP notifications go to both reviewers, retry failed sends, and preserve documents in the dashboard', async () => {
    const request = { id: 'request-id', englishWords: 250, pages: 1, priceMicros: 10_000_000, direction: 'en-ko', customerEmail: 'customer@example.com', sourceText: 'PRIVATE ORIGINAL', translatedText: 'PRIVATE DRAFT', status: 'queued', notification: { status: 'pending', attempts: 0 } };
    let calls = 0;
    let writes = 0;
    let message;
    const notify = createReviewNotifier({ store: { humanReviewRequests: [request] }, persist: async () => { writes++; }, env: {}, transport: { sendMail: async value => { calls++; message = value; if (calls === 1) throw new Error('failure'); return { messageId: 'test-message', rejected: [] }; } } });
    await Promise.all([notify(), notify()]);
    assert.equal(calls, 1);
    assert.equal(request.notification.status, 'pending');
    assert.equal(writes, 1);
    assert.ok(request.notification.nextAttemptAt > Date.now());
    request.notification.nextAttemptAt = 0;
    await notify();
    assert.equal(request.notification.status, 'sent');
    assert.deepEqual(message.to, REVIEW_ADMINS);
    assert.match(message.text, /app.html\?reviews=manage#request-id/);
    assert.ok(!message.text.includes('PRIVATE ORIGINAL'));
    assert.ok(!message.text.includes('PRIVATE DRAFT'));
    assert.equal(writes, 2);
    await notify();
    assert.equal(calls, 2);
    const options = reviewMailOptions({ SMTP_PASSWORD: 'test-password' });
    assert.equal(options.host, 'mail.privateemail.com');
    assert.equal(options.port, 465);
    assert.equal(options.secure, true);
    assert.equal(options.requireTLS, true);
});

test('human review requests persist with quotes, access control, idempotency, delivery, and live backlog updates', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'shiroko-review-'));
    const dataFile = path.join(directory, 'store.json');
    const salt = 'test-salt';
    const password = 'long-review-test-password';
    const admins = REVIEW_ADMINS.map((email, index) => ({ id: String(index + 1).repeat(32), email, salt, hash: scryptSync(password, salt, 64).toString('hex') }));
    await writeFile(dataFile, JSON.stringify({ users: admins, sessions: [], translations: [], billingLedger: [] }));
    const port = 32000 + Math.floor(Math.random() * 20000);
    const base = `http://127.0.0.1:${port}`;
    let server;
    async function start() {
        server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), SHIROKO_DATA_FILE: dataFile, SMTP_PASSWORD: '' }, stdio: 'ignore' });
        for (let i = 0; i < 100; i++) { try { await fetch(`${base}/api/me`); return; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
        throw new Error('Review test server did not start');
    }
    async function stop() { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
    async function api(route, method = 'GET', input, cookie) {
        const response = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
        return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    try {
        await start();
        assert.equal((await api('/api/human-reviews')).status, 401);
        assert.equal((await api('/api/human-reviews/backlog')).data.words, 0);
        const customer = await api('/api/register', 'POST', { email: 'review@example.com', password });
        const other = await api('/api/register', 'POST', { email: 'other-review@example.com', password });
        const staff = await api('/api/login', 'POST', { email: REVIEW_ADMINS[0], password });
        const secondStaff = await api('/api/login', 'POST', { email: REVIEW_ADMINS[1], password });
        assert.equal((await api('/api/human-reviews', 'GET', undefined, staff.cookie)).data.admin, true);
        assert.equal((await api('/api/human-reviews', 'GET', undefined, secondStaff.cookie)).data.admin, true);
        assert.equal((await api('/api/human-reviews?all=1', 'GET', undefined, customer.cookie)).status, 403);
        const input = { clientRequestId: randomUUID(), direction: 'en-ko', sourceText: 'word '.repeat(5000), translatedText: '원문을 검토해 주세요.', acceptedPriceMicros: 200_000_000 };
        assert.equal((await api('/api/human-reviews', 'POST', { ...input, acceptedPriceMicros: 1 }, customer.cookie)).status, 409);
        assert.equal((await api('/api/human-reviews', 'POST', { ...input, direction: 'en-fr' }, customer.cookie)).status, 400);
        const results = await Promise.all(Array.from({ length: 3 }, () => api('/api/human-reviews', 'POST', input, customer.cookie)));
        assert.deepEqual(results.map(result => result.status).sort(), [200, 200, 201]);
        const request = results[0].data.request;
        assert.equal(request.notification, undefined);
        assert.equal(request.estimatedDays, 1);
        assert.equal((await api('/api/human-reviews/backlog')).data.pages, 20);
        const second = await api('/api/human-reviews', 'POST', { ...input, clientRequestId: randomUUID(), sourceText: 'word '.repeat(250), acceptedPriceMicros: 10_000_000 }, customer.cookie);
        assert.equal(second.data.request.estimatedDays, 2);
        assert.equal((await api('/api/human-reviews', 'GET', undefined, other.cookie)).data.requests.length, 0);
        assert.equal((await api(`/api/human-reviews/${request.id}`, 'PUT', { status: 'in_review' }, customer.cookie)).status, 403);
        assert.equal((await api(`/api/human-reviews/${request.id}`, 'PUT', { status: 'canceled' }, other.cookie)).status, 404);
        const staffQueue = await api('/api/human-reviews?all=1', 'GET', undefined, staff.cookie);
        assert.equal(staffQueue.data.requests.length, 2);
        assert.equal(staffQueue.data.requests[0].notification.status, 'pending');
        assert.equal((await api(`/api/human-reviews/${request.id}`, 'PUT', { status: 'in_review' }, staff.cookie)).status, 200);
        assert.equal((await api(`/api/human-reviews/${request.id}`, 'PUT', { status: 'completed' }, staff.cookie)).status, 400);
        assert.equal((await api(`/api/human-reviews/${request.id}`, 'PUT', { status: 'completed', reviewedText: '검토가 완료되었습니다.' }, staff.cookie)).status, 200);
        assert.equal((await api('/api/human-reviews/backlog')).data.pages, 1);
        const own = await api('/api/human-reviews', 'GET', undefined, customer.cookie);
        assert.equal(own.data.requests[0].reviewedText, '검토가 완료되었습니다.');
        assert.equal(own.data.requests[1].estimatedDays, 1);
        await stop();
        await start();
        assert.equal((await api('/api/human-reviews/backlog')).data.pages, 1);
        assert.equal((await api('/api/human-reviews', 'GET', undefined, customer.cookie)).data.requests[0].status, 'completed');
        assert.equal((await api(`/api/human-reviews/${second.data.request.id}`, 'PUT', { status: 'canceled' }, customer.cookie)).status, 200);
        assert.equal((await api('/api/human-reviews/backlog')).data.pages, 0);
        const stored = JSON.parse(await readFile(dataFile, 'utf8'));
        assert.equal(stored.humanReviewRequests.length, 2);
    } finally {
        if (server?.exitCode === null) await stop();
        await rm(directory, { recursive: true, force: true });
    }
});
