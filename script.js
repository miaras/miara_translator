import './referral-notification.js';
import { initResultWorkbench } from './result-workbench.js';
import { readDraftValue, saveDraftValue, removeDraftValue, loadDraftStorage, flushDraftStorage } from './draft-storage.js';
import { SUBSCRIPTION_PLANS, SPEED_MULTIPLIERS, allowanceCost } from './subscription-plans.js';
import { countSourceTokens, sourceChunks } from './source-tokens.js';
import { SPEEDS, validSpeed, priceMicros } from './pricing.js';
const incomingReferral = new URLSearchParams(location.search).get('ref');
if (/^[a-f0-9]{32}$/.test(incomingReferral || '')) localStorage.setItem('SHIROKO_REFERRAL', incomingReferral);
const referralCode = () => localStorage.getItem('SHIROKO_REFERRAL') || '';
const storedSpeed = readDraftValue('SHIROKO_SPEED');
const linkedSpeed = new URLSearchParams(location.search).get('speed');
let currentSpeed = validSpeed(linkedSpeed) ? linkedSpeed : validSpeed(storedSpeed) ? storedSpeed : 'standard';
if (validSpeed(linkedSpeed)) saveDraftValue('SHIROKO_SPEED', currentSpeed);
// Global State
let currentData = [];
let currentTargetLang = 'Korean';
let currentSourceText = '';
let currentSourceLang = '';
let currentInstructions = '';
let currentDictionary = {};
let currentSummary = '';
let currentSavedId = null;
let currentUser = null;
let authMode = 'login';
let saveAfterLogin = false;
let improveMode = false;
const existingTranslation = document.getElementById('existing-translation');
function setImproveMode(enabled) {
    improveMode = enabled;
    document.getElementById('preferences-step').textContent = enabled ? '03 / PREFERENCES' : '02 / PREFERENCES';
    document.getElementById('source-heading').textContent = enabled ? 'Original Text' : 'Your text';
    document.querySelector('.workspace-intro .overline').textContent = enabled ? 'Improve a translation' : 'A new translation';
    document.querySelector('.workspace-intro h1').innerHTML = enabled ? 'Refine <em>your translation.</em>' : 'Begin with <em>your words.</em>';
    document.querySelector('.workspace-intro > p').textContent = enabled ? 'Add the original text and its existing translation, then describe how you want it improved.' : 'Paste your text or upload a PDF or Word document. Shiroko will keep each sentence aligned with its translation.';
    document.getElementById('existing-panel').hidden = !enabled;
    const button = document.getElementById('existing-mode-btn');
    button.setAttribute('aria-expanded', String(enabled));
    button.textContent = enabled ? 'Translate New Text' : 'Use Existing Translation';
    translateBtn.textContent = enabled ? 'Improve & align' : 'Translate & align';
}
document.getElementById('existing-mode-btn')?.addEventListener('click', () => setImproveMode(!improveMode));

// UI Elements
const landingPage = document.getElementById('landing-page');
const resultsPage = document.getElementById('results-page');
const translateBtn = document.getElementById('translate-btn');
const backBtn = document.getElementById('back-btn');
const sourceText = document.getElementById('source-text');
const targetLangSelect = document.getElementById('target-lang');
const alignmentGrid = document.getElementById('alignment-grid');
const loader = document.getElementById('loader');
const customInstructions = document.getElementById('custom-instructions');

// Action Buttons
const copyBtn = document.getElementById('copy-btn');
const exportBtn = document.getElementById('export-btn');
const uploadBtn = document.getElementById('upload-btn');
const fileInput = document.getElementById('file-upload');
const speedOptions = document.querySelectorAll('input[name="translation-speed"]');
function refreshSpeedSettings() {
    speedOptions.forEach(option => { option.checked = option.value === currentSpeed; });
    const selected = document.getElementById('selected-speed');
    if (selected) selected.textContent = SPEEDS[currentSpeed].label;
    const price = document.getElementById('speed-price');
    const rates = SPEEDS[currentSpeed];
    if (price) price.textContent = `${SPEED_MULTIPLIERS[currentSpeed]}× monthly allowance usage. Alignment and context included.`;
}
speedOptions.forEach(option => option.addEventListener('change', () => {
    currentSpeed = option.value;
    saveDraftValue('SHIROKO_SPEED', currentSpeed);
    refreshSpeedSettings();
    updatePriceEstimate();
}));
refreshSpeedSettings();
const priceDisplay = document.getElementById('price-estimate');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');
const authDialog = document.getElementById('auth-dialog');

