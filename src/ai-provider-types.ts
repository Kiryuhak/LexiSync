import type { MistralRequest, MistralSettings } from './mistral-client';

export type AiProviderType = 'mistral' | 'gigachat';
export type PrimaryAiProvider = 'auto' | 'mistral' | 'gigachat';

export type AiErrorCode =
    | 'AUTH_ERROR'
    | 'RATE_LIMIT'
    | 'QUOTA_EXCEEDED'
    | 'NETWORK_ERROR'
    | 'TIMEOUT'
    | 'SERVER_ERROR'
    | 'INVALID_RESPONSE'
    | 'INVALID_REQUEST'
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
        // Fallback разрешён только для 429, тайм-аута, ошибки сети и 5xx.
        // Запрещен для AUTH_ERROR (401, 403) и INVALID_REQUEST (400), чтобы не скрывать проблему с некорректным ключом или неверным запросом.
        return this.retryable && ['RATE_LIMIT', 'SERVER_ERROR', 'NETWORK_ERROR', 'TIMEOUT'].includes(this.code);
    }
}

export interface AIMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface AIRequest {
    messages: AIMessage[];
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    mode?: string;
}

export interface AIResponse {
    text: string;
    provider: AiProviderType;
    model: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
}

export interface AIProvider {
    readonly id: AiProviderType;
    readonly name: string;
    isConfigured(credential?: string): Promise<boolean>;
    validateCredentials(credential: string): Promise<{ ok: boolean; message: string }>;
    streamChat(
        request: MistralRequest,
        credential: string,
        settings: MistralSettings,
        signal: AbortSignal,
        onChunk: (chunk: string) => void,
    ): Promise<AIResponse>;
}

export interface AiRequestOptions {
    request: MistralRequest;
    settings: MistralSettings;
    primaryProvider: PrimaryAiProvider;
    autoFallback: boolean;
    mistralApiKey?: string;
    gigachatAuthKey?: string;
    signal: AbortSignal;
    onChunk: (text: string) => void;
    /** Очищает уже показанный незавершённый ответ перед переходом на резервного провайдера. */
    onReset?: () => void;
    /** Отдельный лимит ожидания одного провайдера; общий запрос по-прежнему контролируется вызывающим кодом. */
    providerTimeoutMs?: number;
    /** Максимальная пауза между частями уже начавшегося потокового ответа. */
    providerStallTimeoutMs?: number;
}

export interface AiExecutionResult {
    providerUsed: AiProviderType;
    fallbackOccurred: boolean;
    fallbackReason?: string;
    fallbackNotification?: string;
}
