import { t } from './i18n';
import {
    AiProviderError,
    type AiErrorCode,
    type AiProviderType,
    type CloudflareCredentials,
} from './ai-provider-types';
import { validateCloudflareCredentials } from './cloudflare-client';
import { AI_CONFIG, normalizeCloudflareModel } from './ai-models-config';
import {
    getProviderAvailability,
    markProviderProbing,
    recordProviderFailure,
    recordProviderSuccess,
    releaseProviderAttempt,
} from './provider-availability';
import { probeMistralConnection } from './mistral-client';

export type HealthState =
    'healthy' | 'degraded' | 'cooldown' | 'probe-ready' | 'probing' | 'outage' | 'unconfigured' | 'checking';

export interface ProviderHealthStatus {
    provider: AiProviderType;
    state: HealthState;
    latencyMs?: number;
    message: string;
    subMessage?: string;
    checkedAt: number;
    model?: string;
    cooldownRemainingMs?: number;
    errorCode?: string;
}

export interface CheckProviderHealthOptions {
    probe?: boolean;
}

const HEALTH_CACHE_KEY = 'lexisync_provider_health_cache';
const HEALTH_CACHE_MAX_AGE_MS = 15 * 60_000;
const activeProbes = new Map<AiProviderType, Promise<ProviderHealthStatus>>();

export function getHealthStateColor(state: HealthState): string {
    switch (state) {
        case 'healthy':
            return '#10b981'; // 🟢 зеленый
        case 'degraded':
            return '#f59e0b'; // 🟡 желтый
        case 'cooldown':
            return '#f97316';
        case 'probe-ready':
            return '#0ea5e9'; // 🔵 готов к проверке
        case 'probing':
        case 'checking':
            return '#3b82f6'; // 🔵 синий / проверка
        case 'outage':
            return '#ef4444'; // 🔴 красный
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
        case 'cooldown':
            return '⏳';
        case 'probe-ready':
            return '🔍';
        case 'probing':
        case 'checking':
            return '🔄';
        case 'outage':
            return '🔴';
        case 'unconfigured':
        default:
            return '⚪';
    }
}

export function formatHealthMessage(status: ProviderHealthStatus): string {
    const latencyStr = typeof status.latencyMs === 'number' ? ` (${Math.round(status.latencyMs)} мс)` : '';
    const subStr = status.subMessage ? ` • ${status.subMessage}` : '';
    return `${status.message}${subStr}${latencyStr}`;
}

