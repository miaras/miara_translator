import test from 'node:test';
import assert from 'node:assert/strict';
import { translateWithOpenAI } from '../openai-translation.js';

function response(text) {
    return { ok: true, json: async () => ({ status: 'completed', output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text }] }
    ] }) };
}

test('translation uses GPT-6.1 Sol structured output and keeps the API key on the server', async () => {
    let sent;
    const fetchMock = async (url, options) => {
        sent = { url, options };
        return response(JSON.stringify({ sourceLanguage: 'English', alignedRows: [{ source: 'Hello.', target: '안녕하세요.', newParagraph: false }], newSummary: 'A greeting.', newProperNouns: [{ source: 'Shiroko', target: '시로코' }] }));
    };
    const result = await translateWithOpenAI({ mode: 'translate', text: 'Hello.', targetLanguage: 'Korean', instructions: 'Formal tone' }, fetchMock, 'test-key');
    assert.equal(sent.url, 'https://api.openai.com/v1/responses');
    assert.equal(sent.options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(sent.options.body);
    assert.equal(body.model, 'gpt-6.1-sol');
    assert.equal(body.service_tier, 'default');
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(result.newProperNouns, { Shiroko: '시로코' });
    assert.equal(result.alignedRows[0].target, '안녕하세요.');
    assert.equal(result.sourceLanguage, 'English');
    assert.ok(body.text.format.schema.required.includes('sourceLanguage'));
});

test('regeneration returns plain text and reports rate limits', async () => {
    let body;
    const regenerated = await translateWithOpenAI({ mode: 'regenerate', text: 'Hello.', targetLanguage: 'Korean' }, async (_url, options) => {
        body = JSON.parse(options.body);
        return response(' 안녕하세요. ');
    }, 'test-key');
    assert.equal(body.text, undefined);
    assert.equal(body.service_tier, 'default');
    assert.deepEqual(regenerated, { translation: '안녕하세요.' });
    await assert.rejects(translateWithOpenAI({ mode: 'regenerate', text: 'Hello.', targetLanguage: 'Korean' }, async () => ({ ok: false, status: 429 }), 'test-key'), /rate limited/);
});

test('improvement carries the draft, running summary and terminology between chunks', async () => {
    let sent;
    const input = { mode: 'improve', text: 'Hello.', targetLanguage: 'Korean', instructions: 'Use formal language.', existingTranslation: '안녕. 다음.', draftSentences: ['안녕. ', '다음.'], isLastChunk: false, summary: 'A greeting.', dictionary: { Shiroko: '시로코' }, previousTranslatedText: '이전 문장.' };
    const fetchMock = async (_url, options) => {
        sent = JSON.parse(options.body);
        return response(JSON.stringify({ alignedRows: [{ source: 'Hello.', target: '안녕하세요.', originalTranslation: '안녕.', newParagraph: false }], newSummary: 'A formal greeting.', newProperNouns: [{ source: 'Shiroko', target: '시로코' }], consumedDraftSentences: 1 }));
    };
    const result = await translateWithOpenAI(input, fetchMock, 'test-key');
    const content = JSON.parse(sent.input[1].content);
    assert.equal(sent.service_tier, 'default');
    assert.deepEqual(content.draftSentences, input.draftSentences);
    assert.deepEqual(content.dictionary, input.dictionary);
    assert.equal(content.summary, input.summary);
    assert.equal(content.instructions, input.instructions);
    assert.equal(result.consumedDraftSentences, 1);
    assert.equal(sent.text.format.schema.properties.consumedDraftSentences.maximum, 2);
    await assert.rejects(translateWithOpenAI({ ...input, draftSentences: [] }, fetchMock, 'test-key'), /invalid draft position/);
});

for (const [speed, tier] of [['standard', 'default'], ['fast', 'fast'], ['ultrafast', 'ultrafast']]) {
    test(`${speed} selects the requested API tier for every action`, async () => {
        for (const mode of ['translate', 'improve', 'regenerate']) {
            await translateWithOpenAI({ mode, speed, text: 'Hello.', targetLanguage: 'Korean', draftSentences: [] }, async (_url, options) => {
                assert.equal(JSON.parse(options.body).service_tier, tier);
                return response(mode === 'regenerate' ? 'Hello.' : JSON.stringify({ alignedRows: [], newSummary: '', newProperNouns: [], consumedDraftSentences: 0 }));
            }, 'test-key');
        }
    });
}
test('invalid speed is rejected before calling OpenAI', async () => {
    await assert.rejects(translateWithOpenAI({ speed: 'invalid' }, () => assert.fail('Unexpected API call'), 'test-key'), /Invalid translation speed/);
});

test('sentence regeneration receives the saved terminology dictionary', async () => {
    let payload;
    await translateWithOpenAI({ mode: 'regenerate', text: 'Shiroko.', targetLanguage: 'Korean', dictionary: { Shiroko: '시로코' } }, async (_url, options) => {
        payload = JSON.parse(options.body);
        return response('시로코.');
    }, 'test-key');
    assert.deepEqual(JSON.parse(payload.input[1].content).dictionary, { Shiroko: '시로코' });
    assert.match(payload.input[0].content, /dictionary/);
});
