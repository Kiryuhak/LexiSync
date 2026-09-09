import type { AiProviderType, CloudflareCredentials } from './ai-provider-types';
import type { ProviderHealthStatus } from './provider-health';

// Проверки выполняются в background: у OAuth один владелец и один single-flight кэш.
async function requestCheck<T>(
    provider: AiProviderType,
    credential: string | CloudflareCredentials,
    health: boolean,
    model?: string,
): Promise<T> {
    const response = await chrome.runtime.sendMessage({
        action: 'checkAiCredential',
        provider,
        credential,
        health,
        model,
    });
    if (!response?.ok) throw new Error(response?.error || 'AI_CHECK_FAILED');
    return response.data as T;
}

export function validateCloudflareCredentials(
    credentials: CloudflareCredentials,
    model?: string,
): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    return requestCheck('cloudflare', credentials, false, model);
}

export function validateApiKey(key: string): Promise<{ ok: boolean; message: string }> {
    return requestCheck('mistral', key, false);
}

export function checkProviderHealth(
    provider: AiProviderType,
    key: string | CloudflareCredentials,
    model?: string,
): Promise<ProviderHealthStatus> {
    return requestCheck(provider, key, true, model);
}
