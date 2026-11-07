import { planFor, SUBSCRIPTION_PLANS, TOKEN_TOPUPS } from './subscription-plans.js';

export function subscriptionProduct(planId) { return planFor(planId) && process.env[`POLAR_SUBSCRIPTION_${planId.toUpperCase()}`]; }
export const planForProduct = productId => SUBSCRIPTION_PLANS.find(plan => subscriptionProduct(plan.id) && subscriptionProduct(plan.id) === productId);
function initialize(store) { store.subscriptions ||= []; store.subscriptionPeriods ||= []; store.subscriptionUsage ||= []; }
export function reconcileSubscription(store, subscription) {
    initialize(store);
    const plan = planForProduct(subscription.product_id);
    if (!plan) return null;
    const userId = subscription.customer?.external_id;
    if (!store.users.some(user => user.id === userId)) throw new Error('Subscription account could not be found.');
    const start = Date.parse(subscription.current_period_start), end = Date.parse(subscription.current_period_end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Invalid subscription billing period.');
    let saved = store.subscriptions.find(item => item.id === subscription.id);
    if (saved && saved.userId !== userId) throw new Error('Subscription ownership cannot change.');
    if (!saved) { saved = { id: subscription.id, userId }; store.subscriptions.push(saved); }
    Object.assign(saved, { planId: plan.id, customerId: subscription.customer_id || subscription.customer?.id, status: subscription.status, periodStart: new Date(start).toISOString(), periodEnd: new Date(end).toISOString(), cancelAtPeriodEnd: !!subscription.cancel_at_period_end, endedAt: subscription.ended_at || null });
    return saved;
}
export function reconcileSubscriptionOrder(store, order, subscription) {
    initialize(store);
    const plan = planForProduct(order.product_id);
    if (!plan || order.subscription_id !== subscription.id) return false;
    const saved = reconcileSubscription(store, subscription);
    if (!saved || order.customer?.external_id !== saved.userId || order.currency !== 'usd') throw new Error('Subscription order ownership is invalid.');
    if (!order.paid && !['paid', 'partially_refunded', 'refunded'].includes(order.status)) return false;
    const paid = order.net_amount, refunded = order.refunded_amount || 0;
    if (!Number.isSafeInteger(paid) || paid <= 0 || !Number.isSafeInteger(refunded) || refunded < 0 || refunded > paid) throw new Error('Invalid subscription payment.');
    // Order IDs retain their original period across renewals and late refunds.
    let period = store.subscriptionPeriods.find(item => item.orders.some(item => item.id === order.id));
    if (!period) {
        const created = Date.parse(order.created_at);
        if (!Number.isFinite(created) || created < Date.parse(saved.periodStart) || created >= Date.parse(saved.periodEnd)) return false;
        // Proration alone cannot open a fresh, full monthly allowance.
        if (paid < plan.monthlyUsd * 100) return false;
        const id = `${saved.id}:${saved.periodStart}`;
        period = store.subscriptionPeriods.find(item => item.id === id);
        if (!period) {
            period = { id, subscriptionId: saved.id, userId: saved.userId, planId: plan.id, start: saved.periodStart, end: saved.periodEnd, orders: [], quotaTokens: 0 };
            store.subscriptionPeriods.push(period);
        }
    }
    let funding = period.orders.find(item => item.id === order.id);
    if (!funding) { funding = { id: order.id }; period.orders.push(funding); }
    funding.fullTokens ||= plan.tokens;
    Object.assign(funding, { planId: plan.id, paid, refunded, tokens: Math.round(funding.fullTokens * (1 - refunded / paid)) });
    // A duplicate paid invoice cannot stack a second monthly allowance.
    period.quotaTokens = Math.max(0, ...period.orders.map(item => item.tokens));
    const best = period.orders.find(item => item.tokens === period.quotaTokens);
    if (best) period.planId = best.planId;
    return true;
}
export function subscriptionState(store, userId, now = Date.now()) {
    initialize(store);
    const subscriptions = store.subscriptions.filter(item => item.userId === userId).sort((a,b) => Date.parse(b.periodStart)-Date.parse(a.periodStart));
    const paidPeriods = store.subscriptionPeriods.filter(item => item.userId === userId && Date.parse(item.start) <= now && Date.parse(item.end) > now && !subscriptions.find(sub => sub.id === item.subscriptionId && sub.endedAt && Date.parse(sub.endedAt) <= now)).sort((a,b) => Date.parse(b.start)-Date.parse(a.start));
    const grant = store.users?.find(user => user.id === userId)?.permanentPlan;
    const permanentPlan = grant?.neverExpires && Date.parse(grant.grantedAt) <= now ? planFor(grant.planId) : null;
    let period = paidPeriods[0];
    let subscription = subscriptions.find(item => item.id === period?.subscriptionId) || subscriptions[0];
    if (permanentPlan) {
        const current = new Date(now);
        const start = new Date(Math.max(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1), Date.parse(grant.grantedAt))).toISOString();
        const end = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)).toISOString();
        const id = `permanent:${userId}`;
        period = { id: `${id}:${start}`, subscriptionId: id, userId, planId: permanentPlan.id, start, end, quotaTokens: permanentPlan.tokens };
        subscription = { id, userId, planId: permanentPlan.id, status: 'active', periodStart: start, periodEnd: end, cancelAtPeriodEnd: false, endedAt: null };
    }
    const spent = period ? -store.subscriptionUsage.filter(item => item.periodId === period.id).reduce((sum,item) => sum + item.tokens, 0) : 0;
    const hasLiveSubscription = !!subscription && !subscription.endedAt && (Date.parse(subscription.periodEnd) > now || ['active', 'trialing', 'past_due', 'unpaid'].includes(subscription.status));
    return { ...(permanentPlan ? { permanent: true } : {}), canSubscribe: !hasLiveSubscription, prepaidTokens: prepaidTokens(store, userId), subscriptionId: subscription?.id || null, planId: period?.planId || subscription?.planId || null, status: subscription?.status || 'none', cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd || false, periodStart: period?.start || subscription?.periodStart || null, periodEnd: period?.end || subscription?.periodEnd || null, periodId: period?.id || null, quotaTokens: period?.quotaTokens || 0, remainingTokens: period ? Math.max(0, period.quotaTokens - spent) : 0, active: !!period && period.quotaTokens > 0, hasCustomer: !!subscription?.customerId };
}

