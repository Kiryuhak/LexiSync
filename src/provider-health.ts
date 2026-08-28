import { t } from './i18n';
import type { AiProviderType } from './ai-provider-types';

export type HealthState = 'healthy' | 'degraded' | 'outage' | 'unconfigured' | 'checking';

export interface ProviderHealthStatus {
    provider: AiProviderType;
    state: HealthState;
    latencyMs?: number;
    message: string;
    checkedAt: number;
}

const HEALTH_CACHE_KEY = 'lexisync_provider_health_cache';
const HEALTH_CACHE_MAX_AGE_MS = 15 * 60_000;

export function getHealthStateColor(state: HealthState): string {
    switch (state) {
        case 'healthy':
            return '#10b981'; // 🟢 зеленый
        case 'degraded':
            return '#f59e0b'; // 🟡 желтый
        case 'outage':
            return '#ef4444'; // 🔴 красный
        case 'checking':
            return '#3b82f6'; // 🔵 синий / проверка
        case 'unconfigured':
        default:
            return '#9ca3af'; // ⚪ серый
    }
}

export function getHealthStateBadge(state: HealthState): string {
    switch (state) {
        case 'healthy':
            return '🟢';
        case 'degraded':
            return '🟡';
        case 'outage':
            return '🔴';
        case 'checking':
            return '🔄';
        case 'unconfigured':
        default:
            return '⚪';
    }
}

export function formatHealthMessage(status: ProviderHealthStatus): string {
    const latencyStr = typeof status.latencyMs === 'number' ? ` (${Math.round(status.latencyMs)} мс)` : '';
    return `${status.message}${latencyStr}`;
}

export async function checkProviderHealth(
    provider: AiProviderType,
    apiKey: string,
    timeoutMs = 7000,
): Promise<ProviderHealthStatus> {
    const trimmedKey = (apiKey || '').trim();
    if (!trimmedKey) {
        return {
            provider,
            state: 'unconfigured',
            message: t('serverStatusUnconfigured', 'Ключ не настроен'),
            checkedAt: Date.now(),
        };
    }

    const url = provider === 'groq' ? 'https://api.groq.com/openai/v1/models' : 'https://api.mistral.ai/v1/models';

    const startTime = performance.now();
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${trimmedKey}`,
            },
            cache: 'no-store',
            signal: AbortSignal.timeout(timeoutMs),
        });

        const durationMs = performance.now() - startTime;

        if (response.ok) {
            // Если ответ быстрый (< 2500 мс) — отличная работа
            if (durationMs < 2500) {
                return {
                    provider,
                    state: 'healthy',
                    latencyMs: durationMs,
                    message: t('serverStatusHealthy', 'Работает отлично'),
                    checkedAt: Date.now(),
                };
            }
            // Если ответ занял >= 2.5 сек — замедление
            return {
                provider,
                state: 'degraded',
                latencyMs: durationMs,
                message: t('serverStatusDegradedLatency', 'Замедление ответа'),
                checkedAt: Date.now(),
            };
        }

        // Обработка статус-кодов
        if (response.status === 429) {
            return {
                provider,
                state: 'degraded',
                latencyMs: durationMs,
                message: t('serverStatusRateLimit', 'Лимит запросов (Rate Limit)'),
                checkedAt: Date.now(),
            };
        }

        if (response.status === 401 || response.status === 403) {
            return {
                provider,
                state: 'outage',
                latencyMs: durationMs,
                message: t('serverStatusAuthError', 'Недействительный API-ключ'),
                checkedAt: Date.now(),
            };
        }

        if (response.status >= 500) {
            return {
                provider,
                state: 'outage',
                latencyMs: durationMs,
                message: t('serverStatusServerError', `Сбой сервера (${response.status})`),
                checkedAt: Date.now(),
            };
        }

        return {
            provider,
            state: 'outage',
            latencyMs: durationMs,
            message: t('serverStatusHttpError', `Ошибка HTTP ${response.status}`),
            checkedAt: Date.now(),
        };
    } catch (error) {
        const durationMs = performance.now() - startTime;
        const isTimeout =
            error instanceof Error &&
            (error.name === 'TimeoutError' ||
                error.name === 'AbortError' ||
                error.message.includes('timeout') ||
                error.message.includes('aborted'));

        return {
            provider,
            state: 'outage',
            latencyMs: durationMs,
            message: isTimeout
                ? t('serverStatusTimeout', 'Таймаут подключения')
                : t('serverStatusNetworkError', 'Ошибка сети / недоступен'),
            checkedAt: Date.now(),
        };
    }
}

export function evaluateHealthFromRuntimeResponse(
    provider: AiProviderType,
    durationMs: number,
    errorStatus?: number,
    isNetworkError = false,
): ProviderHealthStatus {
    if (errorStatus === 429) {
        return {
            provider,
            state: 'degraded',
            latencyMs: durationMs,
            message: t('serverStatusRateLimit', 'Лимит запросов (Rate Limit)'),
            checkedAt: Date.now(),
        };
    }

    if (errorStatus && errorStatus >= 500) {
        return {
            provider,
            state: 'outage',
            latencyMs: durationMs,
            message: t('serverStatusServerError', `Сбой сервера (${errorStatus})`),
            checkedAt: Date.now(),
        };
    }

    if (errorStatus === 401 || errorStatus === 403) {
        return {
            provider,
            state: 'outage',
            latencyMs: durationMs,
            message: t('serverStatusAuthError', 'Недействительный API-ключ'),
            checkedAt: Date.now(),
        };
    }

    if (isNetworkError) {
        return {
            provider,
            state: 'outage',
            latencyMs: durationMs,
            message: t('serverStatusNetworkError', 'Ошибка сети / недоступен'),
            checkedAt: Date.now(),
        };
    }

    if (durationMs > 3500) {
        return {
            provider,
            state: 'degraded',
            latencyMs: durationMs,
            message: t('serverStatusDegradedLatency', 'Замедление ответа'),
            checkedAt: Date.now(),
        };
    }

    return {
        provider,
        state: 'healthy',
        latencyMs: durationMs,
        message: t('serverStatusHealthy', 'Работает отлично'),
        checkedAt: Date.now(),
    };
}

export async function loadCachedHealthStatus(): Promise<Record<AiProviderType, ProviderHealthStatus | null>> {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            const data = (await chrome.storage.local.get(HEALTH_CACHE_KEY)) as {
                [HEALTH_CACHE_KEY]?: Record<AiProviderType, ProviderHealthStatus | null>;
            };
            const cached = data[HEALTH_CACHE_KEY];
            if (cached && typeof cached === 'object') {
                const now = Date.now();
                const fresh = (status: ProviderHealthStatus | null | undefined) =>
                    status &&
                    Number.isFinite(status.checkedAt) &&
                    now - status.checkedAt <= HEALTH_CACHE_MAX_AGE_MS &&
                    now >= status.checkedAt
                        ? status
                        : null;
                return {
                    groq: fresh(cached.groq),
                    mistral: fresh(cached.mistral),
                };
            }
        }
    } catch {
        // Fallback
    }
    return { groq: null, mistral: null };
}

export async function saveCachedHealthStatus(
    statusMap: Partial<Record<AiProviderType, ProviderHealthStatus>>,
): Promise<void> {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            const current = await loadCachedHealthStatus();
            const updated = { ...current, ...statusMap };
            await chrome.storage.local.set({ [HEALTH_CACHE_KEY]: updated });
        }
    } catch {
        // Fallback
    }
}
