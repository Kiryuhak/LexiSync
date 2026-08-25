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
    ) {
        super(message);
        this.name = 'AiProviderError';
    }

    get isFallbackEligible(): boolean {
        // Fallback разрешен только для временных ошибок нагрузки, квоты, сети и сервера.
        // Запрещен для AUTH_ERROR (401, 403), чтобы не скрывать проблему с некорректным ключом.
        return (
            this.code === 'RATE_LIMIT' ||
            this.code === 'QUOTA_EXCEEDED' ||
            this.code === 'SERVER_ERROR' ||
            this.code === 'NETWORK_ERROR' ||
            this.code === 'TIMEOUT' ||
            this.code === 'INVALID_RESPONSE'
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
}

export interface AiExecutionResult {
    providerUsed: AiProviderType;
    fallbackOccurred: boolean;
    fallbackReason?: string;
    fallbackNotification?: string;
}
