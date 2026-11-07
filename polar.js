import { priceMicros } from './pricing.js';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

export const CREDIT_PACKS = [5, 10, 25, 50, 100];
export const API_VERSION = '2026-10';
export function productFor(amount) { return CREDIT_PACKS.includes(amount) ? process.env[`POLAR_PRODUCT_${amount}_USD`] : undefined; }
export async function polarRequest(route, method = 'GET', data) {
    if (!process.env.POLAR_ACCESS_TOKEN) throw new Error('Polar is not configured.');
    const base = process.env.POLAR_ENVIRONMENT === 'sandbox' ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh';
    const response = await fetch(`${base}/v1${route}`, {
        method, signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'Polar-Version': API_VERSION },
        ...(data ? { body: JSON.stringify(data) } : {})
    });
    if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        const detail = Array.isArray(problem.detail) ? problem.detail.map(item => `${item.loc?.join('.')}: ${item.msg}`).join('; ') : typeof problem.detail === 'string' ? problem.detail : '';
        throw new Error(`Polar request failed (${response.status}). ${detail}`);
    }
    return response.json();
}

// Polar supports both its original UTF-8 signing keys and Standard Webhooks keys.
export function verifyWebhook(raw, headers, secret = process.env.POLAR_WEBHOOK_SECRET, now = Date.now()) {
    const id = headers['webhook-id'];
    const timestamp = Number(headers['webhook-timestamp']);
    const signature = headers['webhook-signature'];
    if (!secret || !id || !Number.isInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300 || typeof signature !== 'string') throw new Error('Invalid webhook signature.');
    const keys = [Buffer.from(secret), Buffer.from(secret.replace(/^whsec_/, ''), 'base64')].filter(key => key.length);
    const valid = keys.some(key => {
        const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest();
        return signature.split(' ').some(part => {
            const [version, value] = part.split(',');
            if (version !== 'v1' || !value) return false;
            const actual = Buffer.from(value, 'base64');
            return actual.length === expected.length && timingSafeEqual(actual, expected);
        });
    });
    if (!valid) throw new Error('Invalid webhook signature.');
    return JSON.parse(raw);
}

export function balance(store, userId) {
    return store.billingLedger.filter(entry => entry.userId === userId).reduce((sum, entry) => sum + entry.amountMicros, 0);
}

// Reconcile the current order, rather than trusting webhook delivery order.
export function reconcileOrder(store, order) {
    const dollars = CREDIT_PACKS.find(amount => productFor(amount) === order.product_id);
    if (!dollars) return false;
    const userId = order.customer?.external_id;
    if (!store.users.some(user => user.id === userId)) throw new Error('Payment account could not be found.');
    if (order.currency !== 'usd' || (!order.paid && !['paid', 'partially_refunded', 'refunded'].includes(order.status))) return false;
    const paid = order.net_amount;
    const refunded = order.refunded_amount || 0;
    if (!Number.isSafeInteger(paid) || paid <= 0 || !Number.isSafeInteger(refunded) || refunded < 0 || refunded > paid) throw new Error('Invalid payment amounts.');
    const original = dollars * 1_000_000;
    const credit = original - Math.round(original * refunded / paid);
    const previous = store.billingLedger.filter(entry => entry.orderId === order.id).reduce((sum, entry) => sum + entry.amountMicros, 0);
    if (credit === previous) return false;
    store.billingLedger.push({ id: `order:${order.id}:${refunded}`, orderId: order.id, userId, amountMicros: credit - previous, kind: refunded ? 'refund' : 'purchase', createdAt: new Date().toISOString() });
    return true;
}

// Move dollar credit into the existing non-expiring prepaid allowance. The ledger
// debit makes repeated startup/persist calls idempotent and retains the audit trail.
export function convertDollarCredits(store) {
    const amounts = new Map();
    for (const entry of store.billingLedger || []) amounts.set(entry.userId, (amounts.get(entry.userId) || 0) + entry.amountMicros);
    let converted = 0;
    const microsPerToken = priceMicros('standard', 1);
    for (const user of store.users) {
        const amountMicros = amounts.get(user.id) || 0;
        if (!amountMicros) continue;
        if (!Number.isSafeInteger(amountMicros)) throw new Error('Invalid credit balance for conversion.');
        const tokens = amountMicros > 0 ? Math.ceil(amountMicros / microsPerToken) : Math.floor(amountMicros / microsPerToken);
        if (!Number.isSafeInteger(tokens)) throw new Error('Invalid converted token balance.');
        const id = `credit-conversion:${randomUUID()}`;
        const createdAt = new Date().toISOString();
        store.tokenTopups ||= [];
        store.tokenTopups.push({ id, userId: user.id, tokens, kind: 'credit_conversion', amountMicros, microsPerToken, createdAt });
        store.billingLedger.push({ id, userId: user.id, amountMicros: -amountMicros, tokens, kind: 'token_conversion', createdAt });
        converted++;
    }
    return converted;
}
