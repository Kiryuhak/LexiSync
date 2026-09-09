import { t } from './i18n';
import { recordErrorLog } from './error-log';
import {
    AiProviderError,
    type AiErrorCode,
    type AiExecutionResult,
    type AiProviderType,
    type AiRequestOptions,
    type PrimaryAiProvider,
    type AIProvider,
    type CloudflareCredentials,
} from './ai-provider-types';
import { mistralProvider } from './mistral-provider';
import { cloudflareWorkersAIProvider } from './cloudflare-provider';

export const AI_PROVIDERS: Record<AiProviderType, AIProvider> = {
    mistral: mistralProvider,
    cloudflare: cloudflareWorkersAIProvider,
};

const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
const DEFAULT_PROVIDER_STALL_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;
const CIRCUIT_BREAKER_FAILURES = 2;
const CIRCUIT_BREAKER_COOLDOWN_MS = 20_000;

interface ProviderHealth {
    consecutiveFailures: number;
    cooldownUntil: number;
    lastErrorCode?: AiErrorCode;
}

const providerHealth: Record<AiProviderType, ProviderHealth> = {
    mistral: { consecutiveFailures: 0, cooldownUntil: 0 },
    cloudflare: { consecutiveFailures: 0, cooldownUntil: 0 },
};

export function resetAiProviderHealth(): void {
    for (const state of Object.values(providerHealth)) {
        state.consecutiveFailures = 0;
        state.cooldownUntil = 0;
        state.lastErrorCode = undefined;
    }
}

export function getAiProviderCooldownRemaining(provider: AiProviderType, now = Date.now()): number {
    return Math.max(0, providerHealth[provider].cooldownUntil - now);
}

function recordProviderSuccess(provider: AiProviderType): void {
    providerHealth[provider].consecutiveFailures = 0;
    providerHealth[provider].cooldownUntil = 0;
    providerHealth[provider].lastErrorCode = undefined;
}

function recordProviderFailure(error: AiProviderError, now = Date.now()): void {
    void recordErrorLog({
        level: 'error',
        source: 'ai-client',
        provider: error.provider,
        errorCode: error.code,
        status: error.status,
        message: error.message,
    });
    if (!error.isFallbackEligible) return;
    const state = providerHealth[error.provider];
    state.lastErrorCode = error.code;
    state.consecutiveFailures += 1;
    if (error.code === 'RATE_LIMIT' || error.code === 'QUOTA_EXCEEDED') {
        const cooldownMs = Math.min(
            Math.max(1_000, error.retryAfterMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS),
            MAX_RATE_LIMIT_COOLDOWN_MS,
        );
        state.cooldownUntil = Math.max(state.cooldownUntil, now + cooldownMs);
    } else if (state.consecutiveFailures >= CIRCUIT_BREAKER_FAILURES) {
        state.cooldownUntil = Math.max(state.cooldownUntil, now + CIRCUIT_BREAKER_COOLDOWN_MS);
    }
}

async function runWithProviderTimeout<T>(
    provider: AiProviderType,
    parentSignal: AbortSignal,
    timeoutMs: number,
    stallTimeoutMs: number,
    task: (signal: AbortSignal, markActivity: () => void) => Promise<T>,
): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const abortFromParent = () => controller.abort(parentSignal.reason);
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });

    const armTimeout = (delayMs: number) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(
            () => {
                timedOut = true;
                controller.abort(
                    new DOMException(t('providerTimeout', 'AI-сервис не ответил вовремя.'), 'TimeoutError'),
                );
            },
            Math.max(1, delayMs),
        );
    };

    armTimeout(timeoutMs);
    try {
        return await task(controller.signal, () => armTimeout(stallTimeoutMs));
    } catch (error) {
        if (timedOut && !parentSignal.aborted) {
            throw new AiProviderError(t('providerTimeout', 'AI-сервис не ответил вовремя.'), 'TIMEOUT', provider, true);
        }
        throw error;
    } finally {
        if (timeout) clearTimeout(timeout);
        parentSignal.removeEventListener('abort', abortFromParent);
    }
}

