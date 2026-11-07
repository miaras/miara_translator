import { sourceChunks } from './source-tokens.js';

const compact = text => text.replace(/\s/gu, '');
export const sameSource = (a, b) => a.replace(/\r\n?/g, '\n').trim() === b.replace(/\r\n?/g, '\n').trim();
export const sameTerms = (a = {}, b = {}) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => b[key] === value);
export const draftSegments = text => Array.from(new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text), ({ segment }) => segment.match(/[\s\S]{1,5000}/gu) || []).flat();

export function validProgress(progress, sourceText) {
    if (!progress || progress.version !== 1 || !['translate', 'improve'].includes(progress.mode)) return false;
    const count = sourceChunks(sourceText).length;
    return progress.totalChunks === count && Number.isInteger(progress.nextChunk) && progress.nextChunk >= 0 && progress.nextChunk <= count
        && Number.isInteger(progress.draftCursor) && progress.draftCursor >= 0
        && typeof progress.existingTranslation === 'string'
        && typeof progress.previousTranslatedText === 'string' && progress.previousTranslatedText.length <= 4000
        && (progress.mode !== 'improve' || (!!progress.existingTranslation.trim() && progress.draftCursor <= draftSegments(progress.existingTranslation).length));
}

// Older saves have no checkpoint. Only resume when all saved source rows match
// an exact prefix ending at a chunk boundary; never infer progress by row count.
export function resumableProgress(document, suppliedDraft = null) {
    if (document.progress) return validProgress(document.progress, document.sourceText) && document.progress.nextChunk < document.progress.totalChunks ? document.progress : null;
    if (!document.rows?.length) return null;
    const improve = document.rows.some(row => row.originalTranslation !== undefined);
    let draftCursor = 0;
    if (improve) {
        if (typeof suppliedDraft !== 'string' || !suppliedDraft.trim()) return null;
        const used = compact(document.rows.map(row => row.originalTranslation || '').join(''));
        let prefix = '';
        for (const segment of draftSegments(suppliedDraft)) {
            if (prefix === used) break;
            prefix += compact(segment); draftCursor++;
        }
        if (prefix !== used) return null;
    }
    const chunks = sourceChunks(document.sourceText);
    const saved = compact(document.rows.map(row => row.source).join(''));
    let prefix = '';
    for (let index = 0; index < chunks.length; index++) {
        const previousLength = prefix.length;
        prefix += compact(chunks[index]);
        if (prefix.length > saved.length || !saved.startsWith(prefix)) return null;
        if (prefix !== saved) continue;
        if (index + 1 === chunks.length) return null;
        let length = 0;
        const lastRows = document.rows.filter(row => {
            length += compact(row.source).length;
            return length > previousLength;
        });
        return { version: 1, mode: improve ? 'improve' : 'translate', nextChunk: index + 1, totalChunks: chunks.length, draftCursor, existingTranslation: improve ? suppliedDraft : '', previousTranslatedText: lastRows.map(row => row.target).join(' ').slice(-4000) };
    }
    return null;
}
