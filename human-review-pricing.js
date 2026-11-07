export const REVIEW_WORDS_PER_PAGE = 250;
export const REVIEW_PAGES_PER_DAY = 20;
export const REVIEW_RATE_MICROS = 40_000;
export const REVIEW_MINIMUM_MICROS = 10_000_000;
export function englishWordCount(text) {
    return Array.from(new Intl.Segmenter('en', { granularity: 'word' }).segment(text), segment => segment)
        .filter(segment => segment.isWordLike && /[\p{Script=Latin}\p{Number}]/u.test(segment.segment)).length;
}
export function koreanWordCount(text) {
    return text.split(/\s+/u).filter(word => /[\p{Letter}\p{Number}]/u.test(word)).length;
}
// Historical requests retain their originally accepted English-side quote.
export const reviewWordCount = request => request.wordCount ?? request.englishWords ?? 0;
export const reviewWordLanguage = request => request.wordLanguage || 'en';
export function reviewQuote(direction, sourceText) {
    const wordLanguage = direction === 'ko-en' ? 'ko' : 'en';
    const wordCount = wordLanguage === 'ko' ? koreanWordCount(sourceText) : englishWordCount(sourceText);
    return { wordCount, wordLanguage, pages: wordCount / REVIEW_WORDS_PER_PAGE, priceMicros: Math.max(REVIEW_MINIMUM_MICROS, wordCount * REVIEW_RATE_MICROS) };
}
