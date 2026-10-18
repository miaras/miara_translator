// Global State
let currentData = [];
let currentTargetLang = 'Korean';
let currentSourceText = '';
let currentInstructions = '';
let currentSavedId = null;
let currentUser = null;
let authMode = 'login';
let saveAfterLogin = false;

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
const priceDisplay = document.getElementById('price-estimate');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');
const authDialog = document.getElementById('auth-dialog');

async function request(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
}
function refreshAccount() {
    const email = document.getElementById('account-email');
    const open = document.getElementById('auth-open');
    const signOut = document.getElementById('sign-out');
    if (email) { email.textContent = currentUser?.email || ''; email.hidden = !currentUser; }
    if (open) open.hidden = !!currentUser;
    if (signOut) signOut.hidden = !currentUser;
    const librarySignIn = document.getElementById('library-sign-in');
    if (librarySignIn) librarySignIn.hidden = !!currentUser;
}
function openAuth() { authDialog?.showModal(); document.getElementById('auth-email')?.focus(); }
function setAuthMode(mode) {
    authMode = mode;
    document.getElementById('auth-heading').textContent = mode === 'register' ? 'Make room for your words.' : 'Welcome back.';
    document.getElementById('auth-intro').textContent = mode === 'register' ? 'Create an account to save your aligned translations.' : 'Sign in to keep your translations close.';
    document.getElementById('auth-submit').textContent = mode === 'register' ? 'Create account' : 'Sign in';
    document.getElementById('auth-switch').textContent = mode === 'register' ? 'Already have an account? Sign in' : 'New here? Create an account';
    document.getElementById('auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    document.getElementById('auth-error').textContent = '';
}
document.getElementById('auth-open')?.addEventListener('click', openAuth);
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
        const { user } = await request(`/api/${authMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: document.getElementById('auth-email').value, password: document.getElementById('auth-password').value }) });
        currentUser = user;
        refreshAccount();
        const shouldSave = saveAfterLogin;
        authDialog.close();
        document.getElementById('auth-form').reset();
        if (shouldSave) await saveTranslation();
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
        ['SHIROKO_SAVED_ID', 'SHIROKO_SOURCE_TEXT', 'SHIROKO_TARGET_LANG', 'SHIROKO_INSTRUCTIONS', 'SHIROKO_TRANSLATION_DATA'].forEach(key => sessionStorage.removeItem(key));
        refreshAccount();
        if (landingPage) {
            sourceText.value = '';
            customInstructions.value = '';
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
        message.textContent = translations.length ? '' : 'No saved translations yet. Translate something, then choose Save.';
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
function markUnsaved() {
    if (!saveStatus) return;
    saveStatus.textContent = currentSavedId ? 'Unsaved changes' : '';
    if (currentSavedId) saveBtn.textContent = 'Save changes';
}
async function saveTranslation() {
    if (!currentUser) { saveAfterLogin = true; openAuth(); return; }
    if (!currentData.length) { saveStatus.textContent = 'There is no translation to save yet.'; return; }
    const title = currentSourceText.trim().split(/\n|[.!?。！？]/)[0].slice(0, 80).trim() || 'Untitled translation';
    saveBtn.disabled = true;
    saveStatus.textContent = 'Saving…';
    try {
        const { translation } = await request(currentSavedId ? `/api/translations/${currentSavedId}` : '/api/translations', { method: currentSavedId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, sourceText: currentSourceText, targetLang: currentTargetLang, instructions: currentInstructions, rows: currentData }) });
        currentSavedId = translation.id;
        sessionStorage.setItem('SHIROKO_SAVED_ID', currentSavedId);
        history.replaceState(null, '', `result.html?id=${encodeURIComponent(currentSavedId)}`);
        saveStatus.textContent = `Saved ${new Date(translation.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
        saveBtn.innerHTML = '<i data-lucide="check" aria-hidden="true"></i> Saved';
        window.lucide?.createIcons();
    } catch (e) { saveStatus.textContent = e.message; }
    finally { saveBtn.disabled = false; }
}
saveBtn?.addEventListener('click', saveTranslation);

// Event Listeners
if (sourceText) {
    sourceText.addEventListener('input', updatePriceEstimate);
}

function updatePriceEstimate() {
    if (!priceDisplay || !sourceText) return;
    const text = sourceText.value;
    const chars = text.length;
    // Estimate: 4 characters per token
    const inputTokens = chars / 4;
    // Estimate: output tokens are roughly equal to input tokens
    const outputTokens = inputTokens;

    // GPT-6.1 Sol rates; context, summaries, and reasoning add to the actual cost.
    const cost = ((inputTokens * 2) / 1000000) + ((outputTokens * 10) / 1000000);
    priceDisplay.textContent = `Base estimate: $${cost.toFixed(4)}+`;
}
if (translateBtn) {
    translateBtn.onclick = () => {
        const text = sourceText.value.trim();
        const targetLang = targetLangSelect.value;
        const instructions = customInstructions.value.trim();

        if (!text) return alert("Please enter some text to translate.");

        sessionStorage.setItem('SHIROKO_SOURCE_TEXT', text);
        sessionStorage.setItem('SHIROKO_TARGET_LANG', targetLang);
        sessionStorage.setItem('SHIROKO_INSTRUCTIONS', instructions);
        sessionStorage.removeItem('SHIROKO_SAVED_ID');
        window.location.href = 'result.html';
    };
}

if (backBtn) {
    backBtn.addEventListener('click', () => {
        window.location.href = 'app.html';
    });
}

if (copyBtn) copyBtn.addEventListener('click', handleCopyAll);
if (exportBtn) exportBtn.addEventListener('click', handleExportToWord);

if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);
}

