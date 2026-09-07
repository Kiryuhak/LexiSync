import type { AiProviderType, CloudflareCredentials } from './ai-provider-types';
import type { ProviderHealthStatus } from './provider-health';

// Проверки выполняются в background: у OAuth один владелец и один single-flight кэш.
async function requestCheck<T>(
    provider: AiProviderType,
    credential: string | CloudflareCredentials,
    health: boolean,
): Promise<T> {
    const response = await chrome.runtime.sendMessage({ action: 'checkAiCredential', provider, credential, health });
    if (!response?.ok) throw new Error(response?.error || 'AI_CHECK_FAILED');
    return response.data as T;
}

export function validateCloudflareCredentials(
    credentials: CloudflareCredentials,
): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    return requestCheck('cloudflare', credentials, false);
}

export function validateApiKey(key: string): Promise<{ ok: boolean; message: string }> {
    return requestCheck('mistral', key, false);
}

export function checkProviderHealth(
    provider: AiProviderType,
    key: string | CloudflareCredentials,
): Promise<ProviderHealthStatus> {
    return requestCheck(provider, key, true);
}
