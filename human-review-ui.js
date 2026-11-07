import { reviewQuote, reviewWordCount, reviewWordLanguage } from './human-review-pricing.js';
import { t } from './interface-i18n.js';
const money = micros => `$${(micros / 1_000_000).toFixed(2)}`;
const number = value => new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 2 }).format(value);
let currentUser = null;
let isAdmin = false;
let selectedTab = 'request';
let allRequests = [];
let backlog = null;
let openedRequestId = null;
let submitId = crypto.randomUUID();
const dialog = document.createElement('dialog');
dialog.className = 'human-review-dialog';
dialog.id = 'human-review-dialog';
dialog.setAttribute('aria-labelledby', 'human-review-heading');
dialog.innerHTML = `<div class="review-dialog-heading"><div><p class="overline">English ↔ Korean</p><h2 id="human-review-heading">Human Review</h2></div><form method="dialog"><button class="secondary-btn" aria-label="Close">Close</button></form></div>
<p>Professional human translators for the highest quality translation.</p><p>More languages coming soon.</p><p id="review-backlog" class="review-backlog" role="status"></p>
<nav class="review-tabs" aria-label="Human review sections"><button type="button" class="secondary-btn" data-review-tab="request">Request human review</button><button type="button" class="secondary-btn" data-review-tab="mine">My requests</button><button type="button" class="secondary-btn" data-review-tab="manage" hidden>Manage queue</button></nav>
<p id="review-message" class="review-message" role="status" aria-live="polite"></p>
<section id="review-auth" hidden><p>Sign in to request human review or view your requests.</p><a class="button button-dark" href="/app.html?signin=1&reviews=1">Sign in</a></section>
<section id="review-request-section"><form id="review-request-form">
<p>$0.04 per English or Korean word</p><p>$10 per 250-word page · $10 minimum</p><p>Word count uses the original text. Korean words are counted by spaces.</p>
<label for="review-direction">Translation direction</label><select id="review-direction"><option value="en-ko">English → Korean</option><option value="ko-en">Korean → English</option></select>
<div class="review-document-grid"><label for="review-source"><span>Original text</span><textarea id="review-source" dir="auto" data-no-localize required maxlength="250000"></textarea></label><label for="review-draft"><span>Translation draft</span><textarea id="review-draft" dir="auto" data-no-localize required maxlength="250000"></textarea></label></div>
<label for="review-notes">Notes for the reviewer (optional)</label><textarea id="review-notes" dir="auto" data-no-localize maxlength="5000"></textarea>
<output id="review-quote" class="review-quote" aria-live="polite"></output>
<p>Submitting a request does not charge your card or use your translation credit. We will arrange payment separately.</p>
<label class="review-confirm"><input id="review-confirm-price" type="checkbox" required><span>I agree to the displayed review price.</span></label><button id="review-submit" class="button button-dark" type="submit">Request human review</button></form></section>
<section id="review-list-section" hidden><div class="review-list-heading"><h3 id="review-list-heading">My requests</h3><button id="review-refresh" type="button" class="secondary-btn">Refresh</button></div><div id="review-list" class="review-list"></div></section>
<section id="review-detail" class="review-detail" hidden></section>`;
document.body.appendChild(dialog);
const byId = id => dialog.querySelector(`#${id}`);
function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
function userData(tag, text, className) { const element = node(tag, text, className); element.setAttribute('data-no-localize', ''); element.dir = 'auto'; return element; }
function message(text, error = false) { const element = byId('review-message'); element.textContent = text; element.classList.toggle('form-error', error); }
async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('Request failed.'));
    return data;
}
function showBacklog() {
    if (!backlog) return;
    byId('review-backlog').textContent = t('{requests} requests · {pages} pages waiting · {days} days of review work', { requests: number(backlog.requests), pages: number(backlog.pages), days: number(backlog.backlogDays) });
}
function updateQuote() {
    const source = byId('review-source').value;
    const draft = byId('review-draft').value;
    const quote = reviewQuote(byId('review-direction').value, source, draft);
    const days = Math.ceil(((backlog?.words || 0) + quote.wordCount) / (250 * 20));
    byId('review-quote').textContent = t('{words} {language} words · {pages} pages · {price} · estimated {days} days', { language: t(quote.wordLanguage === 'ko' ? 'Korean' : 'English'), words: number(quote.wordCount), pages: number(quote.pages), price: money(quote.priceMicros), days: number(days) });
    byId('review-submit').textContent = `${t('Request human review')} — ${money(quote.priceMicros)}`;
    return quote;
}
function setTab(tab) {
    selectedTab = tab === 'manage' && !isAdmin ? 'mine' : tab;
    byId('review-request-section').hidden = !currentUser || selectedTab !== 'request';
    byId('review-list-section').hidden = !currentUser || selectedTab === 'request';
    byId('review-auth').hidden = !!currentUser;
    byId('review-detail').hidden = true;
    openedRequestId = null;
    dialog.querySelectorAll('[data-review-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.reviewTab === selectedTab)));
    byId('review-list-heading').textContent = t(selectedTab === 'manage' ? 'Manage queue' : 'My requests');
    if (currentUser && selectedTab !== 'request') loadRequests().catch(error => message(error.message, true));
}
function renderRequests() {
    const list = byId('review-list');
    list.replaceChildren();
    if (!allRequests.length) { list.append(node('p', t('No review requests yet.'))); return; }
    for (const request of allRequests) {
        const button = node('button', undefined, 'review-request-item');
        button.type = 'button';
        const top = node('span', undefined, 'review-request-title');
        top.append(node('strong', t(request.direction === 'en-ko' ? 'English → Korean' : 'Korean → English')), node('span', t(statusLabel(request.status)), 'review-status'));
        const meta = node('span', `${number(request.pages)} ${t('pages')} · ${money(request.priceMicros)} · ${new Date(request.createdAt).toLocaleDateString(document.documentElement.lang)}`);
        button.append(top, meta);
        if (selectedTab === 'manage') button.append(userData('span', request.customerEmail || request.customerName || request.userId || ''));
        if (request.estimatedDays !== null) button.append(node('span', t('Estimated turnaround: {days} days', { days: number(request.estimatedDays || 0) })));
        button.addEventListener('click', () => showDetail(request));
        list.append(button);
    }
}
const statusLabel = status => ({ queued: 'Queued', in_review: 'In review', completed: 'Completed', canceled: 'Canceled' })[status] || status;
async function loadRequests() {
    message(t('Loading review requests…'));
    const data = await api(`/api/human-reviews${selectedTab === 'manage' ? '?all=1' : ''}`);
    isAdmin = !!data.admin;
    backlog = data.backlog;
    allRequests = data.requests;
    dialog.querySelector('[data-review-tab="manage"]').hidden = !isAdmin;
    showBacklog();
    renderRequests();
    const linkedRequest = allRequests.find(request => request.id === location.hash.slice(1));
    if (linkedRequest && !openedRequestId) showDetail(linkedRequest);
    message('');
}
async function updateRequest(request, body, button) {
    button.disabled = true;
    try {
        const result = await api(`/api/human-reviews/${encodeURIComponent(request.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        await loadRequests();
        const updated = allRequests.find(item => item.id === request.id) || result.request;
        if (updated) showDetail(updated);
        message(t(body.status === 'completed' ? 'Review completed. The customer can now read the reviewed text.' : 'Review request updated.'));
    } catch (error) { message(error.message, true); button.disabled = false; }
}
function showDetail(request) {
    openedRequestId = request.id;
    const detail = byId('review-detail');
    detail.hidden = false;
    detail.replaceChildren(node('h3', t('Review request')));
    detail.append(node('p', `${t(statusLabel(request.status))} · ${money(request.priceMicros)} · ${number(reviewWordCount(request))} ${t(reviewWordLanguage(request) === 'ko' ? 'Korean words' : 'English words')}`));
    const grid = node('div', undefined, 'review-document-grid');
    for (const [label, text] of [['Original text', request.sourceText], ['Translation draft', request.translatedText]]) {
        const section = node('div'); section.append(node('h4', t(label)), userData('pre', text, 'review-document')); grid.append(section);
    }
    detail.append(grid);
    if (request.notes) detail.append(node('h4', t('Notes')), userData('p', request.notes, 'review-document'));
    if (request.reviewedText) detail.append(node('h4', t('Reviewed text')), userData('pre', request.reviewedText, 'review-document'));
    if (selectedTab === 'manage' && isAdmin) {
        detail.append(node('h4', t('Customer')), userData('p', request.customerEmail || request.customerName || ''));
        if (request.notification) detail.append(node('p', t('Email notification: {status}', { status: request.notification.status })));
        if (request.notification?.lastError) detail.append(userData('p', request.notification.lastError, 'form-error'));
        const label = node('label', t('Reviewed text')); label.htmlFor = 'review-delivery-text';
        const reviewed = userData('textarea', request.reviewedText || request.translatedText); reviewed.id = 'review-delivery-text'; reviewed.rows = 12;
        detail.append(label, reviewed);
        const actions = node('div', undefined, 'review-detail-actions');
        for (const [status, title] of [['queued', 'Move to queue'], ['in_review', 'Start review'], ['completed', 'Complete and deliver'], ['canceled', 'Cancel request']]) {
            const button = node('button', t(title), status === 'completed' ? 'button button-dark' : 'secondary-btn'); button.type = 'button'; button.disabled = status === request.status;
            button.addEventListener('click', () => {
                if (status === 'completed' && !reviewed.value.trim()) { message(t('Enter the reviewed text before completing this request.'), true); reviewed.focus(); return; }
                updateRequest(request, { status, ...(status === 'completed' ? { reviewedText: reviewed.value } : {}) }, button);
            });
            actions.append(button);
        }
        detail.append(actions);
    } else if (request.status === 'queued') {
        const cancel = node('button', t('Cancel request'), 'secondary-btn'); cancel.type = 'button';
        cancel.addEventListener('click', () => updateRequest(request, { status: 'canceled' }, cancel)); detail.append(cancel);
    }
    detail.scrollIntoView({ block: 'nearest' });
}
async function openReview(tab = 'request') {
    selectedTab = tab;
    if (!dialog.open) dialog.showModal();
    message(t('Loading review requests…'));
    try {
        const [account, state] = await Promise.all([api('/api/me'), api('/api/human-reviews/backlog')]);
        currentUser = account.user;
        backlog = state.backlog || state;
        isAdmin = false;
        if (currentUser) {
            const own = await api('/api/human-reviews'); isAdmin = !!own.admin;
        }
        dialog.querySelector('[data-review-tab="manage"]').hidden = !isAdmin;
        showBacklog(); updateQuote(); setTab(tab); message('');
    } catch (error) { message(error.message, true); }
}
byId('review-request-form').addEventListener('input', () => { byId('review-confirm-price').checked = false; updateQuote(); });
byId('review-confirm-price').addEventListener('input', event => { event.stopPropagation(); });
byId('review-request-form').addEventListener('submit', async event => {
    event.preventDefault();
    const quote = updateQuote();
    if (!quote.wordCount) return message(t('Add original English or Korean text before requesting a review.'), true);
    const button = byId('review-submit'); button.disabled = true;
    try {
        await api('/api/human-reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientRequestId: submitId, direction: byId('review-direction').value, sourceText: byId('review-source').value, translatedText: byId('review-draft').value, notes: byId('review-notes').value, acceptedPriceMicros: quote.priceMicros }) });
        submitId = crypto.randomUUID();
        byId('review-request-form').reset(); updateQuote();
        setTab('mine'); message(t('Your human review request has been added to the queue.'));
    } catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
});
dialog.querySelectorAll('[data-review-tab]').forEach(button => button.addEventListener('click', () => setTab(button.dataset.reviewTab)));
byId('review-refresh').addEventListener('click', () => loadRequests().catch(error => message(error.message, true)));
for (const header of document.querySelectorAll(location.pathname === '/' || location.pathname.endsWith('/index.html') ? '.site-header .account-controls' : '.site-header nav, .site-header .account-controls')) {
    const button = node('button', 'Human Review', 'header-link'); button.type = 'button'; button.dataset.humanReviewOpen = ''; header.append(button);
}
document.querySelectorAll('[data-human-review-open]').forEach(button => button.addEventListener('click', () => openReview('request')));
window.addEventListener('interface-language-change', () => { showBacklog(); updateQuote(); if (dialog.open && selectedTab !== 'request') { renderRequests(); const request = allRequests.find(item => item.id === openedRequestId); if (request) showDetail(request); } });
window.addEventListener('shiroko:account', event => { currentUser = event.detail?.user || null; if (dialog.open) openReview(selectedTab); });
const requested = new URLSearchParams(location.search).get('reviews');
if (requested) openReview(requested === 'manage' ? 'manage' : 'request');
updateQuote();
