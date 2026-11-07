import { PHOTO_RESERVATION } from './photo-pricing.js';
import './book-page.css';
import './book-copy.js';
import { bookStore, bookPageMetadata } from './book-storage.js';
import { saveDraftValue, flushDraftStorage } from './draft-storage.js';
import { t } from './interface-i18n.js';
export function fittedDimensions(width,height) {
    if (!width || !height || width * height > 80_000_000) throw new Error('This photo is too large. Choose a smaller image.');
    const landscape = width >= height;
    const scale = Math.min(1,(landscape ? 1920 : 1080)/width,(landscape ? 1080 : 1920)/height);
    return [Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale))];
}
export async function normalizePhoto(file) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 20_000_000) throw new Error('Choose JPEG, PNG, or WebP photos smaller than 20 MB each.');
    const bitmap = await createImageBitmap(file,{imageOrientation:'from-image'});
    try {
        const [width,height] = fittedDimensions(bitmap.width,bitmap.height);
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff'; context.fillRect(0,0,width,height);
        context.drawImage(bitmap,0,0,width,height);
        return canvas.toDataURL('image/jpeg',0.9);
    } finally { bitmap.close(); }
}
async function request(path,payload) {
    const response = await fetch(path,payload === undefined ? {credentials:'same-origin'} : {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Photo transcription failed.');
    return result;
}
async function makeThumbnail(blob) {
    const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');
    const ratio=Math.min(128/bitmap.width,128/bitmap.height,1);canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not create page thumbnail.')),'image/jpeg',0.75));
}
export function setupPhotoUpload() {
    const source = document.getElementById('source-text');
    const wrap = document.querySelector('#upload-btn')?.parentElement;
    if (source && wrap) {
        wrap.classList.add('document-upload-actions');
        const link = document.createElement('a');
        link.href = 'book.html'; link.className = 'secondary-btn'; link.textContent = t('Upload book photos');
        link.addEventListener('click', async event => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            try {
                for (const [id,key] of [['source-text','SHIROKO_SOURCE_TEXT'],['target-lang','SHIROKO_TARGET_LANG'],['custom-instructions','SHIROKO_INSTRUCTIONS'],['existing-translation','SHIROKO_EXISTING_TRANSLATION']]) {
                    const field = document.getElementById(id); if(field) saveDraftValue(key,field.value);
                }
                await flushDraftStorage(); location.assign(link.href);
            } catch { link.textContent = 'Could not save draft. Try again.'; }
        });
        wrap.append(link);
    }
    const dialog = document.getElementById('book-editor');
    if (!dialog) return;
    dialog.innerHTML = `<div class="book-heading"><div><h1 id="book-title">${t('Book & essay photos')}</h1><p>Import page photos, read their text, then send your book to the translation editor.</p></div><a class="secondary-btn" href="app.html">Back to editor</a></div><p>${t('Import a whole book, review each page, and arrange its reading order. Photos are stored in this browser. Recognized text is cached on our server to prevent duplicate charges. All paid plans include photo transcription.')}</p><label for="book-files">${t('Add page photos')}</label><input id="book-files" type="file" multiple accept="image/jpeg,image/png,image/webp"><details class="book-allowance"><summary>Transcription allowance</summary><p>${t('Photos are resized to FHD before OCR. Transcription initially reserves 1,536 allowance tokens per page, then charges 512 plus recognized text tokens. Dense pages may need additional allowance. Unused tokens are returned. Translation uses additional allowance at your selected speed.')}</p></details><p id="book-estimate" role="status"></p><div class="book-actions"><button id="book-sort" type="button" class="secondary-btn">${t('Sort by filename')}</button><button id="book-clear" type="button" class="secondary-btn">${t('New book')}</button><button id="book-read" type="button" class="button button-dark">${t('Read unprocessed pages')}</button><button id="book-pause" type="button" class="secondary-btn" disabled>${t('Pause after this page')}</button><button id="book-retry" type="button" class="secondary-btn">${t('Retry failed pages')}</button><button id="book-use" type="button" class="button button-dark">${t('Use book text')}</button><button id="book-download" type="button" class="secondary-btn">${t('Download text')}</button></div><p id="book-status" role="status" aria-live="polite"></p><div class="book-workspace"><div class="book-page-list"><h2>Pages</h2><p class="book-empty">Add JPEG, PNG, or WebP photos to get started. Select a page to review its image and edit its text.</p><ol id="book-pages" class="book-pages" aria-label="Book page order"></ol></div><section class="book-preview" hidden><h3 id="book-page-title"></h3><div class="book-review-columns"><img id="book-image" alt="Selected book page"><div class="book-text-column"><label for="book-page-text">${t('Page text — editable')}</label><textarea id="book-page-text" dir="auto" data-no-localize rows="14"></textarea></div></div><div class="book-actions"><button id="book-up" type="button" class="secondary-btn">${t('Move up')}</button><button id="book-down" type="button" class="secondary-btn">${t('Move down')}</button><label>${t('Position')} <input id="book-position" type="number" min="1" style="width:5rem"></label><button id="book-move" type="button" class="secondary-btn">${t('Move')}</button><button id="book-rotate" type="button" class="secondary-btn">${t('Rotate 90°')}</button><button id="book-remove" type="button" class="secondary-btn">${t('Remove page')}</button></div></section></div>`;

    const el = id => dialog.querySelector(`#book-${id}`);
    const thumbnailURLs = new Set();
    let thumbObserver;
    let pages = [], selected = null, previewURL = null, running = false, importing = false, pause = false, loaded = false, saveTimer;
    const message = text => {el('status').textContent = text;};
    const saveOrder = () => bookStore('meta','put',pages.map(page=>page.id),'order');
    async function persistPage(page) {await bookStore('pages','put',page);}
    async function load() {
        if (loaded) return;
        const all = await bookPageMetadata();
        const order = await bookStore('meta','get','order') || [];
        // Recover imported pages even if the browser closed before saving the order.
        const byId = new Map(all.map(page=>[page.id,page]));
        pages = [...order.filter(id=>byId.has(id)),...all.map(page=>page.id).filter(id=>!order.includes(id))].map(id=>{const {blob,thumbnailBlob,...meta}=byId.get(id); return meta;});
        for (const page of pages) if (page.status === 'reading') {page.status='pending'; await update(page);}
        loaded=true; render();
    }
    async function update(page) {
        const stored = await bookStore('pages','get',page.id);
        await persistPage({...stored,...page});
    }
    function controls() {
        el('files').disabled=running||importing;
        el('page-text').disabled=running;
        el('read').disabled=running||importing||!pages.some(p=>!['done','error'].includes(p.status));
        el('pause').disabled=!running;
        el('retry').disabled=running||importing||!pages.some(p=>p.status==='error');
        for (const id of ['up','down','move','rotate','remove','sort','clear']) el(id).disabled=running||importing;
        el('use').disabled=running||importing||!pages.some(p=>p.text?.trim());
        el('download').disabled=!pages.some(p=>p.text?.trim());
    }
    function render() {
        thumbObserver?.disconnect();
        for(const url of thumbnailURLs) URL.revokeObjectURL(url); thumbnailURLs.clear();
        el('pages').replaceChildren();
        thumbObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const image=entry.target;thumbObserver.unobserve(image);void bookStore('pages','get',image.dataset.pageId).then(page=>{if(!image.isConnected||!page?.thumbnailBlob)return;const url=URL.createObjectURL(page.thumbnailBlob);thumbnailURLs.add(url);image.src=url;}).catch(()=>{});}},{root:el('pages'),rootMargin:'150px'});
        pages.forEach((page,index)=>{
            const item=document.createElement('li'), pick=document.createElement('button');
            pick.type='button'; pick.textContent=`${index+1}. ${page.name} · ${page.status}`; pick.className='secondary-btn';
            pick.setAttribute('aria-current',String(page.id===selected)); pick.setAttribute('data-no-localize','');
            const thumbnail=document.createElement('img');thumbnail.alt='';thumbnail.width=56;thumbnail.height=72;thumbnail.dataset.pageId=page.id;pick.prepend(thumbnail);thumbObserver.observe(thumbnail);
            pick.addEventListener('click',()=>{void select(page.id).catch(error=>message(error.message));});
            item.append(pick); item.draggable=!running&&!importing;
            item.addEventListener('dragstart',event=>event.dataTransfer.setData('text/plain',page.id));
            item.addEventListener('dragover',event=>event.preventDefault());
            item.addEventListener('drop',event=>{event.preventDefault(); const id=event.dataTransfer.getData('text/plain'); if(!running&&!importing&&pages.some(p=>p.id===id)) void move(id,index).catch(error=>message(error.message));});
            el('pages').append(item);
        });
        const pending=pages.filter(p=>p.status!=='done').length, done=pages.length-pending;
        dialog.classList.toggle('has-pages',pages.length>0);
        el('estimate').textContent=`${pages.length} pages · ${done} read · estimated ${(pending*PHOTO_RESERVATION).toLocaleString()} allowance tokens for remaining pages`;
        controls();
    }
    async function flushText() {
        clearTimeout(saveTimer);
        const page=pages.find(p=>p.id===selected);
        if(page) {page.text=el('page-text').value; await update(page); controls();}
    }
    async function select(id) {
        if(selected) await flushText();
        selected=id; const page=pages.find(p=>p.id===id); if(!page)return;
        const stored=await bookStore('pages','get',id);
        if(previewURL) URL.revokeObjectURL(previewURL);
        previewURL=URL.createObjectURL(stored.blob); el('image').src=previewURL;
        el('page-title').textContent=`${pages.indexOf(page)+1}. ${page.name}`;
        el('page-title').setAttribute('data-no-localize','');
        el('page-text').value=page.text||''; el('position').value=pages.indexOf(page)+1;
        dialog.querySelector('.book-preview').hidden=false; if(page.error)message(page.error); render();
    }
    async function move(id,index) {
        const from=pages.findIndex(p=>p.id===id); if(from<0)return;
        pages.splice(Math.max(0,Math.min(pages.length-1,index)),0,pages.splice(from,1)[0]);
        await saveOrder(); render(); if(selected)await select(selected);
    }
    async function initialize() { try{await load();if(pages.length)await select(pages[0].id); const {user}=await request('/api/me'); message(user?.subscription?.active?`Available allowance: ${((user.subscription.remainingTokens||0)+(user.subscription.prepaidTokens||0)+Math.floor((user.balanceMicros||0)/50)).toLocaleString()} tokens` : t('Photo transcription requires an active paid subscription. You can import and arrange pages now.'));}catch(error){message(error.message);}}
    void initialize();
    el('files').addEventListener('change',async()=>{
        importing=true; controls(); let added=0;
        try {
            for(const file of el('files').files) {
                message(`Preparing page ${added+1} of ${el('files').files.length}…`);
                const dataURL=await normalizePhoto(file), blob=await (await fetch(dataURL)).blob();
                const page={id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:file.name,status:'pending',text:'',createdAt:Date.now()};
                const thumbnailBlob = await makeThumbnail(blob);
                await persistPage({...page,blob,thumbnailBlob}); pages.push(page); added++; await saveOrder();
            }
            message(`${added} pages saved in this browser. Arrange pages before transcription.`);
        }catch(error){message(`${error.message} ${added} pages were saved; you can continue with those pages.`);}
        finally{importing=false;el('files').value='';render();if(!selected&&pages.length)await select(pages[0].id);}
    });
    async function readPages(retry=false) {
        if(running||importing)return; await flushText();
        if(retry) for(const page of pages)if(page.status==='error'){page.status='pending';await update(page);}
        running=true;pause=false;controls();
        try {
            for(const page of pages) {
                if(pause)break; if(['done','error'].includes(page.status))continue;
                const {user}=await request('/api/me');
                if(!user?.subscription?.active)throw new Error('An active paid subscription is required to read photos.');
                if((user.subscription.remainingTokens||0)+(user.subscription.prepaidTokens||0)+Math.floor((user.balanceMicros||0)/50)<PHOTO_RESERVATION){message('Paused: at least 1,536 available allowance tokens are required for the next page. Your progress is saved.');break;}
                page.status='reading';await update(page);render(); message(`Reading page ${pages.indexOf(page)+1} of ${pages.length}…`);
                try {
                    const stored=await bookStore('pages','get',page.id);
                    const dataURL=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(stored.blob);});
                    page.requestId ||= crypto.randomUUID(); await update(page);
                    const result=await request('/api/ocr',{photos:[dataURL],requestId:page.requestId});
                    page.text=result.text;page.status='done';page.tokens=result.tokens;delete page.error;
                    window.dispatchEvent(new CustomEvent('shiroko:account-updated',{detail:result}));
                    if(selected===page.id)el('page-text').value=page.text;
                }catch(error){page.status='error';page.error=error.message;message(`Page ${pages.indexOf(page)+1}: ${error.message}`);}
                await update(page);render();
            }
        }catch(error){message(error.message);}
        finally{running=false;render();const errors=pages.filter(p=>p.status==='error').length;if(!pages.some(p=>p.status==='pending'))message(errors?`${errors} pages need attention. Select a failed page to inspect it, then retry.`:'All pages are ready. Review their text and use the book text to translate.');else if(pause)message('Paused. Your pages and progress are saved.');}
    }
    el('read').addEventListener('click',()=>void readPages());el('retry').addEventListener('click',()=>void readPages(true));
    el('pause').addEventListener('click',()=>{pause=true;message('Pausing after the current page…');});
    el('page-text').addEventListener('input',()=>{clearTimeout(saveTimer);saveTimer=setTimeout(()=>void flushText().catch(error=>message(error.message)),300);});
    for(const [id,delta] of [['up',-1],['down',1]])el(id).addEventListener('click',()=>void move(selected,pages.findIndex(p=>p.id===selected)+delta).catch(error=>message(error.message)));
    el('move').addEventListener('click',()=>void move(selected,Number(el('position').value)-1).catch(error=>message(error.message)));
    el('sort').addEventListener('click',async()=>{if(running||importing)return;pages.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));await saveOrder();render();if(selected)await select(selected);});
    el('clear').addEventListener('click',async()=>{if(running||importing||!confirm(t('Remove all book photos and page drafts from this browser? Download the text first if you need it.')))return;try{await bookStore('pages','clear');pages=[];selected=null;if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}await saveOrder();dialog.querySelector('.book-preview').hidden=true;message(t('Start a new book by adding page photos.'));render();}catch(error){message(error.message);}});
    el('remove').addEventListener('click',async()=>{try{await bookStore('pages','delete',selected);pages=pages.filter(p=>p.id!==selected);selected=null;await saveOrder();dialog.querySelector('.book-preview').hidden=true;if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}render();}catch(error){message(error.message);}});
    el('rotate').addEventListener('click',async()=>{
        const page=pages.find(p=>p.id===selected);if(!page)return;
        try{const stored=await bookStore('pages','get',page.id),bitmap=await createImageBitmap(stored.blob);const canvas=document.createElement('canvas');canvas.width=bitmap.height;canvas.height=bitmap.width;const ctx=canvas.getContext('2d');ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(Math.PI/2);ctx.drawImage(bitmap,-bitmap.width/2,-bitmap.height/2);bitmap.close();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));if(!blob)throw new Error('Could not rotate this photo.');page.requestId=crypto.randomUUID();await persistPage({...stored,...page,blob,thumbnailBlob:await makeThumbnail(blob)});await select(page.id);}catch(error){message(error.message);}
    });
    const assembled=()=>pages.filter(page=>page.text?.trim()).map(page=>page.text.trim()).join('\n\n');
    el('use').addEventListener('click',async()=>{try{await flushText();const missing=pages.filter(p=>!p.text?.trim()).length;if(missing){message(`${missing} pages have no text. Read, edit, or remove them before using the whole book.`);return;}const text=assembled();saveDraftValue('SHIROKO_SOURCE_TEXT',text);await flushDraftStorage();location.assign('app.html');}catch(error){message(error.message);}});
    el('download').addEventListener('click',async()=>{try{await flushText();const url=URL.createObjectURL(new Blob([assembled()],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='shiroko-book.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){message(error.message);}});
    window.addEventListener('pagehide',()=>{if(previewURL)URL.revokeObjectURL(previewURL);});
}
if(typeof document!=='undefined')setupPhotoUpload();
