import { createHash, randomBytes, createPublicKey, verify } from 'node:crypto';

export const PROVIDERS = {
    google: { name: 'Google', authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuer: 'https://accounts.google.com', scope: 'openid email profile', pkce: true },
    microsoft: { name: 'Microsoft', authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', jwks: 'https://login.microsoftonline.com/common/discovery/v2.0/keys', scope: 'openid email profile', pkce: true },
    twitter: { name: 'X (Twitter)', authorize: 'https://x.com/i/oauth2/authorize', token: 'https://api.x.com/2/oauth2/token', profile: 'https://api.x.com/2/users/me', scope: 'tweet.read users.read', pkce: true },
    kakao: { name: 'Kakao', authorize: 'https://kauth.kakao.com/oauth/authorize', token: 'https://kauth.kakao.com/oauth/token', profile: 'https://kapi.kakao.com/v2/user/me' }
};
const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const keyCache = new Map();
const baseUrl = () => new URL(process.env.APP_URL || 'https://translate.shiroko.tools').origin;
export const callbackUrl = provider => `${baseUrl()}/api/auth/${provider}/callback`;

function credentials(provider) {
    const prefix = provider.toUpperCase();
    return { clientId: process.env[`${prefix}_CLIENT_ID`], secret: process.env[`${prefix}_CLIENT_SECRET`] };
}
export function providerEnabled(provider) {
    if (!Object.hasOwn(PROVIDERS, provider)) return false;
    const { clientId, secret } = credentials(provider);
    return !!(clientId && secret);
}
async function fetchJson(url, options = {}, fetchImpl = fetch) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error('Provider request failed.');
    return response.json();
}
async function signingKey(provider, kid, fetchImpl) {
    let cached = keyCache.get(provider);
    if (!cached || cached.expires < Date.now() || !cached.keys.some(key => key.kid === kid)) {
        const data = await fetchJson(PROVIDERS[provider].jwks, {}, fetchImpl);
        if (!Array.isArray(data.keys)) throw new Error('Invalid signing keys.');
        cached = { keys: data.keys, expires: Date.now() + 3600_000 };
        keyCache.set(provider, cached);
    }
    const key = cached.keys.find(key => key.kid === kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
    if (!key) throw new Error('Unknown signing key.');
    return key;
}
export async function verifyIdToken(token, provider, nonce, fetchImpl = fetch) {
    if (typeof token !== 'string' || token.length > 32_000) throw new Error('Invalid identity token.');
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[\w-]+$/.test(part))) throw new Error('Invalid identity token.');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit !== undefined) throw new Error('Unsupported identity signature.');
    const key = await signingKey(provider, header.kid, fetchImpl);
    if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid identity signature.');
    const now = Date.now() / 1000;
    const { clientId } = credentials(provider);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!clientId || !audience.includes(clientId) || (audience.length > 1 && claims.azp !== clientId) || (claims.azp && claims.azp !== clientId) || !Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 60 || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 60)) || claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new Error('Invalid identity claims.');
    if (provider === 'microsoft') {
        if (typeof claims.tid !== 'string' || !/^[a-f\d-]{36}$/i.test(claims.tid)) throw new Error('Invalid Microsoft tenant.');
        const issuer = `https://login.microsoftonline.com/${claims.tid}/v2.0`;
        if (claims.iss !== issuer || (key.issuer && key.issuer.replace('{tenantid}', claims.tid) !== issuer)) throw new Error('Invalid identity issuer.');
    } else if (claims.iss !== PROVIDERS[provider].issuer && !(provider === 'google' && claims.iss === 'accounts.google.com')) throw new Error('Invalid identity issuer.');
    return claims;
}
const emailValue = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.trim().toLowerCase() : null;
export async function exchangeIdentity(provider, code, transaction, fetchImpl = fetch) {
    const config = PROVIDERS[provider];
    const { clientId, secret } = credentials(provider);
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: callbackUrl(provider) });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    if (config.pkce) form.set('code_verifier', transaction.verifier);
    if (provider === 'twitter') headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`).toString('base64')}`;
    else form.set('client_secret', secret);
    const tokens = await fetchJson(config.token, { method: 'POST', headers, body: form.toString() }, fetchImpl);
    if (config.jwks) {
        const claims = await verifyIdToken(tokens.id_token, provider, transaction.nonce, fetchImpl);
        const email = emailValue(claims.email);
        return { provider, subject: `${provider === 'google' ? config.issuer : claims.iss}|${claims.sub}`, email, emailVerified: claims.email_verified === true || claims.email_verified === 'true', name: typeof claims.name === 'string' ? claims.name.slice(0, 160) : config.name + ' account' };
    }
    if (typeof tokens.access_token !== 'string' || !tokens.access_token) throw new Error('Missing access token.');
    const profile = await fetchJson(config.profile, { headers: { Authorization: `Bearer ${tokens.access_token}` } }, fetchImpl);
    if (provider === 'twitter') {
        if (typeof profile.data?.id !== 'string' || !profile.data.id) throw new Error('Invalid X account.');
        return { provider, subject: profile.data.id, email: null, emailVerified: false, name: String(profile.data.name || profile.data.username || 'X account').slice(0, 160) };
    }
    if (!Number.isSafeInteger(profile.id) || profile.id <= 0) throw new Error('Invalid Kakao account.');
    const account = profile.kakao_account || {};
    return { provider, subject: String(profile.id), email: emailValue(account.email), emailVerified: account.is_email_valid === true && account.is_email_verified === true, name: String(account.profile?.nickname || 'Kakao account').slice(0, 160) };
}