export function topupProduct(amount) { return TOKEN_TOPUPS.some(pack => pack.amount === amount) ? process.env[`POLAR_TOKEN_TOPUP_${amount}`] : null; }
export function prepaidTokens(store, userId) {
    initialize(store);
    return Math.max(0, (store.tokenTopups || []).filter(item => item.userId === userId).reduce((sum,item) => sum+item.tokens,0) + store.subscriptionUsage.filter(item => item.userId === userId && item.periodId === 'prepaid').reduce((sum,item)=>sum+item.tokens,0));
}
export function reconcileTokenTopup(store, order) {
    initialize(store);
    const pack = TOKEN_TOPUPS.find(item => topupProduct(item.amount) && topupProduct(item.amount) === order.product_id);
    if (!pack) return false;
    const userId = order.customer?.external_id;
    if (!store.users.some(user => user.id === userId) || order.currency !== 'usd') throw new Error('Invalid top-up account.');
    if (!order.paid && !['paid','partially_refunded','refunded'].includes(order.status)) return false;
    const paid = order.net_amount, refunded = order.refunded_amount || 0;
    if (!Number.isSafeInteger(paid) || paid <= 0 || !Number.isSafeInteger(refunded) || refunded<0 || refunded>paid) throw new Error('Invalid top-up payment.');
    store.tokenTopups ||= [];
    let saved = store.tokenTopups.find(item=>item.id === order.id);
    if (saved && saved.userId !== userId) throw new Error('Top-up ownership cannot change.');
    if (!saved) { saved = { id:order.id,userId }; store.tokenTopups.push(saved); }
    saved.tokens = Math.round(pack.tokens * (1-refunded/paid));
    return true;
}
