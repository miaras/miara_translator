import { countSourceTokens } from './source-tokens.js';

export const RESEARCH_BASE_TOKENS = 1000;
const contains = (text, term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
export function matchingTerms(text, translatedText, dictionary = {}) {
    return Object.entries(dictionary).filter(([source, target]) => source.trim() && source.length <= 200 && typeof target === 'string' && target.trim() && target.length <= 200
        && (contains(text, source) || contains(translatedText, target))).map(([source, target]) => ({ source, target }));
}
export function sentenceResearchInput(state, index) {
    const row = state.rows[index];
    if (!row) throw new Error('This sentence is no longer available.');
    const pair = ({ source, target }) => ({ source, target });
    return validateResearchInput({ text: row.source, translatedText: row.target, targetLanguage: state.targetLang,
        summary: state.summary || '', before: state.rows.slice(Math.max(0, index - 2), index).map(pair), after: state.rows.slice(index + 1, index + 3).map(pair),
        dictionary: Object.fromEntries(matchingTerms(row.source, row.target, state.dictionary).slice(0, 50).map(({ source, target }) => [source, target])) });
}
export function validateResearchInput(value) {
    const string = (text, max) => typeof text === 'string' && text.length <= max;
    const context = rows => Array.isArray(rows) && rows.length <= 2 && rows.every(row => row && string(row.source, 20_000) && string(row.target, 20_000));
    if (!value || !string(value.text, 20_000) || !value.text.trim() || !string(value.translatedText, 20_000)
        || !string(value.targetLanguage, 80) || !value.targetLanguage.trim() || !string(value.summary, 10_000)
        || !context(value.before) || !context(value.after) || !value.dictionary || typeof value.dictionary !== 'object' || Array.isArray(value.dictionary)
        || Object.entries(value.dictionary).length > 50 || Object.entries(value.dictionary).some(([key, term]) => !key.trim() || key.length > 200 || !string(term, 200) || !term.trim())) {
        const error = new Error('Sentence research data is invalid.'); error.status = 400; throw error;
    }
    return { text: value.text, translatedText: value.translatedText, targetLanguage: value.targetLanguage, summary: value.summary,
        before: value.before.map(({ source, target }) => ({ source, target })), after: value.after.map(({ source, target }) => ({ source, target })),
        dictionary: Object.fromEntries(Object.entries(value.dictionary).sort(([a], [b]) => a.localeCompare(b))) };
}
export const researchAllowance = input => RESEARCH_BASE_TOKENS + countSourceTokens(JSON.stringify(input));

export function safeResearchSource(value) {
    try {
        const url = new URL(value.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
        return { url: url.href, title: typeof value.title === 'string' && value.title.trim() ? value.title.slice(0, 500) : url.hostname };
    } catch { return null; }
}