async function request(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', ...options });
    const data = await response.json();
    if (!response.ok) {
        if (response.status === 402) showUpgradeModal();
        if (response.status === 401 && path === '/api/translate') openAuth();
        throw new Error(data.error || 'Request failed.');
    }
    if (data.subscription && currentUser) currentUser.subscription = data.subscription;
    if (typeof data.balanceMicros === 'number' && currentUser) { currentUser.balanceMicros = data.balanceMicros; refreshAccount(); }
    return data;
}
function showWelcomePromotion() {
    if (!currentUser?.promotionPromptPending || document.getElementById('welcome-promotion-dialog')) return;
    const userId = currentUser.id;
    currentUser.promotionPromptPending = false;
    const dialog = document.createElement('dialog');
    dialog.id = 'welcome-promotion-dialog';
    dialog.className = 'auth-dialog';
    dialog.setAttribute('aria-labelledby', 'welcome-promotion-heading');
    dialog.innerHTML = `<form method="dialog"><button class="auth-close" aria-label="Close">Close</button></form><h2 id="welcome-promotion-heading">A little credit for your first words.</h2><p>Have a promotion code? Enter it to add 10,000 prepaid tokens to your account.</p><form id="welcome-promotion-form"><label for="welcome-promotion-code">Promotion code</label><input id="welcome-promotion-code" type="text" autocomplete="off" maxlength="100" required><button class="button button-dark" type="submit">Redeem credit</button></form><p id="welcome-promotion-message" role="status" aria-live="polite"></p><button id="welcome-promotion-skip" class="header-link" type="button">Maybe later</button>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => {
        if (currentUser?.id === userId) {
            void request('/api/billing/promotion-prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
        }
        dialog.remove();
    }, { once: true });
    document.getElementById('welcome-promotion-skip').addEventListener('click', () => dialog.close());
    document.getElementById('welcome-promotion-form').addEventListener('submit', async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button');
        const message = document.getElementById('welcome-promotion-message');
        button.disabled = true;
        try {
            const data = await request('/api/billing/promotion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ promotionCode: document.getElementById('welcome-promotion-code').value }) });
            message.textContent = data.message;
            button.textContent = 'Credit added';
            document.getElementById('welcome-promotion-skip').textContent = 'Start translating';
            document.getElementById('welcome-promotion-code').disabled = true;
        } catch (error) { message.textContent = error.message; button.disabled = false; }
    });
    dialog.showModal();
    document.getElementById('welcome-promotion-code').focus();
}
window.addEventListener('shiroko:account-updated', event => {
    if (!currentUser) return;
    const data = event.detail || {};
    if (typeof data.balanceMicros === 'number') currentUser.balanceMicros = data.balanceMicros;
    if (data.subscription) currentUser.subscription = data.subscription;
    refreshAccount();
});
function refreshAccount() {
    window.dispatchEvent(new CustomEvent('shiroko:account', { detail: { user: currentUser } }));
    const email = document.getElementById('account-email');
    const open = document.getElementById('auth-open');
    const signOut = document.getElementById('sign-out');
    if (email) { email.textContent = currentUser?.email || currentUser?.name || ''; email.hidden = !currentUser; }
    if (open) open.hidden = !!currentUser;
    if (signOut) signOut.hidden = !currentUser;
    const methods = document.getElementById('auth-methods');
    if (methods) methods.hidden = !currentUser;
    const invite = document.getElementById('invite-open');
    if (invite) invite.hidden = !currentUser;
    const credit = document.getElementById('billing-open');
    if (credit) { credit.hidden = !currentUser; credit.textContent = currentUser?.subscription?.active ? `${currentUser.subscription.remainingTokens.toLocaleString()} tokens · Plan` : `${(currentUser?.subscription?.prepaidTokens || 0).toLocaleString()} tokens · Plans & credit`; }
    const billingBalance = document.getElementById('billing-balance');
    if (billingBalance && currentUser) billingBalance.textContent = `Prepaid allowance: ${(currentUser.subscription?.prepaidTokens || 0).toLocaleString()} tokens`;
    const librarySignIn = document.getElementById('library-sign-in');
    if (librarySignIn) librarySignIn.hidden = !!currentUser;
}
function showRequestedPlan() {
    const requested = new URLSearchParams(location.search).get('plan');
    if (!SUBSCRIPTION_PLANS.some(plan => plan.id === requested)) return;
    if (!currentUser) { void openAuth(); return; }
    const welcome = document.getElementById('welcome-promotion-dialog');
    if (welcome?.open) welcome.addEventListener('close', () => { void showUpgradeModal(); }, { once: true });
    else void showUpgradeModal();
}
async function openAuth() {
    if (!authDialog) return;
    document.getElementById('auth-form').hidden = !!currentUser;
    document.getElementById('auth-error').textContent = '';
    if (currentUser) {
        document.getElementById('auth-heading').textContent = 'Your sign-in methods.';
        document.getElementById('auth-intro').textContent = 'Connect an account to sign in to the same translations and credit balance.';
    } else setAuthMode(authMode);
    if (!authDialog.open) authDialog.showModal();
    const status = document.getElementById('social-status');
    const container = document.getElementById('social-providers');
    status.textContent = 'Loading sign-in options…';
    container.replaceChildren();
    try {
        const { providers } = await request('/api/auth/providers');
        providers.forEach(provider => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `social-provider social-provider-${provider.id}`;
            const signInLabels = { google: 'Sign in with Google', microsoft: 'Sign in with Microsoft', twitter: 'Sign in with X', kakao: 'Login with Kakao' };
            const label = document.createElement('span');
            label.className = 'social-provider-label';
            label.textContent = provider.linked ? `Connected to ${provider.name}` : currentUser ? `Connect ${provider.name}` : signInLabels[provider.id] || `Continue with ${provider.name}`;
            const logo = document.createElement('img');
            logo.className = 'social-provider-logo';
            logo.src = `/auth/${provider.id}.${provider.id === 'google' ? 'png' : 'svg'}`;
            logo.alt = '';
            logo.width = 20;
            logo.height = 20;
            logo.setAttribute('aria-hidden', 'true');
            button.append(logo, label);
            button.disabled = !provider.enabled || provider.linked;
            button.setAttribute('aria-label', button.textContent + (!provider.enabled ? ', currently unavailable' : ''));
            button.addEventListener('click', async () => {
                container.querySelectorAll('button').forEach(item => { item.disabled = true; });
                status.textContent = `Connecting to ${provider.name}…`;
                const returnTo = preserveSocialDraft();
                await flushDraftStorage();
                try {
                    if (currentUser) {
                        const { url } = await request(`/api/auth/${provider.id}/link?returnTo=${encodeURIComponent(returnTo)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                        location.assign(url);
                    } else location.assign(`/api/auth/${provider.id}/start?returnTo=${encodeURIComponent(returnTo)}&ref=${encodeURIComponent(referralCode())}`);
                } catch (error) {
                    document.getElementById('auth-error').textContent = error.message;
                    container.querySelectorAll('button').forEach((item, index) => { item.disabled = !providers[index].enabled || providers[index].linked; });
                    status.textContent = '';
                }
            });
            container.appendChild(button);
        });
        status.textContent = providers.some(provider => !provider.enabled) ? 'More sign-in options will be available soon.' : '';
    } catch { status.textContent = 'Social sign-in is temporarily unavailable.'; }
}
function preserveSocialDraft() {
    if (sourceText) {
        saveDraftValue('SHIROKO_SOURCE_TEXT', sourceText.value);
        saveDraftValue('SHIROKO_TARGET_LANG', targetLangSelect.value);
        saveDraftValue('SHIROKO_INSTRUCTIONS', customInstructions.value);
        saveDraftValue('SHIROKO_EXISTING_TRANSLATION', existingTranslation.value);
        saveDraftValue('SHIROKO_MODE', improveMode ? 'improve' : 'translate');
    }
    if (currentSavedId) return `/result.html?id=${currentSavedId}`;
    if (resultsPage && currentData.length) {
        saveDraftValue('SHIROKO_AUTH_DRAFT', JSON.stringify({ rows: currentData, sourceText: currentSourceText, sourceLang: currentSourceLang, targetLang: currentTargetLang, instructions: currentInstructions, dictionary: currentDictionary, summary: currentSummary }));
        return '/result.html';
    }
    return '/app.html';
}
function setAuthMode(mode) {
    authMode = mode;
    document.getElementById('auth-promotion-field').hidden = mode !== 'register';
    document.getElementById('auth-heading').textContent = mode === 'register' ? 'Make room for your words.' : 'Welcome back.';
    document.getElementById('auth-intro').textContent = mode === 'register' ? 'Create an account to save your aligned translations.' : 'Sign in to keep your translations close.';
    if (mode === 'register' && referralCode()) document.getElementById('auth-intro').textContent = 'Create your account using this invitation. You and your friend each receive 2,500 prepaid tokens.';
    document.getElementById('auth-submit').textContent = mode === 'register' ? 'Create account' : 'Sign in';
    document.getElementById('auth-switch').textContent = mode === 'register' ? 'Already have an account? Sign in' : 'New here? Create an account';
    document.getElementById('auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    document.getElementById('auth-error').textContent = '';
}
document.getElementById('auth-open')?.addEventListener('click', openAuth);
document.getElementById('auth-methods')?.addEventListener('click', openAuth);
document.getElementById('invite-open')?.addEventListener('click', showInviteDialog);
async function showInviteDialog() {
    let dialog = document.getElementById('invite-dialog');
    if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'invite-dialog';
        dialog.className = 'auth-dialog';
        dialog.setAttribute('aria-labelledby', 'invite-heading');
        dialog.innerHTML = `<form method="dialog"><button class="auth-close" aria-label="Close">Close</button></form><h2 id="invite-heading">Invite a friend and get credit to translate 5 pages.</h2><p>You and your friend each receive 2,500 prepaid tokens.</p><p>Credit is added when a new friend creates an account using your link. Each friend can receive signup credit once.</p><label for="invite-link">Your invitation link</label><input id="invite-link" type="url" readonly><button id="invite-copy" class="button button-dark" type="button">Copy invitation link</button><p id="invite-status" role="status" aria-live="polite"></p>`;
        document.body.appendChild(dialog);
        document.getElementById('invite-copy').addEventListener('click', async () => {
            const input = document.getElementById('invite-link');
            try { await navigator.clipboard.writeText(input.value); document.getElementById('invite-status').textContent = 'Invitation link copied.'; }
            catch { input.select(); document.getElementById('invite-status').textContent = 'Select and copy your invitation link.'; }
        });
    }
    dialog.showModal();
    document.getElementById('invite-copy').disabled = true;
    document.getElementById('invite-link').value = '';
    document.getElementById('invite-status').textContent = 'Loading your invitation link…';
    try {
        const data = await request('/api/referrals');
        document.getElementById('invite-link').value = data.url;
        document.getElementById('invite-copy').disabled = false;
        document.getElementById('invite-status').textContent = `${data.successfulInvites} successful invitations.`;
    } catch (error) { document.getElementById('invite-status').textContent = error.message; }
}
document.getElementById('billing-open')?.addEventListener('click', showUpgradeModal);
document.getElementById('library-sign-in')?.addEventListener('click', openAuth);
document.getElementById('auth-close')?.addEventListener('click', () => authDialog.close());
authDialog?.addEventListener('close', () => { saveAfterLogin = false; });
document.getElementById('auth-switch')?.addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
document.getElementById('auth-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = document.getElementById('auth-submit');
    const error = document.getElementById('auth-error');
    submit.disabled = true;
    error.textContent = '';
    try {
        const { user } = await request(`/api/${authMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: document.getElementById('auth-email').value, password: document.getElementById('auth-password').value, ...(authMode === 'register' ? { promotionCode: document.getElementById('auth-promotion').value.trim(), referralCode: referralCode() } : {}) }) });
        currentUser = user;
        refreshAccount();
        const shouldSave = saveAfterLogin;
        authDialog.close();
        document.getElementById('auth-form').reset();
        showWelcomePromotion();
        showRequestedPlan();
        if (shouldSave || (resultsPage && currentData.length)) await saveTranslation();
        if (landingPage) await loadLibrary();
        if (resultsPage && new URLSearchParams(location.search).has('id') && !currentData.length) location.reload();
    } catch (e) { error.textContent = e.message; }
    finally { submit.disabled = false; }
});
document.getElementById('sign-out')?.addEventListener('click', async () => {
    try {
        await request('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        currentUser = null;
        currentSavedId = null;
        ['SHIROKO_SAVED_ID', 'SHIROKO_SOURCE_TEXT', 'SHIROKO_TARGET_LANG', 'SHIROKO_INSTRUCTIONS', 'SHIROKO_TRANSLATION_DATA', 'SHIROKO_EXISTING_TRANSLATION', 'SHIROKO_MODE', 'SHIROKO_AUTH_DRAFT'].forEach(key => removeDraftValue(key));
        refreshAccount();
        if (landingPage) {
            sourceText.value = '';
            customInstructions.value = '';
            existingTranslation.value = '';
            updatePriceEstimate();
            await loadLibrary();
        }
        if (resultsPage) location.href = 'app.html';
    } catch (e) { if (saveStatus) saveStatus.textContent = e.message; }
});
async function loadLibrary() {
    const list = document.getElementById('library-list');
    const message = document.getElementById('library-message');
    if (!list || !message) return;
    list.replaceChildren();
    if (!currentUser) { message.textContent = 'Sign in to see your saved translations.'; return; }
    try {
        const { translations } = await request('/api/translations');
        message.textContent = translations.length ? '' : 'No saved translations yet. Your translations will save here automatically.';
        translations.forEach(item => {
            const link = document.createElement('a');
            link.className = 'library-item';
            link.href = `result.html?id=${encodeURIComponent(item.id)}`;
            const title = document.createElement('strong');
            title.textContent = item.title;
            const detail = document.createElement('span');
            detail.textContent = `${item.targetLang} · ${item.rowCount} sentences · Updated ${new Date(item.updatedAt).toLocaleDateString()}`;
            link.append(title, detail);
            list.appendChild(link);
        });
    } catch (e) { message.textContent = e.message; }
}
let saveTimer;
let savePromise;
let changeVersion = 0;
let savedVersion = 0;
function markUnsaved() {
    changeVersion++;
    if (!saveStatus) return;
    saveStatus.textContent = currentUser ? 'Waiting to save…' : 'Sign in to save your translation.';
    if (saveBtn) saveBtn.textContent = 'Save changes';
    clearTimeout(saveTimer);
    if (currentUser) saveTimer = setTimeout(saveTranslation, 700);
}
function saveTranslation() {
    clearTimeout(saveTimer);
    if (!currentUser) { saveAfterLogin = true; openAuth(); return Promise.resolve(); }
    if (!currentData.length) return Promise.resolve();
    if (savePromise) return savePromise;
    if (saveBtn) saveBtn.disabled = true;
    savePromise = (async () => {
        try {
            do {
                const version = changeVersion;
                const title = currentSourceText.trim().split(/\n|[.!?。！？]/)[0].slice(0, 80).trim() || 'Untitled translation';
                const payload = JSON.stringify({ title, sourceText: currentSourceText, sourceLang: currentSourceLang, targetLang: currentTargetLang, instructions: currentInstructions, rows: currentData, dictionary: currentDictionary, summary: currentSummary });
                saveStatus.textContent = 'Saving…';
                const { translation } = await request(currentSavedId ? `/api/translations/${currentSavedId}` : '/api/translations', { method: currentSavedId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
                currentSavedId = translation.id;
                savedVersion = version;
                saveDraftValue('SHIROKO_SAVED_ID', currentSavedId);
                history.replaceState(null, '', `result.html?id=${encodeURIComponent(currentSavedId)}`);
                if (savedVersion === changeVersion) {
                    saveStatus.textContent = `Saved automatically at ${new Date(translation.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
                    if (saveBtn) saveBtn.innerHTML = '<i data-lucide="check" aria-hidden="true"></i> Saved';
                    window.lucide?.createIcons();
                }
            } while (savedVersion !== changeVersion && currentUser);
        } catch (error) {
            saveStatus.textContent = `Could not save: ${error.message} Retrying…`;
            if (saveBtn) saveBtn.textContent = 'Retry save';
            clearTimeout(saveTimer);
            if (currentUser) saveTimer = setTimeout(saveTranslation, 5000);
        } finally {
            savePromise = null;
            if (saveBtn) saveBtn.disabled = false;
        }
    })();
    return savePromise;
}
saveBtn?.addEventListener('click', saveTranslation);
window.addEventListener('shiroko:draft-storage-error', () => { if (saveStatus) saveStatus.textContent = 'Browser draft storage is full. Keep this page open until your account save completes.'; });
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && currentUser && currentData.length && savedVersion !== changeVersion) void saveTranslation();
});
window.addEventListener('online', () => {
    if (currentUser && currentData.length && savedVersion !== changeVersion) void saveTranslation();
});

