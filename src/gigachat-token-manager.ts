import { t } from './i18n';
import { AiProviderError } from './ai-provider-types';
import { recordErrorLog } from './error-log';

export const GIGACHAT_OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
export const GIGACHAT_SCOPE = 'GIGACHAT_API_PERS';
const STORAGE_KEY_TOKEN = '_gigachat_token_cache';
const PREEMPTIVE_REFRESH_WINDOW_MS = 60_000; // Обновлять за 60 секунд до истечения срока действия

export interface GigaChatCachedToken {
    accessToken: string;
    expiresAt: number; // Unix timestamp в миллисекундах
}

interface OAuthResponsePayload {
    access_token?: string;
    expires_at?: number;
}

let inMemoryToken: GigaChatCachedToken | null = null;
let refreshPromise: Promise<string> | null = null;

function generateRqUid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Читает кэшированный токен из памяти или chrome.storage.local (для восстановления после выгрузки Service Worker).
 */
async function loadStoredToken(): Promise<GigaChatCachedToken | null> {
    if (inMemoryToken) return inMemoryToken;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            const data = await chrome.storage.local.get(STORAGE_KEY_TOKEN);
            const cached = data[STORAGE_KEY_TOKEN] as GigaChatCachedToken | undefined;
            if (cached && typeof cached.accessToken === 'string' && typeof cached.expiresAt === 'number') {
                inMemoryToken = cached;
                return inMemoryToken;
            }
        }
    } catch {
        // Ошибка доступа к storage не блокирует получение нового токена
    }
    return null;
}

/**
 * Сохраняет токен в памяти и в chrome.storage.local.
 */
async function persistToken(token: GigaChatCachedToken): Promise<void> {
    inMemoryToken = token;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            await chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: token });
        }
    } catch {
        // Допустимо, если storage временно недоступен
    }
}

/**
 * Сбрасывает сохранённый токен при получении 401 или смене ключа авторизации.
 */
export async function invalidateGigaChatToken(): Promise<void> {
    inMemoryToken = null;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            await chrome.storage.local.remove(STORAGE_KEY_TOKEN);
        }
    } catch {
        // Игнорируем ошибки удаления
    }
}

/**
 * Проверяет валидность токена с учетом защитного интервала 60 секунд.
 */
export function isTokenValid(token: GigaChatCachedToken | null, now = Date.now()): boolean {
    if (!token || !token.accessToken) return false;
    return token.expiresAt - now > PREEMPTIVE_REFRESH_WINDOW_MS;
}

/**
 * Выполняет фактический HTTP-запрос OAuth к шлюзу Сбера.
 * Защищён от логирования секретов и токена.
 */
