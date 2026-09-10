import { AI_CONFIG } from './ai-models-config';
import type { AIProvider, AIResponse } from './ai-provider-types';
import { streamText, validateApiKey, type MistralRequest, type MistralSettings } from './mistral-client';

export class MistralProvider implements AIProvider {
    readonly id = AI_CONFIG.mistral.id;
    readonly name = AI_CONFIG.mistral.name;

    async isConfigured(credential?: string): Promise<boolean> {
        return Boolean(credential?.trim());
    }

    async validateCredentials(credential: string): Promise<{ ok: boolean; message: string }> {
        return validateApiKey(credential);
    }

    async streamChat(
        request: MistralRequest,
        credential: string,
        settings: MistralSettings,
        signal: AbortSignal,
        onChunk: (chunk: string) => void,
        _model?: string,
        onActivity?: () => void,
    ): Promise<AIResponse> {
        return streamText(request, credential, settings, signal, onChunk, onActivity);
    }
}

export const mistralProvider = new MistralProvider();