export async function checkProviderHealth(
    provider: AiProviderType,
    apiKey: string | CloudflareCredentials,
    timeoutMs = 7000,
    cloudflareModel: unknown = AI_CONFIG.cloudflare.defaultModel,
    options?: CheckProviderHealthOptions,
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

        const availability = await getProviderAvailability('cloudflare');
        if (availability.cooldownRemainingMs > 0) {
            const seconds = Math.max(1, Math.ceil(availability.cooldownRemainingMs / 1000));
            return {
                provider: 'cloudflare',
                state: 'cooldown',
                message: t('serverStatusMistralLimited', 'Временно ограничен API-провайдером'),
                subMessage: t(
                    'serverStatusMistralRetryIn',
                    `Повторная проверка через ${seconds} сек.`,
                    String(seconds),
                ),
                cooldownRemainingMs: availability.cooldownRemainingMs,
                checkedAt: Date.now(),
                model: resolvedModel,
                errorCode: availability.lastErrorCode,
            };
        }

        if (options?.probe !== true) {
            if (availability.healthState === 'probe-ready') {
                return {
                    provider: 'cloudflare',
                    state: 'probe-ready',
                    message: t('serverStatusProbeReadyTitle', 'Пауза завершена'),
                    subMessage: t('serverStatusProbeReadySubtext', 'Можно проверить доступность'),
                    checkedAt: Date.now(),
                    model: resolvedModel,
                    errorCode: availability.lastErrorCode,
                };
            }
            if (availability.healthState === 'probing') {
                return {
                    provider: 'cloudflare',
                    state: 'probing',
                    message: t('serverStatusProbing', 'Проверяем доступность…'),
                    checkedAt: Date.now(),
                    model: resolvedModel,
                };
            }
            if (options?.probe === false) {
                if (availability.healthState === 'degraded') {
                    return {
                        provider: 'cloudflare',
                        state: 'degraded',
                        message: t('serverStatusUnstable', 'Работает нестабильно'),
                        subMessage: t('serverStatusDegradedLatency', 'Замедление ответа'),
                        checkedAt: Date.now(),
                        model: resolvedModel,
                        errorCode: availability.lastErrorCode,
                    };
                }
                const cached = await loadCachedHealthStatus();
                if (cached.cloudflare) return cached.cloudflare;
                return {
                    provider: 'cloudflare',
                    state: 'unconfigured',
                    message: t('serverStatusNotChecked', 'Статус не проверен'),
                    checkedAt: Date.now(),
                    model: resolvedModel,
                };
            }
        }

        if (activeProbes.has('cloudflare')) {
            return activeProbes.get('cloudflare')!;
        }

        const probePromise = (async (): Promise<ProviderHealthStatus> => {
            try {
                const signal = AbortSignal.timeout(timeoutMs);
                const result = await validateCloudflareCredentials(creds, resolvedModel, signal);

                if (result.ok) {
                    await recordProviderSuccess('cloudflare');
                    const isDegraded = (result.latencyMs ?? 0) >= 2500;
                    return {
                        provider: 'cloudflare',
                        state: isDegraded ? 'degraded' : 'healthy',
                        latencyMs: result.latencyMs,
                        message: isDegraded
                            ? t('serverStatusUnstable', 'Работает нестабильно')
                            : t('serverStatusHealthy', 'Работает отлично'),
                        subMessage: isDegraded ? t('serverStatusDegradedLatency', 'Замедление ответа') : undefined,
                        checkedAt: Date.now(),
                        model: resolvedModel,
                    };
                }

                if (result.status === 429) {
                    return {
                        provider: 'cloudflare',
                        state: 'degraded',
                        latencyMs: result.latencyMs,
                        message: t('serverStatusRateLimit', 'Лимит запросов (Rate Limit)'),
                        checkedAt: Date.now(),
                        model: resolvedModel,
                        errorCode: result.errorCode,
                    };
                }

                return {
                    provider: 'cloudflare',
                    state: 'outage',
                    latencyMs: result.latencyMs,
                    message: result.message,
                    checkedAt: Date.now(),
                    model: resolvedModel,
                    errorCode: result.errorCode,
                };
            } finally {
                activeProbes.delete('cloudflare');
            }
        })();

        activeProbes.set('cloudflare', probePromise);
        const resolved = await probePromise;
        void saveCachedHealthStatus({ cloudflare: resolved });
        return resolved;
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

    const availability = await getProviderAvailability('mistral');
    if (availability.cooldownRemainingMs > 0) {
        const seconds = Math.max(1, Math.ceil(availability.cooldownRemainingMs / 1000));
        return {
            provider: 'mistral',
            state: 'cooldown',
            message: t('serverStatusMistralLimited', 'Временно ограничен API-провайдером'),
            subMessage: t('serverStatusMistralRetryIn', `Повторная проверка через ${seconds} сек.`, String(seconds)),
            cooldownRemainingMs: availability.cooldownRemainingMs,
            checkedAt: Date.now(),
            errorCode: availability.lastErrorCode,
        };
    }

    if (options?.probe !== true) {
        if (availability.healthState === 'probe-ready') {
            return {
                provider: 'mistral',
                state: 'probe-ready',
                message: t('serverStatusProbeReadyTitle', 'Пауза завершена'),
                subMessage: t('serverStatusProbeReadySubtext', 'Можно проверить доступность'),
                checkedAt: Date.now(),
                errorCode: availability.lastErrorCode,
            };
        }
        if (availability.healthState === 'probing') {
            return {
                provider: 'mistral',
                state: 'probing',
                message: t('serverStatusProbing', 'Проверяем доступность…'),
                checkedAt: Date.now(),
            };
        }
        if (options?.probe === false) {
            if (availability.healthState === 'degraded') {
                return {
                    provider: 'mistral',
                    state: 'degraded',
                    message: t('serverStatusUnstable', 'Работает нестабильно'),
                    subMessage: t('serverStatusDegradedFallback', 'Используется резервный Cloudflare'),
                    checkedAt: Date.now(),
                    errorCode: availability.lastErrorCode,
                };
            }
            const cached = await loadCachedHealthStatus();
            if (cached.mistral) return cached.mistral;
            return {
                provider: 'mistral',
                state: 'unconfigured',
                message: t('serverStatusNotChecked', 'Статус не проверен'),
                checkedAt: Date.now(),
            };
        }
    }

    if (activeProbes.has('mistral')) {
        return activeProbes.get('mistral')!;
    }

    const probePromise = (async (): Promise<ProviderHealthStatus> => {
        try {
            await markProviderProbing('mistral');
            const probeResult = await probeMistralConnection(trimmedKey, AbortSignal.timeout(timeoutMs));

            if (probeResult.ok) {
                await recordProviderSuccess('mistral');
                const isDegraded = (probeResult.latencyMs ?? 0) >= 2500;
                return {
                    provider: 'mistral',
                    state: isDegraded ? 'degraded' : 'healthy',
                    latencyMs: probeResult.latencyMs,
                    message: isDegraded
                        ? t('serverStatusUnstable', 'Работает нестабильно')
                        : t('serverStatusHealthy', 'Работает отлично'),
                    subMessage: isDegraded ? t('serverStatusDegradedLatency', 'Замедление ответа') : undefined,
                    checkedAt: Date.now(),
                };
            }

            const error = new AiProviderError(
                probeResult.message,
                (probeResult.errorCode as AiErrorCode) || 'SERVER_ERROR',
                'mistral',
                probeResult.status === 429 || !probeResult.status || probeResult.status >= 500,
                probeResult.status,
                probeResult.retryAfterMs,
            );
            await recordProviderFailure(error);
            const updated = await getProviderAvailability('mistral');
            if (updated.cooldownRemainingMs > 0) {
                const seconds = Math.max(1, Math.ceil(updated.cooldownRemainingMs / 1000));
                return {
                    provider: 'mistral',
                    state: 'cooldown',
                    message: t('serverStatusMistralLimited', 'Временно ограничен API-провайдером'),
                    subMessage: t(
                        'serverStatusMistralRetryIn',
                        `Повторная проверка через ${seconds} сек.`,
                        String(seconds),
                    ),
                    latencyMs: probeResult.latencyMs,
                    cooldownRemainingMs: updated.cooldownRemainingMs,
                    checkedAt: Date.now(),
                    errorCode: updated.lastErrorCode,
                };
            }

            const isAuth = probeResult.status === 401 || probeResult.status === 403;
            const isOutage =
                isAuth ||
                (typeof probeResult.status === 'number' && probeResult.status >= 500) ||
                probeResult.errorCode === 'NETWORK_ERROR' ||
                probeResult.errorCode === 'SERVER_ERROR';
            return {
                provider: 'mistral',
                state: isOutage ? 'outage' : 'degraded',
                latencyMs: probeResult.latencyMs,
                message: probeResult.message,
                checkedAt: Date.now(),
                errorCode: probeResult.errorCode,
            };
        } finally {
            activeProbes.delete('mistral');
            await releaseProviderAttempt('mistral');
        }
    })();

    activeProbes.set('mistral', probePromise);
    const resolved = await probePromise;
    void saveCachedHealthStatus({ mistral: resolved });
    return resolved;
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
                    ? t('cloudflareRateLimit', 'Превышен лимит запросов Cloudflare Workers AI. Попробуйте позже.')
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
