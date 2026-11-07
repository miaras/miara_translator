import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhook, reconcileOrder, balance } from '../polar.js';

test('webhooks reject tampering, expired timestamps, and missing signatures for both signing formats', () => {
    const raw = JSON.stringify({ type: 'order.paid', data: { id: 'example' } });
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000));
    for (const [secret, key] of [['polar_whs_example', Buffer.from('polar_whs_example')], ['whsec_c2VjcmV0', Buffer.from('secret')]]) {
        const headers = { 'webhook-id': 'event-1', 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${createHmac('sha256', key).update(`event-1.${timestamp}.${raw}`).digest('base64')}` };
        assert.equal(verifyWebhook(raw, headers, secret, now).type, 'order.paid');
        assert.throws(() => verifyWebhook(`${raw} `, headers, secret, now));
        assert.throws(() => verifyWebhook(raw, headers, secret, now + 301000));
        assert.throws(() => verifyWebhook(raw, {}, secret, now));
    }
});

test('credit reconciliation handles retries, partial refunds, tax, and refund-before-payment delivery', () => {
    const previous = process.env.POLAR_PRODUCT_5_USD;
    process.env.POLAR_PRODUCT_5_USD = 'test-product';
    try {
        const store = { users: [{ id: 'user' }], billingLedger: [] };
        const order = { id: 'order', product_id: 'test-product', customer: { external_id: 'user' }, currency: 'usd', paid: true, net_amount: 500, total_amount: 550, refunded_amount: 0 };
        reconcileOrder(store, order);
        reconcileOrder(store, order);
        assert.equal(balance(store, 'user'), 5_000_000);
        order.refunded_amount = 250;
        reconcileOrder(store, order);
        reconcileOrder(store, order);
        assert.equal(balance(store, 'user'), 2_500_000);
        order.refunded_amount = 500;
        order.paid = false;
        order.status = 'refunded';
        reconcileOrder(store, order);
        assert.equal(balance(store, 'user'), 0);
        store.billingLedger = [];
        reconcileOrder(store, order);
        assert.equal(balance(store, 'user'), 0);
        assert.equal(reconcileOrder(store, { ...order, product_id: 'other-product' }), false);
        assert.throws(() => reconcileOrder(store, { ...order, customer: { external_id: 'missing' } }));
    } finally {
        if (previous === undefined) delete process.env.POLAR_PRODUCT_5_USD;
        else process.env.POLAR_PRODUCT_5_USD = previous;
    }
});
