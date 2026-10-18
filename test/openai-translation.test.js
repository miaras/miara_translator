import test from 'node:test';
import assert from 'node:assert/strict';
import { translateWithOpenAI } from '../openai-translation.js';

function response(text) {
    return { ok: true, json: async () => ({ status: 'completed', output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text }] }
    ] }) };
}

test('translation uses Terra structured output and keeps the API key on the server', async () => {
    let sent;
    const fetchMock = async (url, options) => {
        sent = { url, options };
        return response(JSON.stringify({ alignedRows: [{ source: 'Hello.', target: '안녕하세요.', newParagraph: false }], newSummary: 'A greeting.', newProperNouns: [{ source: 'Shiroko', target: '시로코' }] }));
    };
    const result = await translateWithOpenAI({ mode: 'translate', text: 'Hello.', targetLanguage: 'Korean', instructions: 'Formal tone' }, fetchMock, 'test-key');
    assert.equal(sent.url, 'https://api.openai.com/v1/responses');
    assert.equal(sent.options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(sent.options.body);
    assert.equal(body.model, 'gpt-5.6-terra');
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(result.newProperNouns, { Shiroko: '시로코' });
    assert.equal(result.alignedRows[0].target, '안녕하세요.');
});

test('regeneration returns plain text and reports rate limits', async () => {
    let body;
    const regenerated = await translateWithOpenAI({ mode: 'regenerate', text: 'Hello.', targetLanguage: 'Korean' }, async (_url, options) => {
        body = JSON.parse(options.body);
        return response(' 안녕하세요. ');
    }, 'test-key');
    assert.equal(body.text, undefined);
    assert.deepEqual(regenerated, { translation: '안녕하세요.' });
    await assert.rejects(translateWithOpenAI({ mode: 'regenerate', text: 'Hello.', targetLanguage: 'Korean' }, async () => ({ ok: false, status: 429 }), 'test-key'), /rate limited/);
});
