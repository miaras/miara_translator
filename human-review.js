import { randomBytes } from 'node:crypto';

import { REVIEW_WORDS_PER_PAGE, REVIEW_PAGES_PER_DAY, REVIEW_MINIMUM_MICROS, REVIEW_RATE_MICROS, reviewQuote, reviewWordCount, reviewWordLanguage } from './human-review-pricing.js';
export const REVIEW_ADMINS = ['jbaek080@gmail.com', 'miarasung@gmail.com'];
const pending = request => ['queued', 'in_review'].includes(request.status);
export const isReviewAdmin = (user, ids) => !!user?.email && REVIEW_ADMINS.includes(user.email.trim().toLowerCase()) && !!ids?.has(user.id);
export function reviewBacklog(store) {
    const requests = (store.humanReviewRequests || []).filter(pending);
    const words = requests.reduce((sum, request) => sum + reviewWordCount(request), 0);
    return { requests: requests.length, words, pages: words / REVIEW_WORDS_PER_PAGE, pagesPerDay: REVIEW_PAGES_PER_DAY, wordsPerPage: REVIEW_WORDS_PER_PAGE, backlogDays: Math.ceil(words / (REVIEW_WORDS_PER_PAGE * REVIEW_PAGES_PER_DAY)), minimumPriceMicros: REVIEW_MINIMUM_MICROS, rateMicrosPerWord: REVIEW_RATE_MICROS };
}
function presented(store, request, admin = false) {
    let ahead = 0;
    for (const item of store.humanReviewRequests || []) {
        if (item.id === request.id) break;
        if (pending(item)) ahead += reviewWordCount(item);
    }
    return { ...request, wordCount: reviewWordCount(request), wordLanguage: reviewWordLanguage(request), ...(admin ? {} : { notification: undefined }), estimatedDays: pending(request) ? Math.max(1, Math.ceil((ahead + reviewWordCount(request)) / (REVIEW_WORDS_PER_PAGE * REVIEW_PAGES_PER_DAY))) : null };
}
export async function humanReviewApi(req, res, url, context) {
    if (!url.pathname.startsWith('/api/human-reviews')) return false;
    const { store, persist, userFor, body, json, notify } = context;
    store.humanReviewRequests ||= [];
    if (url.pathname === '/api/human-reviews/backlog' && req.method === 'GET') {
        json(res, 200, reviewBacklog(store));
        return true;
    }
    const user = userFor(req);
    if (!user) { json(res, 401, { error: 'Sign in to request human review.' }); return true; }
    const admin = isReviewAdmin(user, context.reviewAdminIds);
    if (url.pathname === '/api/human-reviews' && req.method === 'GET') {
        if (url.searchParams.get('all') === '1' && !admin) { json(res, 403, { error: 'Only review administrators can manage the queue.' }); return true; }
        const all = admin && url.searchParams.get('all') === '1';
        json(res, 200, { admin, backlog: reviewBacklog(store), requests: store.humanReviewRequests.filter(request => all || request.userId === user.id).map(request => presented(store, request, all)) });
        return true;
    }
    if (url.pathname === '/api/human-reviews' && req.method === 'POST') {
        const input = await body(req);
        if (!['en-ko', 'ko-en'].includes(input.direction) || typeof input.sourceText !== 'string' || typeof input.translatedText !== 'string' || !input.sourceText.trim() || !input.translatedText.trim() || input.sourceText.length > 250_000 || input.translatedText.length > 250_000 || typeof input.clientRequestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.clientRequestId) || input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 5000)) {
            json(res, 400, { error: 'Provide an English–Korean original and translation to review.' }); return true;
        }
        const existing = store.humanReviewRequests.find(request => request.userId === user.id && request.clientRequestId === input.clientRequestId);
        if (existing) { json(res, 200, { request: presented(store, existing), backlog: reviewBacklog(store) }); return true; }
        const quote = reviewQuote(input.direction, input.sourceText, input.translatedText);
        if (!quote.wordCount) { json(res, 400, { error: 'Provide the original English or Korean text so we can calculate the review price.' }); return true; }
        if (input.acceptedPriceMicros !== quote.priceMicros) { json(res, 409, { error: 'Review the current price before submitting.', quote }); return true; }
        if (store.humanReviewRequests.some(request => request.userId === user.id && pending(request) && request.direction === input.direction && request.sourceText === input.sourceText && request.translatedText === input.translatedText)) {
            json(res, 409, { error: 'This translation is already in your review queue.' }); return true;
        }
        const createdAt = new Date().toISOString();
        const request = { id: randomBytes(16).toString('hex'), clientRequestId: input.clientRequestId, userId: user.id, customerEmail: user.email || null, customerName: user.name || '', direction: input.direction, sourceText: input.sourceText, translatedText: input.translatedText, notes: input.notes || '', ...quote, status: 'queued', createdAt, updatedAt: createdAt, notification: { status: 'pending', attempts: 0 } };
        store.humanReviewRequests.push(request);
        try { await persist(); } catch (error) { store.humanReviewRequests.splice(store.humanReviewRequests.indexOf(request), 1); throw error; }
        void notify?.();
        json(res, 201, { request: presented(store, request), backlog: reviewBacklog(store) });
        return true;
    }
    const match = /^\/api\/human-reviews\/([a-f0-9]{32})$/.exec(url.pathname);
    if (match && req.method === 'PUT') {
        const request = store.humanReviewRequests.find(item => item.id === match[1] && (admin || item.userId === user.id));
        if (!request) { json(res, 404, { error: 'Review request not found.' }); return true; }
        const input = await body(req);
        if (!admin && (input.status !== 'canceled' || request.status !== 'queued')) { json(res, 403, { error: 'Only review administrators can manage the queue.' }); return true; }
        if (!['queued', 'in_review', 'completed', 'canceled'].includes(input.status) || (input.status === 'completed' && (typeof input.reviewedText !== 'string' || !input.reviewedText.trim() || input.reviewedText.length > 500_000))) {
            json(res, 400, { error: 'Choose a valid review status and include reviewed text when completing a request.' }); return true;
        }
        request.status = input.status;
        request.updatedAt = new Date().toISOString();
        if (admin) request.updatedBy = user.id;
        if (input.status === 'completed') { request.reviewedText = input.reviewedText; request.completedAt = request.updatedAt; }
        await persist();
        json(res, 200, { request: presented(store, request, admin), backlog: reviewBacklog(store) });
        return true;
    }
    json(res, 404, { error: 'Review endpoint not found.' });
    return true;
}
