import { t } from './i18n';
import { streamText, type MistralRequest, type MistralSettings } from './mistral-client';
import { streamGroqText } from './groq-client';
import {
    AiProviderError,
    type AiErrorCode,
    type AiExecutionResult,
    type AiProviderType,
    type AiRequestOptions,
    type PrimaryAiProvider,
} from './ai-provider-types';

export function normalizeAiError(error: unknown, provider: AiProviderType): AiProviderError {
    if (error instanceof AiProviderError) return error;
    if (error instanceof DOMException && error.name === 'AbortError') {
        return new AiProviderError(t('requestCancelled', 'Запрос отменён.'), 'TIMEOUT', provider, false);
    }
    const message = error instanceof Error ? error.message : String(error);
    const isNetwork =
        message.includes('Failed to fetch') ||
        message.includes('NetworkError') ||
        message.includes('network') ||
        message.includes('Не удалось подключиться') ||
        error instanceof TypeError;
    if (isNetwork) {
        return new AiProviderError(message, 'NETWORK_ERROR', provider, true);
    }
    if (
        message.includes('Превышен лимит запросов') ||
        message.includes('Rate limit') ||
        message.includes('rate_limit') ||
        message.includes('Too Many Requests') ||
        message.includes('429')
    ) {
        return new AiProviderError(message, 'RATE_LIMIT', provider, true, 429);
    }
    if (
        message.includes('недействителен') ||
        message.includes('отозван') ||
        message.includes('Invalid API Key') ||
        message.includes('Unauthorized') ||
        message.includes('401') ||
        message.includes('403')
    ) {
        return new AiProviderError(message, 'AUTH_ERROR', provider, false, 401);
    }
    if (
        message.includes('временно недоступен') ||
        message.includes('Service Unavailable') ||
        message.includes('Internal Server Error') ||
        message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504')
    ) {
        return new AiProviderError(message, 'SERVER_ERROR', provider, true, 503);
    }
    return new AiProviderError(message, 'UNKNOWN_ERROR', provider, false);
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
        return t('fallbackToGroqDueToOutage', 'Сервис Mistral временно недоступен. Использован Groq (Qwen 3.6).');
    }
    if (fromProvider === 'groq' && toProvider === 'mistral') {
        if (code === 'RATE_LIMIT' || code === 'QUOTA_EXCEEDED') {
            return t('fallbackToMistralDueToRateLimit', 'Лимит Groq достигнут. Запрос выполнен через Mistral.');
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

    // 1. Определение приоритета провайдеров
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
        if (provider === 'mistral') {
            await streamText(msg, key, settings, signal, onChunk);
        } else {
            await streamGroqText(msg, key, settings, signal, onChunk);
        }
    };

    // Если у основного провайдера нет ключа, но у резервного есть и fallback включен — сразу используем резервный
    let effectivePrimary = primary;
    if (!getKey(primary) && getKey(secondary) && options.autoFallback) {
        effectivePrimary = secondary;
    } else if (!getKey(primary)) {
        const missingMsg =
            primary === 'mistral'
                ? t('apiKeyMissing', 'API-ключ Mistral не настроен.')
                : t('groqApiKeyMissing', 'API-ключ Groq не настроен.');
        throw new AiProviderError(missingMsg, 'AUTH_ERROR', primary, false, 401);
    }

    // 2. Попытка выполнения через первого провайдера
    let primaryError: AiProviderError;
    try {
        await callProvider(effectivePrimary, options.request, options.settings, options.signal, options.onChunk);
        return {
            providerUsed: effectivePrimary,
            fallbackOccurred: false,
        };
    } catch (err) {
        if (options.signal.aborted) throw err;
        primaryError = normalizeAiError(err, effectivePrimary);
    }

    // 3. Анализ возможности Fallback
    const fallbackProvider: AiProviderType = effectivePrimary === 'mistral' ? 'groq' : 'mistral';
    const fallbackKey = getKey(fallbackProvider);

    // Fallback запрещен, если отключен в настройках, или если ошибка авторизации (401/403)
    if (!options.autoFallback || !primaryError.isFallbackEligible) {
        throw primaryError;
    }

    // Если fallback разрешен по типу ошибки, но у резервного провайдера не настроен ключ:
    if (!fallbackKey) {
        if (primaryError.code === 'RATE_LIMIT' || primaryError.code === 'QUOTA_EXCEEDED') {
            const needKeyMsg =
                effectivePrimary === 'mistral'
                    ? t(
                          'mistralRateLimitNeedGroqKey',
                          'Лимит Mistral достигнут. Для автоматического переключения добавьте Groq API Key в настройках.',
                      )
                    : t(
                          'groqRateLimitNeedMistralKey',
                          'Лимит Groq достигнут. Для автоматического переключения добавьте Mistral API Key в настройках.',
                      );
            throw new AiProviderError(needKeyMsg, primaryError.code, effectivePrimary, true, primaryError.status);
        }
        throw primaryError;
    }

    // 4. Выполнение через резервного провайдера (ровно 1 попытка, защита от зацикливания)
    try {
        await callProvider(fallbackProvider, options.request, options.settings, options.signal, options.onChunk);
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
