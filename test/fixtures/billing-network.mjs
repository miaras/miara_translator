import { readFile } from 'node:fs/promises';
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.polar.sh/v1/subscriptions/')) return Response.json(JSON.parse(await readFile(process.env.TEST_SUBSCRIPTION_FILE, 'utf8')));
    if (String(url).startsWith('https://api.polar.sh/v1/customer-sessions/')) return Response.json({ customer_portal_url: 'https://polar.sh/portal/test' });
    if (String(url).startsWith('https://api.polar.sh/v1/orders/')) return Response.json(JSON.parse(await readFile(process.env.TEST_ORDER_FILE, 'utf8')));
    if (String(url).startsWith('https://api.polar.sh/v1/checkouts/')) {
        const input = JSON.parse(options.body);
        if (input.external_customer_id && ['product-5', 'topup-product-5', 'personal-product', 'plus-product', 'pro-product'].includes(input.products[0])) return Response.json({ url: 'https://polar.sh/checkout/test' });
        return Response.json({}, { status: 422 });
    }
    if (String(url) === 'https://api.openai.com/v1/responses') {
        await new Promise(resolve => setTimeout(resolve, 100));
        const input = JSON.parse(options.body);
        if (input.input[1].content.includes('FAIL_PROVIDER')) return Response.json({}, { status: 500 });
        return Response.json({ status: 'completed', usage: { input_tokens: 100, output_tokens: input.input[1].content.includes("EXTRA_USAGE") ? 50000 : 50 }, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Bonjour.' }] }] });
    }
    return nativeFetch(url, options);
};
