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
import { AI_CONFIG, normalizeCloudflareModel } from './ai-models-config';
import {
    acquireProviderAttempt,
    peekProviderAvailability,
    recordProviderFailure as recordAvailabilityFailure,
    recordProviderSuccess as recordAvailabilitySuccess,
    releaseProviderAttempt,
    resetProviderAvailability,
} from './provider-availability';

export const AI_PROVIDERS: Record<AiProviderType, AIProvider> = {
    mistral: mistralProvider,
    cloudflare: cloudflareWorkersAIProvider,
};

const DEFAULT_PROVIDER_TIMEOUT_MS = 20_000;
const DEFAULT_PROVIDER_STALL_TIMEOUT_MS = 15_000;
const DEFAULT_PROVIDER_TOTAL_TIMEOUT_MS = 40_000;

export function resetAiProviderHealth(): void {
    resetProviderAvailability();
}

export function getAiProviderCooldownRemaining(provider: AiProviderType, now = Date.now()): number {
    return peekProviderAvailability(provider, now).cooldownRemainingMs;
}

async function writeProviderFailureLog(
    error: AiProviderError,
    fallbackProvider?: AiProviderType,
    fallbackUsed = false,
): Promise<void> {
    await recordErrorLog({
        level: 'error',
        source: 'ai-client',
        provider: error.provider,
        errorCode: error.code,
        status: error.status,
        httpStatus: error.status,
        message: error.message,
        operation: error.context.operation,
        model: error.context.model,
        attempt: error.context.attempt,
        fallbackProvider,
        fallbackUsed,
        retryAfterMs: error.retryAfterMs,
        latencyMs: error.context.latencyMs,
    });
}

