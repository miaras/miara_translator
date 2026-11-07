import { randomBytes } from 'node:crypto';
import { balance } from './polar.js';
import { subscriptionState, prepaidTokens } from './subscriptions.js';
import { priceMicros } from './pricing.js';

export function createAllowanceBilling({ store, persist, transaction }) {
    store.ocrReservations ||= [];
    function entry(reservation, tokens, kind, suffix) {
        if (!tokens) return;
        const { id, userId, periodId } = reservation;
        store.subscriptionUsage.push({ id: `${id}:${suffix}`, userId, periodId, tokens, kind, service: 'ocr', createdAt: new Date().toISOString() });
    }
    function creditEntry(reservation, amountMicros, kind, suffix) {
        if (!amountMicros) return;
        store.billingLedger.push({ id: `${reservation.id}:${suffix}`, userId: reservation.userId, amountMicros, kind, service: 'ocr', createdAt: new Date().toISOString() });
    }
    return {
        reserve: (user, tokens) => transaction(async () => {
            if (!Number.isSafeInteger(tokens) || tokens <= 0) throw new Error('Invalid OCR allowance estimate.');
            const state = subscriptionState(store, user.id);
            const monthly = Math.min(tokens, state.remainingTokens);
            const prepaid = Math.min(tokens - monthly, prepaidTokens(store, user.id));
            const legacy = tokens - monthly - prepaid;
            const cost = priceMicros('standard', legacy);
            if (balance(store, user.id) < cost) { const error = new Error('Not enough allowance for the photo estimate. Add a top-up to continue.'); error.status = 402; throw error; }
            const reservation = { id: `ocr:${randomBytes(16).toString('hex')}`, userId: user.id, tokens, monthly, prepaid, legacy, periodId: state.periodId, status: 'pending', createdAt: new Date().toISOString() };
            store.ocrReservations.push(reservation);
            entry(reservation, -monthly, 'reservation', 'monthly');
            entry({ ...reservation, periodId: 'prepaid' }, -prepaid, 'reservation', 'prepaid');
            creditEntry(reservation, -cost, 'reservation', 'credit');
            await persist();
            return reservation;
        }),
        settle: (user, reservation, actualTokens, metadata = {}) => transaction(async () => {
            if (reservation.userId !== user.id || reservation.status !== 'pending') return;
            if (!Number.isSafeInteger(actualTokens) || actualTokens < 0) throw new Error('Invalid OCR allowance settlement.');
            // The initial hold is an estimate. Fund denser pages atomically from
            // currently available allowance without changing the output limit.
            const additional = Math.max(0, actualTokens - reservation.tokens);
            if (additional) {
                const state = subscriptionState(store, user.id);
                const monthly = Math.min(additional, state.remainingTokens);
                const prepaid = Math.min(additional - monthly, prepaidTokens(store, user.id));
                const cost = priceMicros('standard', additional - monthly - prepaid);
                if (balance(store, user.id) < cost) {
                    const error = new Error('This page needs more allowance than the initial estimate. Add a top-up and retry; its recognized text is saved.');
                    error.status = 402; throw error;
                }
                entry({ ...reservation, periodId: state.periodId }, -monthly, 'usage', 'extra-monthly');
                entry({ ...reservation, periodId: 'prepaid' }, -prepaid, 'usage', 'extra-prepaid');
                creditEntry(reservation, -cost, 'usage', 'extra-credit');
                reservation.additionalTokens = additional;
            }
            let unused = Math.max(0, reservation.tokens - actualTokens);
            const legacyReturn = Math.min(unused, reservation.legacy); unused -= legacyReturn;
            const prepaidReturn = Math.min(unused, reservation.prepaid); unused -= prepaidReturn;
            entry(reservation, unused, 'release', 'monthly-release');
            entry({ ...reservation, periodId: 'prepaid' }, prepaidReturn, 'release', 'prepaid-release');
            creditEntry(reservation, priceMicros('standard', legacyReturn), 'release', 'credit-release');
            reservation.status = 'settled'; reservation.actualTokens = actualTokens; reservation.settledAt = new Date().toISOString();
            if (Number.isSafeInteger(metadata.inputTokens)) reservation.inputTokens = metadata.inputTokens;
            if (Number.isSafeInteger(metadata.outputTokens)) reservation.outputTokens = metadata.outputTokens;
            await persist();
        }),
        release: (user, reservation) => transaction(async () => {
            if (reservation.userId !== user.id || reservation.status !== 'pending') return;
            entry(reservation, reservation.monthly, 'release', 'monthly-release');
            entry({ ...reservation, periodId: 'prepaid' }, reservation.prepaid, 'release', 'prepaid-release');
            creditEntry(reservation, priceMicros('standard', reservation.legacy), 'release', 'credit-release');
            reservation.status = 'released';
            await persist();
        })
    };
}