export function resolveIdentity(store, identity, linkUserId) {
    const match = store.users.find(user => user.identities?.some(item => item.provider === identity.provider && item.subject === identity.subject));
    if (match && linkUserId && match.id !== linkUserId) throw new Error('identity_in_use');
    if (match) return match;
    let user = linkUserId && store.users.find(user => user.id === linkUserId);
    if (linkUserId && !user) throw new Error('session_expired');
    if (!user && identity.email && store.users.some(item => item.email === identity.email)) throw new Error('email_exists');
    if (!user) {
        // Unverified/provider-absent email is not a recovery or password-login identity.
        user = { id: randomBytes(16).toString('hex'), email: identity.emailVerified ? identity.email : null, name: identity.name, identities: [] };
        store.users.push(user);
    }
    user.identities ||= [];
    if (user.identities.some(item => item.provider === identity.provider)) throw new Error('provider_already_linked');
    user.identities.push({ provider: identity.provider, subject: identity.subject, createdAt: new Date().toISOString() });
    return user;
}
function safeReturn(value) {
    try {
        const url = new URL(value || '/app.html', baseUrl());
        if (url.origin !== baseUrl() || !['/app.html', '/result.html'].includes(url.pathname)) return '/app.html';
        for (const key of [...url.searchParams.keys()]) if (!['id', 'speed', 'mode'].includes(key)) url.searchParams.delete(key);
        return url.pathname + url.search;
    } catch { return '/app.html'; }
}
function redirect(res, location, cookies = []) {
    res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
    res.end();
}
function flowCookie(provider, value, remove = false) {
    const secure = baseUrl().startsWith('https:');
    return `shiroko_oauth_${provider}=${value}; HttpOnly; Path=/api/auth/${provider}/callback; Max-Age=${remove ? 0 : 600}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
export async function socialAuth(req, res, url, context) {
    const { store, persist, userFor, sessionCookie, json } = context;
    const currentUser = userFor(req);
    if (url.pathname === '/api/auth/providers' && req.method === 'GET') {
        json(res, 200, { providers: Object.entries(PROVIDERS).map(([id, config]) => ({ id, name: config.name, enabled: providerEnabled(id), linked: !!currentUser?.identities?.some(item => item.provider === id) })) });
        return true;
    }
    const match = /^\/api\/auth\/(google|microsoft|twitter|kakao)\/(start|link|callback)$/.exec(url.pathname);
    if (!match) return false;
    const [, provider, action] = match;
    if ((action === 'start' && req.method !== 'GET') || (action === 'link' && req.method !== 'POST') || (action === 'callback' && req.method !== 'GET')) {
        json(res, 405, { error: 'Method not allowed.' });
        return true;
    }
    if (!providerEnabled(provider)) { json(res, 503, { error: 'This sign-in option is not available yet.' }); return true; }
    store.oauthTransactions ||= [];
    store.oauthTransactions = store.oauthTransactions.filter(item => item.expires > Date.now());
    if (action === 'start' || action === 'link') {
        if (action === 'link' && (!currentUser || req.headers.origin !== baseUrl())) {
            json(res, currentUser ? 403 : 401, { error: 'Sign in before connecting an account.' });
            return true;
        }
        if (store.oauthTransactions.length >= 2000) { json(res, 429, { error: 'Please try signing in again shortly.' }); return true; }
        const state = random();
        const binding = random();
        const transaction = { stateHash: hash(state), bindingHash: hash(binding), provider, verifier: random(), nonce: random(), expires: Date.now() + 600_000, returnTo: safeReturn(url.searchParams.get('returnTo')), userId: action === 'link' ? currentUser.id : null, referralCode: action === 'start' && /^[a-f0-9]{32}$/.test(url.searchParams.get('ref') || '') ? url.searchParams.get('ref') : null, sessionHash: action === 'link' ? hash(/(?:^|; )shiroko_session=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '') : null };
        store.oauthTransactions.push(transaction);
        await persist();
        const authorize = new URL(PROVIDERS[provider].authorize);
        for (const [key, value] of Object.entries({ client_id: credentials(provider).clientId, redirect_uri: callbackUrl(provider), response_type: 'code', state })) authorize.searchParams.set(key, value);
        if (PROVIDERS[provider].scope) authorize.searchParams.set('scope', PROVIDERS[provider].scope);
        if (PROVIDERS[provider].jwks) authorize.searchParams.set('nonce', transaction.nonce);
        if (PROVIDERS[provider].pkce) {
            authorize.searchParams.set('code_challenge', createHash('sha256').update(transaction.verifier).digest('base64url'));
            authorize.searchParams.set('code_challenge_method', 'S256');
        }
        if (action === 'link') json(res, 200, { url: authorize.href }, { 'Set-Cookie': flowCookie(provider, binding) });
        else redirect(res, authorize.href, [flowCookie(provider, binding)]);
        return true;
    }
    const params = url.searchParams;
    const expiredCookie = flowCookie(provider, '', true);
    try {
        const state = params.get('state');
        const binding = new RegExp(`(?:^|; )shiroko_oauth_${provider}=([^;]+)`).exec(req.headers.cookie || '')?.[1];
        if (!state || state.length > 100 || !binding || binding.length > 100) throw new Error('invalid_callback');
        const transaction = store.oauthTransactions.find(item => item.stateHash === hash(state) && item.bindingHash === hash(binding) && item.provider === provider);
        if (!transaction) throw new Error('invalid_callback');
        // Consume before exchanging the code so a concurrent callback cannot reuse it.
        store.oauthTransactions = store.oauthTransactions.filter(item => item !== transaction);
        await persist();
        if (params.has('error')) throw new Error('canceled');
        const code = params.get('code');
        if (!code || code.length > 8000) throw new Error('invalid_callback');
        if (transaction.userId && !store.sessions.some(session => session.userId === transaction.userId && session.tokenHash === transaction.sessionHash && session.expires > Date.now())) throw new Error('session_expired');
        const identity = await exchangeIdentity(provider, code, transaction);
        // Check the linking session again after the external request completes.
        if (transaction.userId && !store.sessions.some(session => session.userId === transaction.userId && session.tokenHash === transaction.sessionHash && session.expires > Date.now())) throw new Error('session_expired');
        const existingIds = new Set(store.users.map(user => user.id));
        const user = resolveIdentity(store, identity, transaction.userId);
        if (!existingIds.has(user.id)) context.onSignup?.(user, transaction.referralCode);
        const token = randomBytes(32).toString('hex');
        store.sessions = store.sessions.filter(item => item.expires > Date.now());
        store.sessions.push({ tokenHash: hash(token), userId: user.id, expires: Date.now() + 30 * 86400_000 });
        await persist();
        const destination = new URL(transaction.returnTo, baseUrl());
        destination.searchParams.set('auth', transaction.userId ? 'linked' : 'success');
        redirect(res, destination.pathname + destination.search, [expiredCookie, sessionCookie(token, req)]);
    } catch (error) {
        const known = ['email_exists', 'identity_in_use', 'session_expired', 'provider_already_linked', 'canceled'];
        const reason = known.includes(error.message) ? error.message : 'failed';
        // Never log authorization codes, provider tokens, or their claims.
        redirect(res, `/app.html?auth_error=${reason}`, [expiredCookie]);
    }
    return true;
}
