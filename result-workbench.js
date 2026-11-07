import { t, localizedLanguageName } from './interface-i18n.js';
import { downloadDocx, printPdf } from './document-export.js';

export function initResultWorkbench({ getState, replaceTargets }) {
    const root = document.getElementById('results-page');
    if (!root) return () => {};
    const el = id => document.getElementById(id);
    const find = el('result-find'), replacement = el('result-replacement');
    let matches = [], selected = -1, undo = null;
    const messages = new Map();
    function toolMessage(id, key, values) {
        messages.set(id, { key, values });
        el(id).textContent = t(key, values);
    }
    let fontSize = 18;
    try { fontSize = Math.min(32, Math.max(12, Number(localStorage.getItem('SHIROKO_REVIEW_FONT_SIZE')) || 18)); } catch {}
    function resize() {
        root.style.setProperty('--review-font-size', `${fontSize}px`);
        el('review-font-size').value = String(fontSize);
        try { localStorage.setItem('SHIROKO_REVIEW_FONT_SIZE', String(fontSize)); } catch {}
    }
    resize();
    el('review-font-size').addEventListener('change', event => { fontSize = Number(event.target.value); resize(); });
    const sourceLanguage = text => /[\uac00-\ud7a3\u1100-\u11ff]/u.test(text) ? 'Korean' : /[A-Za-z]/.test(text) ? 'English' : 'Auto-detected';
    const langCode = name => ({ Korean: 'ko', English: 'en', Japanese: 'ja', Chinese: 'zh', French: 'fr', German: 'de', Spanish: 'es', Arabic: 'ar' })[name] || '';
    function scan() {
        matches = [];
        if (!find.value) return;
        const escaped = find.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped, el('result-match-case').checked ? 'gu' : 'giu');
        getState().rows.forEach((row, rowIndex) => {
            for (const match of String(row.target).matchAll(pattern)) matches.push({ row: rowIndex, start: match.index, end: match.index + match[0].length });
        });
    }
    function paint(scroll = false) {
        const match = matches[selected];
        const matchedRows = new Set(matches.map(item => item.row));
        root.querySelectorAll('.alignment-row').forEach((row, index) => {
            row.classList.toggle('search-match', matchedRows.has(index));
            row.classList.toggle('search-current', match?.row === index);
        });
        el('result-match-count').textContent = !find.value ? t('Find in all translated sentences') : matches.length ? t('{current} of {total} matches', { current: selected + 1, total: matches.length }) : t('No matches');
        for (const id of ['result-find-prev', 'result-find-next', 'result-replace-one', 'result-replace-all']) el(id).disabled = !matches.length;
        if (scroll && match) root.querySelectorAll('.alignment-row')[match.row]?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    function refreshMatches(scroll = false) {
        scan(); selected = matches.length ? Math.min(Math.max(selected, 0), matches.length - 1) : -1; paint(scroll);
    }
    find.addEventListener('input', () => { selected = 0; refreshMatches(true); });
    el('result-match-case').addEventListener('change', () => { selected = 0; refreshMatches(); });
    function step(delta) { if (matches.length) { selected = (selected + delta + matches.length) % matches.length; paint(true); } }
    el('result-find-next').addEventListener('click', () => step(1));
    el('result-find-prev').addEventListener('click', () => step(-1));
    find.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); } });
    function replace(all) {
        scan();
        const chosen = all ? matches : matches[selected] ? [matches[selected]] : [];
        if (!chosen.length) return;
        const before = getState().rows.map(row => row.target), after = [...before];
        for (const match of [...chosen].reverse()) after[match.row] = after[match.row].slice(0, match.start) + replacement.value + after[match.row].slice(match.end);
        replaceTargets(after);
        undo = { before, after }; el('result-replace-undo').disabled = false;
        toolMessage('result-replace-status', chosen.length === 1 ? 'Replaced {count} occurrence.' : 'Replaced {count} occurrences.', { count: chosen.length });
        refreshMatches();
    }
    el('result-replace-one').addEventListener('click', () => replace(false));
    el('result-replace-all').addEventListener('click', () => replace(true));
    el('result-replace-undo').addEventListener('click', () => {
        if (!undo) return;
        const before = undo.before; undo = null;
        replaceTargets(before); el('result-replace-undo').disabled = true;
        toolMessage('result-replace-status', 'Replacement undone.'); refreshMatches();
    });
    const findPanel = el('result-find-panel'), findToggle = el('result-find-toggle');
    function openFind() { findPanel.hidden = false; findToggle.setAttribute('aria-expanded', 'true'); find.focus(); }
    findToggle.addEventListener('click', () => { if (findPanel.hidden) openFind(); else { findPanel.hidden = true; findToggle.setAttribute('aria-expanded', 'false'); findToggle.focus(); } });
    document.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h' && !event.altKey) { event.preventDefault(); openFind(); }
        if (event.key === 'Escape' && findPanel.contains(document.activeElement)) { findPanel.hidden = true; findToggle.setAttribute('aria-expanded', 'false'); findToggle.focus(); }
    });
    const termsPanel = el('result-terms-panel'), termsToggle = el('result-terms-toggle');
    function closeTerms() { termsPanel.hidden = true; root.classList.remove('terms-open'); termsToggle.setAttribute('aria-expanded', 'false'); termsToggle.focus(); }
    termsToggle.addEventListener('click', () => {
        if (!termsPanel.hidden) return closeTerms();
        termsPanel.hidden = false; root.classList.add('terms-open'); termsToggle.setAttribute('aria-expanded', 'true');
        renderTerms(); el('result-terms-filter').focus();
    });
    el('result-terms-close').addEventListener('click', closeTerms);
    termsPanel.addEventListener('keydown', event => { if (event.key === 'Escape') closeTerms(); });
    function renderTerms() {
        const entries = Object.entries(getState().dictionary || {}), query = el('result-terms-filter').value.toLocaleLowerCase();
        el('result-term-count').textContent = String(entries.length);
        const list = el('result-terms-list'); list.replaceChildren();
        for (const [source, target] of entries.filter(([a,b]) => `${a} ${b}`.toLocaleLowerCase().includes(query))) {
            const item = document.createElement('div'), label = document.createElement('dt'), value = document.createElement('dd');
            label.textContent = source; value.textContent = String(target); item.append(label, value); list.append(item);
        }
        el('result-terms-empty').hidden = !!list.children.length;
        el('result-terms-empty').textContent = t(entries.length ? 'No terms match your search.' : 'No terms extracted yet. Proper nouns and specialist terms appear here as the translation progresses.');
    }
    el('result-terms-filter').addEventListener('input', renderTerms);
    el('result-export-format').addEventListener('change', event => {
        if (!event.target.value) return;
        const state = getState(), options = { targetLang: state.targetLang, sourceLang: state.sourceLang || sourceLanguage(state.sourceText), fontSize, layout: el('result-export-layout').value };
        try {
            if (!state.rows.length) throw new Error('There is no translation to export yet.');
            if (event.target.value === 'docx') { downloadDocx(state.rows, options); toolMessage('result-export-status', 'Word document downloaded.'); }
            else { printPdf(state.rows, options); toolMessage('result-export-status', 'Choose Save as PDF in the print dialog.'); }
        } catch (error) { toolMessage('result-export-status', error.message); }
        event.target.value = '';
    });
    function sync({ contentOnly = false } = {}) {
        if (contentOnly) {
            if (undo) { undo = null; el('result-replace-undo').disabled = true; }
            if (find.value) refreshMatches();
            return;
        }
        const state = getState(), source = state.sourceLang || sourceLanguage(state.sourceText);
        el('result-source-language').textContent = localizedLanguageName(source); el('result-target-language').textContent = localizedLanguageName(state.targetLang);
        el('result-row-count').textContent = t('{count} sentences', { count: state.rows.length });
        el('result-column-source').textContent = localizedLanguageName(source);
        el('result-column-target').textContent = localizedLanguageName(state.targetLang);
        root.querySelectorAll('.source-item').forEach(item => { item.lang = langCode(source); item.dir = 'auto'; });
        root.querySelectorAll('.target-item').forEach(item => { item.lang = langCode(state.targetLang); item.dir = 'auto'; item.setAttribute('role','textbox'); item.setAttribute('aria-multiline','true'); item.setAttribute('aria-label',t('Translation sentence')); item.setAttribute('spellcheck','true'); });
        if (undo && (state.rows.length !== undo.after.length || state.rows.some((row,i) => row.target !== undo.after[i]))) { undo = null; el('result-replace-undo').disabled = true; }
        root.querySelectorAll('.regen-btn').forEach((button,index) => { const label = t('Regenerate sentence {number}', { number: index + 1 }); button.setAttribute('aria-label', label); button.title = label; });
        renderTerms(); refreshMatches();
    }
    window.addEventListener('interface-language-change', () => {
        sync();
        for (const [id, { key, values }] of messages) el(id).textContent = t(key, values);
    });
    return sync;
}
