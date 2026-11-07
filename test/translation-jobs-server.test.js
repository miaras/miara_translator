import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceChunks, countSourceTokens } from '../source-tokens.js';

async function until(read, predicate) {
    for (let index = 0; index < 150; index++) {
        try { const value = await read(); if (predicate(value)) return value; } catch {}
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.fail('Server job did not reach the expected state');
}
test('authenticated jobs stop/resume and keep translating without browser polling; stale saves cannot truncate server progress', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'shiroko-jobs-'));
    const port = 32000 + Math.floor(Math.random() * 20000), base = `http://127.0.0.1:${port}`;
    const dataFile = path.join(directory, 'store.json'), traceFile = path.join(directory, 'trace.jsonl');
    const server = spawn(process.execPath, ['--import', './test/fixtures/job-network.mjs', 'server.js'], {
        env: { ...process.env, PORT: String(port), SHIROKO_DATA_FILE: dataFile, TEST_JOB_TRACE: traceFile, OPENAI_API_KEY: 'test-key' }, stdio: 'ignore'
    });
    try {
        await until(async () => fetch(`${base}/api/me`), response => response.ok);
        async function call(route, method = 'GET', value, cookie) {
            const response = await fetch(base + route, { method, headers: { ...(value !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
            return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
        }
        const sourceText = Array.from({ length: 350 }, (_, index) => `Source sentence ${index} with some detail. `).join('').trim();
        const chunks = sourceChunks(sourceText);
        const input = { sourceText, targetLang: 'French', instructions: 'Keep the tone.', customTerms: {}, mode: 'translate', speed: 'standard' };
        assert.equal((await call('/api/translation-jobs', 'POST', input)).status, 401);
        const registered = await call('/api/register', 'POST', { email: 'jobs@example.com', password: 'long-job-password', promotionCode: 'TRANSLATE.SHIROKO.TOOLS' });
        const cookie = registered.cookie, initialTokens = registered.data.user.subscription.prepaidTokens;
        const other = await call('/api/register', 'POST', { email: 'other-jobs@example.com', password: 'other-long-job-password' });
        const created = await call('/api/translation-jobs', 'POST', input, cookie);
        assert.equal(created.status, 202);
        const id = created.data.translation.id, route = `/api/translations/${id}`;
        assert.equal(created.data.translation.job.status, 'running');
        assert.equal((await call('/api/translation-jobs', 'POST', input, cookie)).data.translation.id, id);
        await until(() => readFile(traceFile, 'utf8'), value => value.trim().split('\n').length === 1);
        assert.equal((await call(`${route}/stop`, 'POST', {}, other.cookie)).status, 404);
        assert.equal((await call(`${route}/job?from=0`, 'GET', undefined, other.cookie)).status, 404);
        const stop = await call(`${route}/stop`, 'POST', {}, cookie);
        assert.equal(stop.data.translation.job.status, 'stopping');
        const paused = await until(() => call(route, 'GET', undefined, cookie), response => response.data.translation.job.status === 'paused');
        assert.equal(paused.data.translation.progress.nextChunk, 1);
        assert.equal(paused.data.translation.rows.length, 1);
        assert.equal((await readFile(traceFile, 'utf8')).trim().split('\n').length, 1);
        const status = await call(`${route}/job?from=1`, 'GET', undefined, cookie);
        assert.deepEqual(status.data.rows, []);
        assert.equal(status.data.sourceText, undefined);
        assert.equal(status.data.progress.existingTranslation, undefined);
        assert.equal((await call(`${route}/job?from=999`, 'GET', undefined, cookie)).status, 400);
        const stale = structuredClone(paused.data.translation);
        stale.rows[0].target = 'Reader edit'; stale.rows[0].bookmarked = true;
        assert.equal((await call(route, 'PUT', stale, cookie)).status, 200);
        const resumed = await call(`${route}/start`, 'POST', { speed: 'standard' }, cookie);
        assert.equal(resumed.status, 200);
        // Deliberately make no progress requests while the worker finishes the book.
        await new Promise(resolve => setTimeout(resolve, 1200));
        const finished = await call(route, 'GET', undefined, cookie);
        assert.equal(finished.data.translation.job.status, 'completed');
        assert.equal(finished.data.translation.rows.length, chunks.length);
        assert.equal(finished.data.translation.rows[0].target, 'Reader edit');
        assert.equal(finished.data.translation.rows[0].bookmarked, true);
        const afterStaleSave = await call(route, 'PUT', stale, cookie);
        assert.equal(afterStaleSave.data.translation.rows.length, chunks.length);
        assert.equal(afterStaleSave.data.translation.progress.nextChunk, chunks.length);
        const calls = (await readFile(traceFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        assert.deepEqual(calls.map(call => call.text), chunks);
        assert.equal(calls[1].summary, paused.data.translation.summary);
        assert.equal(calls[1].previousContext, chunks[0]);
        const onDisk = JSON.parse(await readFile(dataFile, 'utf8'));
        assert.equal(onDisk.translations.find(item => item.id === id).job.status, 'completed');
        const spent = chunks.reduce((sum, chunk) => sum + countSourceTokens(chunk), 0);
        assert.equal(finished.data.subscription.prepaidTokens, initialTokens - spent);
        assert.equal(onDisk.billingLedger.filter(entry => entry.userId === registered.data.user.id && entry.kind === 'usage').length, chunks.length);
    } finally { server.kill(); await rm(directory, { recursive: true, force: true }); }
});
