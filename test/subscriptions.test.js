import test from 'node:test';
import assert from 'node:assert/strict';
import { SUBSCRIPTION_PLANS, allowanceCost } from '../subscription-plans.js';
import { reconcileSubscription, reconcileSubscriptionOrder, subscriptionState, reconcileTokenTopup, prepaidTokens } from '../subscriptions.js';
import { createAllowanceBilling } from '../allowance-billing.js';

process.env.POLAR_SUBSCRIPTION_PERSONAL = 'personal-product';
process.env.POLAR_SUBSCRIPTION_PRO = 'pro-product';
process.env.POLAR_TOKEN_TOPUP_5 = 'topup-product';
const start = new Date(Date.now()-60_000).toISOString();
const end = new Date(Date.now()+30*86400_000).toISOString();
const subscription = () => ({ id:'sub', product_id:'personal-product', customer_id:'customer', customer:{ external_id:'user' }, current_period_start:start, current_period_end:end, status:'active', cancel_at_period_end:false, ended_at:null });
const order = () => ({ id:'order', subscription_id:'sub', product_id:'personal-product', customer:{external_id:'user'}, paid:true, currency:'usd', net_amount:900, refunded_amount:0, created_at:new Date().toISOString() });
const storeFor = () => ({ users:[{id:'user'}], billingLedger:[] });

test('Pro $99 allowance scales across speeds and paid invoices cannot duplicate allowance', () => {
    const pro = SUBSCRIPTION_PLANS.find(plan=>plan.id==='pro');
    assert.equal(pro.monthlyUsd,99); assert.equal(pro.tokens,650_000);
    assert.equal(allowanceCost('fast',325_000),650_000);
    assert.equal(allowanceCost('ultrafast',108_333),649_998);
    const store=storeFor(), sub=subscription(), invoice=order();
    reconcileSubscription(store,sub);
    assert.equal(subscriptionState(store,'user').remainingTokens,0,'Subscription activation alone grants no unpaid allowance');
    assert.equal(reconcileSubscriptionOrder(store,invoice,sub),true);
    reconcileSubscriptionOrder(store,invoice,sub);
    reconcileSubscriptionOrder(store,{...invoice,id:'duplicate-invoice'},sub);
    assert.equal(subscriptionState(store,'user').remainingTokens,50_000);
    assert.equal(store.subscriptionPeriods.length,1);
});

test('renewals reset allowance without rollover; late refunds affect the original period only', () => {
    const store=storeFor(), sub=subscription(), invoice=order();
    reconcileSubscriptionOrder(store,invoice,sub);
    const oldPeriod=subscriptionState(store,'user').periodId;
    store.subscriptionUsage.push({periodId:oldPeriod,tokens:-1000});
    const newStart=new Date(Date.now()-1000).toISOString();
    const renewed={...sub,current_period_start:newStart,current_period_end:new Date(Date.now()+31*86400_000).toISOString()};
    reconcileSubscription(store,renewed);
    assert.equal(subscriptionState(store,'user').remainingTokens,49_000,'Unpaid renewal metadata cannot mint a new allowance');
    reconcileSubscriptionOrder(store,{...invoice,id:'renewal',created_at:new Date().toISOString()},renewed);
    assert.equal(subscriptionState(store,'user').remainingTokens,50_000);
    reconcileSubscriptionOrder(store,{...invoice,refunded_amount:900},renewed);
    assert.equal(subscriptionState(store,'user').remainingTokens,50_000);
    reconcileSubscriptionOrder(store,{...invoice,id:'renewal',refunded_amount:450,created_at:new Date().toISOString()},renewed);
    assert.equal(subscriptionState(store,'user').remainingTokens,25_000);
    const cancel={...renewed,cancel_at_period_end:true};
    reconcileSubscription(store,cancel);
    assert.equal(subscriptionState(store,'user').remainingTokens,25_000);
    assert.equal(subscriptionState(store,'user',Date.parse(cancel.current_period_end)+1).remainingTokens,0);
    reconcileSubscription(store,{...cancel,status:'canceled',ended_at:new Date(Date.now()-10).toISOString()});
    assert.equal(subscriptionState(store,'user').remainingTokens,0);
});

test('old out-of-order invoice cannot fund a new period; proration cannot mint a full allowance', () => {
    const store=storeFor(), sub=subscription();
    assert.equal(reconcileSubscriptionOrder(store,{...order(),created_at:new Date(Date.parse(start)-1000).toISOString()},sub),false);
    assert.equal(reconcileSubscriptionOrder(store,{...order(),net_amount:100},sub),false);
    assert.equal(subscriptionState(store,'user').remainingTokens,0);
});