async function handleFileUpload(event) {
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
        sourceText.value = text;
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
    try { currentUser = (await request('/api/me')).user; } catch { currentUser = null; }
    refreshAccount();
    if (landingPage) {
        sourceText.value = sessionStorage.getItem('SHIROKO_SOURCE_TEXT') || '';
        targetLangSelect.value = sessionStorage.getItem('SHIROKO_TARGET_LANG') || 'Korean';
        customInstructions.value = sessionStorage.getItem('SHIROKO_INSTRUCTIONS') || '';
        updatePriceEstimate();
        await loadLibrary();
        if (new URLSearchParams(location.search).has('signin') && !currentUser) openAuth();
    }
    const path = window.location.pathname;
    if (path.includes('result.html')) {
        const savedId = new URLSearchParams(location.search).get('id');
        if (savedId) {
            try {
                const { translation } = await request(`/api/translations/${encodeURIComponent(savedId)}`);
                currentSavedId = translation.id;
                currentSourceText = translation.sourceText;
                currentTargetLang = translation.targetLang;
                currentInstructions = translation.instructions;
                currentData = translation.rows;
                sessionStorage.setItem('SHIROKO_SOURCE_TEXT', currentSourceText);
                sessionStorage.setItem('SHIROKO_TARGET_LANG', currentTargetLang);
                sessionStorage.setItem('SHIROKO_INSTRUCTIONS', currentInstructions);
                sessionStorage.setItem('SHIROKO_TRANSLATION_DATA', JSON.stringify(currentData));
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
        const text = sessionStorage.getItem('SHIROKO_SOURCE_TEXT') ?? sessionStorage.getItem('MIARA_SOURCE_TEXT');
        const targetLang = sessionStorage.getItem('SHIROKO_TARGET_LANG') ?? sessionStorage.getItem('MIARA_TARGET_LANG');
        const instructions = sessionStorage.getItem('SHIROKO_INSTRUCTIONS') ?? sessionStorage.getItem('MIARA_INSTRUCTIONS');

        if (text && targetLang) {
            currentSourceText = text;
            currentTargetLang = targetLang;
            currentInstructions = instructions || '';
            await processAdvancedStreaming(text, targetLang, instructions);
        } else {
            window.location.href = 'app.html';
        }
    }
});

async function processAdvancedStreaming(fullText, targetLang, instructions) {
    const statusEl = document.getElementById('processing-status');
    const CHUNK_SIZE = 5000;

    // Use Intl.Segmenter for robust, locale-aware sentence splitting
    // This handles cases like "Mr." vs "." and different languages correctly
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
    const segments = segmenter.segment(fullText);

    const chunks = [];
    let currentChunk = "";

    for (const { segment } of segments) {
        if ((currentChunk + segment).length > CHUNK_SIZE && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = segment;
        } else {
            currentChunk += segment;
        }
    }
    if (currentChunk) chunks.push(currentChunk);

    let summary = "The beginning of the document.";
    let dictionary = {};
    let previousText = "";
    let previousTranslatedText = ""; // Track previous output
    currentData = [];

    for (let i = 0; i < chunks.length; i++) {
        if (statusEl) statusEl.textContent = `Translating chunk ${i + 1} of ${chunks.length}...`;

        // Show skeleton for this chunk
        const skeletonId = `skeleton-${i}`;
        appendSkeleton(skeletonId);

        try {
            const result = await translateAndAlignRecursive(
                chunks[i],
                targetLang,
                instructions,
                summary,
                dictionary,
                previousText,
                previousTranslatedText // Pass previous output
            );

            // Remove skeleton
            removeSkeleton(skeletonId);

            // Update state for next recursion
            summary = result.newSummary;
            dictionary = { ...dictionary, ...result.newProperNouns };
            previousText = chunks[i];

            // Store last ~1000 tokens (approx 4000 chars) of translation
            const currentTranslation = result.alignedRows.map(row => row.target).join(' ');
            previousTranslatedText = currentTranslation.slice(-4000);

            // Render and save
            appendChunkToUI(result.alignedRows);
            currentData = currentData.concat(result.alignedRows);
            sessionStorage.setItem('SHIROKO_TRANSLATION_DATA', JSON.stringify(currentData));
            markUnsaved();
        } catch (error) {
            console.error('Streaming Error:', error);
            removeSkeleton(skeletonId); // Ensure removal on error
            if (statusEl) statusEl.textContent = `Translation stopped: ${error.message}`;
            return;
        }
    }

    if (statusEl) statusEl.textContent = "Translation Complete.";
}

function appendChunkToUI(rows) {
    rows.forEach((item, index) => {
        const globalIndex = currentData.length + index;

        if (item.newParagraph && globalIndex > 0) {
            const breakLine = document.createElement('div');
            breakLine.style.height = '1.5rem';
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
        targetCol.contentEditable = true;
        targetCol.textContent = item.target;

        targetCol.addEventListener('input', (e) => {
            currentData[globalIndex].target = e.target.textContent;
            sessionStorage.setItem('SHIROKO_TRANSLATION_DATA', JSON.stringify(currentData));
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
        body: JSON.stringify({ mode: 'translate', text, targetLanguage, instructions, summary, dictionary, previousContext, previousTranslatedText })
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
    row.appendChild(targetCol);
    alignmentGrid.appendChild(row);

}

function removeSkeleton(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function showUpgradeModal() {
    // Check if modal already exists
    if (document.getElementById('upgrade-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'upgrade-modal';
    modal.className = 'loader-overlay'; // Re-use loader overlay styles for backdrop
    modal.style.background = 'rgba(0, 0, 0, 0.7)';

    modal.innerHTML = `
        <div class="glass" style="background: white; padding: 2.5rem; border-radius: 20px; text-align: center; max-width: 400px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);">
            <i data-lucide="lock" style="width: 48px; height: 48px; color: var(--accent-primary); margin-bottom: 1rem;"></i>
            <h2 style="font-size: 1.5rem; margin-bottom: 0.5rem;">Free Limit Reached</h2>
            <p style="color: var(--text-secondary); margin-bottom: 2rem;">You've used your 5,000 free tokens! Upgrade to continue translating without limits.</p>
            <a href="https://buy.stripe.com/test_placeholder" target="_blank" class="primary-btn-lg" style="display: inline-block; font-size: 1rem; padding: 0.8rem 2rem; text-decoration: none;">
                Upgrade Now
            </a>
            <button id="close-modal-btn" style="margin-top: 1rem; background: none; border: none; color: var(--text-muted); cursor: pointer; display: block; width: 100%; font-size: 0.9rem;">Maybe Later</button>
        </div>
    `;

    document.body.appendChild(modal);
    lucide.createIcons();

    document.getElementById('close-modal-btn').addEventListener('click', () => {
        modal.remove();
    });
}

function renderResults() {
    alignmentGrid.innerHTML = '';

    currentData.forEach((item, index) => {
        // Add paragraph break class if needed
        if (item.newParagraph && index > 0) {
            const breakLine = document.createElement('div');
            breakLine.style.height = '1.5rem';
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
        targetCol.contentEditable = true;
        targetCol.textContent = item.target;

        // Update state on edit
        targetCol.addEventListener('input', (e) => {
            currentData[index].target = e.target.textContent;
            // Sync back to sessionStorage
            sessionStorage.setItem('SHIROKO_TRANSLATION_DATA', JSON.stringify(currentData));
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
        row.appendChild(targetCol);
        row.appendChild(actions);
        alignmentGrid.appendChild(row);
    });

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
            body: JSON.stringify({ mode: 'regenerate', text: sentenceToTranslate, targetLanguage: currentTargetLang, instructions: currentInstructions, contextBefore, contextAfter })
        });

        // Update data and UI
        currentData[index].target = newTranslation;
        sessionStorage.setItem('SHIROKO_TRANSLATION_DATA', JSON.stringify(currentData));
        markUnsaved();

        const targetElement = btn.closest('.alignment-row').querySelector('.target-item');
        targetElement.textContent = newTranslation;

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

function handleExportToWord() {
    let content = "";
    let currentPara = "";

    currentData.forEach((item, index) => {
        if (item.newParagraph && index > 0) {
            content += `<p>${currentPara}</p>`;
            currentPara = item.target;
        } else {
            if (currentPara) currentPara += " ";
            currentPara += item.target;
        }
    });
    if (currentPara) content += `<p>${currentPara}</p>`;

    // Simple HTML Blob approach for Word
    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
        "xmlns:w='urn:schemas-microsoft-com:office:word' " +
        "xmlns='http://www.w3.org/TR/REC-html40'>" +
        "<head><meta charset='utf-8'></head><body>";
    const footer = "</body></html>";
    const sourceHtml = header + content + footer;

    const blob = new Blob(['\ufeff', sourceHtml], {
        type: 'application/msword'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'translation.doc';
    link.click();
    URL.revokeObjectURL(url);
}

function showLoader(show) {
    if (!loader) return;
    if (show) {
        loader.classList.remove('hidden');
    } else {
        loader.classList.add('hidden');
    }
}
