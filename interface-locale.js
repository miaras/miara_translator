export const LOCALES = Object.freeze({ en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', zh: '中文', ar: 'العربية', ko: '한국어', ja: '日本語' });
export const COUNTRY_LOCALES = Object.freeze({ ES:'es', MX:'es', AR:'es', CO:'es', CL:'es', PE:'es', VE:'es', EC:'es', UY:'es', BO:'es', CR:'es', PA:'es', GT:'es', DO:'es', CU:'es', FR:'fr', BE:'fr', CA:'en', CH:'de', DE:'de', AT:'de', CN:'zh', TW:'zh', HK:'zh', SG:'en', JP:'ja', KR:'ko', SA:'ar', AE:'ar', EG:'ar', MA:'ar', DZ:'ar', TN:'ar', JO:'ar', IQ:'ar', QA:'ar', KW:'ar', LB:'ar' });
export function supportedLocale(value) {
    if (typeof value !== 'string') return null;
    const language = value.trim().toLowerCase().split(/[-_]/)[0];
    return Object.hasOwn(LOCALES, language) ? language : null;
}
export function resolveLocale({ saved, languages = [], country } = {}) {
    // A deliberately chosen language persists across sessions and pages.
    return supportedLocale(saved) || languages.map(supportedLocale).find(Boolean) || COUNTRY_LOCALES[String(country || '').toUpperCase()] || 'en';
}
export function interpolate(template, values = {}) {
    return template.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
