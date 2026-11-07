import { randomBytes } from 'node:crypto';

export const SIGNUP_CREDIT_MICROS = 125_000;
export const CREDIT_EXPLANATION = 'Invite a friend and get credit to translate 5 pages.';
export function ensureReferralCode(store, user) {
    if (!user.referralCode) {
        do { user.referralCode = randomBytes(16).toString('hex'); }
        while (store.users.some(other => other !== user && other.referralCode === user.referralCode));
    }
    return user.referralCode;
}
export function hasSignupCredit(store, user) {
    return store.billingLedger.some(entry => entry.userId === user.id && ['promotion', 'referral_signup'].includes(entry.kind));
}
// Called only as part of creating a new account. Existing accounts cannot attach referrals.
export function grantSignupReferral(store, user, code) {
    const inviter = typeof code === 'string' && store.users.find(other => other.referralCode === code && other.id !== user.id);
    if (!inviter || user.referredBy || hasSignupCredit(store, user)) return false;
    user.referredBy = inviter.id;
    const createdAt = new Date().toISOString();
    store.billingLedger.push(
        { id: `referral:signup:${user.id}`, userId: user.id, inviterId: inviter.id, amountMicros: SIGNUP_CREDIT_MICROS, kind: 'referral_signup', createdAt },
        { id: `referral:reward:${user.id}`, userId: inviter.id, invitedUserId: user.id, amountMicros: SIGNUP_CREDIT_MICROS, kind: 'referral_reward', createdAt }
    );
    for (const recipient of [user, inviter]) {
        recipient.referralNotifications ||= [];
        recipient.referralNotifications.push({ id: `referral:${user.id}:${recipient.id}`, creditTokens: 2_500, createdAt });
    }
    return true;
}

export function pendingReferralNotifications(user) {
    return (user.referralNotifications || []).filter(notification => !notification.seenAt);
}

export function acknowledgeReferralNotifications(user, ids) {
    if (!Array.isArray(ids)) return;
    const seenAt = new Date().toISOString();
    for (const notification of pendingReferralNotifications(user)) {
        if (ids.includes(notification.id)) notification.seenAt = seenAt;
    }
}
