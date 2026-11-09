import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');
const savingCode = script.slice(script.indexOf('let saveTimer;'), script.indexOf("saveBtn?.addEventListener('click', saveTranslation);"));
function setup(request) {
    const timers = new Map();
    let timer = 0;
    const context = vm.createContext({
        currentUser: { id: 'user' }, currentSavedId: null, currentProgress: null, currentJob: null, currentCustomTerms: {}, currentSourceLang: '',
        currentData: [{ source: 'Hello.', target: 'Bonjour.' }],
        currentSourceText: 'Hello.', currentTargetLang: 'French', currentInstructions: '', currentDictionary: {}, currentSummary: '',
        saveStatus: {}, saveBtn: {}, request, saveDraftValue() {}, sessionStorage: { setItem() {} }, history: { replaceState() {} }, window: {},
        setTimeout(callback) { timers.set(++timer, callback); return timer; }, clearTimeout(id) { timers.delete(id); }
    });
    vm.runInContext(savingCode, context);
    return { context, timers, run: code => vm.runInContext(code, context) };
}
const result = { translation: { id: 'saved-id', updatedAt: new Date().toISOString() } };

test('autosave debounces edits and serializes creation with edits arriving during the request', async () => {
    const requests = [];
    let finish;
    const app = setup((route, options) => {
        requests.push({ route, ...options });
        return requests.length === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(result);
    });
    app.run('markUnsaved(); markUnsaved();');
    assert.equal(app.timers.size, 1);
    const saving = app.run('saveTranslation()');
    app.run("currentData[0].target = 'Salut.'; markUnsaved();");
    assert.equal(app.run('saveTranslation()'), saving);
    assert.equal(requests.length, 1);
    finish(result);
    await saving;
    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[1].method, 'PUT');
    assert.equal(requests[1].route, '/api/translations/saved-id');
    assert.equal(JSON.parse(requests[0].body).rows[0].target, 'Bonjour.');
    assert.equal(JSON.parse(requests[1].body).rows[0].target, 'Salut.');
    assert.equal(app.run('savedVersion === changeVersion'), true);
    assert.match(app.context.saveStatus.textContent, /Saved automatically/);
});

test('autosave retries failed saves and preserves the changed state until successful', async () => {
    let attempts = 0;
    const app = setup(async () => {
        if (++attempts === 1) throw new Error('Network unavailable');
        return result;
    });
    app.run('markUnsaved()');
    await app.run('saveTranslation()');
    assert.equal(app.run('savedVersion === changeVersion'), false);
    assert.match(app.context.saveStatus.textContent, /Retrying/);
    assert.equal(app.timers.size, 1);
    await [...app.timers.values()][0]();
    assert.equal(attempts, 2);
    assert.equal(app.run('savedVersion === changeVersion'), true);
    assert.equal(app.context.saveBtn.disabled, false);
});
