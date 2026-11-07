import { readFile, writeFile } from 'node:fs/promises';
import { polarRequest } from '../polar.js';
import { SUBSCRIPTION_PLANS, TOKEN_TOPUPS } from '../subscription-plans.js';
process.loadEnvFile();
const appUrl = process.env.APP_URL || 'https://translate.shiroko.tools';
await polarRequest('/subscriptions/?limit=1');
const products = await polarRequest('/products/?limit=100&is_archived=false');
const organizationId = process.env.POLAR_ORGANIZATION_ID || products.items?.[0]?.organization_id;
if (!organizationId) throw new Error('Set POLAR_ORGANIZATION_ID before subscription setup.');
for (const plan of SUBSCRIPTION_PLANS) {
    const name = `Shiroko ${plan.name} — $${plan.monthlyUsd}/month`;
    let product = products.items.find(item => item.name === name && item.organization_id === organizationId);
    if (!product) product = await polarRequest('/products/', 'POST', { name, description: `${plan.tokens.toLocaleString('en-US')} Standard-equivalent source tokens each month. Standard 1×, Fast 2×, Ultrafast 6×. Allowance resets each paid month; unused tokens do not roll over. Human Review is separate.`, recurring_interval: 'month', recurring_interval_count: 1, prices: [{ amount_type: 'fixed', price_amount: plan.monthlyUsd * 100, price_currency: 'usd' }], metadata: { app: 'shiroko-translator', plan_id: plan.id, allowance_tokens: plan.tokens } });
    if (product.recurring_interval !== 'month' || !product.prices?.some(price => !price.is_archived && price.price_amount === plan.monthlyUsd * 100 && price.price_currency === 'usd')) throw new Error(`Unexpected subscription pricing for ${plan.name}.`);
    const key = `POLAR_SUBSCRIPTION_${plan.id.toUpperCase()}`;
    let env = await readFile('.env', 'utf8');
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, `${key}=${product.id}`) : `${env.trimEnd()}\n${key}=${product.id}\n`;
    await writeFile('.env', env, { mode: 0o600 });
    console.log(`Configured ${plan.name}: $${plan.monthlyUsd}/month, ${plan.tokens.toLocaleString('en-US')} allowance tokens.`);
}
for (const pack of TOKEN_TOPUPS) {
    const name = `Shiroko Top-up — ${pack.tokens.toLocaleString('en-US')} tokens`;
    let product = products.items.find(item => item.name === name && item.organization_id === organizationId);
    if (!product) product = await polarRequest('/products/', 'POST', { name, description: `${pack.tokens.toLocaleString('en-US')} prepaid Standard-equivalent source tokens. One-time purchase; no expiration. Standard 1×, Fast 2×, Ultrafast 6×.`, recurring_interval: null, prices: [{ amount_type: 'fixed', price_amount: pack.amount * 100, price_currency: 'usd' }], metadata: { app: 'shiroko-translator', topup_tokens: pack.tokens } });
    if (product.recurring_interval || !product.prices?.some(price => !price.is_archived && price.price_amount === pack.amount * 100 && price.price_currency === 'usd')) throw new Error(`Unexpected top-up pricing for ${name}.`);
    const key = `POLAR_TOKEN_TOPUP_${pack.amount}`;
    let env = await readFile('.env', 'utf8');
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, `${key}=${product.id}`) : `${env.trimEnd()}\n${key}=${product.id}\n`;
    await writeFile('.env', env, { mode: 0o600 });
    console.log(`Configured $${pack.amount} top-up: ${pack.tokens.toLocaleString('en-US')} tokens.`);
}
const endpoints = await polarRequest('/webhooks/endpoints/?limit=100');
const endpoint = endpoints.items.find(item => item.url === `${appUrl}/api/billing/webhook`);
if (!endpoint) throw new Error('Configure the billing webhook before enabling subscriptions.');
const events = [...new Set([...(endpoint.events || []), 'order.paid', 'order.refunded', 'subscription.created', 'subscription.updated', 'subscription.active', 'subscription.canceled', 'subscription.revoked', 'subscription.uncanceled', 'subscription.past_due'])];
if (events.length !== endpoint.events.length) await polarRequest(`/webhooks/endpoints/${endpoint.id}`, 'PATCH', { events, enabled: true });
console.log('Subscription renewal/cancellation webhooks configured.');
