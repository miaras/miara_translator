import { readFile, writeFile } from 'node:fs/promises';

process.loadEnvFile(new URL('../.env', import.meta.url));
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required.');
const languages = JSON.parse(await readFile(new URL('../languages.json', import.meta.url), 'utf8'));
const source = 'The meaning lives between the lines.';
const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
        model: 'gpt-6.1-sol', service_tier: 'default', store: false,
        reasoning: { effort: 'low' },
        input: [
            { role: 'developer', content: 'You are a literary translator. Translate the supplied headline naturally and concisely into every requested language using its native writing system. Preserve the metaphor of implicit meaning between written lines, and the elegant tone. For English, reproduce the original exactly. Use Simplified Chinese for Chinese, Serbian Cyrillic for Serbian, and Gurmukhi for Punjabi. Return only the requested JSON.' },
            { role: 'user', content: JSON.stringify({ source, languages }) }
        ],
        text: { format: {
            type: 'json_schema', name: 'headline_translations', strict: true,
            schema: { type: 'object', properties: Object.fromEntries(languages.map(({ code }) => [code, { type: 'string' }])), required: languages.map(({ code }) => code), additionalProperties: false }
        } }
    })
});
if (!response.ok) throw new Error(`OpenAI request failed (${response.status}).`);
const result = await response.json();
if (result.status !== 'completed') throw new Error('Translation generation did not complete.');
const text = result.output.flatMap(item => item.type === 'message' ? item.content : []).filter(item => item.type === 'output_text').map(item => item.text).join('');
const translations = JSON.parse(text);
if (languages.some(({ code }) => typeof translations[code] !== 'string' || !translations[code].trim())) throw new Error('Missing translations.');
await writeFile(new URL('../headline-translations.json', import.meta.url), JSON.stringify({ model: result.model, source, translations }, null, 2) + '\n');
console.log(`Generated ${languages.length} headline translations using ${result.model}.`);
