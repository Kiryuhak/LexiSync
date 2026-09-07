export const AI_CONFIG = {
    mistral: {
        id: 'mistral' as const,
        name: 'Mistral AI',
        baseUrl: 'https://api.mistral.ai/v1',
        defaultModel: 'mistral-small-latest',
        ocrModel: 'mistral-ocr-latest',
    },
    gigachat: {
        id: 'gigachat' as const,
        name: 'GigaChat',
        baseUrl: 'https://api.giga.chat/v1',
        oauthUrl: 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
        defaultModel: 'GigaChat',
        scope: 'GIGACHAT_API_PERS',
    },
} as const;

export type SupportedAiProviderId = keyof typeof AI_CONFIG;
