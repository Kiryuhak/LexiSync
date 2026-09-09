import { t } from './i18n';
import { AiProviderError, type AiProviderType, type CloudflareCredentials } from './ai-provider-types';
import { validateCloudflareCredentials } from './cloudflare-client';
import { AI_CONFIG, normalizeCloudflareModel } from './ai-models-config';

export type HealthState = 'healthy' | 'degraded' | 'outage' | 'unconfigured' | 'checking';

export interface ProviderHealthStatus {
    provider: AiProviderType;
    state: HealthState;
    latencyMs?: number;
    message: string;
    checkedAt: number;
    model?: string;
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
    apiKey: string | CloudflareCredentials,
    timeoutMs = 7000,
    cloudflareModel: unknown = AI_CONFIG.cloudflare.defaultModel,
): Promise<ProviderHealthStatus> {
    if (provider === 'cloudflare') {
        const resolvedModel = normalizeCloudflareModel(cloudflareModel);
        let creds: CloudflareCredentials;
        if (typeof apiKey === 'object' && apiKey !== null) {
            creds = apiKey;
        } else {
            try {
                creds = JSON.parse(apiKey) as CloudflareCredentials;
            } catch {
                creds = { accountId: '', apiToken: '' };
            }
        }
        if (!creds.accountId?.trim() || !creds.apiToken?.trim()) {
            return {
                provider: 'cloudflare',
                state: 'unconfigured',
                message: t('serverStatusUnconfigured', 'Ключ не настроен'),
                checkedAt: Date.now(),
                model: resolvedModel,
            };
        }

        const signal = AbortSignal.timeout(timeoutMs);
        const result = await validateCloudflareCredentials(creds, resolvedModel, signal);

        if (result.ok) {
            const isDegraded = (result.latencyMs ?? 0) >= 2500;
            return {
                provider: 'cloudflare',
                state: isDegraded ? 'degraded' : 'healthy',
                latencyMs: result.latencyMs,
                message: isDegraded
                    ? t('serverStatusDegradedLatency', 'Замедление ответа')
                    : t('serverStatusHealthy', 'Работает отлично'),
                checkedAt: Date.now(),
                model: resolvedModel,
            };
        }

        const isDegraded =
            result.message.includes('квота') ||
            result.message.includes('лимит') ||
            result.message.includes('вовремя') ||
            result.message.includes('timeout');

        return {
            provider: 'cloudflare',
            state: isDegraded ? 'degraded' : 'outage',
            latencyMs: result.latencyMs,
            message: result.message,
            checkedAt: Date.now(),
            model: resolvedModel,
        };
    }

    const trimmedKey = (typeof apiKey === 'string' ? apiKey : '').trim();
    if (!trimmedKey) {
        return {
            provider: 'mistral',
            state: 'unconfigured',
            message: t('serverStatusUnconfigured', 'Ключ не настроен'),
            checkedAt: Date.now(),
        };
    }

    const startTime = performance.now();
    const url = `${AI_CONFIG.mistral.baseUrl}/models`;
    const signal = AbortSignal.timeout(timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${trimmedKey}`,
            },
            cache: 'no-store',
            signal,
        });

        const durationMs = performance.now() - startTime;

        if (response.ok) {
            if (durationMs < 2500) {
                return {
                    provider: 'mistral',
                    state: 'healthy',
                    latencyMs: durationMs,
                    message: t('serverStatusHealthy', 'Работает отлично'),
                    checkedAt: Date.now(),
                };
            }
            return {
                provider: 'mistral',
                state: 'degraded',
                latencyMs: durationMs,
                message: t('serverStatusDegradedLatency', 'Замедление ответа'),
                checkedAt: Date.now(),
            };
        }

        if (response.status === 429) {
            return {
                provider: 'mistral',
                state: 'degraded',
                latencyMs: durationMs,
                message: t('serverStatusRateLimit', 'Лимит запросов (Rate Limit)'),
                checkedAt: Date.now(),
            };
        }

        if (response.status === 401 || response.status === 403) {
            return {
                provider: 'mistral',
                state: 'outage',
                latencyMs: durationMs,
                message: t('serverStatusAuthError', 'Недействительный API-ключ'),
                checkedAt: Date.now(),
            };
        }

        if (response.status >= 500) {
            return {
                provider: 'mistral',
                state: 'outage',
                latencyMs: durationMs,
                message: t('serverStatusServerError', `Сбой сервера (${response.status})`),
                checkedAt: Date.now(),
            };
        }

        return {
            provider: 'mistral',
            state: 'outage',
            latencyMs: durationMs,
            message: t('serverStatusHttpError', `Ошибка HTTP ${response.status}`),
            checkedAt: Date.now(),
        };
    } catch (error) {
        const durationMs = performance.now() - startTime;
        if (error instanceof AiProviderError && error.status) {
            return evaluateHealthFromRuntimeResponse('mistral', durationMs, error.status);
        }
        const isTimeout =
            error instanceof Error &&
            (error.name === 'TimeoutError' ||
                error.name === 'AbortError' ||
                error.message.includes('timeout') ||
                error.message.includes('aborted'));

        if (isTimeout) {
            return {
                provider: 'mistral',
                state: 'degraded',
                latencyMs: durationMs,
                message: t('serverStatusTimeout', 'Тайм-аут соединения'),
                checkedAt: Date.now(),
            };
        }

        return {
            provider: 'mistral',
            state: 'outage',
            latencyMs: durationMs,
            message: t('serverStatusNetworkError', 'Ошибка сети / недоступен'),
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
            message:
                provider === 'cloudflare'
                    ? t('cloudflareRateLimit', 'Дневная квота Cloudflare Workers AI исчерпана. Попробуйте позже.')
                    : t('serverStatusRateLimit', 'Лимит запросов (Rate Limit)'),
            checkedAt: Date.now(),
        };
    }

    if (errorStatus && errorStatus >= 500) {
        return {
            provider,
            state: 'outage',
            latencyMs: durationMs,
            message:
                provider === 'cloudflare'
                    ? t('cloudflareServerError', 'Ошибка сервера Cloudflare Workers AI.')
                    : t('serverStatusServerError', `Сбой сервера (${errorStatus})`),
            checkedAt: Date.now(),
        };
    }

    if (errorStatus === 401 || errorStatus === 403) {
        return {
            provider,
            state: 'outage',
            latencyMs: durationMs,
            message:
                provider === 'cloudflare'
                    ? t('cloudflareAuthError', 'Проверьте Cloudflare API Token.')
                    : t('serverStatusAuthError', 'Недействительный API-ключ'),
            checkedAt: Date.now(),
        };
    }

    if (errorStatus === 404 && provider === 'cloudflare') {
        return {
            provider,
            state: 'outage',
            latencyMs: durationMs,
            message: t('cloudflareAccountError', 'Проверьте Cloudflare Account ID.'),
            checkedAt: Date.now(),
        };
    }

    if (errorStatus && errorStatus >= 400) {
        return {
            provider,
            state: 'outage',
            latencyMs: durationMs,
            message: t('serverStatusHttpError', `Ошибка HTTP ${errorStatus}`),
            checkedAt: Date.now(),
        };
    }
    if (isNetworkError) {
        return {
            provider,
            state: 'outage',
            latencyMs: durationMs,
            message:
                provider === 'cloudflare'
                    ? t('cloudflareNetworkError', 'Не удалось подключиться к Cloudflare Workers AI.')
                    : t('serverStatusNetworkError', 'Ошибка сети / недоступен'),
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
                    cloudflare: fresh(cached.cloudflare),
                    mistral: fresh(cached.mistral),
                };
            }
        }
    } catch {
        // Fallback
    }
    return { cloudflare: null, mistral: null };
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
