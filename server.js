import { createAllowanceBilling } from './allowance-billing.js';
import { photoOcrApi } from './photo-ocr.js';
import { countryForRequest } from './interface-geolocation.js';
import { SUBSCRIPTION_PLANS, TOKEN_TOPUPS, allowanceCost } from './subscription-plans.js';
import { subscriptionProduct, planForProduct, subscriptionState, reconcileSubscription, reconcileSubscriptionOrder, topupProduct, reconcileTokenTopup, prepaidTokens } from './subscriptions.js';
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { validSpeed, priceMicros } from './pricing.js';
import { countSourceTokens } from './source-tokens.js';
import { translateWithOpenAI } from './openai-translation.js';
import { CREDIT_PACKS, productFor, polarRequest, verifyWebhook, balance, reconcileOrder, convertDollarCredits } from './polar.js';
import { socialAuth } from './social-auth.js';
import { humanReviewApi, REVIEW_ADMINS } from './human-review.js';
import { createReviewNotifier } from './human-review-notifications.js';
import { ensureReferralCode, hasSignupCredit, grantSignupReferral, pendingReferralNotifications, acknowledgeReferralNotifications, CREDIT_EXPLANATION, SIGNUP_CREDIT_MICROS } from './referral.js';

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const dataFile = process.env.SHIROKO_DATA_FILE || path.join(root, 'data', 'store.json');
const port = Number(process.env.PORT || 3000);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8' };
let store = { users: [], sessions: [], translations: [] };
let writing = Promise.resolve();
try { store = JSON.parse(await readFile(dataFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
store.billingLedger ||= [];
store.humanReviewRequests ||= [];
if (convertDollarCredits(store)) await persist();
const reviewAdminIds = new Set(store.users.filter(user => REVIEW_ADMINS.includes(user.email?.toLowerCase())).map(user => user.id));
const notifyReviews = createReviewNotifier({ store, persist });
setInterval(notifyReviews, 60_000).unref();
void notifyReviews();
let billingQueue = Promise.resolve();
function billingTransaction(work) {
    const next = billingQueue.then(work);
    billingQueue = next.catch(() => {});
    return next;
}

const ocrBilling = createAllowanceBilling({ store, persist, transaction: billingTransaction });

function persist() {
    convertDollarCredits(store);
    writing = writing.catch(() => {}).then(async () => {
        await mkdir(path.dirname(dataFile), { recursive: true });
        const temp = `${dataFile}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(store), { mode: 0o600 });
        await rename(temp, dataFile);
    });
    return writing;
}
function json(res, status, value, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(value));
}
function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
function cookie(req) { return /(?:^|; )shiroko_session=([^;]+)/.exec(req.headers.cookie || '')?.[1]; }
function userFor(req) {
    const token = cookie(req);
    const session = token && store.sessions.find(s => s.tokenHash === tokenHash(token) && s.expires > Date.now());
    return session && store.users.find(u => u.id === session.userId);
}
function sessionCookie(token, req) {
    return `shiroko_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;
}
async function body(req, maxLength = 2_000_000) {
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
        if (raw.length > maxLength) throw new Error('Request is too large.');
    }
    try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON.'); }
}
function publicUser(user) { return { id: user.id, email: user.email, name: user.name, balanceMicros: balance(store, user.id), subscription: subscriptionState(store, user.id), promotionPromptPending: !user.promotionPromptSeenAt && !store.billingLedger.some(entry => entry.userId === user.id && ['promotion', 'referral_signup'].includes(entry.kind)) }; }
const PROMOTION_CODE = 'TRANSLATE.SHIROKO.TOOLS';
function validPromotion(code) { return typeof code === 'string' && code.trim().toUpperCase() === PROMOTION_CODE; }
function grantPromotion(user) {
    const id = `promotion:${PROMOTION_CODE}:${user.id}`;
    if (hasSignupCredit(store, user)) return false;
    store.billingLedger.push({ id, userId: user.id, amountMicros: 500_000, kind: 'promotion', promotionCode: PROMOTION_CODE, createdAt: new Date().toISOString() });
    return true;
}
async function billingWebhook(req, res) {
    if (!process.env.POLAR_WEBHOOK_SECRET) return json(res, 503, { error: 'Webhook is not configured.' });
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 2_000_000) return json(res, 413, { error: 'Webhook is too large.' });
    }
    let event;
    try { event = verifyWebhook(raw, req.headers); }
    catch { return json(res, 403, { error: 'Invalid webhook signature or payload.' }); }
    if (['order.paid', 'order.refunded'].includes(event.type)) {
        if (!/^[a-f0-9-]{36}$/.test(event.data?.id || '')) return json(res, 400, { error: 'Invalid order.' });
        await billingTransaction(async () => {
            const order = await polarRequest(`/orders/${event.data.id}`);
            if (planForProduct(order.product_id) && order.subscription_id) {
                const subscription = await polarRequest(`/subscriptions/${order.subscription_id}`);
                reconcileSubscriptionOrder(store, order, subscription);
            } else if (!reconcileTokenTopup(store, order)) reconcileOrder(store, order);
            await persist();
        });
    }
    if (['subscription.created', 'subscription.updated', 'subscription.active', 'subscription.canceled', 'subscription.revoked', 'subscription.uncanceled', 'subscription.past_due'].includes(event.type)) {
        if (!/^[a-f0-9-]{36}$/.test(event.data?.id || '')) return json(res, 400, { error: 'Invalid subscription.' });
        await billingTransaction(async () => {
            reconcileSubscription(store, await polarRequest(`/subscriptions/${event.data.id}`));
            await persist();
        });
    }
    return json(res, 200, { received: true });
}
function documentInput(value) {
    if (!value || typeof value !== 'object' || typeof value.title !== 'string' || typeof value.sourceText !== 'string' || typeof value.targetLang !== 'string' || typeof value.instructions !== 'string' || !Array.isArray(value.rows)) return null;
    if (!value.title.trim() || value.title.length > 160 || value.instructions.length > 10_000) return null;
    if (!value.rows.every(row => row && typeof row.source === 'string' && typeof row.target === 'string' && row.source.length <= 20_000 && row.target.length <= 20_000 && (row.originalTranslation === undefined || typeof row.originalTranslation === 'string') && (row.newParagraph === undefined || typeof row.newParagraph === 'boolean'))) return null;
    if (value.summary !== undefined && typeof value.summary !== 'string') return null;
    if (value.dictionary !== undefined && (!value.dictionary || typeof value.dictionary !== 'object' || Array.isArray(value.dictionary) || Object.values(value.dictionary).some(term => typeof term !== 'string'))) return null;
    if (value.sourceLang !== undefined && (typeof value.sourceLang !== 'string' || value.sourceLang.length > 80)) return null;
    return { ...(value.sourceLang ? { sourceLang: value.sourceLang } : {}), dictionary: value.dictionary || {}, summary: value.summary || '', title: value.title.trim(), sourceText: value.sourceText, targetLang: value.targetLang, instructions: value.instructions, rows: value.rows.map(({ source, target, newParagraph, originalTranslation }) => ({ source, target, newParagraph: !!newParagraph, ...(originalTranslation !== undefined ? { originalTranslation } : {}) })) };
}
function translationInput(value) {
    if (!value || typeof value !== 'object' || !['translate', 'regenerate', 'improve'].includes(value.mode)) return null;
    if (value.speed !== undefined && !validSpeed(value.speed)) return null;
    const fields = ['text', 'targetLanguage', 'instructions', 'summary', 'previousContext', 'previousTranslatedText', 'contextBefore', 'contextAfter'];
    if (fields.some(field => value[field] !== undefined && typeof value[field] !== 'string')) return null;
    if (value.mode === 'improve' && (typeof value.existingTranslation !== 'string' || !Array.isArray(value.draftSentences) || !value.draftSentences.every(sentence => typeof sentence === 'string') || value.draftSentences.join('') !== value.existingTranslation || typeof value.isLastChunk !== 'boolean')) return null;
    if (!value.text?.trim() || (value.mode !== 'improve' && value.text.length > 10_000) || !value.targetLanguage?.trim() || value.targetLanguage.length > 80 || (value.instructions || '').length > 10_000) return null;
    if (fields.slice(3).some(field => (value[field] || '').length > 10_000)) return null;
    if (value.dictionary !== undefined && (!value.dictionary || typeof value.dictionary !== 'object' || Array.isArray(value.dictionary) || Object.entries(value.dictionary).length > 500 || Object.entries(value.dictionary).some(([key, term]) => key.length > 200 || typeof term !== 'string' || term.length > 200))) return null;
    return value;
}
async function api(req, res, url) {
    if (!['GET', 'POST', 'PUT'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
    if (await socialAuth(req, res, url, { store, persist, userFor, sessionCookie, json, onSignup: (user, referralCode) => { ensureReferralCode(store, user); grantSignupReferral(store, user, referralCode); } })) return;
    if (url.pathname === '/api/billing/webhook' && req.method === 'POST') return billingWebhook(req, res);
    if (req.method !== 'GET') {
        const origin = req.headers.origin;
        const host = req.headers.host;
        if (origin && new URL(origin).host !== host) return json(res, 403, { error: 'Request origin rejected.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Expected JSON.' });
    }
    if (await photoOcrApi(req, res, url, { store, persist, userFor, body, json, ...ocrBilling, account: user => ({ balanceMicros: balance(store, user.id), subscription: subscriptionState(store, user.id) }) })) return;
    if (await humanReviewApi(req, res, url, { store, persist, userFor, body, json, reviewAdminIds, notify: notifyReviews })) return;
    if (url.pathname === '/api/translate' && req.method === 'POST') {
        const input = translationInput(await body(req));
        if (!input) return json(res, 400, { error: 'Translation request is invalid.' });
        const user = userFor(req);
        if (!user) return json(res, 401, { error: 'Sign in to translate.' });
        if (!process.env.OPENAI_API_KEY) return json(res, 503, { error: 'OPENAI_API_KEY is not configured on the server.' });
        const sourceTokens = countSourceTokens(input.text);
        const fixedCost = priceMicros(input.speed || 'standard', sourceTokens);
        const requestId = randomBytes(16).toString('hex');
        let reserved = 0;
        let reservedTokens = 0;
        let reservedPeriodId = null;
        let reservedPrepaidTokens = 0;
        let settled = false;
        const billing = {
            reserve: () => billingTransaction(async () => {
                const allowance = subscriptionState(store, user.id);
                const needed = allowanceCost(input.speed || 'standard', sourceTokens);
                const fromSubscription = Math.min(needed, allowance.remainingTokens);
                const fromPrepaid = Math.min(needed - fromSubscription, prepaidTokens(store, user.id));
                const amount = priceMicros('standard', needed - fromSubscription - fromPrepaid);
                if (balance(store, user.id) < amount) {
                    const error = new Error('Choose a plan or add credit to cover this request. Your text is saved in this browser.');
                    error.status = 402;
                    throw error;
                }
                if (fromSubscription) {
                    store.subscriptionUsage.push({ id: requestId, userId: user.id, periodId: allowance.periodId, tokens: -fromSubscription, kind: 'reservation', createdAt: new Date().toISOString() });
                    reservedTokens = fromSubscription;
                    reservedPeriodId = allowance.periodId;
                }
                if (fromPrepaid) {
                    store.subscriptionUsage.push({ id: `${requestId}:prepaid`, userId: user.id, periodId: 'prepaid', tokens: -fromPrepaid, kind: 'reservation', createdAt: new Date().toISOString() });
                    reservedPrepaidTokens = fromPrepaid;
                }
                store.billingLedger.push({ id: requestId, userId: user.id, amountMicros: -amount, kind: 'reservation', createdAt: new Date().toISOString() });
                reserved = amount;
                await persist();
            }),
            settle: usage => billingTransaction(async () => {
                if (!Number.isSafeInteger(usage?.input_tokens) || !Number.isSafeInteger(usage?.output_tokens) || usage.input_tokens < 0 || usage.output_tokens < 0) throw new Error('Provider usage is missing.');
                const cost = reserved;
                store.billingLedger.push({ id: `${requestId}:settled`, userId: user.id, amountMicros: reserved - cost, kind: 'usage', sourceTokens, allowanceTokens: reservedTokens, prepaidTokens: reservedPrepaidTokens, nominalCostMicros: fixedCost, costMicros: cost, pricingVersion: 'subscription-v1', inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, speed: input.speed || 'standard', createdAt: new Date().toISOString() });
                settled = true;
                await persist();
            })
        };
        try {
            const result = await translateWithOpenAI(input, fetch, process.env.OPENAI_API_KEY, billing);
            return json(res, 200, { ...result, balanceMicros: balance(store, user.id), subscription: subscriptionState(store, user.id) });
        }
        catch (error) {
            if ((reserved || reservedTokens || reservedPrepaidTokens) && !settled) await billingTransaction(async () => {
                if (reservedPrepaidTokens) store.subscriptionUsage.push({ id: `${requestId}:prepaid-released`, userId: user.id, periodId: 'prepaid', tokens: reservedPrepaidTokens, kind: 'release', createdAt: new Date().toISOString() });
                if (reservedTokens) store.subscriptionUsage.push({ id: `${requestId}:released`, userId: user.id, periodId: reservedPeriodId, tokens: reservedTokens, kind: 'release', createdAt: new Date().toISOString() });
                store.billingLedger.push({ id: `${requestId}:released`, userId: user.id, amountMicros: reserved, kind: 'release', createdAt: new Date().toISOString() });
                await persist();
            });
            if (error.status === 402) return json(res, 402, { error: error.message });
            console.error('Translation failed:', error);
            return json(res, 502, { error: error.message.startsWith('OpenAI is rate limited') ? error.message : 'Translation failed. Please try again.' });
        }
    }
    if (url.pathname === '/api/me' && req.method === 'GET') {
        const user = userFor(req);
        return json(res, 200, { user: user ? publicUser(user) : null });
    }
    if (url.pathname === '/api/register' && req.method === 'POST') {
        const { email, password, promotionCode, referralCode } = await body(req);
        const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254 || typeof password !== 'string' || password.length < 12 || password.length > 256) return json(res, 400, { error: 'Enter a valid email and a password of at least 12 characters.' });
        if (store.users.some(u => u.email === normalized)) return json(res, 409, { error: 'An account with this email already exists.' });
        if (promotionCode && !validPromotion(promotionCode)) return json(res, 400, { error: 'Promotion code is invalid.' });
        const salt = randomBytes(16).toString('hex');
        const hash = (await scrypt(password, salt, 64)).toString('hex');
        if (store.users.some(u => u.email === normalized)) return json(res, 409, { error: 'An account with this email already exists.' });
        const user = { id: randomBytes(16).toString('hex'), email: normalized, salt, hash };
        store.users.push(user);
        ensureReferralCode(store, user);
        grantSignupReferral(store, user, referralCode);
        if (validPromotion(promotionCode)) grantPromotion(user);
        const token = randomBytes(32).toString('hex');
        store.sessions = store.sessions.filter(s => s.expires > Date.now());
        store.sessions.push({ tokenHash: tokenHash(token), userId: user.id, expires: Date.now() + 30 * 86400_000 });
        await persist();
        return json(res, 201, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token, req) });
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
        const { email, password } = await body(req);
        const user = store.users.find(u => u.email === String(email || '').trim().toLowerCase());
        const actual = await scrypt(typeof password === 'string' ? password : '', user?.salt || '00000000000000000000000000000000', 64);
        if (!user?.hash || !timingSafeEqual(actual, Buffer.from(user.hash, 'hex'))) return json(res, 401, { error: 'Email or password is incorrect.' });
        const token = randomBytes(32).toString('hex');
        store.sessions = store.sessions.filter(s => s.expires > Date.now());
        store.sessions.push({ tokenHash: tokenHash(token), userId: user.id, expires: Date.now() + 30 * 86400_000 });
        await persist();
        return json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token, req) });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
        store.sessions = store.sessions.filter(s => s.tokenHash !== tokenHash(cookie(req) || ''));
        await persist();
        return json(res, 200, { ok: true }, { 'Set-Cookie': 'shiroko_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    const user = userFor(req);
    if (!user) return json(res, 401, { error: 'Sign in to access saved translations.' });
    if (url.pathname === '/api/referrals/notifications' && req.method === 'GET') {
        return json(res, 200, { notifications: pendingReferralNotifications(user) });
    }
    if (url.pathname === '/api/referrals/notifications' && req.method === 'POST') {
        const { ids } = await body(req);
        acknowledgeReferralNotifications(user, ids);
        await persist();
        return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/referrals' && req.method === 'GET') {
        const code = ensureReferralCode(store, user);
        await persist();
        const link = new URL('/app.html', process.env.APP_URL || 'https://translate.shiroko.tools');
        link.searchParams.set('ref', code);
        return json(res, 200, { url: link.href, creditMicros: SIGNUP_CREDIT_MICROS, creditTokens: 2_500, explanation: CREDIT_EXPLANATION, successfulInvites: store.billingLedger.filter(entry => entry.userId === user.id && entry.kind === 'referral_reward').length });
    }
    if (url.pathname === '/api/billing/promotion-prompt' && req.method === 'POST') {
        user.promotionPromptSeenAt ||= new Date().toISOString();
        await persist();
        return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/billing/promotion' && req.method === 'POST') {
        const { promotionCode } = await body(req);
        if (!validPromotion(promotionCode)) return json(res, 400, { error: 'Promotion code is invalid.' });
        return billingTransaction(async () => {
            const granted = grantPromotion(user);
            await persist();
            return json(res, 200, { balanceMicros: balance(store, user.id), subscription: subscriptionState(store, user.id), message: granted ? '10,000 promotional tokens added.' : 'Your signup credit has already been redeemed on this account.' });
        });
    }
    if (url.pathname === '/api/billing' && req.method === 'GET') return json(res, 200, { balanceMicros: balance(store, user.id), subscription: subscriptionState(store, user.id), plans: SUBSCRIPTION_PLANS.map(plan => ({ ...plan, available: !!subscriptionProduct(plan.id) })), packs: TOKEN_TOPUPS.map(pack => ({ ...pack, available: !!topupProduct(pack.amount) })), configured: !!(process.env.POLAR_ACCESS_TOKEN && process.env.POLAR_WEBHOOK_SECRET) });
    if (url.pathname === '/api/billing/subscribe' && req.method === 'POST') {
        const { planId } = await body(req);
        const product = subscriptionProduct(planId);
        if (!product) return json(res, 400, { error: 'Choose an available subscription plan.' });
        if (!process.env.POLAR_WEBHOOK_SECRET) return json(res, 503, { error: 'Payments are not ready yet.' });
        if (!subscriptionState(store, user.id).canSubscribe) return json(res, 409, { error: 'Manage your existing subscription before starting another plan.' });
        const appUrl = process.env.APP_URL || 'https://translate.shiroko.tools';
        try {
            const checkout = await polarRequest('/checkouts/', 'POST', { products: [product], external_customer_id: user.id, ...(user.email ? { customer_email: user.email } : {}), allow_discount_codes: false, success_url: `${appUrl}/app.html?payment=success&checkout_id={CHECKOUT_ID}`, return_url: `${appUrl}/app.html?payment=canceled` });
            return json(res, 200, { url: checkout.url });
        } catch { return json(res, 502, { error: 'Could not open subscription checkout. Please try again.' }); }
    }
    if (url.pathname === '/api/billing/portal' && req.method === 'POST') {
        const customerId = store.subscriptions?.find(item => item.userId === user.id && item.customerId)?.customerId;
        if (!customerId) return json(res, 400, { error: 'Subscribe before opening subscription management.' });
        try {
            const session = await polarRequest('/customer-sessions/', 'POST', { customer_id: customerId, return_url: `${process.env.APP_URL || 'https://translate.shiroko.tools'}/app.html` });
            return json(res, 200, { url: session.customer_portal_url });
        } catch { return json(res, 502, { error: 'Could not open subscription management. Please try again.' }); }
    }
    if (url.pathname === '/api/billing/topup' && req.method === 'POST') {
        const { amount } = await body(req);
        const product = topupProduct(amount);
        if (!product) return json(res, 400, { error: 'Choose an available credit pack.' });
        if (!process.env.POLAR_WEBHOOK_SECRET) return json(res, 503, { error: 'Payments are not ready yet.' });
        const appUrl = process.env.APP_URL || 'https://translate.shiroko.tools';
        try {
            const checkout = await polarRequest('/checkouts/', 'POST', { products: [product], external_customer_id: user.id, ...(user.email ? { customer_email: user.email } : {}), allow_discount_codes: false, success_url: `${appUrl}/app.html?payment=success&checkout_id={CHECKOUT_ID}`, return_url: `${appUrl}/app.html?payment=canceled` });
            return json(res, 200, { url: checkout.url });
        } catch { return json(res, 502, { error: 'Could not open checkout. Please try again.' }); }
    }
    if (url.pathname === '/api/translations' && req.method === 'GET') {
        return json(res, 200, { translations: store.translations.filter(t => t.userId === user.id).map(({ id, title, targetLang, updatedAt, rows }) => ({ id, title, targetLang, updatedAt, rowCount: rows.length })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    }
    if (url.pathname === '/api/translations' && req.method === 'POST') {
        const input = documentInput(await body(req, Infinity));
        if (!input) return json(res, 400, { error: 'Translation data is invalid.' });
        const translation = { ...input, id: randomBytes(16).toString('hex'), userId: user.id, updatedAt: new Date().toISOString() };
        store.translations.push(translation);
        await persist();
        return json(res, 201, { translation });
    }
    const match = /^\/api\/translations\/([a-f0-9]{32})$/.exec(url.pathname);
    if (match) {
        const translation = store.translations.find(t => t.id === match[1] && t.userId === user.id);
        if (!translation) return json(res, 404, { error: 'Translation not found.' });
        if (req.method === 'GET') return json(res, 200, { translation });
        if (req.method === 'PUT') {
            const input = documentInput(await body(req, Infinity));
            if (!input) return json(res, 400, { error: 'Translation data is invalid.' });
            Object.assign(translation, input, { updatedAt: new Date().toISOString() });
            await persist();
            return json(res, 200, { translation });
        }
    }
    return json(res, 404, { error: 'Not found.' });
}
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (url.pathname === '/api/interface-locale' && req.method === 'GET') return json(res, 200, { country: await countryForRequest(req) });
        if (url.pathname.startsWith('/api/')) return await api(req, res, url);
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
        const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : ['/icons', '/icons/'].includes(url.pathname) ? '/icons/index.html' : url.pathname);
        const file = path.resolve(root, 'dist', `.${pathname}`);
        if (!file.startsWith(path.join(root, 'dist') + path.sep)) return json(res, 404, { error: 'Not found.' });
        const info = await stat(file);
        if (!info.isFile()) return json(res, 404, { error: 'Not found.' });
        const headers = { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
        let start = 0;
        let end = info.size - 1;
        if (req.headers.range) {
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            if (range && (range[1] || range[2])) {
                start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
                end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
            } else start = info.size;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= info.size || start > end) {
                res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` });
                return res.end();
            }
            headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
        }
        headers['Content-Length'] = Math.max(0, end - start + 1);
        res.writeHead(req.headers.range ? 206 : 200, headers);
        if (req.method === 'HEAD') return res.end();
        createReadStream(file, req.headers.range ? { start, end } : {}).pipe(res);
    } catch (error) {
        if (error.code === 'ENOENT') return json(res, 404, { error: 'Not found. Run npm run build first.' });
        const status = ['Request is too large.', 'Invalid JSON.'].includes(error.message) ? 400 : 500;
        if (status === 500) console.error(error);
        json(res, status, { error: status === 500 ? 'Server error. Please try again.' : error.message });
    }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Shiroko listening on http://localhost:${port}`));
