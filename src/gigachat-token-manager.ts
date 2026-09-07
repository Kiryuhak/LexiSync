import { t } from './i18n';
import { AiProviderError } from './ai-provider-types';
import { recordErrorLog } from './error-log';
import { AI_CONFIG } from './ai-models-config';
import { deletePrivateRecord, readPrivateRecord, writePrivateRecord } from './extension-db';

export const GIGACHAT_OAUTH_URL = AI_CONFIG.gigachat.oauthUrl;
export const GIGACHAT_SCOPE = AI_CONFIG.gigachat.scope;
const STORAGE_KEY_TOKEN = '_gigachat_token_cache';
const PREEMPTIVE_REFRESH_WINDOW_MS = 60_000; // Обновлять за 60 секунд до истечения срока действия

export interface GigaChatCachedToken {
    accessToken: string;
    expiresAt: number; // Unix timestamp в миллисекундах
    credentialId?: string;
}

interface OAuthResponsePayload {
    access_token?: string;
    expires_at?: number;
}

let inMemoryToken: GigaChatCachedToken | null = null;
const refreshes = new Map<string, Promise<string>>();
let generation = 0;
let pendingWrite: Promise<void> = Promise.resolve();

function queueWrite(operation: () => Promise<void>): Promise<void> {
    const result = pendingWrite.then(operation, operation);
    pendingWrite = result.catch(() => undefined);
    return result;
}

async function credentialId(key: string): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function waitForToken(task: Promise<string>, signal?: AbortSignal): Promise<string> {
    if (!signal) return task;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        void task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

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
 * Читает токен из памяти или приватной IndexedDB после выгрузки Service Worker.
 */
async function loadStoredToken(): Promise<GigaChatCachedToken | null> {
    await pendingWrite;
    if (inMemoryToken) return inMemoryToken;
    const cached = await readPrivateRecord<GigaChatCachedToken>('secrets', STORAGE_KEY_TOKEN);
    return cached && isTokenValid(cached) ? cached : null;
}

/**
 * Сохраняет токен в памяти и приватной IndexedDB, недоступной content scripts.
 */
async function persistToken(token: GigaChatCachedToken): Promise<void> {
    await writePrivateRecord('secrets', STORAGE_KEY_TOKEN, token);
    inMemoryToken = token;
}

/**
 * Сбрасывает сохранённый токен при получении 401 или смене ключа авторизации.
 */
export async function invalidateGigaChatToken(rejectedToken?: string): Promise<void> {
    if (!rejectedToken) {
        generation++;
        refreshes.clear();
    }
    await queueWrite(async () => {
        const token = inMemoryToken ?? (await readPrivateRecord<GigaChatCachedToken>('secrets', STORAGE_KEY_TOKEN));
        if (rejectedToken && token?.accessToken !== rejectedToken) return;
        inMemoryToken = null;
        await deletePrivateRecord('secrets', STORAGE_KEY_TOKEN);
    });
}

/**
 * Проверяет валидность токена с учетом защитного интервала 60 секунд.
 */
export function isTokenValid(token: GigaChatCachedToken | null, now = Date.now()): boolean {
    if (!token || !token.accessToken) return false;
    return Number.isFinite(token.expiresAt) && token.expiresAt - now > PREEMPTIVE_REFRESH_WINDOW_MS;
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
        // Не сохраняем тело ошибки: сервер может вернуть заголовки или секреты.

        if (response.status === 401 || response.status === 403) {
            void recordErrorLog({
                level: 'error',
                source: 'gigachat-token-manager',
                provider: 'gigachat',
                status: response.status,
                message: `Ошибка авторизации GigaChat: HTTP ${response.status}`,
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
    } catch (error) {
        if (combinedSignal.aborted) {
            if (signal?.aborted) throw error;
            throw new AiProviderError(
                t('gigachatTimeout', 'Сервис авторизации GigaChat не ответил вовремя.'),
                'TIMEOUT',
                'gigachat',
                true,
            );
        }
        throw new AiProviderError(
            t('gigachatInvalidResponse', 'Некорректный ответ от сервера авторизации GigaChat.'),
            'INVALID_RESPONSE',
            'gigachat',
            true,
        );
    }

    if (
        !payload ||
        !payload.access_token ||
        typeof payload.access_token !== 'string' ||
        !Number.isFinite(payload.expires_at)
    ) {
        throw new AiProviderError(
            t('gigachatEmptyToken', 'Сервер GigaChat вернул пустой access token.'),
            'INVALID_RESPONSE',
            'gigachat',
            true,
        );
    }

    // expires_at в ответе GigaChat приходит в миллисекундах (или секундах в зависимости от формата;
    // если значение меньше 10^11, это секунды, иначе миллисекунды)
    let expiresAt = payload.expires_at!;
    if (expiresAt < 10_000_000_000) {
        expiresAt *= 1000;
    }

    const cachedToken: GigaChatCachedToken = {
        accessToken: payload.access_token,
        expiresAt,
    };

    return cachedToken;
}

/**
 * Получает действующий access_token GigaChat с защитой single-flight от параллельных запросов.
 */
export async function getGigaChatAccessToken(authKey: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw signal.reason;
    const key = authKey.trim();
    const epoch = generation;
    if (!key)
        throw new AiProviderError('Authorization Key GigaChat не настроен.', 'AUTH_ERROR', 'gigachat', false, 401);
    const id = await credentialId(key);
    if (epoch !== generation) throw new DOMException('Ключ авторизации изменён.', 'AbortError');
    let task = refreshes.get(id);
    if (!task) {
        task = (async () => {
            const existing = await loadStoredToken();
            if (existing?.credentialId === id && isTokenValid(existing)) return existing.accessToken;
            // Отмена одного клиента не прерывает общий OAuth-запрос остальных.
            const token = await fetchOAuthToken(key);
            await queueWrite(async () => {
                if (epoch !== generation) throw new DOMException('Ключ авторизации изменён.', 'AbortError');
                await persistToken({ ...token, credentialId: id });
            });
            return token.accessToken;
        })();
        refreshes.set(id, task);
        const current = task;
        void task
            .finally(() => {
                if (refreshes.get(id) === current) refreshes.delete(id);
            })
            .catch(() => undefined);
    }
    return waitForToken(task, signal);
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
            message: t('gigachatAuthFailed', 'Сбой проверки ключа GigaChat.'),
        };
    }
}

export const getValidGigaChatToken = getGigaChatAccessToken;

export function getStoredGigaChatTokenMemory(): string | null {
    return inMemoryToken?.accessToken ?? null;
}
