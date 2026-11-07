import test from 'node:test';
import assert from 'node:assert/strict';
import { priceMicros } from '../pricing.js';
import { countSourceTokens, sourceChunks } from '../source-tokens.js';

test('fixed source prices exclude provider output and context', () => {
    assert.equal(priceMicros('standard', 100_000), 5_000_000);
    assert.equal(priceMicros('fast', 100_000), 10_000_000);
    assert.equal(priceMicros('ultrafast', 100_000), 30_000_000);
    assert.equal(priceMicros('standard', countSourceTokens('Hello.')), 100);
    assert.equal(priceMicros('standard', 0), 0);
    assert.throws(() => priceMicros('standard', -1));
    assert.throws(() => priceMicros('invalid', 100));
});
test('the live price counts the same source chunks submitted for billing', () => {
    const text = 'A long sentence. '.repeat(1000);
    const chunks = sourceChunks(text);
    assert.equal(chunks.join(''), text);
    assert.ok(chunks.every(chunk => chunk.length <= 5000));
    assert.equal(chunks.reduce((sum, chunk) => sum + priceMicros('standard', countSourceTokens(chunk)), 0),
        chunks.reduce((sum, chunk) => sum + countSourceTokens(chunk) * 50, 0));
});
