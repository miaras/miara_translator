const MODEL = 'gpt-6.1-sol';
const URL = 'https://api.openai.com/v1/responses';

const translationSchema = {
    type: 'object',
    properties: {
        alignedRows: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    source: { type: 'string' },
                    target: { type: 'string' },
                    newParagraph: { type: 'boolean' }
                },
                required: ['source', 'target', 'newParagraph'],
                additionalProperties: false
            }
        },
        newSummary: { type: 'string' },
        newProperNouns: {
            type: 'array',
            items: {
                type: 'object',
                properties: { source: { type: 'string' }, target: { type: 'string' } },
                required: ['source', 'target'],
                additionalProperties: false
            }
        }
    },
    required: ['alignedRows', 'newSummary', 'newProperNouns'],
    additionalProperties: false
};

function outputText(result) {
    if (result.status !== 'completed') throw new Error('OpenAI did not complete the response.');
    const text = result.output?.flatMap(item => item.type === 'message' ? item.content || [] : [])
        .filter(item => item.type === 'output_text').map(item => item.text).join('');
    if (!text) throw new Error('OpenAI returned no translation.');
    return text;
}

export async function translateWithOpenAI(input, fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the server.');
    const { mode, text, targetLanguage, instructions = '', summary = '', dictionary = {}, previousContext = '', previousTranslatedText = '', contextBefore = '', contextAfter = '' } = input;
    const regenerate = mode === 'regenerate';
    const payload = {
        model: MODEL,
        store: false,
        reasoning: { effort: 'low' },
        input: [
            { role: 'developer', content: regenerate
                ? 'Translate the target sentence accurately into the requested language. Use the context and style instructions. Return only the translated sentence.'
                : 'Translate the supplied text accurately into the requested language. Align each source sentence with its translation, preserve paragraph starts, keep terms consistent with the dictionary, update the concise running summary, and list newly encountered proper nouns with their translations. Use the previous translation for consistent style, tense, and formality. For Korean and Japanese, keep sentence endings consistent.' },
            { role: 'user', content: JSON.stringify(regenerate
                ? { targetLanguage, instructions, contextBefore, text, contextAfter }
                : { targetLanguage, instructions, summary, dictionary, previousContext, previousTranslatedText, text }) }
        ]
    };
    if (!regenerate) payload.text = { format: { type: 'json_schema', name: 'aligned_translation', strict: true, schema: translationSchema } };

    const response = await fetchImpl(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        if (response.status === 429) throw new Error('OpenAI is rate limited. Please try again shortly.');
        throw new Error(`OpenAI request failed (${response.status}).`);
    }
    const result = await response.json();
    const textOutput = outputText(result);
    if (regenerate) return { translation: textOutput.trim() };
    const parsed = JSON.parse(textOutput);
    if (!Array.isArray(parsed.alignedRows) || typeof parsed.newSummary !== 'string' || !Array.isArray(parsed.newProperNouns)) throw new Error('OpenAI returned an invalid translation.');
    return {
        alignedRows: parsed.alignedRows,
        newSummary: parsed.newSummary,
        newProperNouns: Object.fromEntries(parsed.newProperNouns.map(({ source, target }) => [source, target]))
    };
}
