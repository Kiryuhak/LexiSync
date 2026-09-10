import { getStoredGoogleDriveToken, setStoredGoogleDriveToken } from './secret-store';
import { GOOGLE_DRIVE_ERROR } from './google-drive-errors';

declare const __LEXISYNC_GOOGLE_DRIVE_FIREFOX_CLIENT_ID__: string;

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const firefoxClientId = __LEXISYNC_GOOGLE_DRIVE_FIREFOX_CLIENT_ID__.trim();

type ChromeTokenResult = string | { token?: string } | undefined;

function getIdentityApi(): typeof chrome.identity | undefined {
    return chrome.identity;
}

function getChromeOauthClientId(): string {
    return chrome.runtime.getManifest().oauth2?.client_id?.trim() || '';
}

function hasChromeTokenFlow(): boolean {
    return typeof getIdentityApi()?.getAuthToken === 'function' && Boolean(getChromeOauthClientId());
}

function hasFirefoxWebAuthFlow(): boolean {
    const manifest = chrome.runtime.getManifest();
    return (
        Boolean(manifest.browser_specific_settings?.gecko) &&
        typeof getIdentityApi()?.launchWebAuthFlow === 'function' &&
        Boolean(firefoxClientId)
    );
}

export function isGoogleDriveAuthConfigured(): boolean {
    return hasChromeTokenFlow() || hasFirefoxWebAuthFlow();
}

function identityError(fallback: string): Error {
    const message = chrome.runtime.lastError?.message || fallback;
    if (/cancel|denied|approve|closed|interact|user/i.test(message)) return new Error('AUTH_CANCELLED');
    return new Error('AUTH_FAILED');
}

async function getChromeAccessToken(interactive: boolean): Promise<string> {
    const identity = getIdentityApi();
    if (!identity?.getAuthToken) throw new Error('OAUTH_NOT_CONFIGURED');

    return new Promise((resolve, reject) => {
        identity.getAuthToken({ interactive, scopes: [GOOGLE_DRIVE_SCOPE] }, (result: ChromeTokenResult) => {
            if (chrome.runtime.lastError) {
                reject(identityError('Не удалось получить доступ к Google Drive.'));
                return;
            }
            const token = typeof result === 'string' ? result : result?.token;
            if (!token) {
                reject(new Error(interactive ? 'AUTH_CANCELLED' : 'NO_TOKEN'));
                return;
            }
            resolve(token);
        });
    });
}

function createOauthState(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/u, '');
}

export function getFirefoxGoogleRedirectUrl(): string {
    const redirectUrl = getIdentityApi()?.getRedirectURL();
    if (!redirectUrl) throw new Error('OAUTH_NOT_CONFIGURED');
    const extensionSubdomain = new URL(redirectUrl).hostname.split('.')[0];
    if (!extensionSubdomain) throw new Error('OAUTH_NOT_CONFIGURED');
    return `http://127.0.0.1/mozoauth2/${extensionSubdomain}`;
}

async function launchFirefoxAuthFlow(): Promise<string> {
    const identity = getIdentityApi();
    if (!identity?.launchWebAuthFlow || !firefoxClientId) throw new Error('OAUTH_NOT_CONFIGURED');

    const state = createOauthState();
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', firefoxClientId);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri', getFirefoxGoogleRedirectUrl());
    authUrl.searchParams.set('scope', GOOGLE_DRIVE_SCOPE);
    authUrl.searchParams.set('include_granted_scopes', 'true');
    authUrl.searchParams.set('state', state);

    const responseUrl = await new Promise<string>((resolve, reject) => {
        identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, (redirectUrl) => {
            if (chrome.runtime.lastError) {
                reject(identityError('Не удалось открыть вход в Google Drive.'));
                return;
            }
            if (!redirectUrl) {
                reject(new Error('AUTH_CANCELLED'));
                return;
            }
            resolve(redirectUrl);
        });
    });

    const parsed = new URL(responseUrl);
    const params = new URLSearchParams(parsed.hash.replace(/^#/u, '') || parsed.search);
    if (params.get('state') !== state) throw new Error('AUTH_STATE_MISMATCH');
    if (params.get('error')) throw new Error('AUTH_CANCELLED');
    const token = params.get('access_token')?.trim() || '';
    if (!token) throw new Error('AUTH_FAILED');
    await setStoredGoogleDriveToken(token);
    return token;
}

export async function getGoogleDriveAccessToken(interactive = true): Promise<string> {
    if (hasChromeTokenFlow()) return getChromeAccessToken(interactive);
    if (!hasFirefoxWebAuthFlow()) throw new Error('OAUTH_NOT_CONFIGURED');

    const storedToken = await getStoredGoogleDriveToken();
    if (storedToken) return storedToken;
    if (!interactive) throw new Error('NO_TOKEN');
    return launchFirefoxAuthFlow();
}

async function removeChromeCachedToken(token: string): Promise<void> {
    const identity = getIdentityApi();
    if (!identity?.removeCachedAuthToken || !token) return;
    await new Promise<void>((resolve) => {
        identity.removeCachedAuthToken({ token }, () => {
            void chrome.runtime.lastError;
            resolve();
        });
    });
}

export async function disconnectGoogleDrive(): Promise<void> {
    let token = '';
    try {
        token = hasChromeTokenFlow() ? await getChromeAccessToken(false) : await getStoredGoogleDriveToken();
    } catch {
        // Отсутствие активного токена уже означает отключённое состояние.
    }
    await Promise.all([
        removeChromeCachedToken(token),
        setStoredGoogleDriveToken(''),
        chrome.storage.local.remove('googleDriveLastSync'),
    ]);
}

export async function isGoogleDriveConnected(): Promise<boolean> {
    if (!isGoogleDriveAuthConfigured()) return false;
    try {
        return Boolean(await getGoogleDriveAccessToken(false));
    } catch {
        return false;
    }
}

export async function withGoogleDriveAuth<T>(operation: (token: string) => Promise<T>): Promise<T> {
    let token = await getGoogleDriveAccessToken(true);
    try {
        return await operation(token);
    } catch (error) {
        if (!(error instanceof Error) || error.message !== GOOGLE_DRIVE_ERROR.AUTH) throw error;
    }

    await Promise.all([removeChromeCachedToken(token), setStoredGoogleDriveToken('')]);
    token = await getGoogleDriveAccessToken(true);
    return operation(token);
}