export function normalizeAiError(error: unknown, provider: AiProviderType): AiProviderError {
    if (error instanceof AiProviderError) return error;
    if (error instanceof DOMException && error.name === 'AbortError') {
        return new AiProviderError(t('requestCancelled', 'Запрос отменён.'), 'TIMEOUT', provider, false);
    }
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const sourceRetryable =
        error &&
        typeof error === 'object' &&
        'retryable' in error &&
        typeof (error as { retryable: unknown }).retryable === 'boolean'
            ? Boolean((error as { retryable: boolean }).retryable)
            : undefined;
    const sourceStatus =
        error &&
        typeof error === 'object' &&
        'status' in error &&
        typeof (error as { status: unknown }).status === 'number'
            ? (error as { status: number }).status
            : undefined;
    const retryAfterMs =
        error &&
        typeof error === 'object' &&
        'retryAfterMs' in error &&
        typeof (error as { retryAfterMs: unknown }).retryAfterMs === 'number'
            ? (error as { retryAfterMs: number }).retryAfterMs
            : undefined;

    if (sourceStatus === 401 || sourceStatus === 403) {
        return new AiProviderError(message, 'AUTH_ERROR', provider, false, sourceStatus);
    }
    if (sourceStatus === 404) {
        return new AiProviderError(message, 'ACCOUNT_ERROR', provider, false, sourceStatus);
    }
    if (sourceStatus === 429) {
        return new AiProviderError(message, 'RATE_LIMIT', provider, sourceRetryable ?? true, 429, retryAfterMs);
    }
    if (sourceStatus && sourceStatus >= 500 && sourceStatus <= 599) {
        return new AiProviderError(message, 'SERVER_ERROR', provider, sourceRetryable ?? true, sourceStatus);
    }
    if (sourceStatus && sourceStatus >= 400 && sourceStatus < 500) {
        return new AiProviderError(message, 'INVALID_REQUEST', provider, false, sourceStatus);
    }

    const isNetwork =
        lower.includes('failed to fetch') ||
        lower.includes('networkerror') ||
        lower.includes('network') ||
        lower.includes('не удалось подключиться') ||
        error instanceof TypeError;
    if (isNetwork) {
        return new AiProviderError(message, 'NETWORK_ERROR', provider, sourceRetryable ?? true);
    }
    if (
        lower.includes('лимит') ||
        lower.includes('limit') ||
        lower.includes('rate_limit') ||
        lower.includes('too many requests') ||
        lower.includes('429') ||
        lower.includes('quota')
    ) {
        return new AiProviderError(message, 'RATE_LIMIT', provider, sourceRetryable ?? true, 429);
    }
    if (
        lower.includes('недействителен') ||
        lower.includes('отозван') ||
        lower.includes('invalid') ||
        lower.includes('unauthorized') ||
        lower.includes('401') ||
        lower.includes('403')
    ) {
        return new AiProviderError(message, 'AUTH_ERROR', provider, false, 401);
    }
    if (
        lower.includes('временно') ||
        lower.includes('unavailable') ||
        lower.includes('internal server error') ||
        lower.includes('500') ||
        lower.includes('502') ||
        lower.includes('503') ||
        lower.includes('504')
    ) {
        return new AiProviderError(message, 'SERVER_ERROR', provider, sourceRetryable ?? true, 503);
    }
    if (sourceRetryable) {
        return new AiProviderError(message, 'INVALID_RESPONSE', provider, true, sourceStatus, retryAfterMs);
    }
    return new AiProviderError(message, 'UNKNOWN_ERROR', provider, sourceRetryable ?? false);
}

export function getFallbackNotification(
    fromProvider: AiProviderType,
    toProvider: AiProviderType,
    code: AiErrorCode,
): string {
    if (fromProvider === 'mistral' && toProvider === 'cloudflare') {
        if (code === 'RATE_LIMIT' || code === 'QUOTA_EXCEEDED') {
            return t(
                'fallbackToCloudflareDueToRateLimit',
                'Лимит Mistral достигнут. Запрос выполнен через Cloudflare Workers AI.',
            );
        }
        return t(
            'fallbackToCloudflareDueToOutage',
            'Сервис Mistral временно недоступен. Использован Cloudflare Workers AI.',
        );
    }
    if (fromProvider === 'cloudflare' && toProvider === 'mistral') {
        if (code === 'RATE_LIMIT' || code === 'QUOTA_EXCEEDED') {
            return t('fallbackToMistralDueToRateLimit', 'Лимит Cloudflare достигнут. Запрос выполнен через Mistral.');
        }
        if (code === 'QUALITY_CHECK_FAILED') {
            return t(
                'fallbackDueToQuality',
                'Ответ Cloudflare не прошёл проверку качества. Запрос выполнен через Mistral.',
            );
        }
        return t('fallbackToMistralDueToOutage', 'Сервис Cloudflare временно недоступен. Использован Mistral.');
    }
    return '';
}