// Event Listeners
if (sourceText) {
    sourceText.addEventListener('input', updatePriceEstimate);
}

function updatePriceEstimate() {
    if (!priceDisplay || !sourceText) return;
    const chunks = sourceChunks(sourceText.value.trim());
    const counts = chunks.map(countSourceTokens);
    const tokens = counts.reduce((sum, count) => sum + count, 0);
    const micros = counts.reduce((sum, count) => sum + priceMicros(currentSpeed, count), 0);
    priceDisplay.textContent = `${tokens.toLocaleString()} source tokens · ${allowanceCost(currentSpeed, tokens).toLocaleString()} allowance tokens`;
}
if (translateBtn) {
    translateBtn.onclick = async () => {
        const text = sourceText.value.trim();
        const targetLang = targetLangSelect.value;
        const instructions = customInstructions.value.trim();

        if (!text) return alert("Please enter some original text.");
        if (improveMode && !existingTranslation.value.trim()) return alert("Please enter the existing translation to improve.");
        saveDraftValue('SHIROKO_MODE', improveMode ? 'improve' : 'translate');
        saveDraftValue('SHIROKO_EXISTING_TRANSLATION', existingTranslation.value.trim());

        saveDraftValue('SHIROKO_SOURCE_TEXT', text);
        saveDraftValue('SHIROKO_TARGET_LANG', targetLang);
        saveDraftValue('SHIROKO_INSTRUCTIONS', instructions);
        removeDraftValue('SHIROKO_SAVED_ID');
        if (!currentUser) { openAuth(); return; }
        if ((currentUser.balanceMicros || 0) <= 0 && !(currentUser.subscription?.remainingTokens > 0) && !(currentUser.subscription?.prepaidTokens > 0)) { showUpgradeModal(); return; }
        await flushDraftStorage();
        window.location.href = improveMode ? 'result.html?mode=improve' : 'result.html';
    };
}

