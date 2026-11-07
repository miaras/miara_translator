import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('accounts keep aligned translations private and editable', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'shiroko-test-'));
    const port = 32000 + Math.floor(Math.random() * 20000);
    const base = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ['server.js'], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), env: { ...process.env, PORT: String(port), SHIROKO_DATA_FILE: path.join(directory, 'store.json') }, stdio: 'ignore' });
    try {
        for (let i = 0; i < 50; i++) {
            try { await fetch(`${base}/api/me`); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
        }
        async function call(route, method = 'GET', body, cookie) {
            const response = await fetch(`${base}${route}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
            return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
        }
        const partial = await fetch(`${base}/app.html`, { headers: { Range: 'bytes=0-14' } });
        assert.equal(partial.status, 206);
        assert.equal(partial.headers.get('accept-ranges'), 'bytes');
        assert.match(partial.headers.get('content-range'), /^bytes 0-14\/\d+$/);
        assert.equal(await partial.text(), '<!DOCTYPE html>');
        const suffix = await fetch(`${base}/app.html`, { headers: { Range: 'bytes=-8' } });
        assert.equal(suffix.status, 206);
        assert.equal((await suffix.arrayBuffer()).byteLength, 8);
        assert.equal((await fetch(`${base}/app.html`, { headers: { Range: 'bytes=999999999-' } })).status, 416);
        const workerFile = (await readdir(new URL('../dist/assets/', import.meta.url))).find(file => file.startsWith('pdf.worker.') && file.endsWith('.mjs'));
        assert.ok(workerFile, 'Built PDF worker must exist.');
        const worker = await fetch(`${base}/assets/${workerFile}`);
        assert.equal(worker.status, 200);
        assert.match(worker.headers.get('content-type'), /^text\/javascript/);
        await worker.arrayBuffer();
        const first = await call('/api/register', 'POST', { email: 'one@example.com', password: 'a-long-password-123' });
        assert.equal(first.status, 201);
        assert.ok(first.cookie);
        const second = await call('/api/register', 'POST', { email: 'two@example.com', password: 'another-password-123' });
        assert.equal(second.status, 201);
        const document = { title: 'First sentence', sourceText: 'First sentence. Second sentence.', targetLang: 'Korean', instructions: 'Formal tone', dictionary: { sentence: '문장' }, summary: 'Two sentences.', rows: [{ source: 'First sentence.', target: '첫 번째 문장.', originalTranslation: '첫 문장.', newParagraph: false }, { source: 'Second sentence.', target: '두 번째 문장.', newParagraph: true }] };
        const saved = await call('/api/translations', 'POST', document, first.cookie);
        assert.equal(saved.status, 201);
        const id = saved.data.translation.id;
        assert.deepEqual((await call(`/api/translations/${id}`, 'GET', undefined, first.cookie)).data.translation.rows, document.rows);
        assert.equal((await call(`/api/translations/${id}`, 'GET', undefined, second.cookie)).status, 404);
        assert.equal((await call('/api/translations', 'GET', undefined, second.cookie)).data.translations.length, 0);
        document.rows[1].target = '수정한 문장.';
        assert.equal((await call(`/api/translations/${id}`, 'PUT', document, first.cookie)).status, 200);
        assert.equal((await call(`/api/translations/${id}`, 'GET', undefined, first.cookie)).data.translation.rows[1].target, '수정한 문장.');
        const onDisk = JSON.parse(await readFile(path.join(directory, 'store.json'), 'utf8'));
        assert.equal(onDisk.translations.find(item => item.id === id).rows[1].target, '수정한 문장.');
        assert.deepEqual(onDisk.translations.find(item => item.id === id).dictionary, document.dictionary);
        assert.equal(onDisk.translations.find(item => item.id === id).summary, document.summary);
        assert.equal((await call('/api/translate', 'POST', { mode: 'improve', text: 'Hello.', targetLanguage: 'Korean', existingTranslation: '안녕.', draftSentences: ['different'], isLastChunk: true })).status, 400);
        assert.equal((await call('/api/logout', 'POST', {}, first.cookie)).status, 200);
        assert.equal((await call('/api/translations', 'GET', undefined, first.cookie)).status, 401);
        const login = await call('/api/login', 'POST', { email: 'one@example.com', password: 'a-long-password-123' });
        assert.equal(login.status, 200);
        assert.equal((await call('/api/translations', 'GET', undefined, login.cookie)).data.translations[0].id, id);
    } finally {
        server.kill();
        await rm(directory, { recursive: true, force: true });
    }
});
