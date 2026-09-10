import type { MistralRequest, MistralSettings } from './mistral-client';

export type AiProviderType = 'mistral' | 'cloudflare';
export type AIProviderId = AiProviderType;
export type PrimaryAiProvider = 'auto' | 'mistral' | 'cloudflare';

export interface CloudflareCredentials {
    accountId: string;
    apiToken: string;
}

export type AiErrorCode =
    | 'AUTH_ERROR'
    | 'ACCOUNT_ERROR'
    | 'RATE_LIMIT'
    | 'QUOTA_EXCEEDED'
    | 'NETWORK_ERROR'
    | 'TIMEOUT'
    | 'SERVER_ERROR'
    | 'INVALID_RESPONSE'
    | 'INVALID_REQUEST'
    | 'INVALID_CONFIG'
    | 'QUALITY_CHECK_FAILED'
    | 'PROVIDERS_UNAVAILABLE'
    | 'UNKNOWN_ERROR';

export interface AiErrorContext {
    operation?: string;
    model?: string;
    attempt?: number;
    fallbackProvider?: AiProviderType;
    latencyMs?: number;
}

export class AiProviderError extends Error {
    constructor(
        message: string,
        readonly code: AiErrorCode,
        readonly provider: AiProviderType,
        readonly retryable: boolean,
        readonly status?: number,
        readonly retryAfterMs?: number,
        readonly context: AiErrorContext = {},
    ) {
        super(message);
        this.name = 'AiProviderError';
    }

    get isFallbackEligible(): boolean {
        // Fallback разрешён только для 429, тайм-аута, ошибки сети, 5xx,
        // некорректного ответа сервиса и сбоя проверки качества (sanity check).
        // Запрещен для AUTH_ERROR (401, 403), ACCOUNT_ERROR (404), INVALID_REQUEST (400) и INVALID_CONFIG.
        return (
            this.retryable &&
            [
                'RATE_LIMIT',
                'QUOTA_EXCEEDED',
                'SERVER_ERROR',
                'NETWORK_ERROR',
                'TIMEOUT',
                'INVALID_RESPONSE',
                'QUALITY_CHECK_FAILED',
            ].includes(this.code)
        );
    }
}

export type AIError = AiProviderError;

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
        neurons?: number;
    };
}

export interface AIProvider {
    readonly id: AiProviderType;
    readonly name: string;
    isConfigured(credential?: string | CloudflareCredentials): Promise<boolean>;
    validateCredentials(credential: string | CloudflareCredentials): Promise<{ ok: boolean; message: string }>;
    streamChat(
        request: MistralRequest,
        credential: string | CloudflareCredentials,
        settings: MistralSettings,
        signal: AbortSignal,
        onChunk: (chunk: string) => void,
        model?: string,
        onActivity?: () => void,
    ): Promise<AIResponse>;
}

export interface AiRequestOptions {
    request: MistralRequest;
    settings: MistralSettings;
    primaryProvider: PrimaryAiProvider;
    autoFallback: boolean;
    mistralApiKey?: string;
    cloudflareAccountId?: string;
    cloudflareApiToken?: string;
    cloudflareModel?: string;
    signal: AbortSignal;
    onChunk: (text: string) => void;
    /** Очищает уже показанный незавершённый ответ перед переходом на резервного провайдера. */
    onReset?: () => void;
    /** Отдельный лимит ожидания одного провайдера; общий запрос по-прежнему контролируется вызывающим кодом. */
    providerTimeoutMs?: number;
    /** Максимальная пауза между частями уже начавшегося потокового ответа. */
    providerStallTimeoutMs?: number;
    /** Жёсткий предел одной попытки, независимый от активности потока. */
    providerTotalTimeoutMs?: number;
}

export interface AiExecutionResult {
    providerUsed: AiProviderType;
    fallbackOccurred: boolean;
    fallbackReason?: string;
    fallbackNotification?: string;
    usage?: AIResponse['usage'];
    model?: string;
    attempts: number;
}