if (backBtn) {
    backBtn.addEventListener('click', async () => {
        if (currentData.length && savedVersion !== changeVersion) await saveTranslation();
        window.location.href = 'app.html';
    });
}

if (copyBtn) copyBtn.addEventListener('click', handleCopyAll);


if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);
}

const existingFileInput = document.getElementById('existing-file-upload');
document.getElementById('existing-upload-btn')?.addEventListener('click', () => existingFileInput.click());
existingFileInput?.addEventListener('change', event => handleFileUpload(event, existingTranslation));

async function handleFileUpload(event, destination = sourceText) {
    const file = event.target.files[0];
    if (!file) return;
    const extension = file.name.split('.').pop().toLowerCase();
    try {
        if (!['pdf', 'docx'].includes(extension)) throw new Error('Choose a PDF or .docx file.');
        const arrayBuffer = await file.arrayBuffer();
        const text = extension === 'pdf'
            ? await (await import('./pdf-upload.js')).extractPdfText(arrayBuffer)
            : (await mammoth.extractRawText({ arrayBuffer })).value;
        if (!text.trim()) throw new Error(extension === 'pdf'
            ? 'This PDF has no selectable text. Scanned PDFs need OCR before uploading.'
            : 'This Word document has no text to translate.');
        destination.value = text;
        updatePriceEstimate();
    } catch (error) {
        console.error('Error reading uploaded document:', error);
        alert(error.message === 'Choose a PDF or .docx file.' || error.message.startsWith('This PDF has no selectable text.') || error.message === 'This Word document has no text to translate.'
            ? error.message
            : `Failed to read ${extension === 'pdf' ? 'PDF' : 'Word document'}. Please check that the file is valid.`);
    } finally {
        event.target.value = '';
    }
}

