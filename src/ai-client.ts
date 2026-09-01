import { t } from './i18n';
import { streamText, type MistralRequest, type MistralSettings } from './mistral-client';
import { streamGroqText } from './groq-client';
import { recordErrorLog } from './error-log';
import {
    AiProviderError,
    type AiErrorCode,
    type AiExecutionResult,
    type AiProviderType,
    type AiRequestOptions,
    type PrimaryAiProvider,
} from './ai-provider-types';

const DEFAULT_PROVIDER_TIMEOUT_MS = 12_000;
const DEFAULT_PROVIDER_STALL_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;
const CIRCUIT_BREAKER_FAILURES = 2;
const CIRCUIT_BREAKER_COOLDOWN_MS = 20_000;

interface ProviderHealth {
    consecutiveFailures: number;
    cooldownUntil: number;
}

const providerHealth: Record<AiProviderType, ProviderHealth> = {
    mistral: { consecutiveFailures: 0, cooldownUntil: 0 },
    groq: { consecutiveFailures: 0, cooldownUntil: 0 },
};

export function resetAiProviderHealth(): void {
    for (const state of Object.values(providerHealth)) {
        state.consecutiveFailures = 0;
        state.cooldownUntil = 0;
    }
}

export function getAiProviderCooldownRemaining(provider: AiProviderType, now = Date.now()): number {
    return Math.max(0, providerHealth[provider].cooldownUntil - now);
}

