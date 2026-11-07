import { matchingTerms, researchAllowance, sentenceResearchInput, safeResearchSource } from './sentence-research-input.js';

function highlight(container, text, terms) {
    container.replaceChildren();
    const words = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
    if (!words.length) { container.textContent = text; return; }
    const pattern = new RegExp(words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
        container.append(document.createTextNode(text.slice(cursor, match.index)));
        const mark = document.createElement('mark'); mark.textContent = match[0]; container.append(mark);
        cursor = match.index + match[0].length;
    }
    container.append(document.createTextNode(text.slice(cursor)));
}
function appendEmphasis(container, text) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
        if (index) container.append(document.createTextNode('\n'));
        const heading = /^#{1,4}\s+(.+)$/u.exec(line);
        if (heading) {
            const strong = document.createElement('strong'); appendBold(strong, heading[1]); container.append(strong);
        } else appendBold(container, line);
    });
}
function appendBold(container, text) {
    let cursor = 0;
    for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/gu)) {
        container.append(document.createTextNode(text.slice(cursor, match.index)));
        const strong = document.createElement('strong'); strong.textContent = match[1]; container.append(strong);
        cursor = match.index + match[0].length;
    }
    container.append(document.createTextNode(text.slice(cursor)));
}
function sourceLink(source, label) {
    const link = document.createElement('a');
    link.href = source.url; link.textContent = label; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = source.title;
    return link;
}
function renderResearch(container, sourceList, extraSources, result) {
    container.replaceChildren(); sourceList.replaceChildren(); extraSources.replaceChildren();
    const sources = new Map();
    for (const value of [...result.citations, ...result.sources]) {
        const source = safeResearchSource(value);
        if (source && !sources.has(source.url)) sources.set(source.url, { ...source, number: sources.size + 1 });
    }
    let cursor = 0;
    for (const citation of [...result.citations].sort((a, b) => a.start - b.start)) {
        const source = sources.get(safeResearchSource(citation)?.url);
        if (!source || citation.start < cursor || citation.end > result.text.length) continue;
        appendEmphasis(container, result.text.slice(cursor, citation.start));
        const original = result.text.slice(citation.start, citation.end);
        const label = /|https?:|\]\(/u.test(original) ? `[${source.number}]` : original.replace(/\*\*/g, '') || `[${source.number}]`;
        const link = sourceLink(source, label); link.className = 'research-citation';
        link.setAttribute('aria-label', `Source ${source.number}: ${source.title}`); container.append(link);
        cursor = citation.end;
    }
    appendEmphasis(container, result.text.slice(cursor));
    const cited = new Set(result.citations.map(value => safeResearchSource(value)?.url));
    for (const source of sources.values()) {
        const item = document.createElement('li');
        item.append(sourceLink(source, source.title));
        const domain = document.createElement('small'); domain.textContent = new URL(source.url).hostname;
        item.append(domain); (cited.has(source.url) ? sourceList : extraSources).append(item);
    }
    extraSources.start = sourceList.children.length + 1;
}