// Page-specific Initialization
window.addEventListener('load', async () => {
    await loadDraftStorage();
    try { currentUser = (await request('/api/me')).user; } catch { currentUser = null; }
    refreshAccount();
    showWelcomePromotion();
    showRequestedPlan();
    const authError = new URLSearchParams(location.search).get('auth_error');
    if (authError) {
        await openAuth();
        const messages = { email_exists: 'An account already uses that email. Sign in with your existing method, then choose Sign-in methods to connect this account.', identity_in_use: 'That social account is connected to another Shiroko account.', provider_already_linked: 'This provider is already connected. Use the connected account to sign in.', session_expired: 'Your session expired. Sign in again before connecting an account.', canceled: 'Sign-in was canceled. You can try again.' };
        document.getElementById('auth-error').textContent = messages[authError] || 'Social sign-in could not be completed. Please try again.';
        history.replaceState(null, '', location.pathname);
    }
    if (new URLSearchParams(location.search).get('auth') === 'linked') {
        await openAuth();
        document.getElementById('social-status').textContent = 'Your account is connected.';
    }
    if (new URLSearchParams(location.search).get('payment') === 'success' && currentUser) {
        await showUpgradeModal();
        const message = document.getElementById('billing-message');
        if (message) message.textContent = 'Checkout returned. Waiting for payment confirmation…';
        let attempts = 0;
        const before = currentUser.subscription?.prepaidTokens || 0;
        const timer = setInterval(async () => {
            attempts++;
            try {
                currentUser = (await request('/api/me')).user;
                refreshAccount();
                const status = document.getElementById('billing-message');
                if (!currentUser || (currentUser.subscription?.prepaidTokens || 0) !== before || attempts >= 20) {
                    clearInterval(timer);
                    if (status) status.textContent = (currentUser?.subscription?.prepaidTokens || 0) !== before ? 'Your balance has updated.' : 'Your current balance is shown above. Payment confirmation can take a moment; refresh to check again.';
                }
            } catch { if (attempts >= 20) clearInterval(timer); }
        }, 3000);
    }
    if (landingPage) {
        sourceText.value = readDraftValue('SHIROKO_SOURCE_TEXT') || '';
        targetLangSelect.value = readDraftValue('SHIROKO_TARGET_LANG') || 'Korean';
        customInstructions.value = readDraftValue('SHIROKO_INSTRUCTIONS') || '';
        existingTranslation.value = readDraftValue('SHIROKO_EXISTING_TRANSLATION') || '';
        setImproveMode(new URLSearchParams(location.search).get('mode') === 'improve');
        updatePriceEstimate();
        await loadLibrary();
        if (new URLSearchParams(location.search).has('signin') && !currentUser) openAuth();
    }
    const path = window.location.pathname;
    if (path.includes('result.html')) {
        const restored = readDraftValue('SHIROKO_AUTH_DRAFT');
        if (currentUser && new URLSearchParams(location.search).has('auth') && restored) {
            try {
                const draft = JSON.parse(restored);
                currentData = draft.rows;
                currentSourceText = draft.sourceText;
                currentSourceLang = draft.sourceLang || '';
                currentTargetLang = draft.targetLang;
                currentInstructions = draft.instructions;
                currentDictionary = draft.dictionary;
                currentSummary = draft.summary;
                renderResults();
                document.getElementById('processing-status').textContent = 'Your translation is ready.';
                markUnsaved();
                await saveTranslation();
                removeDraftValue('SHIROKO_AUTH_DRAFT');
                return;
            } catch { removeDraftValue('SHIROKO_AUTH_DRAFT'); }
        }
        const savedId = new URLSearchParams(location.search).get('id');
        if (savedId) {
            try {
                const { translation } = await request(`/api/translations/${encodeURIComponent(savedId)}`);
                currentSavedId = translation.id;
                currentSourceText = translation.sourceText;
                currentSourceLang = translation.sourceLang || '';
                currentTargetLang = translation.targetLang;
                currentInstructions = translation.instructions;
                currentData = translation.rows;
                currentDictionary = translation.dictionary || {};
                currentSummary = translation.summary || '';
                saveDraftValue('SHIROKO_SOURCE_TEXT', currentSourceText);
                saveDraftValue('SHIROKO_TARGET_LANG', currentTargetLang);
                saveDraftValue('SHIROKO_INSTRUCTIONS', currentInstructions);
                saveDraftValue('SHIROKO_TRANSLATION_DATA', JSON.stringify(currentData));
                renderResults();
                document.getElementById('processing-status').textContent = `Saved translation · ${currentTargetLang}`;
                saveStatus.textContent = 'All changes saved';
                return;
            } catch (e) {
                document.getElementById('processing-status').textContent = e.message;
                saveStatus.textContent = currentUser ? 'Choose another translation from your library.' : 'Sign in to open this saved translation.';
                if (!currentUser) openAuth();
                return;
            }
        }
        const text = readDraftValue('SHIROKO_SOURCE_TEXT') ?? readDraftValue('MIARA_SOURCE_TEXT');
        const targetLang = readDraftValue('SHIROKO_TARGET_LANG') ?? readDraftValue('MIARA_TARGET_LANG');
        const instructions = readDraftValue('SHIROKO_INSTRUCTIONS') ?? readDraftValue('MIARA_INSTRUCTIONS');

        if (text && targetLang) {
            currentSourceText = text;
            currentTargetLang = targetLang;
            currentInstructions = instructions || '';
            await processAdvancedStreaming(text, targetLang, instructions, new URLSearchParams(location.search).get('mode') === 'improve' ? readDraftValue('SHIROKO_EXISTING_TRANSLATION') : null);
        } else {
            window.location.href = 'app.html';
        }
    }
});

