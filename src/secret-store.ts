import { deletePrivateRecord, readPrivateRecord, writePrivateRecord } from './extension-db';
import { invalidateGigaChatToken } from './gigachat-token-manager';

const API_KEY_RECORD = 'mistralApiKey';
const GIGACHAT_AUTH_KEY_RECORD = 'gigachatAuthKey';
const LEGACY_GROQ_RECORD = 'groqApiKey';

let mistralApiKeyCache: string | undefined;
let gigaChatAuthKeyCache: string | undefined;
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
        mistralApiKeyCache = normalized;
    });
}

export async function getStoredGigaChatAuthKey(): Promise<string> {
    await pendingSecretWrite;
    if (gigaChatAuthKeyCache !== undefined) return gigaChatAuthKeyCache;
    gigaChatAuthKeyCache = (await readPrivateRecord<string>('secrets', GIGACHAT_AUTH_KEY_RECORD)) || '';
    return gigaChatAuthKeyCache;
}

export async function setStoredGigaChatAuthKey(value: string): Promise<void> {
    const normalized = value.trim();
    if (normalized.length > 1024) throw new Error('API_KEY_TOO_LONG');
    await queueSecretWrite(async () => {
        if (normalized) await writePrivateRecord('secrets', GIGACHAT_AUTH_KEY_RECORD, normalized);
        else await deletePrivateRecord('secrets', GIGACHAT_AUTH_KEY_RECORD);
        gigaChatAuthKeyCache = normalized;
        await invalidateGigaChatToken();
    });
}

export async function migrateApiKeyToSecretStore(): Promise<void> {
    const stored = await chrome.storage.local.get({
        mistralApiKey: '',
        gigachatAuthKey: '',
        groqApiKey: '',
    });

    const legacyMistralKey = typeof stored.mistralApiKey === 'string' ? stored.mistralApiKey.trim() : '';
    if (legacyMistralKey && !(await getStoredApiKey())) await setStoredApiKey(legacyMistralKey);
    if ('mistralApiKey' in stored) await chrome.storage.local.remove('mistralApiKey');

    const legacyGigaChatKey = typeof stored.gigachatAuthKey === 'string' ? stored.gigachatAuthKey.trim() : '';
    if (legacyGigaChatKey && !(await getStoredGigaChatAuthKey())) await setStoredGigaChatAuthKey(legacyGigaChatKey);
    if ('gigachatAuthKey' in stored) await chrome.storage.local.remove('gigachatAuthKey');

    // Очистка устаревших ключей Groq из storage и IndexedDB
    if ('groqApiKey' in stored) await chrome.storage.local.remove('groqApiKey');
    await deletePrivateRecord('secrets', LEGACY_GROQ_RECORD);
}

export async function clearAllSecrets(): Promise<void> {
    await queueSecretWrite(async () => {
        await deletePrivateRecord('secrets', API_KEY_RECORD);
        await deletePrivateRecord('secrets', GIGACHAT_AUTH_KEY_RECORD);
        await deletePrivateRecord('secrets', LEGACY_GROQ_RECORD);
        mistralApiKeyCache = '';
        gigaChatAuthKeyCache = '';
        await invalidateGigaChatToken();
    });
}