export function initSentenceResearch({ getState, requestResearch }) {
    const cache = new Map(), pending = new Map();
    let dialog, activeKey, activeIndex, returnFocus, scrollPosition;
    const el = id => dialog.querySelector(`#${id}`);
    function createDialog() {
        dialog = document.createElement('dialog');
        dialog.className = 'research-dialog'; dialog.setAttribute('aria-labelledby', 'research-heading');
        dialog.innerHTML = `<header class="research-heading"><div><p id="research-sentence-number"></p><h2 id="research-heading">Explain &amp; research</h2></div><button id="research-close" class="secondary-btn" type="button" autofocus>Close</button></header>
            <p class="research-intro">Uses the saved book summary and up to two sentences before and after this sentence.</p>
            <section class="research-passage" aria-label="Selected sentence"><h3>Source</h3><p id="research-source" dir="auto" data-no-localize></p><h3>Translation</h3><p id="research-target" dir="auto" data-no-localize></p><p id="research-terms-note" class="research-note"></p></section>
            <details class="research-context"><summary>Book summary and surrounding sentences</summary><div id="research-context" data-no-localize></div></details>
            <p id="research-cost" class="research-note"></p><p id="research-status" role="status" aria-live="polite"></p><button id="research-retry" class="secondary-btn" type="button" hidden>Try again</button>
            <section id="research-answer" aria-label="Sentence explanation" hidden><h3>Explanation</h3><div id="research-explanation" class="research-explanation" dir="auto" data-no-localize></div><h3>Cited sources</h3><ol id="research-sources" class="research-sources" data-no-localize></ol><details id="research-more-sources" hidden><summary>Additional search results</summary><ol id="research-extra-sources" class="research-sources" data-no-localize></ol></details></section>`;
        document.body.append(dialog);
        el('research-close').addEventListener('click', () => dialog.close());
        el('research-retry').addEventListener('click', () => open(activeIndex, returnFocus));
        dialog.addEventListener('click', event => { if (event.target === dialog) {
            const box = dialog.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
        } });
        dialog.addEventListener('close', () => {
            activeKey = null;
            returnFocus?.isConnected && returnFocus.focus({ preventScroll: true });
            if (scrollPosition) window.scrollTo({ ...scrollPosition, behavior: 'instant' });
        });
    }
    function showTerms(input, terms) {
        highlight(el('research-source'), input.text, terms.map(term => term.source));
        highlight(el('research-target'), input.translatedText, terms.map(term => term.target));
        el('research-terms-note').textContent = terms.length ? 'Highlighted words are special terms or names in this sentence.' : 'No special terms identified in this sentence.';
    }
    function showContext(input) {
        const container = el('research-context'); container.replaceChildren();
        const paragraph = (label, text) => {
            const heading = document.createElement('h4'); heading.textContent = label;
            const content = document.createElement('p'); content.textContent = text; content.dir = 'auto'; container.append(heading, content);
        };
        paragraph('Saved book summary', input.summary || 'No book summary saved yet.');
        for (const [label, rows] of [['Before', input.before], ['After', input.after]]) {
            if (!rows.length) continue;
            paragraph(label, rows.map(row => `${row.source}\n${row.target}`).join('\n\n'));
        }
    }
    async function open(index, button) {
        if (!dialog) createDialog();
        const input = sentenceResearchInput(getState(), index), key = JSON.stringify(input);
        activeIndex = index; activeKey = key; returnFocus = button;
        if (!dialog.open) {
            scrollPosition = { left: window.scrollX, top: window.scrollY };
            dialog.showModal();
        }
        dialog.scrollTop = 0;
        el('research-sentence-number').textContent = `Sentence ${index + 1}`;
        el('research-answer').hidden = true; el('research-retry').hidden = true;
        el('research-status').textContent = 'Searching sources and explaining this sentence…';
        el('research-answer').setAttribute('aria-busy', 'true');
        el('research-cost').textContent = `A new result uses ${researchAllowance(input).toLocaleString()} allowance tokens, including search. Cached results reopen free.`;
        showTerms(input, matchingTerms(input.text, input.translatedText, input.dictionary)); showContext(input);
        try {
            let result = cache.get(key);
            const locallyCached = !!result;
            if (!result) {
                if (!pending.has(key)) {
                    const promise = requestResearch(input).then(value => {
                        cache.set(key, value);
                        if (cache.size > 50) cache.delete(cache.keys().next().value);
                        return value;
                    });
                    pending.set(key, promise);
                    promise.finally(() => pending.delete(key)).catch(() => {});
                }
                result = await pending.get(key);
            }
            if (activeKey !== key || !dialog.open) return;
            showTerms(input, result.specialTerms || []);
            renderResearch(el('research-explanation'), el('research-sources'), el('research-extra-sources'), result);
            el('research-more-sources').hidden = !el('research-extra-sources').children.length;
            el('research-answer').hidden = false;
            el('research-status').textContent = 'Research complete. Sources are linked below and beside the claims they support.';
            el('research-cost').textContent = locallyCached || result.cached ? 'Cached explanation · no additional allowance used.' : `Used ${result.allowanceTokens.toLocaleString()} allowance tokens. Reopening this result is free.`;
        } catch (error) {
            if (activeKey !== key || !dialog.open) return;
            el('research-status').textContent = error.message;
            el('research-retry').hidden = false;
        } finally { if (activeKey === key) el('research-answer').setAttribute('aria-busy', 'false'); }
    }
    return {
        addButton(row, index) {
            if (row.querySelector('.research-btn')) return;
            const button = document.createElement('button'); button.type = 'button'; button.className = 'research-btn';
            button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
            button.setAttribute('aria-label', `Explain and research sentence ${index + 1}. Uses allowance tokens for a new result.`);
            button.title = 'Explain & research · uses allowance tokens';
            button.addEventListener('click', () => { void open(index, button); });
            row.querySelector('.row-actions')?.append(button);
        }
    };
}
