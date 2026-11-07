export const SUBSCRIPTION_PLANS = Object.freeze([
    { id: 'personal', name: 'Personal', monthlyUsd: 9, tokens: 50_000 },
    { id: 'plus', name: 'Plus', monthlyUsd: 19, tokens: 120_000 },
    { id: 'pro', name: 'Pro', monthlyUsd: 99, tokens: 650_000 }
]);
export const SPEED_MULTIPLIERS = Object.freeze({ standard: 1, fast: 2, ultrafast: 6 });
export const planFor = id => SUBSCRIPTION_PLANS.find(plan => plan.id === id);
export function allowanceCost(speed, sourceTokens) {
    if (!Object.hasOwn(SPEED_MULTIPLIERS, speed) || !Number.isSafeInteger(sourceTokens) || sourceTokens < 0) throw new Error('Invalid allowance request.');
    return sourceTokens * SPEED_MULTIPLIERS[speed];
}
export const TOKEN_TOPUPS = Object.freeze([
    { amount: 5, tokens: 20_000 }, { amount: 10, tokens: 45_000 },
    { amount: 25, tokens: 120_000 }, { amount: 50, tokens: 250_000 }, { amount: 100, tokens: 520_000 }
]);