async function processAdvancedStreaming(fullText, targetLang, instructions, draft = null) {
    const statusEl = document.getElementById('processing-status');
    setThreeWay(draft !== null);
    refreshResultWorkbench();
    const chunks = sourceChunks(fullText);
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });

    const draftSentences = draft === null ? [] : Array.from(segmenter.segment(draft), ({ segment }) => segment.match(/[\s\S]{1,5000}/gu) || []).flat();
    let draftCursor = 0;
    let summary = "The beginning of the document.";
    let dictionary = {};
    let previousText = "";
    let previousTranslatedText = ""; // Track previous output
    currentData = [];

    for (let i = 0; i < chunks.length; i++) {
        if (statusEl) statusEl.textContent = `${draft === null ? 'Translating' : 'Improving'} chunk ${i + 1} of ${chunks.length}...`;

        // Show skeleton for this chunk
        const skeletonId = `skeleton-${i}`;
        appendSkeleton(skeletonId);

        try {
            let draftWindow = [];
            if (draft !== null) {
                let length = 0;
                for (const sentence of draftSentences.slice(draftCursor)) {
                    if (length + sentence.length > 30000 && draftWindow.length) break;
                    draftWindow.push(sentence);
                    length += sentence.length;
                }
            }
            const result = draft === null ? await translateAndAlignRecursive(
                chunks[i],
                targetLang,
                instructions,
                summary,
                dictionary,
                previousText,
                previousTranslatedText // Pass previous output
            ) : await request('/api/translate', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ speed: currentSpeed, mode: 'improve', text: chunks[i], targetLanguage: targetLang, instructions,
                    summary, dictionary: Object.fromEntries(Object.entries(dictionary).slice(-500)), previousContext: previousText, previousTranslatedText,
                    existingTranslation: draftWindow.join(''), draftSentences: draftWindow,
                    isLastChunk: i === chunks.length - 1 })
            });
            if (draft !== null) draftCursor += result.consumedDraftSentences;

            // Remove skeleton
            removeSkeleton(skeletonId);

            // Update state for next recursion
            summary = result.newSummary;
            if (result.sourceLanguage) currentSourceLang = result.sourceLanguage;
            dictionary = { ...dictionary, ...result.newProperNouns };
            currentDictionary = dictionary;
            currentSummary = summary;
            previousText = chunks[i];

            // Store last ~1000 tokens (approx 4000 chars) of translation
            const currentTranslation = result.alignedRows.map(row => row.target).join(' ');
            previousTranslatedText = currentTranslation.slice(-4000);

            // Render and save
            appendChunkToUI(result.alignedRows);
            currentData = currentData.concat(result.alignedRows);
            refreshResultWorkbench();
            saveDraftValue('SHIROKO_TRANSLATION_DATA', JSON.stringify(currentData));
            markUnsaved();
        } catch (error) {
            console.error('Streaming Error:', error);
            removeSkeleton(skeletonId); // Ensure removal on error
            if (statusEl) statusEl.textContent = `Translation stopped: ${error.message}`;
            return;
        }
    }

    await saveTranslation();
    if (statusEl) statusEl.textContent = draft === null ? "Translation Complete." : "Translation improvement complete.";
}

function appendChunkToUI(rows) {
    rows.forEach((item, index) => {
        const globalIndex = currentData.length + index;

        if (item.newParagraph && globalIndex > 0) {
            const breakLine = document.createElement('div');
            breakLine.className = 'sentence-paragraph-break';
            breakLine.style.gridColumn = '1 / -1';
            alignmentGrid.appendChild(breakLine);
        }

        const row = document.createElement('div');
        row.className = 'alignment-row';

        const sourceCol = document.createElement('div');
        sourceCol.className = 'source-item';
        sourceCol.textContent = item.source;

        const targetCol = document.createElement('div');
        targetCol.className = 'target-item';
        targetCol.contentEditable = 'plaintext-only';
        targetCol.textContent = item.target;

        targetCol.addEventListener('input', (e) => {
            currentData[globalIndex].target = e.target.textContent;
            refreshResultWorkbench(true);
            saveDraftValue('SHIROKO_TRANSLATION_DATA', JSON.stringify(currentData));
            markUnsaved();
        });

        const actions = document.createElement('div');
        actions.className = 'row-actions';
        const regenBtn = document.createElement('button');
        regenBtn.className = 'regen-btn';
        regenBtn.innerHTML = '<i data-lucide="refresh-cw"></i>';
        regenBtn.onclick = () => handleRegenerate(globalIndex, regenBtn);
        actions.appendChild(regenBtn);

        row.appendChild(sourceCol);
        if (item.originalTranslation !== undefined) {
            const draftCol = document.createElement('div');
            draftCol.className = 'original-translation-item';
            draftCol.textContent = item.originalTranslation;
            row.appendChild(draftCol);
        }
        row.appendChild(targetCol);
        row.appendChild(actions);
        alignmentGrid.appendChild(row);
    });
    if (window.lucide) window.lucide.createIcons();
}

async function translateAndAlignRecursive(text, targetLanguage, instructions, summary, dictionary, previousContext, previousTranslatedText) {
    return request('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speed: currentSpeed, mode: 'translate', text, targetLanguage, instructions, summary, dictionary, previousContext, previousTranslatedText })
    });
}

