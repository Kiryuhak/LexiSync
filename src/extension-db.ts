const DATABASE_NAME = 'lexisync-private';
const DATABASE_VERSION = 1;
export type PrivateStoreName = 'secrets' | 'batchJobs';

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains('secrets')) database.createObjectStore('secrets');
            if (!database.objectStoreNames.contains('batchJobs')) database.createObjectStore('batchJobs');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Не удалось открыть приватное хранилище LexiSync.'));
        request.onblocked = () => reject(new Error('Обновление приватного хранилища LexiSync заблокировано.'));
    });
    return databasePromise;
}

export async function readPrivateRecord<T>(storeName: PrivateStoreName, key: IDBValidKey): Promise<T | undefined> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(request.error || new Error('Не удалось прочитать приватные данные.'));
    });
}

export async function writePrivateRecord<T>(storeName: PrivateStoreName, key: IDBValidKey, value: T): Promise<void> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Не удалось сохранить приватные данные.'));
        transaction.onabort = () => reject(transaction.error || new Error('Сохранение приватных данных отменено.'));
    });
}

export async function deletePrivateRecord(storeName: PrivateStoreName, key: IDBValidKey): Promise<void> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Не удалось удалить приватные данные.'));
    });
}
