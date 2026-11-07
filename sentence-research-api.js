import { createHash } from 'node:crypto';
import { validateResearchInput, researchAllowance } from './sentence-research-input.js';
import { researchSentence } from './sentence-research.js';

export function createSentenceResearchApi(ctx) {
    const { store, persist, body, userFor, json, reserve, settle, release, account } = ctx;
    store.sentenceResearch ||= [];
    const pending = new Map();
    return async (req, res, url) => {
        if (url.pathname !== '/api/research') return false;
        if (req.method !== 'POST') { json(res, 405, { error: 'Expected POST.' }); return true; }
        const user = userFor(req);
        if (!user) { json(res, 401, { error: 'Sign in to research a sentence.' }); return true; }
        try {
            const input = validateResearchInput(await body(req, 250_000));
            const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
            const cached = store.sentenceResearch.find(item => item.userId === user.id && item.key === key && Date.now() - Date.parse(item.createdAt) < 7 * 86400_000);
            if (cached) { json(res, 200, { ...cached.result, cached: true, createdAt: cached.createdAt, allowanceTokens: 0, ...account(user) }); return true; }
            const pendingKey = `${user.id}:${key}`;
            if (!pending.has(pendingKey)) {
                const job = (async () => {
                    if (!(ctx.apiKey || process.env.OPENAI_API_KEY)) throw new Error('Sentence research is not configured.');
                    const tokens = researchAllowance(input);
                    const reservation = await reserve(user, tokens);
                    try {
                        const { providerUsage, ...result } = await researchSentence(input, { apiKey: ctx.apiKey || process.env.OPENAI_API_KEY, fetchImpl: ctx.fetchImpl || fetch });
                        await settle(user, reservation, tokens, providerUsage);
                        const createdAt = new Date().toISOString();
                        store.sentenceResearch = store.sentenceResearch.filter(item => !(item.userId === user.id && item.key === key)).slice(-999);
                        store.sentenceResearch.push({ userId: user.id, key, result, createdAt });
                        await persist();
                        return { ...result, createdAt, allowanceTokens: tokens, cached: false };
                    } catch (error) { await release(user, reservation); throw error; }
                })();
                pending.set(pendingKey, job);
                job.finally(() => pending.delete(pendingKey)).catch(() => {});
            }
            const result = await pending.get(pendingKey);
            json(res, 200, { ...result, ...account(user) });
        } catch (error) {
            json(res, error.status === 400 || error.status === 402 ? error.status : 502, { error: error.status === 400 || error.status === 402 ? error.message : 'Sentence research failed. Please try again.' });
        }
        return true;
    };
}
