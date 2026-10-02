import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.SHIROKO_DATA_FILE || path.join(root, 'data', 'store.json');
const port = Number(process.env.PORT || 3000);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
let store = { users: [], sessions: [], translations: [] };
let writing = Promise.resolve();
try { store = JSON.parse(await readFile(dataFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

function persist() {
    writing = writing.then(async () => {
        await mkdir(path.dirname(dataFile), { recursive: true });
        const temp = `${dataFile}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(store), { mode: 0o600 });
        await rename(temp, dataFile);
    });
    return writing;
}
function json(res, status, value, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(value));
}
function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
function cookie(req) { return /(?:^|; )shiroko_session=([^;]+)/.exec(req.headers.cookie || '')?.[1]; }
function userFor(req) {
    const token = cookie(req);
    const session = token && store.sessions.find(s => s.tokenHash === tokenHash(token) && s.expires > Date.now());
    return session && store.users.find(u => u.id === session.userId);
}
function sessionCookie(token, req) {
    return `shiroko_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;
}
async function body(req) {
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 2_000_000) throw new Error('Request is too large.');
    }
    try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON.'); }
}
function documentInput(value) {
    if (!value || typeof value !== 'object' || typeof value.title !== 'string' || typeof value.sourceText !== 'string' || typeof value.targetLang !== 'string' || typeof value.instructions !== 'string' || !Array.isArray(value.rows)) return null;
    if (!value.title.trim() || value.title.length > 160 || value.sourceText.length > 500_000 || value.instructions.length > 10_000 || value.rows.length > 10_000) return null;
    if (!value.rows.every(row => row && typeof row.source === 'string' && typeof row.target === 'string' && row.source.length <= 20_000 && row.target.length <= 20_000 && (row.newParagraph === undefined || typeof row.newParagraph === 'boolean'))) return null;
    return { title: value.title.trim(), sourceText: value.sourceText, targetLang: value.targetLang, instructions: value.instructions, rows: value.rows.map(({ source, target, newParagraph }) => ({ source, target, newParagraph: !!newParagraph })) };
}
async function api(req, res, url) {
    if (!['GET', 'POST', 'PUT'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
    if (req.method !== 'GET') {
        const origin = req.headers.origin;
        const host = req.headers.host;
        if (origin && new URL(origin).host !== host) return json(res, 403, { error: 'Request origin rejected.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Expected JSON.' });
    }
    if (url.pathname === '/api/me' && req.method === 'GET') {
        const user = userFor(req);
        return json(res, 200, { user: user ? { id: user.id, email: user.email } : null });
    }
    if (url.pathname === '/api/register' && req.method === 'POST') {
        const { email, password } = await body(req);
        const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254 || typeof password !== 'string' || password.length < 12 || password.length > 256) return json(res, 400, { error: 'Enter a valid email and a password of at least 12 characters.' });
        if (store.users.some(u => u.email === normalized)) return json(res, 409, { error: 'An account with this email already exists.' });
        const salt = randomBytes(16).toString('hex');
        const hash = (await scrypt(password, salt, 64)).toString('hex');
        if (store.users.some(u => u.email === normalized)) return json(res, 409, { error: 'An account with this email already exists.' });
        const user = { id: randomBytes(16).toString('hex'), email: normalized, salt, hash };
        store.users.push(user);
        const token = randomBytes(32).toString('hex');
        store.sessions = store.sessions.filter(s => s.expires > Date.now());
        store.sessions.push({ tokenHash: tokenHash(token), userId: user.id, expires: Date.now() + 30 * 86400_000 });
        await persist();
        return json(res, 201, { user: { id: user.id, email: user.email } }, { 'Set-Cookie': sessionCookie(token, req) });
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
        const { email, password } = await body(req);
        const user = store.users.find(u => u.email === String(email || '').trim().toLowerCase());
        const actual = await scrypt(typeof password === 'string' ? password : '', user?.salt || '00000000000000000000000000000000', 64);
        if (!user || !timingSafeEqual(actual, Buffer.from(user.hash, 'hex'))) return json(res, 401, { error: 'Email or password is incorrect.' });
        const token = randomBytes(32).toString('hex');
        store.sessions = store.sessions.filter(s => s.expires > Date.now());
        store.sessions.push({ tokenHash: tokenHash(token), userId: user.id, expires: Date.now() + 30 * 86400_000 });
        await persist();
        return json(res, 200, { user: { id: user.id, email: user.email } }, { 'Set-Cookie': sessionCookie(token, req) });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
        store.sessions = store.sessions.filter(s => s.tokenHash !== tokenHash(cookie(req) || ''));
        await persist();
        return json(res, 200, { ok: true }, { 'Set-Cookie': 'shiroko_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    const user = userFor(req);
    if (!user) return json(res, 401, { error: 'Sign in to access saved translations.' });
    if (url.pathname === '/api/translations' && req.method === 'GET') {
        return json(res, 200, { translations: store.translations.filter(t => t.userId === user.id).map(({ id, title, targetLang, updatedAt, rows }) => ({ id, title, targetLang, updatedAt, rowCount: rows.length })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    }
    if (url.pathname === '/api/translations' && req.method === 'POST') {
        const input = documentInput(await body(req));
        if (!input) return json(res, 400, { error: 'Translation data is invalid.' });
        const translation = { ...input, id: randomBytes(16).toString('hex'), userId: user.id, updatedAt: new Date().toISOString() };
        store.translations.push(translation);
        await persist();
        return json(res, 201, { translation });
    }
    const match = /^\/api\/translations\/([a-f0-9]{32})$/.exec(url.pathname);
    if (match) {
        const translation = store.translations.find(t => t.id === match[1] && t.userId === user.id);
        if (!translation) return json(res, 404, { error: 'Translation not found.' });
        if (req.method === 'GET') return json(res, 200, { translation });
        if (req.method === 'PUT') {
            const input = documentInput(await body(req));
            if (!input) return json(res, 400, { error: 'Translation data is invalid.' });
            Object.assign(translation, input, { updatedAt: new Date().toISOString() });
            await persist();
            return json(res, 200, { translation });
        }
    }
    return json(res, 404, { error: 'Not found.' });
}
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (url.pathname.startsWith('/api/')) return await api(req, res, url);
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
        const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        const file = path.resolve(root, 'dist', `.${pathname}`);
        if (!file.startsWith(path.join(root, 'dist') + path.sep)) return json(res, 404, { error: 'Not found.' });
        const info = await stat(file);
        if (!info.isFile()) return json(res, 404, { error: 'Not found.' });
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        if (req.method === 'HEAD') return res.end();
        createReadStream(file).pipe(res);
    } catch (error) {
        if (error.code === 'ENOENT') return json(res, 404, { error: 'Not found. Run npm run build first.' });
        const status = ['Request is too large.', 'Invalid JSON.'].includes(error.message) ? 400 : 500;
        if (status === 500) console.error(error);
        json(res, status, { error: status === 500 ? 'Server error. Please try again.' : error.message });
    }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Shiroko listening on http://localhost:${port}`));
