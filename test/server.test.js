import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
        const first = await call('/api/register', 'POST', { email: 'one@example.com', password: 'a-long-password-123' });
        assert.equal(first.status, 201);
        assert.ok(first.cookie);
        const second = await call('/api/register', 'POST', { email: 'two@example.com', password: 'another-password-123' });
        assert.equal(second.status, 201);
        const document = { title: 'First sentence', sourceText: 'First sentence. Second sentence.', targetLang: 'Korean', instructions: 'Formal tone', rows: [{ source: 'First sentence.', target: '첫 번째 문장.', newParagraph: false }, { source: 'Second sentence.', target: '두 번째 문장.', newParagraph: true }] };
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
