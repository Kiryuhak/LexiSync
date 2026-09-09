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
        defaultModel: '@cf/zai-org/glm-4.7-flash',
        defaultModelShortName: 'GLM-4.7-Flash',
        availableModels: [
            '@cf/zai-org/glm-4.7-flash',
            '@cf/qwen/qwen3-30b-a3b-fp8',
            '@cf/meta/llama-3.2-3b-instruct',
        ] as const,
    },
} as const;

export type SupportedAiProviderId = keyof typeof AI_CONFIG;

export type CloudflareModel = (typeof AI_CONFIG.cloudflare.availableModels)[number];

export function normalizeCloudflareModel(value: unknown): CloudflareModel {
    return AI_CONFIG.cloudflare.availableModels.includes(value as CloudflareModel)
        ? (value as CloudflareModel)
        : AI_CONFIG.cloudflare.defaultModel;
}
