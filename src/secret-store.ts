import { deletePrivateRecord, readPrivateRecord, writePrivateRecord } from './extension-db';

const API_KEY_RECORD = 'mistralApiKey';
const GROQ_API_KEY_RECORD = 'groqApiKey';

let mistralApiKeyCache: string | undefined;
let groqApiKeyCache: string | undefined;
let pendingSecretWrite: Promise<void> = Promise.resolve();

function queueSecretWrite(operation: () => Promise<void>): Promise<void> {
    const queued = pendingSecretWrite.then(operation, operation);
    pendingSecretWrite = queued.catch(() => undefined);
    return queued;
}

export async function getStoredApiKey(): Promise<string> {
    await pendingSecretWrite;
    if (mistralApiKeyCache !== undefined) return mistralApiKeyCache;
    mistralApiKeyCache = (await readPrivateRecord<string>('secrets', API_KEY_RECORD)) || '';
    return mistralApiKeyCache;
}

export async function setStoredApiKey(value: string): Promise<void> {
    const normalized = value.trim();
    if (normalized.length > 512) throw new Error('API_KEY_TOO_LONG');
    await queueSecretWrite(async () => {
        if (normalized) await writePrivateRecord('secrets', API_KEY_RECORD, normalized);
        else await deletePrivateRecord('secrets', API_KEY_RECORD);
        // Обновляем снимок только после завершения транзакции IndexedDB.
        // Следующий AI-запрос гарантированно получит уже сохранённый ключ.
        mistralApiKeyCache = normalized;
    });
}

export async function getStoredGroqApiKey(): Promise<string> {
    await pendingSecretWrite;
    if (groqApiKeyCache !== undefined) return groqApiKeyCache;
    groqApiKeyCache = (await readPrivateRecord<string>('secrets', GROQ_API_KEY_RECORD)) || '';
    return groqApiKeyCache;
}

export async function setStoredGroqApiKey(value: string): Promise<void> {
    const normalized = value.trim();
    if (normalized.length > 512) throw new Error('API_KEY_TOO_LONG');
    await queueSecretWrite(async () => {
        if (normalized) await writePrivateRecord('secrets', GROQ_API_KEY_RECORD, normalized);
        else await deletePrivateRecord('secrets', GROQ_API_KEY_RECORD);
        groqApiKeyCache = normalized;
    });
}

export async function migrateApiKeyToSecretStore(): Promise<void> {
    const stored = await chrome.storage.local.get({ mistralApiKey: '', groqApiKey: '' });
    const legacyKey = typeof stored.mistralApiKey === 'string' ? stored.mistralApiKey.trim() : '';
    if (legacyKey && !(await getStoredApiKey())) await setStoredApiKey(legacyKey);
    if ('mistralApiKey' in stored) await chrome.storage.local.remove('mistralApiKey');

    const legacyGroqKey = typeof stored.groqApiKey === 'string' ? stored.groqApiKey.trim() : '';
    if (legacyGroqKey && !(await getStoredGroqApiKey())) await setStoredGroqApiKey(legacyGroqKey);
    if ('groqApiKey' in stored) await chrome.storage.local.remove('groqApiKey');
}

export async function clearAllSecrets(): Promise<void> {
    await queueSecretWrite(async () => {
        await deletePrivateRecord('secrets', API_KEY_RECORD);
        await deletePrivateRecord('secrets', GROQ_API_KEY_RECORD);
        mistralApiKeyCache = '';
        groqApiKeyCache = '';
    });
}
