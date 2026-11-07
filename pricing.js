// Customer prices in USD per 100,000 source tokens. Provider usage never changes these rates.
export const SPEEDS = Object.freeze({
    standard: { label: 'Standard', serviceTier: 'default', pricePer100k: 5 },
    fast: { label: 'Fast', serviceTier: 'fast', pricePer100k: 10 },
    ultrafast: { label: 'Ultrafast', serviceTier: 'ultrafast', pricePer100k: 30 }
});
export function validSpeed(speed) {
    return Object.hasOwn(SPEEDS, speed);
}
export function estimatePrice(speed, sourceTokens) {
    if (!validSpeed(speed)) throw new Error('Invalid translation speed.');
    if (!Number.isSafeInteger(sourceTokens) || sourceTokens < 0) throw new Error('Invalid source token count.');
    return sourceTokens * SPEEDS[speed].pricePer100k / 100_000;
}
export function priceMicros(speed, sourceTokens) {
    return Math.round(estimatePrice(speed, sourceTokens) * 1_000_000);
}
