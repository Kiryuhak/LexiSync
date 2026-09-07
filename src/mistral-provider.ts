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
    ): Promise<AIResponse> {
        let fullText = '';
        const collector = (chunk: string) => {
            fullText += chunk;
            onChunk(chunk);
        };
        await streamText(request, credential, settings, signal, collector);
        return {
            text: fullText,
            provider: 'mistral',
            model: AI_CONFIG.mistral.defaultModel,
        };
    }
}

export const mistralProvider = new MistralProvider();
