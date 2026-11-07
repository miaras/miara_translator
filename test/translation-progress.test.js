import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceChunks } from '../source-tokens.js';
import { resumableProgress, validProgress, sameSource, draftSegments } from '../translation-progress.js';

const sourceText = 'A source sentence with some detail. '.repeat(400);
const chunks = sourceChunks(sourceText);
const legacy = { sourceText, rows: [{ source: chunks[0], target: 'First translated chunk.', bookmarked: true }], summary: 'Saved summary.', dictionary: { name: 'Name' } };

test('legacy partial saves resume only at a verified source chunk boundary', () => {
    const progress = resumableProgress(legacy);
    assert.equal(progress.nextChunk, 1);
    assert.equal(progress.totalChunks, chunks.length);
    assert.equal(progress.previousTranslatedText, legacy.rows[0].target);
    assert.ok(validProgress(progress, sourceText));
    assert.equal(resumableProgress({ ...legacy, rows: [{ source: chunks[0].slice(0, -30), target: '' }] }), null);
    assert.equal(resumableProgress({ ...legacy, rows: [{ source: 'Different source.', target: '' }] }), null);
    assert.equal(resumableProgress({ ...legacy, rows: chunks.map(source => ({ source, target: '' })) }), null);
    assert.equal(resumableProgress({ ...legacy, rows: [] }), null);
});

test('checkpoint validation rejects incompatible and out-of-range progress', () => {
    const progress = resumableProgress(legacy);
    for (const changes of [{ version: 2 }, { nextChunk: -1 }, { nextChunk: 0.5 }, { nextChunk: 100 }, { totalChunks: 100 }, { draftCursor: -1 }, { previousTranslatedText: 'x'.repeat(4001) }]) {
        assert.equal(validProgress({ ...progress, ...changes }, sourceText), false);
        assert.equal(resumableProgress({ ...legacy, progress: { ...progress, ...changes } }), null);
    }
    assert.equal(resumableProgress({ ...legacy, progress: { ...progress, nextChunk: chunks.length } }), null);
    assert.equal(sameSource(' text\r\nnext ', 'text\nnext'), true);
    assert.equal(sameSource('text one', 'text two'), false);
});

test('legacy improvement requires the original draft and a verified draft prefix', () => {
    const existingTranslation = 'First draft sentence. Second draft sentence. Third draft sentence.';
    const segments = draftSegments(existingTranslation);
    const doc = { ...legacy, rows: [{ ...legacy.rows[0], originalTranslation: segments[0] }] };
    assert.equal(resumableProgress(doc), null);
    assert.equal(resumableProgress(doc, 'A different draft.'), null);
    const progress = resumableProgress(doc, existingTranslation);
    assert.equal(progress.mode, 'improve');
    assert.equal(progress.draftCursor, 1);
    assert.equal(progress.existingTranslation, existingTranslation);
    assert.ok(validProgress(progress, sourceText));
    assert.equal(validProgress({ ...progress, draftCursor: 1000 }, sourceText), false);
});
