import { AI_CONFIG } from './ai-models-config';
import type { AIProvider, AIResponse, CloudflareCredentials } from './ai-provider-types';
import { streamCloudflareText, validateCloudflareCredentials } from './cloudflare-client';
import type { MistralRequest, MistralSettings } from './mistral-client';

export class CloudflareWorkersAIProvider implements AIProvider {
    readonly id = AI_CONFIG.cloudflare.id;
    readonly name = AI_CONFIG.cloudflare.name;

    async isConfigured(credential?: string | CloudflareCredentials): Promise<boolean> {
        if (!credential) return false;
        if (typeof credential === 'string') return Boolean(credential.trim());
        return Boolean(credential.accountId?.trim() && credential.apiToken?.trim());
    }

    async validateCredentials(
        credential: string | CloudflareCredentials,
    ): Promise<{ ok: boolean; message: string; latencyMs?: number; model?: string }> {
        if (typeof credential === 'string') {
            try {
                const parsed = JSON.parse(credential) as CloudflareCredentials;
                return validateCloudflareCredentials(parsed);
            } catch {
                return { ok: false, message: 'Неверный формат учетных данных Cloudflare.' };
            }
        }
        return validateCloudflareCredentials(credential);
    }

    async streamChat(
        request: MistralRequest,
        credential: string | CloudflareCredentials,
        settings: MistralSettings,
        signal: AbortSignal,
        onChunk: (chunk: string) => void,
        model?: string,
        onActivity?: () => void,
    ): Promise<AIResponse> {
        let creds: CloudflareCredentials;
        if (typeof credential === 'string') {
            try {
                creds = JSON.parse(credential) as CloudflareCredentials;
            } catch {
                throw new Error('Неверный формат учетных данных Cloudflare.');
            }
        } else {
            creds = credential;
        }
        return streamCloudflareText(
            request,
            creds,
            settings,
            signal,
            onChunk,
            model || AI_CONFIG.cloudflare.defaultModel,
            onActivity,
        );
    }
}

export const cloudflareWorkersAIProvider = new CloudflareWorkersAIProvider();
