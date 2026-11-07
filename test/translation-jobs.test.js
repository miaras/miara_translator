import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationJobs } from '../translation-jobs.js';
import { sourceChunks } from '../source-tokens.js';

const user = { id: 'reader' };
const sourceText = Array.from({ length: 350 }, (_, index) => `Source sentence ${index} with some detail. `).join('').trim();
const chunks = sourceChunks(sourceText);
const input = { sourceText, targetLang: 'French', instructions: 'Keep the tone.', customTerms: { Alice: 'Pinned Alice' }, mode: 'translate', speed: 'standard' };
const result = (request, index) => ({ alignedRows: [{ source: request.text, target: `Translation ${index + 1}.`, newParagraph: true,
    ...(request.mode === 'improve' ? { originalTranslation: request.draftSentences[0].trim() } : {}) }], newSummary: `Summary through ${index + 1}.`, sourceLanguage: 'English', newProperNouns: { Alice: 'Model Alice', Bob: 'Robert' }, ...(request.mode === 'improve' ? { consumedDraftSentences: 1 } : {}) });
async function until(predicate) {
    for (let index = 0; index < 300; index++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail('Job did not reach the expected state');
}
function harness(translator) {
    const store = { translations: [] }, calls = [];
    let disk;
    const jobs = createTranslationJobs({ store, persist: async () => { disk = structuredClone(store); }, documentInput: value => structuredClone(value),
        translate: async (_user, request) => {
            const index = chunks.indexOf(request.text);
            if (translator) { calls.push({ request }); return translator(request, index); }
            return new Promise((resolve, reject) => { calls.push({ request, resolve: () => resolve(result(request, index)), reject }); });
        } });
    return { jobs, store, calls, disk: () => disk };
}

test('a server job finishes and persists without any subsequent browser request', async () => {
    const app = harness(async (request, index) => { await new Promise(resolve => setTimeout(resolve, 10)); return result(request, index); });
    const document = await app.jobs.create(user, input);
    assert.equal(document.job.status, 'running');
    await until(() => document.job.status === 'completed');
    assert.equal(app.calls.length, chunks.length);
    assert.equal(document.rows.length, chunks.length);
    assert.equal(document.progress.nextChunk, chunks.length);
    assert.equal(app.disk().translations[0].job.status, 'completed');
    assert.deepEqual(app.calls[1].request.dictionary, { Bob: 'Robert', Alice: 'Pinned Alice' });
    assert.equal(app.calls[1].request.summary, 'Summary through 1.');
    assert.equal(app.calls[1].request.previousContext, chunks[0]);
    assert.equal(app.calls[1].request.previousTranslatedText, 'Translation 1.');
});

test('duplicate starts share a worker; Stop saves the active chunk and Resume starts the next', async () => {
    const app = harness();
    const [document, duplicate] = await Promise.all([app.jobs.create(user, input), app.jobs.create(user, input)]);
    assert.equal(duplicate.id, document.id);
    assert.equal(app.store.translations.length, 1);
    await app.jobs.start(user, document.id);
    assert.equal(app.calls.length, 1);
    await app.jobs.stop(user, document.id);
    assert.equal(document.job.status, 'stopping');
    await assert.rejects(() => app.jobs.start(user, document.id), error => error.status === 409);
    app.calls[0].resolve();
    await until(() => document.job.status === 'paused');
    assert.equal(app.calls.length, 1);
    assert.equal(document.rows.length, 1);
    assert.equal(app.disk().translations[0].progress.nextChunk, 1);
    await app.jobs.start(user, document.id, 'fast');
    assert.equal(app.calls[1].request.text, chunks[1]);
    assert.equal(app.calls[1].request.speed, 'fast');
    await app.jobs.stop(user, document.id);
    app.calls[1].resolve();
    await until(() => document.job.status === 'paused');
    assert.equal(document.rows.length, 2);
});

test('older partial saves resume on the server, preserving context and edits made during a request', async () => {
    const app = harness();
    const legacy = { id: 'old', userId: user.id, title: 'Older book', ...input, rows: [{ source: chunks[0], target: 'Old translation.' }], summary: 'Old summary.', dictionary: { Alice: 'Pinned Alice' }, updatedAt: new Date().toISOString() };
    app.store.translations.push(legacy);
    await app.jobs.start(user, 'old');
    assert.equal(app.calls[0].request.text, chunks[1]);
    assert.equal(app.calls[0].request.summary, 'Old summary.');
    assert.equal(app.calls[0].request.previousTranslatedText, 'Old translation.');
    const stale = { ...structuredClone(legacy), rows: [{ ...legacy.rows[0], target: 'Reader edit.', bookmarked: true }], summary: 'STALE', dictionary: { stale: 'dictionary' } };
    app.jobs.mergeEdits(legacy, stale);
    await app.jobs.stop(user, 'old');
    app.calls[0].resolve();
    await until(() => legacy.job.status === 'paused');
    assert.equal(legacy.rows[0].target, 'Reader edit.');
    assert.equal(legacy.rows[0].bookmarked, true);
    assert.equal(legacy.rows.length, 2);
    assert.equal(legacy.summary, 'Summary through 2.');
    app.jobs.mergeEdits(legacy, stale);
    assert.equal(legacy.rows.length, 2, 'stale autosave cannot truncate new server rows');
    assert.equal(legacy.progress.nextChunk, 2);
    assert.equal(legacy.dictionary.Bob, 'Robert');
    assert.throws(() => app.jobs.mergeEdits(legacy, { ...stale, sourceText: 'Different book' }), error => error.status === 409);
});

test('improvement retains the original draft and exact draft cursor through Stop and Resume', async () => {
    const app = harness();
    const document = await app.jobs.create(user, { ...input, mode: 'improve', existingTranslation: 'First draft. Second draft. Third draft.' });
    assert.equal(app.calls[0].request.draftSentences[0], 'First draft. ');
    await app.jobs.stop(user, document.id); app.calls[0].resolve();
    await until(() => document.job.status === 'paused');
    assert.equal(document.progress.draftCursor, 1);
    await app.jobs.start(user, document.id);
    assert.equal(app.calls[1].request.draftSentences[0], 'Second draft. ');
    await app.jobs.stop(user, document.id); app.calls[1].resolve();
    await until(() => document.job.status === 'paused');
    assert.equal(document.progress.draftCursor, 2);
    assert.equal(document.rows[0].originalTranslation, 'First draft.');
});

test('failed requests do not advance the checkpoint; ownership is enforced by every control', async () => {
    const app = harness();
    const document = await app.jobs.create(user, input);
    const error = new Error('No allowance'); error.status = 402; app.calls[0].reject(error);
    await until(() => document.job.status === 'failed');
    assert.equal(document.progress.nextChunk, 0);
    assert.equal(document.rows.length, 0);
    assert.match(document.job.error, /allowance/);
    for (const operation of [() => app.jobs.start({ id: 'someone-else' }, document.id), () => app.jobs.stop({ id: 'someone-else' }, document.id), () => app.jobs.speed({ id: 'someone-else' }, document.id, 'fast')]) {
        await assert.rejects(operation, error => error.status === 404);
    }
    await app.jobs.start(user, document.id);
    assert.equal(app.calls[1].request.text, chunks[0]);
    await app.jobs.stop(user, document.id); app.calls[1].resolve();
    await until(() => document.job.status === 'paused');
});

test('server restart recovery pauses interrupted work at the saved checkpoint', async () => {
    const app = harness();
    const document = await app.jobs.create(user, input);
    await app.jobs.stop(user, document.id); app.calls[0].resolve();
    await until(() => document.job.status === 'paused');
    document.job.status = 'running';
    const completed = structuredClone(document);
    completed.id = 'finished-before-restart'; completed.progress.nextChunk = completed.progress.totalChunks;
    app.store.translations.push(completed);
    await app.jobs.recover();
    assert.equal(completed.job.status, 'completed');
    assert.equal(completed.job.error, undefined);
    assert.equal(document.job.status, 'paused');
    assert.equal(document.progress.nextChunk, 1);
    assert.match(document.job.error, /server restarted/);
    assert.equal(app.calls.length, 1);
    await app.jobs.start(user, document.id); await app.jobs.stop(user, document.id); app.calls[1].resolve();
    await until(() => document.job.status === 'paused');
});
