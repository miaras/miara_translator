import test from 'node:test';
import assert from 'node:assert/strict';
import { sentenceResearchInput, validateResearchInput, researchAllowance, safeResearchSource } from '../sentence-research-input.js';
import { researchSentence } from '../sentence-research.js';
import { createSentenceResearchApi } from '../sentence-research-api.js';
import { createAllowanceBilling } from '../allowance-billing.js';

const state = { rows: Array.from({ length: 7 }, (_, index) => ({ source: `Source ${index}.`, target: `Translation ${index}.` })), summary: 'A book about Seokguram.', targetLang: 'French', dictionary: { Seokguram: 'Seokguram', absent: 'missing' } };
state.rows[3] = { source: 'They visited Seokguram.', target: 'Ils ont visité Seokguram.' };
const input = sentenceResearchInput(state, 3);
function providerResult() {
    const text = '**Seokguram** is a Buddhist grotto. [1]';
    return { status: 'completed', usage: { input_tokens: 1200, output_tokens: 80 }, output: [
        { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: 'https://whc.unesco.org/en/list/736/', title: 'UNESCO — Seokguram' }, { type: 'url', url: 'javascript:alert(1)' }] } },
        { type: 'message', content: [{ type: 'output_text', text, annotations: [{ type: 'url_citation', start_index: text.indexOf('[1]'), end_index: text.length, url: 'https://whc.unesco.org/en/list/736/', title: 'UNESCO — Seokguram' }] }] }
    ] };
}
const ok = data => ({ ok: true, json: async () => data });

test('research includes exactly two neighbors on either side, both languages, summary, and relevant terms', () => {
    assert.deepEqual(input.before, state.rows.slice(1, 3));
    assert.deepEqual(input.after, state.rows.slice(4, 6));
    assert.equal(input.text, state.rows[3].source);
    assert.equal(input.translatedText, state.rows[3].target);
    assert.equal(input.summary, state.summary);
    assert.deepEqual(input.dictionary, { Seokguram: 'Seokguram' });
    assert.deepEqual(sentenceResearchInput(state, 0).before, []);
    assert.equal(sentenceResearchInput(state, 0).after.length, 2);
    assert.deepEqual(sentenceResearchInput(state, 6).after, []);
    assert.ok(researchAllowance(input) > 1000);
    assert.throws(() => validateResearchInput({ ...input, before: state.rows.slice(0, 3) }));
    assert.throws(() => validateResearchInput({ ...input, summary: 'x'.repeat(10001) }));
    assert.throws(() => validateResearchInput({ ...input, after: [{ source: null, target: '' }] }));
    assert.equal(safeResearchSource({ url: 'javascript:alert(1)' }), null);
    assert.equal(safeResearchSource({ url: 'https://example.com/page?utm_source=openai&id=1' }).url, 'https://example.com/page?id=1');
    assert.equal(safeResearchSource({ url: 'https://user:password@example.com/' }), null);
});

test('provider must search, uses book and local context, and exposes genuine safe source citations', async () => {
    let sent;
    const result = await researchSentence(input, { apiKey: 'test-key', fetchImpl: async (url, options) => {
        assert.equal(url, 'https://api.openai.com/v1/responses');
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        sent = JSON.parse(options.body); return ok(providerResult());
    } });
    assert.equal(sent.model, 'gpt-6.1-sol');
    assert.equal(sent.store, false);
    assert.equal(sent.tool_choice, 'required');
    assert.equal(sent.tools[0].type, 'web_search');
    assert.deepEqual(sent.include, ['web_search_call.action.sources']);
    assert.deepEqual(JSON.parse(sent.input[1].content), input);
    assert.match(sent.input[0].content, /untrusted content/);
    assert.match(sent.input[0].content, /interpretation/);
    assert.equal(result.sources.length, 1);
    assert.equal(result.citations[0].url, 'https://whc.unesco.org/en/list/736/');
    assert.equal(result.text.slice(result.citations[0].start, result.citations[0].end), '[1]');
    assert.deepEqual(result.specialTerms, [{ source: 'Seokguram', target: 'Seokguram' }]);
});

