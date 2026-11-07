let opened;
export function bookDatabase() {
    return opened ||= new Promise((resolve,reject) => {
        const request = indexedDB.open('shiroko-books',1);
        request.onupgradeneeded = () => {request.result.createObjectStore('pages',{keyPath:'id'}); request.result.createObjectStore('meta');};
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Browser storage is unavailable. Enable site storage to import a book.'));
    });
}
export async function bookStore(store,method,value,key) {
    const db = await bookDatabase();
    return new Promise((resolve,reject) => {
        const tx = db.transaction(store,method === 'get' || method === 'getAll' ? 'readonly' : 'readwrite');
        const request = key === undefined ? tx.objectStore(store)[method](value) : tx.objectStore(store)[method](value,key);
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () => reject(new Error('Book storage failed or is full. Your previously saved pages remain available.'));
    });
}
export async function bookPageMetadata() {
    const db = await bookDatabase();
    return new Promise((resolve,reject) => {
        const tx = db.transaction('pages','readonly'), pages=[];
        const request=tx.objectStore('pages').openCursor();
        request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const {blob,thumbnailBlob,...metadata}=cursor.value;pages.push(metadata);cursor.continue();};
        tx.oncomplete=()=>resolve(pages);
        tx.onerror=()=>reject(new Error('Could not load saved book pages.'));
    });
}
