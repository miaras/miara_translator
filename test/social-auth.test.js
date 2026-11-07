import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { verifyIdToken, resolveIdentity, socialAuth } from '../social-auth.js';

test('OIDC verifies signature, audience, issuer, expiry, nonce, and Microsoft tenant', async () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'unit-key', alg: 'RS256' };
    const fetchMock = async () => Response.json({ keys: [key] });
    const oldGoogle = process.env.GOOGLE_CLIENT_ID;
    const oldMicrosoft = process.env.MICROSOFT_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID = 'unit-client';
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: 'https://accounts.google.com', sub: 'user', aud: 'unit-client', exp: now + 600, iat: now, nonce: 'unit-nonce' };
    const jwt = (changes = {}, algorithm = 'RS256') => {
        const head = encode({ alg: algorithm, kid: 'unit-key' });
        const body = encode({ ...claims, ...changes });
        return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), pair.privateKey).toString('base64url')}`;
    };
    try {
        assert.equal((await verifyIdToken(jwt(), 'google', 'unit-nonce', fetchMock)).sub, 'user');
        for (const change of [{ aud: 'wrong' }, { iss: 'https://attacker.example' }, { exp: now - 1 }, { nonce: 'wrong' }, { aud: ['unit-client', 'other'] }, { nbf: now + 500 }, { sub: '' }]) await assert.rejects(verifyIdToken(jwt(change), 'google', 'unit-nonce', fetchMock));
        await assert.rejects(verifyIdToken(jwt({}, 'HS256'), 'google', 'unit-nonce', fetchMock));
        const valid = jwt();
        const parts = valid.split('.');
        parts[1] = encode({ ...claims, sub: 'attacker' });
        await assert.rejects(verifyIdToken(parts.join('.'), 'google', 'unit-nonce', fetchMock));
        const tenant = '12345678-1234-4123-8123-123456789abc';
        assert.equal((await verifyIdToken(jwt({ iss: `https://login.microsoftonline.com/${tenant}/v2.0`, tid: tenant }), 'microsoft', 'unit-nonce', fetchMock)).tid, tenant);
        await assert.rejects(verifyIdToken(jwt({ iss: `https://login.microsoftonline.com/${tenant}/v2.0`, tid: 'different' }), 'microsoft', 'unit-nonce', fetchMock));
    } finally {
        if (oldGoogle === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = oldGoogle;
        if (oldMicrosoft === undefined) delete process.env.MICROSOFT_CLIENT_ID; else process.env.MICROSOFT_CLIENT_ID = oldMicrosoft;
    }
});

test('social accounts require explicit linking and preserve existing credit ownership', () => {
    const existing = { id: 'existing', email: 'existing@example.com', hash: 'password-hash' };
    const store = { users: [existing], billingLedger: [{ userId: 'existing', amountMicros: 5_000_000 }] };
    const identity = { provider: 'google', subject: 'subject', email: existing.email, emailVerified: true, name: 'Test' };
    assert.throws(() => resolveIdentity(store, identity), /email_exists/);
    assert.equal(resolveIdentity(store, identity, 'existing'), existing);
    assert.equal(resolveIdentity(store, identity), existing);
    assert.deepEqual(store.billingLedger, [{ userId: 'existing', amountMicros: 5_000_000 }]);
    const other = resolveIdentity(store, { ...identity, provider: 'twitter', subject: 'x-user', email: null, emailVerified: false });
    assert.equal(other.email, null);
    assert.throws(() => resolveIdentity(store, identity, other.id), /identity_in_use/);
    const unverified = resolveIdentity(store, { ...identity, provider: 'microsoft', subject: 'ms-user', email: 'unverified@example.com', emailVerified: false });
    assert.equal(unverified.email, null);
});

test('expired OAuth browser transactions are rejected before exchanging a code', async () => {
    const previous = { GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET };
    process.env.GOOGLE_CLIENT_ID = 'expiry-client';
    process.env.GOOGLE_CLIENT_SECRET = 'expiry-secret';
    const hash = value => createHash('sha256').update(value).digest('hex');
    const store = { users: [], sessions: [], oauthTransactions: [{ stateHash: hash('expired-state'), bindingHash: hash('binding'), provider: 'google', expires: Date.now() - 1 }] };
    let status, headers;
    const response = { writeHead(code, values) { status = code; headers = values; }, end() {} };
    try {
        await socialAuth({ method: 'GET', headers: { cookie: 'shiroko_oauth_google=binding' } }, response, new URL('https://translate.shiroko.tools/api/auth/google/callback?state=expired-state&code=unused'), { store, persist: async () => {}, userFor: () => null });
        assert.equal(status, 303);
        assert.equal(headers.Location, '/app.html?auth_error=failed');
        assert.equal(store.oauthTransactions.length, 0);
    } finally {
        for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
});