export function resolveExecutionPlan(options: {
    primaryProvider: PrimaryAiProvider;
    autoFallback: boolean;
    mistralApiKey?: string;
    cloudflareAccountId?: string;
    cloudflareApiToken?: string;
}): { primary: AiProviderType; backup?: AiProviderType } {
    const mistralKey = (options.mistralApiKey || '').trim();
    const cfAccount = (options.cloudflareAccountId || '').trim();
    const cfToken = (options.cloudflareApiToken || '').trim();
    const hasCloudflare = Boolean(cfAccount && cfToken);
    const hasMistral = Boolean(mistralKey);

    let primary: AiProviderType;
    let secondary: AiProviderType;

    if (options.primaryProvider === 'cloudflare') {
        primary = 'cloudflare';
        secondary = 'mistral';
    } else if (options.primaryProvider === 'mistral') {
        primary = 'mistral';
        secondary = 'cloudflare';
    } else {
        // 'auto'
        if (hasMistral) {
            primary = 'mistral';
            secondary = 'cloudflare';
        } else if (hasCloudflare) {
            primary = 'cloudflare';
            secondary = 'mistral';
        } else {
            primary = 'mistral';
            secondary = 'cloudflare';
        }
    }

    const hasBackupKey = secondary === 'mistral' ? hasMistral : hasCloudflare;
    return {
        primary,
        backup: options.autoFallback && hasBackupKey ? secondary : undefined,
    };
}