async function runWithProviderTimeout<T>(
    provider: AiProviderType,
    parentSignal: AbortSignal,
    timeoutMs: number,
    stallTimeoutMs: number,
    totalTimeoutMs: number,
    task: (signal: AbortSignal, markActivity: () => void) => Promise<T>,
): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    let activityTimeout: ReturnType<typeof setTimeout> | undefined;
    const abortFromParent = () => controller.abort(parentSignal.reason);
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });

    if (parentSignal.aborted) {
        parentSignal.removeEventListener('abort', abortFromParent);
        throw parentSignal.reason instanceof Error
            ? parentSignal.reason
            : new DOMException(t('requestCancelled', 'Запрос отменён.'), 'AbortError');
    }

    const armTimeout = (delayMs: number) => {
        if (activityTimeout) clearTimeout(activityTimeout);
        activityTimeout = setTimeout(
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
    const totalTimeout = setTimeout(
        () => {
            timedOut = true;
            controller.abort(new DOMException(t('providerTimeout', 'AI-сервис не ответил вовремя.'), 'TimeoutError'));
        },
        Math.max(1, totalTimeoutMs),
    );
    try {
        return await task(controller.signal, () => armTimeout(stallTimeoutMs));
    } catch (error) {
        if (timedOut && !parentSignal.aborted) {
            throw new AiProviderError(t('providerTimeout', 'AI-сервис не ответил вовремя.'), 'TIMEOUT', provider, true);
        }
        throw error;
    } finally {
        if (activityTimeout) clearTimeout(activityTimeout);
        clearTimeout(totalTimeout);
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
        lower.includes('invalid api key') ||
        lower.includes('invalid token') ||
        lower.includes('invalid credentials') ||
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
        if (code === 'QUALITY_CHECK_FAILED') {
            return t(
                'fallbackToCloudflareDueToQuality',
                'Ответ Mistral не прошёл проверку качества. Запрос выполнен через Cloudflare Workers AI.',
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

    let attempts = 0;
    const callProvider = async (
        provider: AiProviderType,
        signal: AbortSignal,
        onChunk: (text: string) => void,
        fallbackProvider?: AiProviderType,
    ) => {
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

        attempts += 1;
        if (attempts > 2) {
            throw new AiProviderError(
                t('aiRequestBudgetExceeded', 'Лимит обращений к AI для одного запроса исчерпан.'),
                'INVALID_REQUEST',
                provider,
                false,
            );
        }
        const startedAt = Date.now();
        try {
            return await runWithProviderTimeout(
                provider,
                signal,
                options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
                options.providerStallTimeoutMs ?? DEFAULT_PROVIDER_STALL_TIMEOUT_MS,
                options.providerTotalTimeoutMs ?? DEFAULT_PROVIDER_TOTAL_TIMEOUT_MS,
                async (providerSignal, markActivity) => {
                    const onProviderChunk = (text: string) => {
                        markActivity();
                        onChunk(text);
                    };
                    const providerInstance = AI_PROVIDERS[provider];
                    return providerInstance.streamChat(
                        options.request,
                        credential,
                        options.settings,
                        providerSignal,
                        onProviderChunk,
                        provider === 'cloudflare' ? options.cloudflareModel : undefined,
                        markActivity,
                    );
                },
            );
        } catch (error) {
            const normalized = normalizeAiError(error, provider);
            throw new AiProviderError(
                normalized.message,
                normalized.code,
                provider,
                normalized.retryable,
                normalized.status,
                normalized.retryAfterMs,
                {
                    ...normalized.context,
                    operation: options.request.mode || 'unknown',
                    model:
                        provider === 'cloudflare'
                            ? normalizeCloudflareModel(options.cloudflareModel)
                            : AI_CONFIG.mistral.defaultModel,
                    attempt: attempts,
                    fallbackProvider,
                    latencyMs: Date.now() - startedAt,
                },
            );
        }
    };

    let effectivePrimary = plan.primary;
    let fallbackProvider = plan.backup;
    let preemptiveFallback = false;
    const primaryAvailability = await acquireProviderAttempt(plan.primary);
    const cooldownReason = primaryAvailability.lastErrorCode ?? 'RATE_LIMIT';

    const formatAvailabilityReason = (provider: AiProviderType): string => {
        const code = peekProviderAvailability(provider).lastErrorCode;
        if (code === 'RATE_LIMIT' || code === 'QUOTA_EXCEEDED')
            return t('providerReasonRateLimit', 'лимит временно достигнут');
        if (code === 'TIMEOUT') return t('providerReasonTimeout', 'сервис не ответил вовремя');
        if (code === 'NETWORK_ERROR') return t('providerReasonNetwork', 'ошибка сети');
        if (code === 'SERVER_ERROR') return t('providerReasonServer', 'временный сбой сервера');
        if (code === 'INVALID_RESPONSE') return t('providerReasonInvalidResponse', 'некорректный ответ сервиса');
        return t('providerReasonUnavailable', 'временная недоступность');
    };

    const unavailableError = (
        provider: AiProviderType,
        retryAfterMs: number,
        fallback?: AiProviderType,
    ): AiProviderError => {
        const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
        const message = fallback
            ? t(
                  'allProvidersUnavailableDetailed',
                  `Оба AI-провайдера временно недоступны. Mistral: ${formatAvailabilityReason('mistral')}. Cloudflare: ${formatAvailabilityReason('cloudflare')}. Повторите запрос примерно через ${seconds} сек.`,
                  [formatAvailabilityReason('mistral'), formatAvailabilityReason('cloudflare'), String(seconds)],
              )
            : t(
                  'providersTemporarilyUnavailable',
                  `AI-провайдер временно недоступен. Повторите запрос примерно через ${seconds} сек.`,
                  String(seconds),
              );
        return new AiProviderError(message, 'PROVIDERS_UNAVAILABLE', provider, true, undefined, retryAfterMs, {
            operation: options.request.mode || 'unknown',
            fallbackProvider: fallback,
        });
    };
    const earliestRetry = (...values: number[]): number => {
        const positive = values.filter((value) => Number.isFinite(value) && value > 0);
        return positive.length > 0 ? Math.min(...positive) : 1_000;
    };

    if (!isConfigured(effectivePrimary)) {
        await releaseProviderAttempt(effectivePrimary);
        const missingMsg =
            effectivePrimary === 'mistral'
                ? t('apiKeyMissing', 'API-ключ Mistral не настроен.')
                : t('cloudflareCredentialsMissing', 'Данные Cloudflare Workers AI не настроены.');
        throw new AiProviderError(missingMsg, 'AUTH_ERROR', effectivePrimary, false, 401);
    } else if (!primaryAvailability.allowed) {
        if (options.autoFallback && fallbackProvider && isConfigured(fallbackProvider)) {
            const backupAvailability = await acquireProviderAttempt(fallbackProvider);
            if (backupAvailability.allowed) {
                effectivePrimary = fallbackProvider;
                fallbackProvider = undefined;
                preemptiveFallback = true;
            } else {
                throw unavailableError(
                    plan.primary,
                    earliestRetry(primaryAvailability.cooldownRemainingMs, backupAvailability.cooldownRemainingMs),
                    fallbackProvider,
                );
            }
        } else {
            throw unavailableError(plan.primary, earliestRetry(primaryAvailability.cooldownRemainingMs));
        }
    }

    // Первая попытка: один провайдер за раз, без параллельной передачи пользовательского текста.
    let primaryError: AiProviderError;
    let primaryProducedContent = false;
    try {
        const response = await callProvider(
            effectivePrimary,
            options.signal,
            (text) => {
                primaryProducedContent = true;
                options.onChunk(text);
            },
            preemptiveFallback ? effectivePrimary : fallbackProvider,
        );
        await recordAvailabilitySuccess(effectivePrimary);
        return {
            providerUsed: effectivePrimary,
            fallbackOccurred: preemptiveFallback,
            fallbackReason: preemptiveFallback ? cooldownReason : undefined,
            fallbackNotification: preemptiveFallback
                ? getFallbackNotification(plan.primary, effectivePrimary, cooldownReason)
                : undefined,
            usage: response.usage,
            model: response.model,
            attempts,
        };
    } catch (err) {
        if (options.signal.aborted) {
            await releaseProviderAttempt(effectivePrimary);
            throw err;
        }
        primaryError = normalizeAiError(err, effectivePrimary);
        await recordAvailabilityFailure(primaryError);
    }

    // КРИТИЧНОЕ ПРАВИЛО: Fallback разрешен ТОЛЬКО при ошибках, подходящих под fallback (isFallbackEligible: 429, 5xx, timeout, network error).
    // Для AUTH_ERROR (401, 403, некорректный ключ) и ACCOUNT_ERROR (404) fallback СТРОГО ЗАПРЕЩЕН, чтобы пользователь четко видел ошибку конфигурации.
    const canFallback =
        options.autoFallback &&
        Boolean(fallbackProvider) &&
        isConfigured(fallbackProvider!) &&
        primaryError.isFallbackEligible;

    if (!canFallback || !fallbackProvider) {
        await writeProviderFailureLog(
            primaryError,
            preemptiveFallback ? effectivePrimary : fallbackProvider,
            preemptiveFallback,
        );
        throw primaryError;
    }

    const fallbackAvailability = await acquireProviderAttempt(fallbackProvider);
    if (!fallbackAvailability.allowed) {
        await writeProviderFailureLog(primaryError, fallbackProvider, false);
        throw unavailableError(
            effectivePrimary,
            earliestRetry(getAiProviderCooldownRemaining(effectivePrimary), fallbackAvailability.cooldownRemainingMs),
            fallbackProvider,
        );
    }

    // Частичный поток первого сервиса нельзя смешивать с новым ответом резервного сервиса.
    if (primaryProducedContent) options.onReset?.();
    await writeProviderFailureLog(primaryError, fallbackProvider, true);

    // Резервный провайдер вызывается ровно один раз; возврата к первому сервису нет (no fallback loop).
    try {
        const response = await callProvider(fallbackProvider, options.signal, options.onChunk);
        await recordAvailabilitySuccess(fallbackProvider);
        const notification = getFallbackNotification(effectivePrimary, fallbackProvider, primaryError.code);
        return {
            providerUsed: fallbackProvider,
            fallbackOccurred: true,
            fallbackReason: primaryError.code,
            fallbackNotification: notification,
            usage: response.usage,
            model: response.model,
            attempts,
        };
    } catch (secondErr) {
        if (options.signal.aborted) {
            await releaseProviderAttempt(fallbackProvider);
            throw secondErr;
        }
        const secondaryError = normalizeAiError(secondErr, fallbackProvider);
        await recordAvailabilityFailure(secondaryError);
        await writeProviderFailureLog(secondaryError, undefined, true);
        if (
            (primaryError.code === 'RATE_LIMIT' || primaryError.code === 'QUOTA_EXCEEDED') &&
            (secondaryError.code === 'RATE_LIMIT' || secondaryError.code === 'QUOTA_EXCEEDED')
        ) {
            throw unavailableError(
                effectivePrimary,
                earliestRetry(
                    getAiProviderCooldownRemaining(effectivePrimary),
                    getAiProviderCooldownRemaining(fallbackProvider),
                ),
                fallbackProvider,
            );
        }
        throw secondaryError;
    }
}
