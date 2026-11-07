import { readFile, writeFile } from 'node:fs/promises';
import { CREDIT_PACKS, polarRequest } from '../polar.js';

process.loadEnvFile();
const appUrl = 'https://translate.shiroko.tools';
const products = await polarRequest('/products/?limit=100&is_archived=false');
const organizationId = process.env.POLAR_ORGANIZATION_ID || products.items?.[0]?.organization_id;
if (!organizationId) throw new Error('Set POLAR_ORGANIZATION_ID before running setup.');
const config = { APP_URL: appUrl, POLAR_ENVIRONMENT: process.env.POLAR_ENVIRONMENT || 'production' };
for (const amount of CREDIT_PACKS) {
    const name = `Shiroko Translation Credit — $${amount}`;
    let product = products.items.find(item => item.name === name && item.organization_id === organizationId);
    if (!product) product = await polarRequest('/products/', 'POST', {
        name, description: `$${amount} USD of prepaid translation usage at translate.shiroko.tools. One-time purchase.`,
        recurring_interval: null, prices: [{ amount_type: 'fixed', price_amount: amount * 100, price_currency: 'usd' }], metadata: { app: 'shiroko-translator', credit_usd: amount }
    });
    if (product.recurring_interval || !product.prices?.some(price => price.price_amount === amount * 100 && price.price_currency === 'usd')) throw new Error(`Unexpected price for ${name}.`);
    config[`POLAR_PRODUCT_${amount}_USD`] = product.id;
    // Save each product immediately so an interrupted setup can resume safely.
    let env = await readFile('.env', 'utf8');
    for (const [key, value] of Object.entries(config)) {
        const line = `${key}=${value}`;
        const pattern = new RegExp(`^${key}=.*$`, 'm');
        env = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;
    }
    await writeFile('.env', env, { mode: 0o600 });
    console.log(`Configured $${amount} credit pack (${product.id}).`);
}
const endpoints = await polarRequest('/webhooks/endpoints/?limit=100');
const endpoint = endpoints.items.find(item => item.url === `${appUrl}/api/billing/webhook`);
console.log(JSON.stringify({ webhookFound: !!endpoint, enabled: endpoint?.enabled, events: endpoint?.events, version: endpoint?.api_version, secretConfigured: !!process.env.POLAR_WEBHOOK_SECRET }));
