// Gemini API calling function using fetch to avoid ESM module requirements for local files

// Global State
let currentData = [];
let currentTargetLang = 'Korean';

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

// Get API Key (Priority: Env -> localStorage -> Input)
const envKey = import.meta.env ? import.meta.env.VITE_GEMINI_API_KEY : null;
const storedKey = localStorage.getItem('GEMINI_API_KEY');

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

    // Price per million tokens: $0.5 input, $3 output
    const cost = ((inputTokens * 0.5) / 1000000) + ((outputTokens * 3) / 1000000);
    priceDisplay.textContent = `Estimated Price: $${cost.toFixed(4)}`;
}
if (translateBtn) {
    translateBtn.onclick = () => {
        const text = sourceText.value.trim();
        const targetLang = targetLangSelect.value;
        const instructions = customInstructions.value.trim();

        if (!text) return alert("Please enter some text to translate.");

        sessionStorage.setItem('MIARA_SOURCE_TEXT', text);
        sessionStorage.setItem('MIARA_TARGET_LANG', targetLang);
        sessionStorage.setItem('MIARA_INSTRUCTIONS', instructions);
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

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const arrayBuffer = e.target.result;
        mammoth.extractRawText({ arrayBuffer: arrayBuffer })
            .then(result => {
                sourceText.value = result.value;
                updatePriceEstimate(); // Update price after upload
            })
            .catch(err => {
                console.error("Error reading .docx file:", err);
                alert("Failed to read document. Please ensure it's a valid .docx file.");
            });
    };
    reader.readAsArrayBuffer(file);
}

// Page-specific Initialization
window.addEventListener('load', async () => {
    const path = window.location.pathname;
    if (path.includes('result.html')) {
        const text = sessionStorage.getItem('MIARA_SOURCE_TEXT');
        const targetLang = sessionStorage.getItem('MIARA_TARGET_LANG');
        const instructions = sessionStorage.getItem('MIARA_INSTRUCTIONS');

        if (text && targetLang) {
            currentTargetLang = targetLang;
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

    console.log(chunks);
    for (let i = 0; i < chunks.length; i++) {
        if (statusEl) statusEl.textContent = `Translating chunk ${i + 1} of ${chunks.length}...`;

        // Show skeleton for this chunk
        const skeletonId = `skeleton-${i}`;
        appendSkeleton(skeletonId);

        try {
            const result = await translateAndAlignRecursive(
                chunks[i],
                targetLang,
                envKey,
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
            Object.assign(dictionary, result.newProperNouns || {});
            previousText = chunks[i];

            // Store last ~1000 tokens (approx 4000 chars) of translation
            const currentTranslation = result.alignedRows.map(row => row.target).join(' ');
            previousTranslatedText = currentTranslation.slice(-4000);

            // Render and save
            appendChunkToUI(result.alignedRows);
            currentData = currentData.concat(result.alignedRows);
            sessionStorage.setItem('MIARA_TRANSLATION_DATA', JSON.stringify(currentData));
        } catch (error) {
            console.error('Streaming Error:', error);
            removeSkeleton(skeletonId); // Ensure removal on error
            if (statusEl) statusEl.textContent = "Error in translation.";
            break;
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
            sessionStorage.setItem('MIARA_TRANSLATION_DATA', JSON.stringify(currentData));
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

async function translateAndAlignRecursive(text, targetLanguage, apiKey, instructions, summary, dictionary, previousContext, previousTranslatedText) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    // Define Manual JSON Schema for Structured Output
    const jsonSchema = {
        type: "object",
        properties: {
            alignedRows: {
                type: "array",
                description: "List of aligned sentence pairs.",
                items: {
                    type: "object",
                    properties: {
                        source: { type: "string", description: "The original source sentence." },
                        target: { type: "string", description: "The translated sentence." },
                        newParagraph: { type: "boolean", description: "True if this sentence starts a new paragraph." }
                    },
                    required: ["source", "target"]
                }
            },
            newSummary: { type: "string", description: "Updated summary of the text content including this chunk." },
            newProperNouns: {
                type: "object",
                description: "Map of proper nouns to their translations.",
                nullable: true
            }
        },
        required: ["alignedRows", "newSummary"]
    };

    const prompt = `
        Translate the following text into ${targetLanguage}.

        CONTEXT:
        1. PREVIOUS SUMMARY: "${summary}"
        2. PREVIOUS SOURCE TEXT (last chunk): "${previousContext}"
        3. PREVIOUS TRANSLATED TEXT (for style/flow consistency): "${previousTranslatedText}"
        4. PROPER NOUN DICTIONARY: ${JSON.stringify(dictionary)}

        ${instructions ? `USER INSTRUCTIONS: "${instructions}"\n` : ""}

        TASK:
        - Translate accurately and align by sentence.
        - Use the dictionary to keep proper nouns/terms consistent.
        - The dictionary is formatted as {source_term: translated_term}. Output the translated_term when seeing instances of source_term.
        - Detect any NEW proper nouns or terms in this chunk.
        - Update the summary to include this chunk's key events/info.
        - Use the previous translated text's style, tense, and formality to ensure morphological consistency.
        - When translatin Korean or Japanese, focus on the sentence endings to ensure consistency. For example, if the previous translated text has sentences ending with ~다, the output sentences should also end with ~다.

        TEXT TO TRANSLATE:
        "${text}"
    `;

    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchema
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error('Gemini API Error');
    const result = await response.json();
    return JSON.parse(result.candidates[0].content.parts[0].text);
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
            sessionStorage.setItem('MIARA_TRANSLATION_DATA', JSON.stringify(currentData));
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

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${envKey}`;

        const prompt = `
            Task: Re-translate the following sentence into ${currentTargetLang}.
            
            Context Before:
            ${contextBefore}
            
            Target Sentence to Translate:
            ${sentenceToTranslate}
            
            Context After:
            ${contextAfter}
            
            IMPORTANT: Return ONLY the translated sentence, no extra text, no JSON. Just the translation.
        `;

        const body = {
            contents: [{ parts: [{ text: prompt }] }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) throw new Error('Regeneration failed');

        const result = await response.json();
        const newTranslation = result.candidates[0].content.parts[0].text.trim();

        // Update data and UI
        currentData[index].target = newTranslation;
        sessionStorage.setItem('MIARA_TRANSLATION_DATA', JSON.stringify(currentData));

        const targetElement = btn.closest('.alignment-row').querySelector('.target-item');
        targetElement.textContent = newTranslation;

    } catch (error) {
        console.error('Regenerate Error:', error);
        alert('Failed to regenerate sentence.');
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
