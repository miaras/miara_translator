// Large book text and aligned results can exceed sessionStorage's small quota.
// Keep the synchronous editor interface while persisting oversized drafts in IDB.
const cache = new Map();
const fallbackKeys = new Set();
const pending = new Map();
let database;
let flushing;
let timer;
function open() {
    database ||= new Promise((resolve, reject) => {
        const request = indexedDB.open('shiroko-large-drafts', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('drafts');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return database;
}
export function readDraftValue(key) { return cache.has(key) ? cache.get(key) : sessionStorage.getItem(key); }
function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { flushDraftStorage().catch(() => window.dispatchEvent(new Event('shiroko:draft-storage-error'))); }, 150);
}
export function saveDraftValue(key, value) {
    value = String(value);
    cache.set(key, value);
    try {
        sessionStorage.setItem(key, value);
        if (fallbackKeys.has(key)) { pending.set(key, null); fallbackKeys.delete(key); schedule(); }
    } catch {
        sessionStorage.removeItem(key);
        fallbackKeys.add(key); pending.set(key, value); schedule();
    }
}
export function removeDraftValue(key) {
    cache.delete(key); sessionStorage.removeItem(key);
    if (fallbackKeys.has(key)) { pending.set(key, null); fallbackKeys.delete(key); schedule(); }
}
export async function loadDraftStorage() {
    try {
        const db = await open();
        await new Promise((resolve, reject) => {
            const request = db.transaction('drafts').objectStore('drafts').openCursor();
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) return resolve();
                fallbackKeys.add(cursor.key);
                if (sessionStorage.getItem(cursor.key) === null && !cache.has(cursor.key)) cache.set(cursor.key, cursor.value);
                cursor.continue();
            };
            request.onerror = () => reject(request.error);
        });
    } catch { /* Ordinary session drafts remain usable when IDB is unavailable. */ }
}
export function flushDraftStorage() {
    clearTimeout(timer);
    if (flushing) return flushing;
    flushing = (async () => {
        while (pending.size) {
            const db = await open();
            const batch = new Map(pending); pending.clear();
            try {
                await new Promise((resolve, reject) => {
                    const transaction = db.transaction('drafts', 'readwrite');
                    const drafts = transaction.objectStore('drafts');
                    for (const [key, value] of batch) value === null ? drafts.delete(key) : drafts.put(value, key);
                    transaction.oncomplete = resolve;
                    transaction.onerror = () => reject(transaction.error);
                    transaction.onabort = () => reject(transaction.error || new Error('Draft storage interrupted.'));
                });
            } catch (error) {
                for (const [key, value] of batch) if (!pending.has(key)) pending.set(key, value);
                throw error;
            }
        }
    })().finally(() => { flushing = null; });
    return flushing;
}