async function fetchOAuthToken(authKey: string, signal?: AbortSignal): Promise<GigaChatCachedToken> {
    const trimmedKey = authKey.trim();
    if (!trimmedKey) {
        throw new AiProviderError(
            t('gigachatAuthKeyMissing', 'Authorization Key GigaChat не настроен.'),
            'AUTH_ERROR',
            'gigachat',
            false,
            401,
        );
    }

    const rqUid = generateRqUid();
    const timeoutSignal = AbortSignal.timeout(10_000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
        response = await fetch(GIGACHAT_OAUTH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
                RqUID: rqUid,
                Authorization: `Basic ${trimmedKey}`,
            },
            body: `scope=${encodeURIComponent(GIGACHAT_SCOPE)}`,
            cache: 'no-store',
            signal: combinedSignal,
        });
    } catch (err) {
        if (signal?.aborted) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        const isTimeout = combinedSignal.aborted || msg.includes('timeout');
        throw new AiProviderError(
            isTimeout
                ? t('gigachatTimeout', 'Сервис авторизации GigaChat не ответил вовремя.')
                : t('gigachatNetworkError', 'Не удалось подключиться к серверу авторизации GigaChat.'),
            isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
            'gigachat',
            true,
        );
    }

    if (!response.ok) {
        let errorDetail = '';
        try {
            const errorJson = (await response.json()) as Record<string, unknown>;
            if (typeof errorJson.message === 'string') errorDetail = errorJson.message;
        } catch {
            // Игнорируем ошибку разбора тела ответа
        }

        if (response.status === 401 || response.status === 403) {
            void recordErrorLog({
                level: 'error',
                source: 'gigachat-token-manager',
                provider: 'gigachat',
                status: response.status,
                message: `Ошибка авторизации GigaChat (401/403): ${errorDetail || 'Неверный Authorization Key'}`,
                knownKeys: [trimmedKey],
            });
            throw new AiProviderError(
                t(
                    'gigachatAuthKeyInvalid',
                    'Authorization Key GigaChat недействителен. Проверьте ключ в настройках LexiSync.',
                ),
                'AUTH_ERROR',
                'gigachat',
                false,
                response.status,
            );
        }

        if (response.status === 429) {
            throw new AiProviderError(
                t('gigachatRateLimit', 'Превышен лимит запросов GigaChat. Попробуйте немного позже.'),
                'RATE_LIMIT',
                'gigachat',
                true,
                429,
            );
        }

        if (response.status >= 500) {
            throw new AiProviderError(
                t('gigachatUnavailable', 'Сервер авторизации GigaChat временно недоступен. Попробуйте позже.'),
                'SERVER_ERROR',
                'gigachat',
                true,
                response.status,
            );
        }

        throw new AiProviderError(
            `${t('gigachatAuthFailed', 'Ошибка получения токена GigaChat')} (${response.status}).`,
            'UNKNOWN_ERROR',
            'gigachat',
            false,
            response.status,
        );
    }

    let payload: OAuthResponsePayload;
    try {
        payload = (await response.json()) as OAuthResponsePayload;
    } catch {
        throw new AiProviderError(
            t('gigachatInvalidResponse', 'Некорректный ответ от сервера авторизации GigaChat.'),
            'INVALID_RESPONSE',
            'gigachat',
            true,
        );
    }

    if (!payload.access_token || typeof payload.access_token !== 'string') {
        throw new AiProviderError(
            t('gigachatEmptyToken', 'Сервер GigaChat вернул пустой access token.'),
            'INVALID_RESPONSE',
            'gigachat',
            true,
        );
    }

    // expires_at в ответе GigaChat приходит в миллисекундах (или секундах в зависимости от формата;
    // если значение меньше 10^11, это секунды, иначе миллисекунды)
    let expiresAt = typeof payload.expires_at === 'number' ? payload.expires_at : Date.now() + 30 * 60_000;
    if (expiresAt < 10_000_000_000) {
        expiresAt *= 1000;
    }

    const cachedToken: GigaChatCachedToken = {
        accessToken: payload.access_token,
        expiresAt,
    };

    await persistToken(cachedToken);
    return cachedToken;
}

/**
 * Получает действующий access_token GigaChat с защитой single-flight от параллельных запросов.
 */
export async function getGigaChatAccessToken(authKey: string, signal?: AbortSignal): Promise<string> {
    const existing = await loadStoredToken();
    if (isTokenValid(existing)) {
        return existing!.accessToken;
    }

    // Single-flight refresh: если запрос уже выполняется, ждем его завершения
    if (refreshPromise) {
        return await refreshPromise;
    }

    refreshPromise = (async () => {
        try {
            const token = await fetchOAuthToken(authKey, signal);
            return token.accessToken;
        } finally {
            refreshPromise = null;
        }
    })();

    return await refreshPromise;
}

/**
 * Валидирует ключ авторизации GigaChat (выполняя тестовый запрос на получение токена).
 */
export async function validateGigaChatAuthKey(authKey: string): Promise<{ ok: boolean; message: string }> {
    const trimmed = authKey.trim();
    if (!trimmed) {
        return { ok: false, message: t('tutorialGigaChatKeyRequired', 'Сначала вставьте Authorization Key GigaChat.') };
    }
    try {
        await invalidateGigaChatToken();
        await fetchOAuthToken(trimmed);
        return {
            ok: true,
            message: t('gigachatAuthKeyValid', 'Authorization Key GigaChat успешно проверен и готов к работе.'),
        };
    } catch (err) {
        if (err instanceof AiProviderError) {
            return { ok: false, message: err.message };
        }
        return {
            ok: false,
            message: err instanceof Error ? err.message : t('gigachatAuthFailed', 'Сбой проверки ключа GigaChat.'),
        };
    }
}

export const getValidGigaChatToken = getGigaChatAccessToken;

export function getStoredGigaChatTokenMemory(): string | null {
    return inMemoryToken?.accessToken ?? null;
}