function recordProviderSuccess(provider: AiProviderType): void {
    providerHealth[provider].consecutiveFailures = 0;
    providerHealth[provider].cooldownUntil = 0;
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
    if (sourceStatus === 429) {
        return new AiProviderError(message, 'RATE_LIMIT', provider, sourceRetryable ?? true, 429, retryAfterMs);
    }
    if (sourceStatus && sourceStatus >= 500 && sourceStatus <= 599) {
        return new AiProviderError(message, 'SERVER_ERROR', provider, sourceRetryable ?? true, sourceStatus);
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
    if (fromProvider === 'mistral' && toProvider === 'groq') {
        if (code === 'RATE_LIMIT' || code === 'QUOTA_EXCEEDED') {
            return t('fallbackToGroqDueToRateLimit', 'Лимит Mistral достигнут. Запрос выполнен через Groq (Qwen 3.6).');
        }
        if (code === 'AUTH_ERROR') {
            return t(
                'fallbackToGroqDueToAuth',
                'Ошибка ключа Mistral. Запрос выполнен через резервный Groq (Qwen 3.6).',
            );
        }
        return t('fallbackToGroqDueToOutage', 'Сервис Mistral временно недоступен. Использован Groq (Qwen 3.6).');
    }
    if (fromProvider === 'groq' && toProvider === 'mistral') {
        if (code === 'RATE_LIMIT' || code === 'QUOTA_EXCEEDED') {
            return t('fallbackToMistralDueToRateLimit', 'Лимит Groq достигнут. Запрос выполнен через Mistral.');
        }
        if (code === 'AUTH_ERROR') {
            return t('fallbackToMistralDueToAuth', 'Ошибка ключа Groq. Запрос выполнен через резервный Mistral.');
        }
        return t('fallbackToMistralDueToOutage', 'Сервис Groq временно недоступен. Использован Mistral.');
    }
    return '';
}

export function resolveExecutionPlan(options: {
    primaryProvider: PrimaryAiProvider;
    autoFallback: boolean;
    mistralApiKey?: string;
    groqApiKey?: string;
}): { primary: AiProviderType; backup?: AiProviderType } {
    const mistralKey = (options.mistralApiKey || '').trim();
    const groqKey = (options.groqApiKey || '').trim();

    let primary: AiProviderType;
    let secondary: AiProviderType;

    if (options.primaryProvider === 'groq') {
        primary = 'groq';
        secondary = 'mistral';
    } else if (options.primaryProvider === 'mistral') {
        primary = 'mistral';
        secondary = 'groq';
    } else {
        // 'auto'
        if (mistralKey) {
            primary = 'mistral';
            secondary = 'groq';
        } else if (groqKey) {
            primary = 'groq';
            secondary = 'mistral';
        } else {
            primary = 'mistral';
            secondary = 'groq';
        }
    }

    const hasBackupKey = secondary === 'mistral' ? Boolean(mistralKey) : Boolean(groqKey);
    return {
        primary,
        backup: options.autoFallback && hasBackupKey ? secondary : undefined,
    };
}

export async function executeAiStreamRequest(options: AiRequestOptions): Promise<AiExecutionResult> {
    const mistralKey = (options.mistralApiKey || '').trim();
    const groqKey = (options.groqApiKey || '').trim();
    const plan = resolveExecutionPlan({
        primaryProvider: options.primaryProvider,
        autoFallback: options.autoFallback,
        mistralApiKey: mistralKey,
        groqApiKey: groqKey,
    });

    const getKey = (provider: AiProviderType): string => (provider === 'mistral' ? mistralKey : groqKey);

    const callProvider = async (
        provider: AiProviderType,
        msg: MistralRequest,
        settings: MistralSettings,
        signal: AbortSignal,
        onChunk: (text: string) => void,
    ): Promise<void> => {
        const key = getKey(provider);
        if (!key) {
            const missingMsg =
                provider === 'mistral'
                    ? t('apiKeyMissing', 'API-ключ Mistral не настроен.')
                    : t('groqApiKeyMissing', 'API-ключ Groq не настроен.');
            throw new AiProviderError(missingMsg, 'AUTH_ERROR', provider, false, 401);
        }
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
                if (provider === 'mistral') await streamText(msg, key, settings, providerSignal, onProviderChunk);
                else await streamGroqText(msg, key, settings, providerSignal, onProviderChunk);
            },
        );
    };

    // Провайдер в cooldown пропускается только когда есть готовый резервный сервис.
    let effectivePrimary = plan.primary;
    let fallbackProvider = plan.backup;
    let preemptiveFallback = false;
    if (!getKey(effectivePrimary) && options.autoFallback && fallbackProvider && getKey(fallbackProvider)) {
        effectivePrimary = fallbackProvider;
        fallbackProvider = undefined;
    } else if (!getKey(effectivePrimary)) {
        const missingMsg =
            effectivePrimary === 'mistral'
                ? t('apiKeyMissing', 'API-ключ Mistral не настроен.')
                : t('groqApiKeyMissing', 'API-ключ Groq не настроен.');
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
        await callProvider(effectivePrimary, options.request, options.settings, options.signal, (text) => {
            primaryProducedContent = true;
            options.onChunk(text);
        });
        recordProviderSuccess(effectivePrimary);
        return {
            providerUsed: effectivePrimary,
            fallbackOccurred: preemptiveFallback,
            fallbackReason: preemptiveFallback ? 'RATE_LIMIT' : undefined,
            fallbackNotification: preemptiveFallback
                ? getFallbackNotification(plan.primary, effectivePrimary, 'RATE_LIMIT')
                : undefined,
        };
    } catch (err) {
        if (options.signal.aborted) throw err;
        primaryError = normalizeAiError(err, effectivePrimary);
        recordProviderFailure(primaryError);
    }

    const canFallback =
        options.autoFallback &&
        Boolean(fallbackProvider) &&
        Boolean(getKey(fallbackProvider!)) &&
        getAiProviderCooldownRemaining(fallbackProvider!) === 0 &&
        (primaryError.isFallbackEligible || primaryError.code === 'AUTH_ERROR');

    if (!canFallback || !fallbackProvider) throw primaryError;

    // Частичный поток первого сервиса нельзя смешивать с новым ответом резервного сервиса.
    if (primaryProducedContent) options.onReset?.();

    // Резервный провайдер вызывается ровно один раз; возврата к первому сервису нет.
    try {
        await callProvider(fallbackProvider, options.request, options.settings, options.signal, options.onChunk);
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
                    'Лимиты всех доступных AI-провайдеров (Mistral и Groq) исчерпаны. Попробуйте позже.',
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
