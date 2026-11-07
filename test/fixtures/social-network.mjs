import { generateKeyPairSync, sign, createHash } from 'node:crypto';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const nativeFetch = globalThis.fetch;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const issuers = { google: 'https://accounts.google.com', microsoft: 'https://login.microsoftonline.com/12345678-1234-4123-8123-123456789abc/v2.0' };
globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') return nativeFetch(url, options);
    if (parsed.pathname.includes('certs') || parsed.pathname.includes('keys')) return Response.json({ keys: [jwk] });
    if (parsed.pathname.endsWith('/token')) {
        const form = new URLSearchParams(options.body);
        if (form.get('code') === 'bad-code') return Response.json({}, { status: 400 });
        const data = JSON.parse(Buffer.from(form.get('code'), 'base64url'));
        if (data.challenge && createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') !== data.challenge) return Response.json({}, { status: 400 });
        if (!form.get('redirect_uri')?.endsWith(`/api/auth/${data.provider}/callback`)) throw new Error('Incorrect redirect URI');
        if (data.provider === 'twitter' && !options.headers.Authorization?.startsWith('Basic ')) throw new Error('Missing Basic client authentication');
        if (data.provider === 'kakao' || data.provider === 'twitter') return Response.json({ access_token: encode(data) });
        if (!form.get('client_secret')) throw new Error('Missing client secret');
        const now = Math.floor(Date.now() / 1000);
        const header = encode({ alg: 'RS256', kid: 'test-key' });
        const payload = encode({ iss: issuers[data.provider], sub: data.subject || 'provider-user', aud: form.get('client_id'), exp: now + 600, iat: now, nonce: data.nonce, tid: '12345678-1234-4123-8123-123456789abc', email: data.email || 'social@example.com', email_verified: true, name: 'Social Test' });
        const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), pair.privateKey).toString('base64url');
        return Response.json({ id_token: `${header}.${payload}.${signature}` });
    }
    if (parsed.pathname.endsWith('/users/me')) {
        const data = JSON.parse(Buffer.from(options.headers.Authorization.slice(7), 'base64url'));
        return Response.json({ data: { id: data.subject || 'x-user', name: 'X Test', username: 'xtest' } });
    }
    if (parsed.pathname === '/v2/user/me') return Response.json({ id: 123456, kakao_account: { profile: { nickname: 'Kakao Test' }, email: 'kakao@example.com', is_email_valid: true, is_email_verified: true } });
    throw new Error('Unexpected external request');
};
