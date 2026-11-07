import { randomBytes } from 'node:crypto';
import { sourceChunks } from './source-tokens.js';
import { validSpeed } from './pricing.js';
import { mergeTerms } from './terminology.js';
import { draftSegments, resumableProgress, validProgress, sameSource, sameTerms } from './translation-progress.js';

const activeStatuses = new Set(['running', 'stopping']);
function failure(message, status = 400) { const error = new Error(message); error.status = status; return error; }

export function createTranslationJobs({ store, persist, translate, documentInput }) {
    const active = new Map();
    function touch(document) {
        document.updatedAt = new Date().toISOString();
        document.job.updatedAt = document.updatedAt;
    }
    function find(user, id) {
        const document = store.translations.find(item => item.id === id && item.userId === user.id);
        if (!document) throw failure('Translation not found.', 404);
        return document;
    }
    async function run(document, user) {
        try {
            const chunks = sourceChunks(document.sourceText);
            const draft = document.progress.mode === 'improve' ? draftSegments(document.progress.existingTranslation) : [];
            while (document.progress.nextChunk < chunks.length && document.job.status === 'running') {
                const index = document.progress.nextChunk;
                const dictionary = mergeTerms(document.dictionary, document.customTerms);
                const input = { mode: document.progress.mode, speed: document.job.speed, text: chunks[index],
                    targetLanguage: document.targetLang, instructions: document.instructions, summary: (document.summary || '').slice(-10_000),
                    dictionary, previousContext: index ? chunks[index - 1] : '', previousTranslatedText: document.progress.previousTranslatedText };
                if (input.mode === 'improve') {
                    const window = []; let length = 0;
                    for (const sentence of draft.slice(document.progress.draftCursor)) {
                        if (length + sentence.length > 30_000 && window.length) break;
                        window.push(sentence); length += sentence.length;
                    }
                    Object.assign(input, { draftSentences: window, existingTranslation: window.join(''), isLastChunk: index === chunks.length - 1 });
                }
                const result = await translate(user, input);
                const progress = { ...document.progress, nextChunk: index + 1,
                    draftCursor: document.progress.draftCursor + (input.mode === 'improve' ? result.consumedDraftSentences : 0),
                    previousTranslatedText: result.alignedRows?.map(row => row.target).join(' ').slice(-4000) || '' };
                const validated = documentInput({ ...document, rows: result.alignedRows, summary: result.newSummary, progress });
                if (!validated || !result.alignedRows.length) throw failure('The translated chunk could not be saved. Resume to try again.', 502);
                // Append to the live document: edits/bookmarks made during the provider
                // request remain intact, and no browser response is needed to checkpoint.
                document.rows.push(...validated.rows);
                document.progress = progress;
                document.summary = result.newSummary;
                document.dictionary = mergeTerms({ ...document.dictionary, ...result.newProperNouns }, document.customTerms);
                if (result.sourceLanguage) document.sourceLang = result.sourceLanguage;
                touch(document);
                await persist();
            }
            document.job.status = document.progress.nextChunk >= chunks.length ? 'completed' : 'paused';
            delete document.job.error;
            touch(document);
            await persist();
        } catch (error) {
            const stopping = document.job.status === 'stopping';
            document.job.status = stopping ? 'paused' : 'failed';
            document.job.error = stopping ? 'Stopped. The current chunk did not finish; resume to retry it.'
                : error.status === 402 ? 'Not enough allowance. Add credit, then resume.'
                    : error.status ? error.message : 'Translation stopped. Resume from the last saved chunk.';
            touch(document);
            await persist();
        }
    }
    async function start(user, id, speed = 'standard', suppliedDraft = null) {
        if (!validSpeed(speed)) throw failure('Invalid translation speed.');
        const document = find(user, id);
        if (document.job?.status === 'stopping') throw failure('Wait for the current chunk to finish stopping, then resume.', 409);
        if (active.has(id)) {
            if (document.job?.status === 'running') { await active.get(id).started; return document; }
            await active.get(id).promise;
        }
        const progress = resumableProgress(document, suppliedDraft);
        if (!progress) throw failure('No verified unfinished translation is available to resume.');
        document.progress = progress;
        document.job = { version: 1, status: 'running', speed, updatedAt: new Date().toISOString() };
        touch(document);
        const worker = {};
        active.set(id, worker);
        try { worker.started = persist(); await worker.started; }
        catch (error) { document.job.status = 'paused'; active.delete(id); throw error; }
        worker.promise = run(document, user).catch(error => {
            console.error('Could not persist translation job state:', error.message);
        }).finally(() => { if (active.get(id) === worker) active.delete(id); });
        return document;
    }
    async function create(user, input) {
        if (!input || !['translate', 'improve'].includes(input.mode) || !validSpeed(input.speed || 'standard')
            || typeof input.sourceText !== 'string' || !input.sourceText.trim() || typeof input.targetLang !== 'string'
            || !input.targetLang.trim() || input.targetLang.length > 80 || typeof input.instructions !== 'string'
            || (input.mode === 'improve' && (typeof input.existingTranslation !== 'string' || !input.existingTranslation.trim()))) throw failure('Translation job data is invalid.');
        const sourceText = input.sourceText.trim(), customTerms = input.customTerms || {};
        const chunks = sourceChunks(sourceText);
        const progress = { version: 1, mode: input.mode, nextChunk: 0, totalChunks: chunks.length, draftCursor: 0,
            existingTranslation: input.mode === 'improve' ? input.existingTranslation.trim() : '', previousTranslatedText: '' };
        const title = sourceText.split(/\n|[.!?。！？]/)[0].slice(0, 80).trim() || 'Untitled translation';
        const document = documentInput({ title, sourceText, targetLang: input.targetLang, instructions: input.instructions,
            rows: [], customTerms, dictionary: customTerms, summary: 'The beginning of the document.', progress });
        if (!document) throw failure('Translation job data is invalid.');
        const candidates = store.translations.filter(item => item.userId === user.id && sameSource(item.sourceText, sourceText)
            && item.targetLang === input.targetLang && item.instructions === input.instructions && sameTerms(item.customTerms, customTerms))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        for (const candidate of candidates) {
            const saved = resumableProgress(candidate, progress.existingTranslation);
            if (saved && saved.mode === input.mode && (saved.mode !== 'improve' || sameSource(saved.existingTranslation, progress.existingTranslation))) {
                return start(user, candidate.id, input.speed || 'standard', progress.existingTranslation);
            }
        }
        Object.assign(document, { id: randomBytes(16).toString('hex'), userId: user.id, updatedAt: new Date().toISOString() });
        store.translations.push(document);
        return start(user, document.id, input.speed || 'standard');
    }
    async function stop(user, id) {
        const document = find(user, id);
        if (document.job && activeStatuses.has(document.job.status)) {
            document.job.status = active.has(id) ? 'stopping' : 'paused';
            touch(document);
            await persist();
        }
        return document;
    }
    async function speed(user, id, value) {
        if (!validSpeed(value)) throw failure('Invalid translation speed.');
        const document = find(user, id);
        if (!document.job) throw failure('This translation has no server job.');
        document.job.speed = value; touch(document); await persist();
        return document;
    }
    async function recover() {
        let changed = false;
        for (const document of store.translations) {
            if (!document.job || !activeStatuses.has(document.job.status)) continue;
            const completed = validProgress(document.progress, document.sourceText) && document.progress.nextChunk === document.progress.totalChunks;
            document.job.status = completed ? 'completed' : 'paused';
            if (completed) delete document.job.error;
            else document.job.error = 'The server restarted. Resume from the last saved chunk.';
            touch(document); changed = true;
        }
        if (changed) await persist();
    }
    function mergeEdits(document, input) {
        if (!sameSource(document.sourceText, input.sourceText) || document.targetLang !== input.targetLang || document.instructions !== input.instructions
            || input.rows.length > document.rows.length || input.rows.some((row, index) => row.source !== document.rows[index].source)) {
            throw failure('The translation changed on the server. Refresh before saving.', 409);
        }
        input.rows.forEach((row, index) => {
            document.rows[index].target = row.target;
            if (row.bookmarked) document.rows[index].bookmarked = true;
            else delete document.rows[index].bookmarked;
        });
        document.title = input.title;
        document.customTerms = input.customTerms;
        document.dictionary = mergeTerms(document.dictionary, input.customTerms);
        touch(document);
    }
    return { create, start, stop, speed, recover, mergeEdits, find };
}
