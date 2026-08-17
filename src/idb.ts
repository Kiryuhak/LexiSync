export function openDatabase(
    name: string,
    version: number,
    upgradeCallback: (db: IDBDatabase, oldVersion: number, newVersion: number | null) => void,
): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = (event) => {
            const db = request.result;
            upgradeCallback(db, event.oldVersion, event.newVersion);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IDB_OPEN_FAILED'));
        request.onblocked = () => reject(new Error('IDB_OPEN_BLOCKED'));
    });
}

export function idbGet<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(request.error || new Error('IDB_GET_FAILED'));
        transaction.onerror = () => reject(transaction.error || new Error('IDB_TRANSACTION_FAILED'));
        transaction.onabort = () => reject(transaction.error || new Error('IDB_TRANSACTION_ABORTED'));
    });
}

export function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve((request.result as T[]) || []);
        request.onerror = () => reject(request.error || new Error('IDB_GET_ALL_FAILED'));
        transaction.onerror = () => reject(transaction.error || new Error('IDB_TRANSACTION_FAILED'));
        transaction.onabort = () => reject(transaction.error || new Error('IDB_TRANSACTION_ABORTED'));
    });
}

export function idbPut<T = unknown>(db: IDBDatabase, storeName: string, value: T): Promise<IDBValidKey> {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(value);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IDB_PUT_FAILED'));
        transaction.onerror = () => reject(transaction.error || new Error('IDB_TRANSACTION_FAILED'));
        transaction.onabort = () => reject(transaction.error || new Error('IDB_TRANSACTION_ABORTED'));
    });
}

export function idbDelete(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('IDB_DELETE_FAILED'));
        transaction.onerror = () => reject(transaction.error || new Error('IDB_TRANSACTION_FAILED'));
        transaction.onabort = () => reject(transaction.error || new Error('IDB_TRANSACTION_ABORTED'));
    });
}

export function idbClear(db: IDBDatabase, storeName: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('IDB_CLEAR_FAILED'));
        transaction.onerror = () => reject(transaction.error || new Error('IDB_TRANSACTION_FAILED'));
        transaction.onabort = () => reject(transaction.error || new Error('IDB_TRANSACTION_ABORTED'));
    });
}
