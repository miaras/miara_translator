import { appendFile } from 'node:fs/promises';
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') return nativeFetch(url, options);
    const payload = JSON.parse(options.body), input = JSON.parse(payload.input[1].content);
    await appendFile(process.env.TEST_JOB_TRACE, `${JSON.stringify(input)}\n`);
    await new Promise(resolve => setTimeout(resolve, 350));
    return Response.json({ status: 'completed', usage: { input_tokens: 100, output_tokens: 50 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        sourceLanguage: 'English', alignedRows: [{ source: input.text, target: `Translated: ${input.text.slice(0, 40)}`, newParagraph: true,
            ...(input.draftSentences ? { originalTranslation: input.draftSentences[0] || '' } : {}) }], newSummary: `Summary: ${input.text.slice(0, 40)}`,
        newProperNouns: [{ source: 'Name', target: 'Nom' }], ...(input.draftSentences ? { consumedDraftSentences: Math.min(1, input.draftSentences.length) } : {})
    }) }] }] });
};
