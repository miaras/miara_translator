import { isIP } from 'node:net';
const cache = new Map();
export function connectingAddress(req) {
    const remote = req.socket.remoteAddress || '';
    // Caddy replaces X-Forwarded-For for direct connections. Its final entry is
    // the peer it actually saw; earlier entries can be supplied by a visitor.
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
    const candidate = loopback ? String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim() || remote : remote;
    return candidate.replace(/^::ffff:/, '');
}
function publicAddress(address) {
    if (!isIP(address)) return false;
    return !/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|::$|f[cd]|fe[89ab])/i.test(address);
}
export async function countryForRequest(req, lookup = fetch) {
    const address = connectingAddress(req);
    if (!publicAddress(address)) return null;
    const hit = cache.get(address);
    if (hit && hit.expires > Date.now()) return hit.country;
    let country = null;
    try {
        // A best-effort lookup is made only when the browser has no supported
        // language. Never send document content, account data, or credentials.
        const response = await lookup(`https://ipwho.is/${encodeURIComponent(address)}?fields=success,country_code`, { signal: AbortSignal.timeout(1500) });
        if (response.ok) { const data = await response.json(); if (data.success && /^[A-Z]{2}$/.test(data.country_code)) country = data.country_code; }
    } catch {}
    if (cache.size >= 1000) cache.delete(cache.keys().next().value);
    cache.set(address, { country, expires: Date.now() + (country ? 3600000 : 60000) });
    return country;
}