export async function executeAiStreamRequest(options: AiRequestOptions): Promise<AiExecutionResult> {
    const mistralKey = (options.mistralApiKey || '').trim();
    const cfAccount = (options.cloudflareAccountId || '').trim();
    const cfToken = (options.cloudflareApiToken || '').trim();

    const plan = resolveExecutionPlan({
        primaryProvider: options.primaryProvider,
        autoFallback: options.autoFallback,
        mistralApiKey: mistralKey,
        cloudflareAccountId: cfAccount,
        cloudflareApiToken: cfToken,
    });

    const isConfigured = (provider: AiProviderType): boolean => {
        if (provider === 'mistral') return Boolean(mistralKey);
        return Boolean(cfAccount && cfToken);
    };

    const callProvider = async (
        provider: AiProviderType,
        signal: AbortSignal,
        onChunk: (text: string) => void,
    ): Promise<void> => {
        if (!isConfigured(provider)) {
            const missingMsg =
                provider === 'mistral'
                    ? t('apiKeyMissing', 'API-ключ Mistral не настроен.')
                    : t(
                          'cloudflareCredentialsMissing',
                          'Данные Cloudflare Workers AI (Account ID и API Token) не настроены.',
                      );
            throw new AiProviderError(missingMsg, 'AUTH_ERROR', provider, false, 401);
        }
        const credential =
            provider === 'mistral'
                ? mistralKey
                : ({ accountId: cfAccount, apiToken: cfToken } as CloudflareCredentials);

        await runWithProviderTimeout(
            provider,
            signal,
            options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
            options.providerStallTimeoutMs ?? DEFAULT_PROVIDER_STALL_TIMEOUT_MS,
            async (providerSignal, markActivity) => {
                const onProviderChunk = (text: string) => {
                    markActivity();
                    onChunk(text);
                };
                const providerInstance = AI_PROVIDERS[provider];
                await providerInstance.streamChat(
                    options.request,
                    credential,
                    options.settings,
                    providerSignal,
                    onProviderChunk,
                    provider === 'cloudflare' ? options.cloudflareModel : undefined,
                );
            },
        );
    };

    // Провайдер в cooldown пропускается только когда есть готовый резервный сервис.
    let effectivePrimary = plan.primary;
    let fallbackProvider = plan.backup;
    let preemptiveFallback = false;
    const cooldownReason = providerHealth[plan.primary].lastErrorCode ?? 'RATE_LIMIT';

    if (!isConfigured(effectivePrimary)) {
        const missingMsg =
            effectivePrimary === 'mistral'
                ? t('apiKeyMissing', 'API-ключ Mistral не настроен.')
                : t('cloudflareCredentialsMissing', 'Данные Cloudflare Workers AI не настроены.');
        throw new AiProviderError(missingMsg, 'AUTH_ERROR', effectivePrimary, false, 401);
    } else if (
        options.autoFallback &&
        fallbackProvider &&
        getAiProviderCooldownRemaining(effectivePrimary) > 0 &&
        getAiProviderCooldownRemaining(fallbackProvider) === 0
    ) {
        effectivePrimary = fallbackProvider;
        fallbackProvider = undefined;
        preemptiveFallback = true;
    }

    // Первая попытка: один провайдер за раз, без параллельной передачи пользовательского текста.
    let primaryError: AiProviderError;
    let primaryProducedContent = false;
    try {
        await callProvider(effectivePrimary, options.signal, (text) => {
            primaryProducedContent = true;
            options.onChunk(text);
        });
        recordProviderSuccess(effectivePrimary);
        return {
            providerUsed: effectivePrimary,
            fallbackOccurred: preemptiveFallback,
            fallbackReason: preemptiveFallback ? cooldownReason : undefined,
            fallbackNotification: preemptiveFallback
                ? getFallbackNotification(plan.primary, effectivePrimary, cooldownReason)
                : undefined,
        };
    } catch (err) {
        if (options.signal.aborted) throw err;
        primaryError = normalizeAiError(err, effectivePrimary);
        recordProviderFailure(primaryError);
    }

    // КРИТИЧНОЕ ПРАВИЛО: Fallback разрешен ТОЛЬКО при ошибках, подходящих под fallback (isFallbackEligible: 429, 5xx, timeout, network error).
    // Для AUTH_ERROR (401, 403, некорректный ключ) и ACCOUNT_ERROR (404) fallback СТРОГО ЗАПРЕЩЕН, чтобы пользователь четко видел ошибку конфигурации.
    const canFallback =
        options.autoFallback &&
        Boolean(fallbackProvider) &&
        isConfigured(fallbackProvider!) &&
        getAiProviderCooldownRemaining(fallbackProvider!) === 0 &&
        primaryError.isFallbackEligible;

    if (!canFallback || !fallbackProvider) throw primaryError;

    // Частичный поток первого сервиса нельзя смешивать с новым ответом резервного сервиса.
    if (primaryProducedContent) options.onReset?.();

    // Резервный провайдер вызывается ровно один раз; возврата к первому сервису нет (no fallback loop).
    try {
        await callProvider(fallbackProvider, options.signal, options.onChunk);
        recordProviderSuccess(fallbackProvider);
        const notification = getFallbackNotification(effectivePrimary, fallbackProvider, primaryError.code);
        return {
            providerUsed: fallbackProvider,
            fallbackOccurred: true,
            fallbackReason: primaryError.code,
            fallbackNotification: notification,
        };
    } catch (secondErr) {
        if (options.signal.aborted) throw secondErr;
        const secondaryError = normalizeAiError(secondErr, fallbackProvider);
        recordProviderFailure(secondaryError);
        if (
            (primaryError.code === 'RATE_LIMIT' || primaryError.code === 'QUOTA_EXCEEDED') &&
            (secondaryError.code === 'RATE_LIMIT' || secondaryError.code === 'QUOTA_EXCEEDED')
        ) {
            throw new AiProviderError(
                t(
                    'allProvidersRateLimited',
                    'Лимиты всех доступных AI-провайдеров (Mistral и Cloudflare) исчерпаны. Попробуйте позже.',
                ),
                'RATE_LIMIT',
                fallbackProvider,
                true,
                429,
            );
        }
        throw secondaryError;
    }
}