function appendSkeleton(id) {
    const row = document.createElement('div');
    row.id = id;
    row.className = 'skeleton-row';

    // Source Skeleton
    const sourceCol = document.createElement('div');
    sourceCol.innerHTML = '<div class="skeleton-text"></div><div class="skeleton-text"></div>';

    // Target Skeleton
    const targetCol = document.createElement('div');
    targetCol.innerHTML = '<div class="skeleton-text"></div><div class="skeleton-text"></div>';

    row.appendChild(sourceCol);
    if (resultsPage.classList.contains('three-way')) row.appendChild(sourceCol.cloneNode(true));
    row.appendChild(targetCol);
    alignmentGrid.appendChild(row);

}

function removeSkeleton(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

async function showUpgradeModal() {
    if (!currentUser) { openAuth(); return; }
    let dialog = document.getElementById('billing-dialog');
    if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'billing-dialog';
        dialog.className = 'auth-dialog billing-dialog';
        dialog.setAttribute('aria-labelledby', 'billing-heading');
        dialog.innerHTML = `<form method="dialog"><button class="auth-close" aria-label="Close" autofocus>Close</button></form><h2 id="billing-heading">Room for more words.</h2><p id="billing-balance"></p><p>Choose a monthly plan. Use Standard at 1×, Fast at 2×, or Ultrafast at 6× from one allowance.</p><p id="subscription-status"></p><div id="subscription-plans" class="subscription-plans"></div><button id="subscription-manage" class="button button-dark" type="button" hidden>Manage subscription</button><p>Page estimates assume about 500 source tokens per page. Actual length varies by language and formatting. Fast uses 2× the allowance; Ultrafast uses 6×.</p><p>Monthly allowances reset each paid billing period. No rollover. Cancel renewal anytime.</p><h3>Optional prepaid top-ups</h3><p>Purchased credit is used after your monthly allowance. Top-ups are one-time purchases and never happen automatically.</p><div id="billing-packs" class="billing-packs"></div><form id="promotion-form"><label for="promotion-code">Promotion code</label><input id="promotion-code" type="text" autocomplete="off" maxlength="100" required><button class="button button-dark" type="submit">Redeem code</button></form><p id="billing-message" role="status" aria-live="polite"></p>`;
        document.body.appendChild(dialog);
        document.getElementById('subscription-manage').addEventListener('click', async () => {
            const button = document.getElementById('subscription-manage');
            button.disabled = true;
            try {
                const data = await request('/api/billing/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                location.assign(data.url);
            } catch (error) { document.getElementById('billing-message').textContent = error.message; button.disabled = false; }
        });
        document.getElementById('promotion-form').addEventListener('submit', async event => {
            event.preventDefault();
            const button = event.currentTarget.querySelector('button');
            const message = document.getElementById('billing-message');
            button.disabled = true;
            try {
                const data = await request('/api/billing/promotion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ promotionCode: document.getElementById('promotion-code').value }) });
                message.textContent = data.message;
            } catch (error) { message.textContent = error.message; }
            finally { button.disabled = false; }
        });
    }
    if (!dialog.open) dialog.showModal();
    const message = document.getElementById('billing-message');
    message.textContent = 'Loading credit options…';
    try {
        const data = await request('/api/billing');
        document.getElementById('billing-balance').textContent = `Prepaid allowance: ${(data.subscription?.prepaidTokens || 0).toLocaleString()} tokens`;
        const subscription = data.subscription;
        const selectedPlan = SUBSCRIPTION_PLANS.find(plan => plan.id === subscription?.planId);
        const status = document.getElementById('subscription-status');
        status.textContent = subscription?.active ? `${selectedPlan?.name || ''} · ${subscription.remainingTokens.toLocaleString()} of ${subscription.quotaTokens.toLocaleString()} allowance tokens remaining · ${subscription.permanent ? 'Allowance resets' : subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} ${new Date(subscription.periodEnd).toLocaleDateString()}` : 'Choose a plan for a monthly translation allowance.';
        const manage = document.getElementById('subscription-manage');
        manage.hidden = !subscription?.hasCustomer;
        manage.disabled = false;
        const plans = document.getElementById('subscription-plans');
        plans.replaceChildren();
        (data.plans || []).forEach(plan => {
            const card = document.createElement('article'); card.className = 'monthly-plan';
            const title = document.createElement('h3'); title.textContent = plan.name;
            const description = document.createElement('p'); description.className = 'plan-description'; description.textContent = { personal: 'For everyday usage at school, home, or work.', plus: "If you're translating multiple essays or a book.", pro: 'For translation professionals translating multiple books a month.' }[plan.id] || '';
            const price = document.createElement('span'); price.className = 'plan-price'; price.textContent = `$${plan.monthlyUsd}/mo`;
            const heading = document.createElement('div'); heading.className = 'plan-heading'; heading.append(title, price);
            const tokens = document.createElement('p'); tokens.className = 'tier-description'; tokens.textContent = `${plan.tokens.toLocaleString()} monthly allowance tokens`;
            const pages = document.createElement('p'); pages.className = 'plan-pages'; pages.textContent = `About ${Math.round(plan.tokens / 500).toLocaleString()} pages of text at Standard speed`;
            const button = document.createElement('button'); button.className = 'button button-dark'; button.type = 'button';
            button.textContent = subscription?.canSubscribe === false ? (subscription.planId === plan.id ? 'Current plan' : 'Manage subscription to change plans') : `Subscribe to ${plan.name}`;
            button.disabled = !plan.available || !data.configured || subscription?.canSubscribe === false;
            button.addEventListener('click', async () => {
                plans.querySelectorAll('button').forEach(item => { item.disabled = true; });
                message.textContent = 'Opening subscription checkout…';
                try {
                    const checkout = await request('/api/billing/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: plan.id }) });
                    location.assign(checkout.url);
                } catch (error) { message.textContent = error.message; plans.querySelectorAll('button').forEach(item => { item.disabled = false; }); }
            });
            const allowance = document.createElement('div'); allowance.className = 'plan-allowance'; allowance.append(pages, tokens);
            card.append(heading, description, allowance, button); plans.append(card);
        });
        const packs = document.getElementById('billing-packs');
        packs.replaceChildren();
        data.packs.forEach(({ amount, available, tokens }) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'button button-dark';
            button.textContent = `$${amount} · ${tokens.toLocaleString()} tokens`;
            button.disabled = !available || !data.configured;
            button.addEventListener('click', async () => {
                packs.querySelectorAll('button').forEach(item => { item.disabled = true; });
                message.textContent = 'Opening secure checkout…';
                try {
                    const checkout = await request('/api/billing/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }) });
                    location.assign(checkout.url);
                } catch (error) {
                    message.textContent = error.message;
                    packs.querySelectorAll('button').forEach(item => { item.disabled = false; });
                }
            });
            packs.appendChild(button);
        });
        message.textContent = data.configured && data.packs.some(pack => pack.available) ? 'One-time purchase. Any applicable taxes are shown at checkout.' : 'Payments are being set up. Please check back shortly.';
    } catch (error) { message.textContent = error.message; }
}

function setThreeWay(enabled) {
    resultsPage.classList.toggle('three-way', enabled);
    document.querySelector('.column-headings').innerHTML = enabled
        ? '<span id="result-column-source">Source</span><span>Original translation</span><span id="result-column-target">Translation</span>'
        : '<span id="result-column-source">Source</span><span id="result-column-target">Translation</span>';
}

function renderResults() {
    setThreeWay(currentData.some(row => row.originalTranslation !== undefined));
    alignmentGrid.innerHTML = '';

    currentData.forEach((item, index) => {
        // Add paragraph break class if needed
        if (item.newParagraph && index > 0) {
            const breakLine = document.createElement('div');
            breakLine.className = 'sentence-paragraph-break';
            breakLine.style.gridColumn = '1 / -1';
            alignmentGrid.appendChild(breakLine);
        }

        const row = document.createElement('div');
        row.className = 'alignment-row';

        const sourceCol = document.createElement('div');
        sourceCol.className = 'source-item';
        sourceCol.textContent = item.source;

        const targetCol = document.createElement('div');
        targetCol.className = 'target-item';
        targetCol.contentEditable = 'plaintext-only';
        targetCol.textContent = item.target;

        // Update state on edit
        targetCol.addEventListener('input', (e) => {
            currentData[index].target = e.target.textContent;
            refreshResultWorkbench(true);
            // Sync back to sessionStorage
            saveDraftValue('SHIROKO_TRANSLATION_DATA', JSON.stringify(currentData));
            markUnsaved();
        });

        const actions = document.createElement('div');
        actions.className = 'row-actions';

        const regenBtn = document.createElement('button');
        regenBtn.className = 'regen-btn';
        regenBtn.innerHTML = '<i data-lucide="refresh-cw"></i>';
        regenBtn.title = 'Regenerate this sentence';
        regenBtn.onclick = () => handleRegenerate(index, regenBtn);

        actions.appendChild(regenBtn);

        row.appendChild(sourceCol);
        if (item.originalTranslation !== undefined) {
            const draftCol = document.createElement('div');
            draftCol.className = 'original-translation-item';
            draftCol.textContent = item.originalTranslation;
            row.appendChild(draftCol);
        }
        row.appendChild(targetCol);
        row.appendChild(actions);
        alignmentGrid.appendChild(row);
    });

    refreshResultWorkbench();
    // Initialize Lucide icons after rendering
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

async function handleRegenerate(index, btn) {

    const icon = btn.querySelector('svg');
    if (icon) { icon.classList.add('spinning'); }

    try {
        // Prepare context
        const start = Math.max(0, index - 5);
        const end = Math.min(currentData.length - 1, index + 5);

        const contextBefore = currentData.slice(start, index).map(d => d.source).join('\n');
        const contextAfter = currentData.slice(index + 1, end + 1).map(d => d.source).join('\n');
        const sentenceToTranslate = currentData[index].source;

        const { translation: newTranslation } = await request('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ speed: currentSpeed, mode: 'regenerate', text: sentenceToTranslate, targetLanguage: currentTargetLang, instructions: currentInstructions, contextBefore, contextAfter })
        });

        // Update data and UI
        currentData[index].target = newTranslation;
        saveDraftValue('SHIROKO_TRANSLATION_DATA', JSON.stringify(currentData));
        markUnsaved();

        const targetElement = btn.closest('.alignment-row').querySelector('.target-item');
        targetElement.textContent = newTranslation;
        refreshResultWorkbench();

    } catch (error) {
        console.error('Regenerate Error:', error);
        alert(`Failed to regenerate sentence: ${error.message}`);
    } finally {
        if (icon) icon.classList.remove('spinning');
    }
}

function handleCopyAll() {
    let text = "";
    currentData.forEach((item, index) => {
        if (item.newParagraph && index > 0) text += "\n\n";
        else if (index > 0) text += " ";
        text += item.target;
    });

    navigator.clipboard.writeText(text).then(() => {
        if (copyBtn) {
            const originalHtml = copyBtn.innerHTML;
            copyBtn.innerHTML = '<i data-lucide="check"></i> Copied!';
            if (window.lucide) window.lucide.createIcons();
            setTimeout(() => {
                copyBtn.innerHTML = originalHtml;
                if (window.lucide) window.lucide.createIcons();
            }, 2000);
        }
    });
}

function showLoader(show) {
    if (!loader) return;
    if (show) {
        loader.classList.remove('hidden');
    } else {
        loader.classList.add('hidden');
    }
}

const syncResultWorkbench = initResultWorkbench({
    getState: () => ({ rows: currentData, sourceText: currentSourceText, sourceLang: currentSourceLang, targetLang: currentTargetLang, dictionary: currentDictionary }),
    replaceTargets: targets => {
        currentData.forEach((row, index) => { row.target = targets[index]; });
        saveDraftValue('SHIROKO_TRANSLATION_DATA', JSON.stringify(currentData));
        markUnsaved(); renderResults();
    }
});
function refreshResultWorkbench(contentOnly = false) { if (typeof syncResultWorkbench === 'function') syncResultWorkbench({ contentOnly }); }
