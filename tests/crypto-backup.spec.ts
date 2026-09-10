import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
    bytesToBase64,
    base64ToBytes,
    encryptBackupPayload,
    decryptBackupPayload,
    createEncryptedBackup,
    restoreEncryptedBackup,
    type BackupPayload,
    type EncryptedBackupPackage,
} from '../src/crypto-backup';
import {
    downloadBackupFromGoogleDrive,
    findDriveBackupFile,
    uploadBackupToGoogleDrive,
} from '../src/google-drive-sync';

describe('crypto-backup: Zero-Knowledge Web Crypto', () => {
    test('bytesToBase64 и base64ToBytes корректно конвертируют произвольные байты', () => {
        const original = new Uint8Array([0, 1, 2, 127, 128, 255, 42, 99]);
        const b64 = bytesToBase64(original);
        const restored = base64ToBytes(b64);
        expect([...restored]).toEqual([...original]);
    });

    test('encryptBackupPayload и decryptBackupPayload успешно шифруют и расшифровывают данные по мастер-паролю', async () => {
        const payload: BackupPayload = {
            version: 1,
            createdAt: new Date().toISOString(),
            settings: {
                selectedTone: 'friendly',
                selectedTheme: 'dark',
                compactResultMode: true,
            },
            secrets: {
                mistralApiKey: 'sk-mistral-secret-12345',
                cloudflareAccountId: 'cf-account-abc',
                cloudflareApiToken: 'cf-token-xyz',
            },
        };

        const password = 'SuperSecretMasterPassword123!';
        const encrypted = await encryptBackupPayload(payload, password);

        expect(encrypted.format).toBe('lexisync-encrypted-backup');
        expect(encrypted.version).toBe(1);
        expect(encrypted.kdf.name).toBe('PBKDF2');
        expect(encrypted.kdf.iterations).toBe(100_000);
        expect(encrypted.cipher.algorithm).toBe('AES-GCM');
        expect(encrypted.cipher.data).toBeDefined();

        // Расшифровка с правильным паролем
        const decrypted = await decryptBackupPayload(encrypted, password);
        expect(decrypted.version).toBe(1);
        expect(decrypted.settings).toEqual(payload.settings);
        expect(decrypted.secrets).toEqual(payload.secrets);
    });

    test('decryptBackupPayload отклоняет расшифровку с неверным паролем ошибкой INVALID_PASSWORD', async () => {
        const payload: BackupPayload = {
            version: 1,
            createdAt: new Date().toISOString(),
            settings: { selectedTone: 'business' },
            secrets: { mistralApiKey: 'secret' },
        };

        const encrypted = await encryptBackupPayload(payload, 'correct-password-42');

        await expect(decryptBackupPayload(encrypted, 'wrong-password-99')).rejects.toThrow('INVALID_PASSWORD');
    });

    test('encryptBackupPayload и decryptBackupPayload отклоняют пустой пароль', async () => {
        const payload: BackupPayload = {
            version: 1,
            createdAt: new Date().toISOString(),
            settings: {},
            secrets: {},
        };

        await expect(encryptBackupPayload(payload, '')).rejects.toThrow('EMPTY_PASSWORD');
        await expect(encryptBackupPayload(payload, '   ')).rejects.toThrow('EMPTY_PASSWORD');

        const encrypted = await encryptBackupPayload(payload, 'valid');
        await expect(decryptBackupPayload(encrypted, '')).rejects.toThrow('EMPTY_PASSWORD');
    });

    test('decryptBackupPayload выявляет повреждённый шифротекст', async () => {
        const payload: BackupPayload = {
            version: 1,
            createdAt: new Date().toISOString(),
            settings: { theme: 'dark' },
            secrets: {},
        };

        const encrypted = await encryptBackupPayload(payload, 'master-pass');

        // Подменяем шифротекст
        const corruptedPkg: EncryptedBackupPackage = {
            ...encrypted,
            cipher: {
                ...encrypted.cipher,
                data: bytesToBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])),
            },
        };

        await expect(decryptBackupPayload(corruptedPkg, 'master-pass')).rejects.toThrow('INVALID_PASSWORD');
    });

    test('decryptBackupPayload ограничивает параметры KDF и размеры служебных полей', async () => {
        const payload: BackupPayload = {
            version: 1,
            createdAt: new Date().toISOString(),
            settings: {},
            secrets: {},
        };
        const encrypted = await encryptBackupPayload(payload, 'master-pass');

        await expect(
            decryptBackupPayload({ ...encrypted, kdf: { ...encrypted.kdf, iterations: 2_000_001 } }, 'master-pass'),
        ).rejects.toThrow('CORRUPTED_BACKUP');
        await expect(
            decryptBackupPayload(
                { ...encrypted, cipher: { ...encrypted.cipher, iv: bytesToBase64(new Uint8Array(11)) } },
                'master-pass',
            ),
        ).rejects.toThrow('CORRUPTED_BACKUP');
    });
});

