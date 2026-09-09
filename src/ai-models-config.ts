export const AI_CONFIG = {
    mistral: {
        id: 'mistral' as const,
        name: 'Mistral AI',
        baseUrl: 'https://api.mistral.ai/v1',
        defaultModel: 'mistral-small-latest',
        ocrModel: 'mistral-ocr-latest',
    },
    cloudflare: {
        id: 'cloudflare' as const,
        name: 'Cloudflare Workers AI',
        baseUrl: 'https://api.cloudflare.com/client/v4',
        defaultModel: '@cf/qwen/qwen2.5-7b-instruct',
        defaultModelShortName: 'Qwen 2.5 7B',
        availableModels: [
            '@cf/qwen/qwen2.5-7b-instruct',
            '@cf/meta/llama-3.1-8b-instruct',
            '@cf/meta/llama-3.2-3b-instruct',
        ] as const,
    },
} as const;

export type SupportedAiProviderId = keyof typeof AI_CONFIG;
