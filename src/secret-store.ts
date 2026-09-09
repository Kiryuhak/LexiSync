import { deletePrivateRecord, readPrivateRecord, writePrivateRecord } from './extension-db';
import type { CloudflareCredentials } from './ai-provider-types';

const API_KEY_RECORD = 'mistralApiKey';
const CLOUDFLARE_API_TOKEN_RECORD = 'cloudflareApiToken';
const CLOUDFLARE_ACCOUNT_ID_RECORD = 'cloudflareAccountId';
const GOOGLE_DRIVE_TOKEN_RECORD = 'googleDriveAccessToken';
const LEGACY_GIGACHAT_RECORD = 'gigachatAuthKey';
const LEGACY_GROQ_RECORD = 'groqApiKey';

let mistralApiKeyCache: string | undefined;
let cloudflareApiTokenCache: string | undefined;
let cloudflareAccountIdCache: string | undefined;
let googleDriveTokenCache: string | undefined;
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

export async function getStoredCloudflareApiToken(): Promise<string> {
    await pendingSecretWrite;
    if (cloudflareApiTokenCache !== undefined) return cloudflareApiTokenCache;
    cloudflareApiTokenCache = (await readPrivateRecord<string>('secrets', CLOUDFLARE_API_TOKEN_RECORD)) || '';
    return cloudflareApiTokenCache;
}

export async function setStoredCloudflareApiToken(value: string): Promise<void> {
    const normalized = value.trim();
    if (normalized.length > 1024) throw new Error('API_KEY_TOO_LONG');
    await queueSecretWrite(async () => {
        if (normalized) await writePrivateRecord('secrets', CLOUDFLARE_API_TOKEN_RECORD, normalized);
        else await deletePrivateRecord('secrets', CLOUDFLARE_API_TOKEN_RECORD);
        cloudflareApiTokenCache = normalized;
    });
}

export async function getStoredCloudflareAccountId(): Promise<string> {
    await pendingSecretWrite;
    if (cloudflareAccountIdCache !== undefined) return cloudflareAccountIdCache;
    cloudflareAccountIdCache = (await readPrivateRecord<string>('secrets', CLOUDFLARE_ACCOUNT_ID_RECORD)) || '';
    return cloudflareAccountIdCache;
}

export async function setStoredCloudflareAccountId(value: string): Promise<void> {
    const normalized = value.trim();
    if (normalized.length > 512) throw new Error('ACCOUNT_ID_TOO_LONG');
    await queueSecretWrite(async () => {
        if (normalized) await writePrivateRecord('secrets', CLOUDFLARE_ACCOUNT_ID_RECORD, normalized);
        else await deletePrivateRecord('secrets', CLOUDFLARE_ACCOUNT_ID_RECORD);
        cloudflareAccountIdCache = normalized;
    });
}

export async function getStoredCloudflareCredentials(): Promise<CloudflareCredentials> {
    const [accountId, apiToken] = await Promise.all([getStoredCloudflareAccountId(), getStoredCloudflareApiToken()]);
    return { accountId, apiToken };
}

export async function setStoredCloudflareCredentials(credentials: CloudflareCredentials): Promise<void> {
    await Promise.all([
        setStoredCloudflareAccountId(credentials.accountId || ''),
        setStoredCloudflareApiToken(credentials.apiToken || ''),
    ]);
}

export async function getStoredGoogleDriveToken(): Promise<string> {
    await pendingSecretWrite;
    if (googleDriveTokenCache !== undefined) return googleDriveTokenCache;
    googleDriveTokenCache = (await readPrivateRecord<string>('secrets', GOOGLE_DRIVE_TOKEN_RECORD)) || '';
    return googleDriveTokenCache;
}

export async function setStoredGoogleDriveToken(value: string): Promise<void> {
    const normalized = value.trim();
    if (normalized.length > 4096) throw new Error('API_KEY_TOO_LONG');
    await queueSecretWrite(async () => {
        if (normalized) await writePrivateRecord('secrets', GOOGLE_DRIVE_TOKEN_RECORD, normalized);
        else await deletePrivateRecord('secrets', GOOGLE_DRIVE_TOKEN_RECORD);
        googleDriveTokenCache = normalized;
    });
}

export async function migrateApiKeyToSecretStore(): Promise<void> {
    // Очистка старого кэша GigaChat и Groq из storage.local
    await chrome.storage.local.remove([
        '_gigachat_token_cache',
        'gigachatAuthKey',
        'gigachatAccessToken',
        'gigachatExpiresAt',
        'groqApiKey',
    ]);

    const stored = await chrome.storage.local.get({
        mistralApiKey: '',
        cloudflareApiToken: '',
        cloudflareAccountId: '',
        googleDriveToken: '',
    });

    const legacyMistralKey = typeof stored.mistralApiKey === 'string' ? stored.mistralApiKey.trim() : '';
    if (legacyMistralKey && !(await getStoredApiKey())) await setStoredApiKey(legacyMistralKey);
    if ('mistralApiKey' in stored) await chrome.storage.local.remove('mistralApiKey');

    const legacyCfToken = typeof stored.cloudflareApiToken === 'string' ? stored.cloudflareApiToken.trim() : '';
    if (legacyCfToken && !(await getStoredCloudflareApiToken())) await setStoredCloudflareApiToken(legacyCfToken);
    if ('cloudflareApiToken' in stored) await chrome.storage.local.remove('cloudflareApiToken');

    const legacyCfAccount = typeof stored.cloudflareAccountId === 'string' ? stored.cloudflareAccountId.trim() : '';
    if (legacyCfAccount && !(await getStoredCloudflareAccountId())) await setStoredCloudflareAccountId(legacyCfAccount);
    if ('cloudflareAccountId' in stored) await chrome.storage.local.remove('cloudflareAccountId');

    const legacyDriveToken = typeof stored.googleDriveToken === 'string' ? stored.googleDriveToken.trim() : '';
    if (legacyDriveToken && !(await getStoredGoogleDriveToken())) await setStoredGoogleDriveToken(legacyDriveToken);
    if ('googleDriveToken' in stored) await chrome.storage.local.remove('googleDriveToken');

    // Очистка устаревших ключей из приватной IndexedDB
    await deletePrivateRecord('secrets', LEGACY_GIGACHAT_RECORD);
    await deletePrivateRecord('secrets', LEGACY_GROQ_RECORD);
}

export async function clearAllSecrets(): Promise<void> {
    await queueSecretWrite(async () => {
        await deletePrivateRecord('secrets', API_KEY_RECORD);
        await deletePrivateRecord('secrets', CLOUDFLARE_API_TOKEN_RECORD);
        await deletePrivateRecord('secrets', CLOUDFLARE_ACCOUNT_ID_RECORD);
        await deletePrivateRecord('secrets', GOOGLE_DRIVE_TOKEN_RECORD);
        await deletePrivateRecord('secrets', LEGACY_GIGACHAT_RECORD);
        await deletePrivateRecord('secrets', LEGACY_GROQ_RECORD);
        mistralApiKeyCache = '';
        cloudflareApiTokenCache = '';
        cloudflareAccountIdCache = '';
        googleDriveTokenCache = '';
    });
}