describe('crypto-backup: Полный цикл создания и восстановления бэкапа в хранилище', () => {
    let mockStorage: Record<string, unknown> = {};

    beforeEach(() => {
        mockStorage = {};
        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    async get(keys: string | string[] | Record<string, unknown> | null) {
                        if (typeof keys === 'string') return { [keys]: mockStorage[keys] };
                        if (Array.isArray(keys)) {
                            const res: Record<string, unknown> = {};
                            for (const k of keys) res[k] = mockStorage[k];
                            return res;
                        }
                        if (keys && typeof keys === 'object') {
                            const res: Record<string, unknown> = { ...keys };
                            for (const k of Object.keys(keys)) {
                                if (mockStorage[k] !== undefined) res[k] = mockStorage[k];
                            }
                            return res;
                        }
                        return { ...mockStorage };
                    },
                    async set(items: Record<string, unknown>) {
                        Object.assign(mockStorage, items);
                    },
                    async remove(keys: string | string[]) {
                        const list = Array.isArray(keys) ? keys : [keys];
                        for (const k of list) delete mockStorage[k];
                    },
                },
            },
        });
    });

    test('createEncryptedBackup и restoreEncryptedBackup полностью сохраняют и восстанавливают настройки и секреты', async () => {
        // Устанавливаем исходные настройки
        mockStorage['selectedTone'] = 'persuasive';
        mockStorage['selectedTheme'] = 'dark';
        mockStorage['compactResultMode'] = true;

        const password = 'VaultMasterPassword777!';
        const backupJson = await createEncryptedBackup(password);

        expect(typeof backupJson).toBe('string');
        const parsed = JSON.parse(backupJson);
        expect(parsed.format).toBe('lexisync-encrypted-backup');

        // Очищаем локальное хранилище
        mockStorage = {};

        // Восстанавливаем из зашифрованной резервной копии
        const summary = await restoreEncryptedBackup(backupJson, password);
        expect(summary.settingsCount).toBeGreaterThan(0);
        expect(mockStorage['selectedTone']).toBe('persuasive');
        expect(mockStorage['selectedTheme']).toBe('dark');
        expect(mockStorage['compactResultMode']).toBe(true);
    });
});

describe('google-drive-sync: Google Drive AppData клиент', () => {
    let mockStorage: Record<string, unknown> = {};

    beforeEach(() => {
        mockStorage = {};
        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    async get(keys: Record<string, unknown>) {
                        const res: Record<string, unknown> = { ...keys };
                        for (const k of Object.keys(keys)) {
                            if (mockStorage[k] !== undefined) res[k] = mockStorage[k];
                        }
                        return res;
                    },
                    async set(items: Record<string, unknown>) {
                        Object.assign(mockStorage, items);
                    },
                    async remove(keys: string | string[]) {
                        const list = Array.isArray(keys) ? keys : [keys];
                        for (const k of list) delete mockStorage[k];
                    },
                },
            },
        });
    });

    test('findDriveBackupFile возвращает exists: false если файла в appDataFolder нет', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ files: [] }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await findDriveBackupFile('token-123');
        expect(result.exists).toBe(false);
    });

    test('findDriveBackupFile возвращает информацию о файле если он найден', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                files: [
                    {
                        id: 'file-xyz-987',
                        name: 'lexisync_backup.enc',
                        modifiedTime: '2026-09-09T12:00:00Z',
                        size: '1024',
                    },
                ],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await findDriveBackupFile('token-123');
        expect(result.exists).toBe(true);
        expect(result.fileId).toBe('file-xyz-987');
        expect(result.size).toBe(1024);
    });

    test('findDriveBackupFile выбрасывает UNAUTHORIZED при 401 от Google API', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(findDriveBackupFile('expired-token')).rejects.toThrow('UNAUTHORIZED');
    });

    test('downloadBackupFromGoogleDrive успешно загружает файл', async () => {
        const fetchMock = vi.fn().mockImplementation((url: string) => {
            if (url.includes('spaces=appDataFolder')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        files: [{ id: 'file-123', name: 'lexisync_backup.enc', modifiedTime: '2026-09-09T12:00:00Z' }],
                    }),
                });
            }
            if (url.includes('file-123?alt=media')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    text: async () => '{"encrypted":"data"}',
                });
            }
            return Promise.reject(new Error('Unknown url'));
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await downloadBackupFromGoogleDrive('valid-token');
        expect(result.content).toBe('{"encrypted":"data"}');
        expect(result.modifiedTime).toBe('2026-09-09T12:00:00Z');
    });

    test('uploadBackupToGoogleDrive обновляет существующий файл через PATCH', async () => {
        const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
            if (url.includes('spaces=appDataFolder')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        files: [{ id: 'existing-file-id', name: 'lexisync_backup.enc' }],
                    }),
                });
            }
            if (url.includes('existing-file-id?uploadType=media') && opts?.method === 'PATCH') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ id: 'existing-file-id', modifiedTime: '2026-09-09T12:30:00Z' }),
                });
            }
            return Promise.reject(new Error('Unknown url'));
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await uploadBackupToGoogleDrive('{"new":"backup"}', 'valid-token');
        expect(result.fileId).toBe('existing-file-id');
        expect(result.modifiedTime).toBe('2026-09-09T12:30:00Z');
    });

    test('uploadBackupToGoogleDrive создает новый файл через multipart POST если файла ещё нет', async () => {
        const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
            if (url.includes('spaces=appDataFolder')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ files: [] }),
                });
            }
            if (url.includes('uploadType=multipart') && opts?.method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ id: 'created-file-id', modifiedTime: '2026-09-09T12:35:00Z' }),
                });
            }
            return Promise.reject(new Error('Unknown url'));
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await uploadBackupToGoogleDrive('{"first":"backup"}', 'valid-token');
        expect(result.fileId).toBe('created-file-id');
        expect(result.modifiedTime).toBe('2026-09-09T12:35:00Z');
    });
});