test('ungrounded, uncited, incomplete and failed research is rejected', async () => {
    const noSearch = providerResult(); noSearch.output.shift();
    const noCitations = providerResult(); noCitations.output[1].content[0].annotations = [];
    const unsafe = providerResult(); unsafe.output[1].content[0].annotations[0].url = 'javascript:alert(1)';
    const noUsage = providerResult(); delete noUsage.usage;
    for (const result of [noSearch, noCitations, unsafe, noUsage, { status: 'incomplete', output: [] }]) {
        await assert.rejects(() => researchSentence(input, { apiKey: 'test', fetchImpl: async () => ok(result) }));
    }
    await assert.rejects(() => researchSentence(input, { apiKey: 'test', fetchImpl: async () => ({ ok: false, status: 429 }) }), /busy/);
});

function apiHarness(fetchImpl) {
    const store = { billingLedger: [{ userId: 'one', amountMicros: 1000000 }, { userId: 'two', amountMicros: 1000000 }], subscriptionUsage: [], subscriptions: [], subscriptionPeriods: [] };
    const billing = createAllowanceBilling({ store, persist: async () => {}, transaction: work => work(), service: 'research' });
    const api = createSentenceResearchApi({ store, persist: async () => {}, body: async req => req.input, userFor: req => req.userId ? { id: req.userId } : null,
        json: (res, status, data) => Object.assign(res, { status, data }), ...billing, account: () => ({}), apiKey: 'test', fetchImpl });
    return { store, async call(value = input, userId = 'one', method = 'POST') { const res = {}; await api({ method, input: value, userId }, res, { pathname: '/api/research' }); return res; } };
}

test('research charges once, shares concurrent work, caches per user, and invalidates changed context', async () => {
    let calls = 0, unblock;
    const gate = new Promise(resolve => { unblock = resolve; });
    const app = apiHarness(async () => { calls++; await gate; return ok(providerResult()); });
    const first = app.call(), second = app.call();
    unblock();
    const replies = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.deepEqual(replies.map(reply => reply.status), [200, 200]);
    assert.equal(app.store.researchReservations.length, 1);
    assert.equal(app.store.researchReservations[0].status, 'settled');
    assert.equal(app.store.researchReservations[0].actualTokens, researchAllowance(input));
    assert.equal(app.store.ocrReservations, undefined);
    assert.ok(app.store.billingLedger.slice(2).every(entry => entry.service === 'research'));
    const cached = await app.call();
    assert.equal(cached.data.cached, true);
    assert.equal(cached.data.allowanceTokens, 0);
    assert.equal(calls, 1);
    await app.call(input, 'two');
    assert.equal(calls, 2);
    await app.call({ ...input, summary: 'The book context changed.' });
    assert.equal(calls, 3);
});

test('research requires authentication and valid context, and refunds failed or uncited results', async () => {
    let calls = 0;
    const app = apiHarness(async () => { calls++; return { ok: false, status: 500 }; });
    assert.equal((await app.call(input, null)).status, 401);
    assert.equal((await app.call({ ...input, after: [1, 2, 3] })).status, 400);
    assert.equal((await app.call(input, 'one', 'GET')).status, 405);
    assert.equal(calls, 0);
    const failed = await app.call();
    assert.equal(failed.status, 502);
    assert.equal(app.store.researchReservations[0].status, 'released');
    assert.equal(app.store.billingLedger.filter(entry => entry.userId === 'one').reduce((sum, entry) => sum + entry.amountMicros, 0), 1000000);
    assert.equal(app.store.sentenceResearch.length, 0);
    const noFunds = apiHarness(async () => { assert.fail('Provider must not run without allowance'); });
    noFunds.store.billingLedger = [];
    assert.equal((await noFunds.call()).status, 402);
});
