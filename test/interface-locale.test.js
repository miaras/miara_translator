import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocale, supportedLocale, interpolate } from '../interface-locale.js';
import { connectingAddress, countryForRequest } from '../interface-geolocation.js';
import { catalogs } from '../interface-catalogs.js';
test('manual preference wins, then supported browser languages, then geography, then English', () => {
    assert.equal(resolveLocale({ saved: 'ja', languages: ['es-MX'], country: 'DE' }), 'ja');
    assert.equal(resolveLocale({ languages: ['pt-BR', 'ko-KR', 'en-US'], country: 'FR' }), 'ko');
    assert.equal(resolveLocale({ languages: ['pt-BR'], country: 'FR' }), 'fr');
    assert.equal(resolveLocale({ languages: ['en-US'], country: 'JP' }), 'en');
    assert.equal(resolveLocale({ languages: ['xx'], country: 'ZZ' }), 'en');
    assert.equal(supportedLocale('ZH_hant'), 'zh');
    assert.equal(resolveLocale({ saved: 'garbage', languages: ['ar-EG'] }), 'ar');
});
test('interpolation preserves absent placeholders and treats values as literal strings', () => {
    assert.equal(interpolate('{count} {missing}', {count:'$0.50<script>'}), '$0.50<script> {missing}');
    for (const entries of Object.values(catalogs)) for (const [key, value] of Object.entries(entries)) {
        assert.deepEqual(value.match(/\{\w+\}/g)?.sort(), key.match(/\{\w+\}/g)?.sort(), key);
    }
});
test('proxy address ignores user-supplied country and earlier forwarded IP addresses', async () => {
    const req = { socket: { remoteAddress: '127.0.0.1' }, headers: {'x-forwarded-for':'1.1.1.1, 8.8.4.4', 'cf-ipcountry': 'JP'} };
    assert.equal(connectingAddress(req), '8.8.4.4');
    assert.equal(connectingAddress({...req,socket:{remoteAddress:'9.9.9.9'}}), '9.9.9.9');
    let url;
    assert.equal(await countryForRequest(req, async target => { url = target; return {ok:true,json:async()=>({success:true,country_code:'DE'})}; }), 'DE');
    assert.ok(url.includes('8.8.4.4'));
    assert.equal(await countryForRequest({socket:{remoteAddress:'127.0.0.1'},headers:{}},()=>{throw Error('no local requests');}), null);
});