test('top-ups survive monthly expiration and reconcile refunds exactly once', () => {
    const store=storeFor();
    const invoice={...order(),product_id:'topup-product',subscription_id:null,net_amount:500};
    reconcileTokenTopup(store,invoice); reconcileTokenTopup(store,invoice);
    assert.equal(prepaidTokens(store,'user'),20_000);
    store.subscriptionUsage.push({userId:'user',periodId:'prepaid',tokens:-1000});
    reconcileTokenTopup(store,{...invoice,refunded_amount:250});
    assert.equal(prepaidTokens(store,'user'),9000);
    assert.equal(subscriptionState(store,'user').prepaidTokens,9000);
});

test('OCR reservation is atomic, releases unused quota, and never double-refunds', async () => {
    const store=storeFor(), sub=subscription();
    reconcileSubscriptionOrder(store,order(),sub);
    let queue=Promise.resolve();
    const billing=createAllowanceBilling({store,persist:async()=>{},transaction:work=>{const next=queue.then(work);queue=next.catch(()=>{});return next;}});
    const user={id:'user'};
    const outcomes=await Promise.allSettled([billing.reserve(user,30_000),billing.reserve(user,30_000)]);
    assert.deepEqual(outcomes.map(item=>item.status).sort(),['fulfilled','rejected']);
    const held=outcomes.find(item=>item.status==='fulfilled').value;
    await billing.settle(user,held,2000);
    await billing.release(user,held);
    assert.equal(subscriptionState(store,'user').remainingTokens,48_000);
    const failed=await billing.reserve(user,4096);
    await billing.release(user,failed);await billing.release(user,failed);
    assert.equal(subscriptionState(store,'user').remainingTokens,48_000);
});


test('permanent Pro access stays active and renews its monthly allowance without payment', () => {
    const store = { users: [{ id: 'owner', permanentPlan: { planId: 'pro', neverExpires: true, grantedAt: '2026-10-21T00:00:00Z' } }], billingLedger: [] };
    const first = subscriptionState(store, 'owner', Date.parse('2026-10-21T12:00:00Z'));
    assert.equal(first.active, true);
    assert.equal(first.permanent, true);
    assert.equal(first.planId, 'pro');
    assert.equal(first.quotaTokens, 650_000);
    assert.equal(first.canSubscribe, false);
    assert.equal(first.hasCustomer, false);
    store.subscriptionUsage.push({ userId: 'owner', periodId: first.periodId, tokens: -1234 });
    assert.equal(subscriptionState(store, 'owner', Date.parse('2026-10-22T00:00:00Z')).remainingTokens, 648_766);
    const next = subscriptionState(store, 'owner', Date.parse('2026-11-01T00:00:00Z'));
    assert.equal(next.remainingTokens, 650_000);
    assert.notEqual(next.periodId, first.periodId);
    const future = subscriptionState(store, 'owner', Date.parse('2050-03-01T00:00:00Z'));
    assert.equal(future.active, true);
    assert.equal(future.remainingTokens, 650_000);
    assert.equal(subscriptionState(store, 'other', Date.parse('2050-03-01T00:00:00Z')).active, false);
});

test('OCR estimate can expand for dense pages without overspending or charging twice', async () => {
    const store = storeFor(); reconcileSubscriptionOrder(store, order(), subscription());
    store.subscriptionPeriods[0].quotaTokens = 2000;
    let queue = Promise.resolve();
    const billing = createAllowanceBilling({ store, persist: async () => {}, transaction: work => { const next = queue.then(work); queue = next.catch(() => {}); return next; } });
    const user = { id: 'user' };
    const hold = await billing.reserve(user, 1536);
    assert.equal(subscriptionState(store, 'user').remainingTokens, 464);
    await assert.rejects(billing.settle(user, hold, 2500), error => error.status === 402);
    assert.equal(subscriptionState(store, 'user').remainingTokens, 464, 'Failed expansion does not spend the remaining allowance');
    await billing.release(user, hold);
    assert.equal(subscriptionState(store, 'user').remainingTokens, 2000);
    store.tokenTopups = [{ id: 'topup', userId: 'user', tokens: 500 }];
    const funded = await billing.reserve(user, 1536);
    await billing.settle(user, funded, 2500);
    await billing.settle(user, funded, 2500);
    await billing.release(user, funded);
    assert.equal(subscriptionState(store, 'user').remainingTokens, 0);
    assert.equal(prepaidTokens(store, 'user'), 0);
    assert.equal(funded.actualTokens, 2500);
});
