import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('all four providers sign in; callbacks bind browsers, expire, and cannot replay; linking preserves accounts', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'shiroko-social-'));
    const port = 32000 + Math.floor(Math.random() * 20000);
    const base = `http://127.0.0.1:${port}`;
    const dataFile = path.join(directory, 'store.json');
    const env = { ...process.env, PORT: String(port), SHIROKO_DATA_FILE: dataFile, APP_URL: 'https://translate.shiroko.tools' };
    for (const provider of ['GOOGLE', 'MICROSOFT', 'TWITTER', 'KAKAO']) { env[`${provider}_CLIENT_ID`] = `${provider}-client`; env[`${provider}_CLIENT_SECRET`] = 'test-secret'; }
    const server = spawn(process.execPath, ['--import', './test/fixtures/social-network.mjs', 'server.js'], { env, stdio: 'ignore' });
    const readStore = async () => JSON.parse(await readFile(dataFile, 'utf8'));
    try {
        for (let i = 0; i < 100; i++) { try { await fetch(`${base}/api/me`); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
        const providers = await (await fetch(`${base}/api/auth/providers`)).json();
        assert.equal(providers.providers.length, 4);
        assert.ok(providers.providers.every(provider => provider.enabled));
        async function start(provider, cookie, link = false, returnTo = '/app.html', referralCode = '') {
            const response = await fetch(`${base}/api/auth/${provider}/${link ? 'link' : 'start'}?returnTo=${encodeURIComponent(returnTo)}&ref=${encodeURIComponent(referralCode)}`, { method: link ? 'POST' : 'GET', redirect: 'manual', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(link ? { Origin: 'https://translate.shiroko.tools', 'Content-Type': 'application/json' } : {}) }, ...(link ? { body: '{}' } : {}) });
            const location = link && response.ok ? (await response.json()).url : response.headers.get('location');
            return { status: response.status, url: location && new URL(location), cookie: response.headers.getSetCookie()[0]?.split(';')[0], cookies: response.headers.getSetCookie() };
        }
        async function callback(provider, flow, options = {}) {
            const code = options.code || Buffer.from(JSON.stringify({ provider, nonce: options.nonce || flow.url.searchParams.get('nonce'), challenge: flow.url.searchParams.get('code_challenge'), email: options.email || `${provider}@example.com`, subject: options.subject })).toString('base64url');
            const params = new URLSearchParams({ code, state: options.state || flow.url.searchParams.get('state') });
            const response = await fetch(`${base}/api/auth/${provider}/callback?${params}`, { redirect: 'manual', headers: { Cookie: options.cookie ?? flow.cookie } });
            return { status: response.status, location: response.headers.get('location'), cookie: response.headers.getSetCookie().find(value => value.startsWith('shiroko_session='))?.split(';')[0] };
        }
        for (const provider of ['google', 'microsoft', 'twitter', 'kakao']) {
            const flow = await start(provider, null, false, '//attacker.example/');
            assert.equal(flow.status, 303);
            assert.equal(flow.url.searchParams.get('redirect_uri'), `https://translate.shiroko.tools/api/auth/${provider}/callback`);
            const success = await callback(provider, flow);
            assert.equal(success.location, '/app.html?auth=success');
            assert.ok(success.cookie);
            const me = await (await fetch(`${base}/api/me`, { headers: { Cookie: success.cookie } })).json();
            assert.ok(me.user.id);
            if (provider === 'twitter') assert.equal(me.user.email, null);
            assert.equal((await callback(provider, flow)).location, '/app.html?auth_error=failed');
        }
        const wrongBrowser = await start('google');
        assert.equal((await callback('google', wrongBrowser, { cookie: '' })).location, '/app.html?auth_error=failed');
        assert.equal((await callback('google', wrongBrowser, { state: 'bad-state' })).location, '/app.html?auth_error=failed');
        assert.equal((await callback('google', wrongBrowser, { nonce: 'bad-nonce' })).location, '/app.html?auth_error=failed');
        const declined = await start('google');
        const decline = await fetch(`${base}/api/auth/google/callback?state=${declined.url.searchParams.get('state')}&error=access_denied`, { headers: { Cookie: declined.cookie }, redirect: 'manual' });
        assert.equal(decline.headers.get('location'), '/app.html?auth_error=canceled');
        const registration = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'existing@example.com', password: 'existing-password-long' }) });
        const passwordUser = (await registration.json()).user;
        const passwordCookie = registration.headers.getSetCookie()[0].split(';')[0];
        const referral = await (await fetch(`${base}/api/referrals`, { headers: { Cookie: passwordCookie } })).json();
        const referralCode = new URL(referral.url).searchParams.get('ref');
        const referredFlow = await start('google', null, false, '/app.html', referralCode);
        const referredResult = await callback('google', referredFlow, { email: 'referred-social@example.com', subject: 'referred-social' });
        const referredMe = await (await fetch(`${base}/api/me`, { headers: { Cookie: referredResult.cookie } })).json();
        assert.equal(referredMe.user.balanceMicros, 500_000);
        assert.equal(referredMe.user.promotionPromptPending, false);
        assert.equal((await (await fetch(`${base}/api/me`, { headers: { Cookie: passwordCookie } })).json()).user.balanceMicros, 500_000);
        const repeatedReferral = await start('google', null, false, '/app.html', referralCode);
        await callback('google', repeatedReferral, { email: 'referred-social@example.com', subject: 'referred-social' });
        assert.equal((await (await fetch(`${base}/api/referrals`, { headers: { Cookie: passwordCookie } })).json()).successfulInvites, 1);
        const conflict = await start('google');
        assert.equal((await callback('google', conflict, { email: 'existing@example.com', subject: 'link-user' })).location, '/app.html?auth_error=email_exists');
        const link = await start('google', passwordCookie, true);
        assert.equal(link.status, 200);
        const linked = await callback('google', link, { email: 'existing@example.com', subject: 'link-user' });
        assert.equal(linked.location, '/app.html?auth=linked');
        const linkedUser = await (await fetch(`${base}/api/me`, { headers: { Cookie: linked.cookie } })).json();
        assert.equal(linkedUser.user.id, passwordUser.id);
        const again = await start('google');
        const againResult = await callback('google', again, { email: 'existing@example.com', subject: 'link-user' });
        assert.equal((await (await fetch(`${base}/api/me`, { headers: { Cookie: againResult.cookie } })).json()).user.id, passwordUser.id);
        assert.equal((await start('google', null, true)).status, 401);
        const forbidden = await fetch(`${base}/api/auth/google/link`, { method: 'POST', headers: { Cookie: passwordCookie, Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(forbidden.status, 403);
        const revoked = await start('microsoft', passwordCookie, true);
        await fetch(`${base}/api/logout`, { method: 'POST', headers: { Cookie: passwordCookie, 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal((await callback('microsoft', revoked)).location, '/app.html?auth_error=session_expired');
        const disk = await readStore();
        assert.ok(!disk.users.some(user => user.access_token || user.refresh_token));
        assert.equal(disk.users.find(user => user.id === passwordUser.id).identities.length, 1);
    } finally {
        server.kill();
        await new Promise(resolve => server.once('exit', resolve));
        await rm(directory, { recursive: true, force: true });
    }
});
