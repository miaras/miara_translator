import test from 'node:test';
import { sourceChunks } from '../source-tokens.js';
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
        const document = { title: 'First sentence', sourceText: 'First sentence. Second sentence.', targetLang: 'Korean', instructions: 'Formal tone', dictionary: { sentence: '문장' }, customTerms: { sentence: '문장' }, summary: 'Two sentences.', rows: [{ source: 'First sentence.', target: '첫 번째 문장.', originalTranslation: '첫 문장.', newParagraph: false, bookmarked: true }, { source: 'Second sentence.', target: '두 번째 문장.', newParagraph: true }] };
        const saved = await call('/api/translations', 'POST', document, first.cookie);
        assert.equal(saved.status, 201);
        const id = saved.data.translation.id;
        assert.deepEqual((await call(`/api/translations/${id}`, 'GET', undefined, first.cookie)).data.translation.rows, document.rows);
        assert.equal((await call(`/api/translations/${id}`, 'GET', undefined, second.cookie)).status, 404);
        assert.equal((await call('/api/translations', 'GET', undefined, second.cookie)).data.translations.length, 0);
        document.rows[0].bookmarked = false;
        document.rows[1].bookmarked = true;
        document.rows[1].target = '수정한 문장.';
        assert.equal((await call(`/api/translations/${id}`, 'PUT', document, first.cookie)).status, 200);
        assert.equal((await call(`/api/translations/${id}`, 'GET', undefined, first.cookie)).data.translation.rows[1].target, '수정한 문장.');
        const onDisk = JSON.parse(await readFile(path.join(directory, 'store.json'), 'utf8'));
        assert.equal(onDisk.translations.find(item => item.id === id).rows[1].target, '수정한 문장.');
        assert.equal(onDisk.translations.find(item => item.id === id).rows[0].bookmarked, undefined);
        assert.equal(onDisk.translations.find(item => item.id === id).rows[1].bookmarked, true);
        assert.deepEqual(onDisk.translations.find(item => item.id === id).customTerms, document.customTerms);
        const invalidBookmark = structuredClone(document); invalidBookmark.rows[0].bookmarked = 'yes';
        assert.equal((await call(`/api/translations/${id}`, 'PUT', invalidBookmark, first.cookie)).status, 400);
        assert.deepEqual(onDisk.translations.find(item => item.id === id).dictionary, document.dictionary);
        assert.equal(onDisk.translations.find(item => item.id === id).summary, document.summary);
        assert.equal((await call('/api/translate', 'POST', { mode: 'improve', text: 'Hello.', targetLanguage: 'Korean', existingTranslation: '안녕.', draftSentences: ['different'], isLastChunk: true })).status, 400);
        const longSource = 'A source sentence with some detail. '.repeat(400);
        const chunks = sourceChunks(longSource);
        const partialDocument = { title: 'Legacy partial', sourceText: longSource, targetLang: 'French', instructions: '', summary: 'Keep this summary.', dictionary: { name: 'Nom' }, rows: [{ source: chunks[0], target: 'Completed first chunk.', bookmarked: true }] };
        const legacySaved = await call('/api/translations', 'POST', partialDocument, first.cookie);
        const resumeInput = { sourceText: longSource, targetLang: 'French', instructions: '', mode: 'translate' };
        const resumeCall = (input, cookie = first.cookie) => call('/api/translations/resume', 'POST', input, cookie);
        assert.equal((await resumeCall(resumeInput, second.cookie)).data.translation, null);
        assert.equal((await resumeCall({ ...resumeInput, targetLang: 'German' })).data.translation, null);
        assert.equal((await resumeCall({ ...resumeInput, instructions: 'Different style' })).data.translation, null);
        assert.equal((await resumeCall({ ...resumeInput, customTerms: { name: 'Different' } })).data.translation, null);
        const recovered = (await resumeCall(resumeInput)).data.translation;
        assert.equal(recovered.id, legacySaved.data.translation.id);
        assert.equal(recovered.progress.nextChunk, 1);
        assert.equal(recovered.summary, partialDocument.summary);
        assert.deepEqual(recovered.dictionary, partialDocument.dictionary);
        assert.equal(recovered.rows[0].bookmarked, true);
        const recoveredPath = `/api/translations/${recovered.id}`;
        assert.deepEqual((await call(recoveredPath, 'GET', undefined, first.cookie)).data.translation.progress, recovered.progress);
        assert.equal((await call(recoveredPath, 'PUT', { ...recovered, progress: { ...recovered.progress, nextChunk: 1000 } }, first.cookie)).status, 400);
        assert.equal((await call(recoveredPath, 'PUT', partialDocument, first.cookie)).status, 200);
        assert.equal((await call(recoveredPath, 'GET', undefined, first.cookie)).data.translation.progress, undefined);
        const done = { ...recovered, rows: chunks.map(source => ({ source, target: 'Done.' })), progress: { ...recovered.progress, nextChunk: chunks.length } };
        assert.equal((await call(recoveredPath, 'PUT', done, first.cookie)).status, 200);
        assert.equal((await resumeCall(resumeInput)).data.translation, null);
        const improvement = { ...partialDocument, instructions: 'Improve', rows: [{ ...partialDocument.rows[0], originalTranslation: 'First draft.' }] };
        const improvementSaved = await call('/api/translations', 'POST', improvement, first.cookie);
        const improveResume = (await resumeCall({ ...resumeInput, mode: 'improve', instructions: 'Improve', existingTranslation: 'First draft. Second draft.' })).data.translation;
        assert.equal(improveResume.id, improvementSaved.data.translation.id);
        assert.equal(improveResume.progress.draftCursor, 1);
        assert.equal((await call('/api/logout', 'POST', {}, first.cookie)).status, 200);
        assert.equal((await call('/api/translations', 'GET', undefined, first.cookie)).status, 401);
        const login = await call('/api/login', 'POST', { email: 'one@example.com', password: 'a-long-password-123' });
        assert.equal(login.status, 200);
        assert.ok((await call('/api/translations', 'GET', undefined, login.cookie)).data.translations.some(item => item.id === id));
    } finally {
        server.kill();
        await rm(directory, { recursive: true, force: true });
    }
});
