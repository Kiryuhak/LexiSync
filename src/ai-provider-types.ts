import type { MistralRequest, MistralSettings } from './mistral-client';

export type AiProviderType = 'mistral' | 'groq';
export type PrimaryAiProvider = 'auto' | 'mistral' | 'groq';

export type AiErrorCode =
    | 'AUTH_ERROR'
    | 'RATE_LIMIT'
    | 'QUOTA_EXCEEDED'
    | 'NETWORK_ERROR'
    | 'TIMEOUT'
    | 'SERVER_ERROR'
    | 'INVALID_RESPONSE'
    | 'UNKNOWN_ERROR';

export class AiProviderError extends Error {
    constructor(
        message: string,
        readonly code: AiErrorCode,
        readonly provider: AiProviderType,
        readonly retryable: boolean,
        readonly status?: number,
        readonly retryAfterMs?: number,
    ) {
        super(message);
        this.name = 'AiProviderError';
    }

    get isFallbackEligible(): boolean {
        // Fallback разрешен только для временных ошибок нагрузки, квоты, сети и сервера.
        // Запрещен для AUTH_ERROR (401, 403), чтобы не скрывать проблему с некорректным ключом.
        return (
            this.retryable &&
            ['RATE_LIMIT', 'QUOTA_EXCEEDED', 'SERVER_ERROR', 'NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'].includes(
                this.code,
            )
        );
    }
}

export interface AiRequestOptions {
    request: MistralRequest;
    settings: MistralSettings;
    primaryProvider: PrimaryAiProvider;
    autoFallback: boolean;
    mistralApiKey?: string;
    groqApiKey?: string;
    signal: AbortSignal;
    onChunk: (text: string) => void;
    /** Очищает уже показанный незавершённый ответ перед переходом на резервного провайдера. */
    onReset?: () => void;
    /** Отдельный лимит ожидания одного провайдера; общий запрос по-прежнему контролируется вызывающим кодом. */
    providerTimeoutMs?: number;
}

export interface AiExecutionResult {
    providerUsed: AiProviderType;
    fallbackOccurred: boolean;
    fallbackReason?: string;
    fallbackNotification?: string;
}
