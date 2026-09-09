import { exportPortableSettings, importPortableSettings } from './settings-transfer';
import {
    getStoredApiKey,
    getStoredCloudflareCredentials,
    setStoredApiKey,
    setStoredCloudflareCredentials,
} from './secret-store';

export interface EncryptedBackupPackage {
    format: 'lexisync-encrypted-backup';
    version: 1;
    createdAt: string;
    kdf: {
        name: 'PBKDF2';
        iterations: number;
        hash: 'SHA-256';
        salt: string;
    };
    cipher: {
        algorithm: 'AES-GCM';
        iv: string;
        data: string;
    };
}

export interface BackupPayload {
    version: 1;
    createdAt: string;
    settings: Record<string, unknown>;
    secrets: {
        mistralApiKey?: string;
        cloudflareAccountId?: string;
        cloudflareApiToken?: string;
    };
}

export interface RestoreResult {
    settingsCount: number;
    hasMistralKey: boolean;
    hasCloudflareCreds: boolean;
    createdAt: string;
}

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTE_LENGTH = 16;
const IV_BYTE_LENGTH = 12;

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);

    return await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as BufferSource,
            iterations,
            hash: 'SHA-256',
        },
        passwordKey,
        {
            name: 'AES-GCM',
            length: 256,
        },
        false,
        ['encrypt', 'decrypt'],
    );
}

export async function encryptBackupPayload(
    payload: BackupPayload,
    masterPassword: string,
): Promise<EncryptedBackupPackage> {
    if (!masterPassword || masterPassword.trim().length === 0) {
        throw new Error('EMPTY_PASSWORD');
    }

    const salt = new Uint8Array(SALT_BYTE_LENGTH);
    crypto.getRandomValues(salt);

    const iv = new Uint8Array(IV_BYTE_LENGTH);
    crypto.getRandomValues(iv);

    const aesKey = await deriveAesKey(masterPassword, salt, PBKDF2_ITERATIONS);
    const serializedPayload = JSON.stringify(payload);
    const encodedPayload = new TextEncoder().encode(serializedPayload);

    const encryptedBuffer = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv,
        },
        aesKey,
        encodedPayload,
    );

    return {
        format: 'lexisync-encrypted-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        kdf: {
            name: 'PBKDF2',
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
            salt: bytesToBase64(salt),
        },
        cipher: {
            algorithm: 'AES-GCM',
            iv: bytesToBase64(iv),
            data: bytesToBase64(new Uint8Array(encryptedBuffer)),
        },
    };
}

export async function decryptBackupPayload(
    pkg: EncryptedBackupPackage,
    masterPassword: string,
): Promise<BackupPayload> {
    if (!masterPassword || masterPassword.trim().length === 0) {
        throw new Error('EMPTY_PASSWORD');
    }
    if (!pkg || pkg.format !== 'lexisync-encrypted-backup' || pkg.version !== 1) {
        throw new Error('UNSUPPORTED_FORMAT');
    }
    if (!pkg.kdf || !pkg.cipher || !pkg.kdf.salt || !pkg.cipher.iv || !pkg.cipher.data) {
        throw new Error('CORRUPTED_BACKUP');
    }

    const salt = base64ToBytes(pkg.kdf.salt);
    const iv = base64ToBytes(pkg.cipher.iv);
    const ciphertext = base64ToBytes(pkg.cipher.data);

    const aesKey = await deriveAesKey(masterPassword, salt, pkg.kdf.iterations || PBKDF2_ITERATIONS);

    let decryptedBuffer: ArrayBuffer;
    try {
        decryptedBuffer = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv as BufferSource,
            },
            aesKey,
            ciphertext as BufferSource,
        );
    } catch {
        throw new Error('INVALID_PASSWORD');
    }

    try {
        const decodedText = new TextDecoder().decode(decryptedBuffer);
        const parsed = JSON.parse(decodedText) as BackupPayload;
        if (!parsed || parsed.version !== 1 || typeof parsed.settings !== 'object') {
            throw new Error('CORRUPTED_BACKUP');
        }
        return parsed;
    } catch (err) {
        if (err instanceof Error && err.message === 'CORRUPTED_BACKUP') throw err;
        throw new Error('CORRUPTED_BACKUP', { cause: err });
    }
}

export async function createEncryptedBackup(masterPassword: string): Promise<string> {
    const portableSettings = await exportPortableSettings();
    const [mistralApiKey, cloudflareCreds] = await Promise.all([getStoredApiKey(), getStoredCloudflareCredentials()]);

    const payload: BackupPayload = {
        version: 1,
        createdAt: new Date().toISOString(),
        settings: portableSettings.settings,
        secrets: {
            mistralApiKey: mistralApiKey || undefined,
            cloudflareAccountId: cloudflareCreds.accountId || undefined,
            cloudflareApiToken: cloudflareCreds.apiToken || undefined,
        },
    };

    const encryptedPkg = await encryptBackupPayload(payload, masterPassword);
    return JSON.stringify(encryptedPkg, null, 2);
}

export async function restoreEncryptedBackup(encryptedJson: string, masterPassword: string): Promise<RestoreResult> {
    let pkg: EncryptedBackupPackage;
    try {
        pkg = JSON.parse(encryptedJson) as EncryptedBackupPackage;
    } catch {
        throw new Error('INVALID_JSON');
    }

    const payload = await decryptBackupPayload(pkg, masterPassword);

    await importPortableSettings({
        format: 'lexisync-settings',
        version: 1,
        exportedAt: payload.createdAt,
        settings: payload.settings,
    });

    if (payload.secrets) {
        if (payload.secrets.mistralApiKey !== undefined) {
            await setStoredApiKey(payload.secrets.mistralApiKey);
        }
        if (payload.secrets.cloudflareAccountId !== undefined || payload.secrets.cloudflareApiToken !== undefined) {
            await setStoredCloudflareCredentials({
                accountId: payload.secrets.cloudflareAccountId || '',
                apiToken: payload.secrets.cloudflareApiToken || '',
            });
        }
    }

    return {
        settingsCount: Object.keys(payload.settings || {}).length,
        hasMistralKey: Boolean(payload.secrets?.mistralApiKey),
        hasCloudflareCreds: Boolean(payload.secrets?.cloudflareAccountId && payload.secrets?.cloudflareApiToken),
        createdAt: payload.createdAt,
    };
}
