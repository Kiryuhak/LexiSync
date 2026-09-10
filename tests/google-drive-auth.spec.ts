import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
    disconnectGoogleDrive,
    getFirefoxGoogleRedirectUrl,
    getGoogleDriveAccessToken,
    isGoogleDriveAuthConfigured,
    withGoogleDriveAuth,
} from '../src/google-drive-auth';
import { setStoredGoogleDriveToken } from '../src/secret-store';

describe('google-drive-auth: авторизация без ручных токенов', () => {
    let mockStorage: Record<string, unknown>;
    const chromeManifest = {
        manifest_version: 3 as const,
        name: 'LexiSync',
        version: '5.6.3',
        oauth2: { client_id: 'chrome-client-id', scopes: [] },
    };

    beforeEach(async () => {
        mockStorage = {};
        await setStoredGoogleDriveToken('');
        vi.stubGlobal('chrome', {
            runtime: {
                getManifest: () => ({}),
                lastError: undefined,
            },
            storage: {
                local: {
                    async remove(key: string) {
                        delete mockStorage[key];
                    },
                },
            },
            identity: {},
        });
    });

    test('Chrome получает токен через identity.getAuthToken', async () => {
        const getAuthToken = vi.fn((_details, callback) => callback({ token: 'chrome-access-token' }));
        Object.assign(chrome.runtime, { getManifest: () => chromeManifest });
        Object.assign(chrome.identity, { getAuthToken });

        expect(isGoogleDriveAuthConfigured()).toBe(true);
        await expect(getGoogleDriveAccessToken(true)).resolves.toBe('chrome-access-token');
        expect(getAuthToken).toHaveBeenCalledWith(expect.objectContaining({ interactive: true }), expect.any(Function));
    });

    test('при 401 удаляет устаревший токен Chrome и повторяет операцию один раз', async () => {
        const tokens = ['expired-token', 'fresh-token'];
        Object.assign(chrome.runtime, { getManifest: () => chromeManifest });
        Object.assign(chrome.identity, {
            getAuthToken: vi.fn((_details, callback) => callback(tokens.shift())),
            removeCachedAuthToken: vi.fn((_details, callback) => callback()),
        });
        const operation = vi
            .fn<(token: string) => Promise<string>>()
            .mockRejectedValueOnce(new Error('UNAUTHORIZED'))
            .mockResolvedValueOnce('готово');

        await expect(withGoogleDriveAuth(operation)).resolves.toBe('готово');
        expect(operation).toHaveBeenNthCalledWith(1, 'expired-token');
        expect(operation).toHaveBeenNthCalledWith(2, 'fresh-token');
        expect(chrome.identity.removeCachedAuthToken).toHaveBeenCalledWith(
            { token: 'expired-token' },
            expect.any(Function),
        );
    });

    test('Firefox открывает OAuth и сохраняет полученный токен в приватном хранилище', async () => {
        Object.assign(chrome.runtime, {
            getManifest: () => ({
                manifest_version: 3,
                name: 'LexiSync',
                version: '5.6.3',
                browser_specific_settings: { gecko: { id: 'lexisync@kiryuhak.dev' } },
            }),
        });
        Object.assign(chrome.identity, {
            getRedirectURL: vi.fn(() => 'https://lexisync-kiryuhak.extensions.allizom.org/'),
            launchWebAuthFlow: vi.fn((details, callback) => {
                const authUrl = new URL(details.url);
                const state = authUrl.searchParams.get('state');
                callback(`${authUrl.searchParams.get('redirect_uri')}#access_token=firefox-token&state=${state}`);
            }),
        });

        expect(getFirefoxGoogleRedirectUrl()).toBe('http://127.0.0.1/mozoauth2/lexisync-kiryuhak');
        await expect(getGoogleDriveAccessToken(true)).resolves.toBe('firefox-token');
        await expect(getGoogleDriveAccessToken(false)).resolves.toBe('firefox-token');
    });

    test('отключение удаляет кэшированный токен Chrome и локальное состояние синхронизации', async () => {
        mockStorage.googleDriveLastSync = 123;
        Object.assign(chrome.runtime, { getManifest: () => chromeManifest });
        Object.assign(chrome.identity, {
            getAuthToken: vi.fn((_details, callback) => callback('active-token')),
            removeCachedAuthToken: vi.fn((_details, callback) => callback()),
        });

        await disconnectGoogleDrive();

        expect(chrome.identity.removeCachedAuthToken).toHaveBeenCalledWith(
            { token: 'active-token' },
            expect.any(Function),
        );
        expect(mockStorage).not.toHaveProperty('googleDriveLastSync');
    });
});
