import { Tiktoken } from 'js-tiktoken/lite';
import ranks from 'js-tiktoken/ranks/o200k_base';
// A stable source-only billing unit, independent of provider prompt/output usage.
let encoding;
export function countSourceTokens(text) {
    if (!text) return 0;
    encoding ||= new Tiktoken(ranks);
    return encoding.encode(text, [], []).length;
}
export function sourceChunks(text) {
    const chunks = [];
    let current = '';
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
    for (const { segment: sentence } of segmenter.segment(text)) {
        for (let offset = 0; offset < sentence.length; offset += 5000) {
            const segment = sentence.slice(offset, offset + 5000);
            if (current.length + segment.length > 5000 && current) {
                chunks.push(current);
                current = segment;
            } else current += segment;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}
