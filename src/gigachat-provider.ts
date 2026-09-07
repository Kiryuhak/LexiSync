import { AI_CONFIG } from './ai-models-config';
import type { AIProvider, AIResponse } from './ai-provider-types';
import type { MistralRequest, MistralSettings } from './mistral-client';
import { streamGigaChatText, validateGigaChatAuthKey } from './gigachat-client';

export class GigaChatProvider implements AIProvider {
    readonly id = AI_CONFIG.gigachat.id;
    readonly name = AI_CONFIG.gigachat.name;

    async isConfigured(credential?: string): Promise<boolean> {
        return Boolean(credential?.trim());
    }

    async validateCredentials(credential: string): Promise<{ ok: boolean; message: string }> {
        return validateGigaChatAuthKey(credential);
    }

    async streamChat(
        request: MistralRequest,
        credential: string,
        settings: MistralSettings,
        signal: AbortSignal,
        onChunk: (chunk: string) => void,
    ): Promise<AIResponse> {
        return streamGigaChatText(request, credential, settings, signal, onChunk);
    }
}

export const gigaChatProvider = new GigaChatProvider();
