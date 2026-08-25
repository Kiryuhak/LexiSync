import { deletePrivateRecord, readPrivateRecord, writePrivateRecord } from './extension-db';

const API_KEY_RECORD = 'mistralApiKey';
const GROQ_API_KEY_RECORD = 'groqApiKey';

export async function getStoredApiKey(): Promise<string> {
    return (await readPrivateRecord<string>('secrets', API_KEY_RECORD)) || '';
}

export async function setStoredApiKey(value: string): Promise<void> {
    const normalized = value.trim();
    if (!normalized) {
        await deletePrivateRecord('secrets', API_KEY_RECORD);
        return;
    }
    if (normalized.length > 512) throw new Error('API_KEY_TOO_LONG');
    await writePrivateRecord('secrets', API_KEY_RECORD, normalized);
}

export async function getStoredGroqApiKey(): Promise<string> {
    return (await readPrivateRecord<string>('secrets', GROQ_API_KEY_RECORD)) || '';
}

export async function setStoredGroqApiKey(value: string): Promise<void> {
    const normalized = value.trim();
    if (!normalized) {
        await deletePrivateRecord('secrets', GROQ_API_KEY_RECORD);
        return;
    }
    if (normalized.length > 512) throw new Error('API_KEY_TOO_LONG');
    await writePrivateRecord('secrets', GROQ_API_KEY_RECORD, normalized);
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
