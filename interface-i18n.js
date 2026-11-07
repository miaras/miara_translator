import { LOCALES, resolveLocale, supportedLocale, interpolate } from './interface-locale.js';
import { catalogs } from './interface-catalogs.js';
import translationLanguages from './languages.json';
let saved;
try { saved = localStorage.getItem('SHIROKO_INTERFACE_LANGUAGE'); } catch {}
const languages = navigator.languages?.length ? [...navigator.languages] : [navigator.language];
let locale = resolveLocale({ saved, languages });
const originalTitle = document.title;
const originals = new WeakMap();
const attributes = new WeakMap();
// Keep documents, editable translations, account identities, library titles, and
// the animated multilingual brand illustration separate from interface copy.
const excluded = 'script,style,svg,[contenteditable],#alignment-grid,#library-list,#account-email,.wordmark,#headline-track,.example-source,[data-no-localize],.language-control';
const patterns = [
    [/^(\d+) sentences$/, '{count} sentences', ['count']],
    [/^(\d+) of (\d+) matches$/, '{current} of {total} matches', ['current','total']],
    [/^Replaced (\d+) occurrence\.$/, 'Replaced {count} occurrence.', ['count']],
    [/^Replaced (\d+) occurrences\.$/, 'Replaced {count} occurrences.', ['count']],
    [/^Regenerate sentence (\d+)$/, 'Regenerate sentence {number}', ['number']],
    [/^Saved translation · (.+)$/, 'Saved translation · {language}', ['language']],
    [/^([126])× monthly allowance usage\. Alignment and context included\.$/, '{multiple}× monthly allowance usage. Alignment and context included.', ['multiple']],

    [/^(.+) tokens · Plans & credit$/, '{tokens} tokens · Plans & credit', ['tokens']],
    [/^Prepaid allowance: (.+) tokens$/, 'Prepaid allowance: {tokens} tokens', ['tokens']],
    [/^About (.+) pages of text at Standard speed$/, 'About {pages} pages of text at Standard speed', ['pages']],
    [/^\$([\d.]+)\/month$/, '${amount}/month', ['amount']],
    [/^(.+) monthly allowance tokens$/, '{tokens} monthly allowance tokens', ['tokens']],
    [/^Subscribe to (.+)$/, 'Subscribe to {plan}', ['plan']],
    [/^([126])× monthly allowance usage$/, '{multiple}× monthly allowance usage', ['multiple']],
    [/^(.+) Standard [·/] (.+) Fast [·/] (.+) Ultrafast source tokens$/, '{standard} Standard · {fast} Fast · {ultrafast} Ultrafast source tokens', ['standard','fast','ultrafast']],
    [/^(.+) source tokens · (.+) allowance tokens$/, '{tokens} source tokens · {allowance} allowance tokens', ['tokens','allowance']],
    [/^(.+) tokens · Plan$/, '{tokens} tokens · Plan', ['tokens']],
    [/^(.+) tokens · \$(.+) · Plans & credit$/, '{tokens} tokens · ${amount} · Plans & credit', ['tokens','amount']],

    [/^(?:Sign in with|Login with|Continue with) (.+)$/, 'Sign in with {provider}', ['provider']],
    [/^Connected to (.+)$/, 'Connected to {provider}', ['provider']],
    [/^Connecting to (.+)…$/, 'Connecting to {provider}…', ['provider']],
    [/^Connect (.+)$/, 'Connect {provider}', ['provider']],
    [/^Translation stopped: (.+)$/, 'Translation stopped: {error}', ['error']],
    [/^Could not save: (.+) Retrying…$/, 'Could not save: {error} Retrying…', ['error']],
    [/^Translating chunk (\d+) of (\d+)\.\.\.$/, 'Translating chunk {current} of {total}...', ['current', 'total']],
    [/^Improving chunk (\d+) of (\d+)\.\.\.$/, 'Improving chunk {current} of {total}...', ['current', 'total']],
    [/^Saved automatically at (.+)$/, 'Saved automatically at {time}', ['time']],
    [/^Available credit: \$(.+)$/, 'Available credit: ${amount}', ['amount']],
    [/^\$(.+) · Add credit$/, '${amount} · Add credit', ['amount']],
    [/^\$([\d.]+) per 100k source tokens$/, '${amount} per 100k source tokens', ['amount']],
    [/^\$([\d.]+) · (.+) source tokens$/, '${amount} · {tokens} source tokens', ['amount', 'tokens']],
    [/^(\d+) successful invitations\.$/, '{count} successful invitations.', ['count']],
];
export function localizedLanguageName(name) {
    const code = translationLanguages.find(item => item.name === name)?.code;
    if (!code) return t(name);
    try { return new Intl.DisplayNames([locale], { type: 'language' }).of(code); } catch { return t(name); }
}
export function t(text, values) {
    const speedPrice = text.match(/^\$([\d.]+) per 100k source tokens\. Alignment and context included\.$/);
    if (speedPrice) return t('${amount} per 100k source tokens', { amount: speedPrice[1] }) + '. ' + t('Alignment, context, and output included.');
    const direct = catalogs[locale]?.[text];
    if (direct || values) return interpolate(direct || text, values);
    for (const [pattern, template, names] of patterns) {
        const match = text.match(pattern);
        if (match) return interpolate(catalogs[locale]?.[template] || template, Object.fromEntries(names.map((name, i) => [name, name === 'language' ? localizedLanguageName(match[i + 1]) : match[i + 1]])));
    }
    return text;
}
function translateNode(node) {
    if (!node.parentElement || node.parentElement.closest(excluded + ',textarea')) return;
    const raw = node.nodeValue;
    const previous = originals.get(node);
    const source = previous && raw === previous.rendered ? previous.source : raw;
    const key = source.trim();
    const result = key ? source.replace(key, t(key)) : source;
    originals.set(node, { source, rendered: result });
    if (raw !== result) node.nodeValue = result;
}
function translateElement(element) {
    if (element.closest(excluded)) return;
    for (const name of ['placeholder', 'aria-label', 'title']) {
        if (!element.hasAttribute(name)) continue;
        let records = attributes.get(element);
        if (!records) { records = {}; attributes.set(element, records); }
        const value = element.getAttribute(name);
        const record = records[name];
        const source = record && record.rendered === value ? record.source : value;
        const rendered = t(source);
        records[name] = { source, rendered };
        if (value !== rendered) element.setAttribute(name, rendered);
    }
}
function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) return translateNode(root);
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(excluded)) return;
    translateElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) translateNode(walker.currentNode);
    root.querySelectorAll('[placeholder],[aria-label],[title]').forEach(translateElement);
}
function applyLocale(next) {
    locale = next;
    document.title = t(originalTitle);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    const languageLabel = ({en:'Website language',es:'Idioma del sitio',fr:'Langue du site',de:'Sprache der Website',zh:'网站语言',ar:'لغة الموقع',ko:'웹사이트 언어',ja:'サイトの言語'})[locale];
    document.querySelector('.language-toggle')?.setAttribute('aria-label', languageLabel);
    document.querySelectorAll('.interface-language').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.locale === locale)); });
    translateTree(document.body);
    const names = new Intl.DisplayNames([locale], { type: 'language' });
    document.querySelectorAll('#target-lang option').forEach(option => {
        const language = translationLanguages.find(language => language.name === option.value);
        if (language) option.textContent = names.of(language.code);
    });
    window.dispatchEvent(new CustomEvent('interface-language-change', { detail: { locale } }));
}
const control = document.createElement('div');
control.className = 'language-control';
control.innerHTML = '<button type="button" class="language-toggle" aria-label="Website language" aria-expanded="false" aria-controls="interface-language-menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18"/></svg></button><div id="interface-language-menu" class="language-menu" hidden></div>';
const toggle = control.querySelector('.language-toggle');
const menu = control.querySelector('.language-menu');
function closeLanguageMenu(restoreFocus = false) {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
}
for (const [value, name] of Object.entries(LOCALES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'interface-language';
    button.dataset.locale = value;
    button.lang = value;
    button.textContent = name;
    button.addEventListener('click', () => {
        saved = value;
        try { localStorage.setItem('SHIROKO_INTERFACE_LANGUAGE', saved); } catch {}
        applyLocale(saved);
        closeLanguageMenu(true);
    });
    menu.append(button);
}
toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('[aria-pressed="true"]')?.focus();
});
document.addEventListener('click', event => { if (!control.contains(event.target)) closeLanguageMenu(); });
control.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeLanguageMenu(true); event.preventDefault(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !menu.hidden) {
        const buttons = [...menu.querySelectorAll('button')];
        const current = buttons.indexOf(document.activeElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[index].focus();
        event.preventDefault();
    }
});
control.addEventListener('focusout', event => { if (!control.contains(event.relatedTarget)) closeLanguageMenu(); });
document.body.append(control);
applyLocale(locale);
const observer = new MutationObserver(records => {
    for (const record of records) {
        if (record.type === 'characterData') translateNode(record.target);
        else if (record.type === 'attributes') translateElement(record.target);
        else for (const node of record.addedNodes) translateTree(node);
    }
});
observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title'] });
// Location is a fallback only: supported browser preferences never trigger GeoIP.
if (!supportedLocale(saved) && !languages.some(supportedLocale)) {
    fetch('/api/interface-locale', { credentials: 'same-origin', signal: AbortSignal.timeout(2500) })
        .then(response => response.ok ? response.json() : {})
        .then(({ country }) => { if (!saved) applyLocale(resolveLocale({ languages, country })); })
        .catch(() => {});
}
