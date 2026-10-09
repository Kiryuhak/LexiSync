import type { AiProviderType } from './ai-provider-types';

export type AiOperation =
    | 'spellcheck'
    | 'proofread'
    | 'rewrite'
    | 'style'
    | 'translate'
    | 'summary'
    | 'shorten'
    | 'explain'
    | 'reply'
    | 'custom'
    | 'ocr'
    | 'case_convert'
    | 'text_clean'
    | 'layout';

export interface ProviderCapability {
    spellcheck: boolean;
    style: boolean;
    translate: boolean;
    summary: boolean;
    explain: boolean;
    reply: boolean;
    custom: boolean;
    ocr: boolean;
}

/**
 * Централизованная матрица возможностей провайдеров.
 * Разделяет общее состояние здоровья сервиса (Health) и его способность выполнить конкретную операцию (Capability).
 */
export const PROVIDER_CAPABILITIES: Record<AiProviderType | 'yandex-speller', ProviderCapability> = {
    mistral: {
        spellcheck: true,
        style: true,
        translate: true,
        summary: true,
        explain: true,
        reply: true,
        custom: true,
        ocr: true, // Поддерживает распознавание документов через отдельный эндпоинт mistral-ocr-latest
    },
    cloudflare: {
        spellcheck: true,
        style: true,
        translate: true,
        summary: true,
        explain: true,
        reply: true,
        custom: true,
        ocr: false, // Текстовые LLM-модели Cloudflare Workers AI в LexiSync не поддерживают распознавание изображений
    },
    'yandex-speller': {
        spellcheck: true,
        style: false,
        translate: false,
        summary: false,
        explain: false,
        reply: false,
        custom: false,
        ocr: false,
    },
};

/**
 * Проверяет, способен ли провайдер выполнить указанную операцию.
 */
export function isProviderCapableOf(provider: string, operation?: string): boolean {
    if (!operation) return true;
    const caps = PROVIDER_CAPABILITIES[provider as keyof typeof PROVIDER_CAPABILITIES];
    if (!caps) return false;
    if (operation in caps) {
        return caps[operation as keyof ProviderCapability];
    }
    // Для текстовых операций, не перечисленных явно, текстовые AI-провайдеры считаются способными, кроме OCR
    return operation !== 'ocr';
}

/**
 * Возвращает резервного провайдера только в том случае, если он совместим с операцией.
 */
export function getCompatibleFallbackProvider(
    primaryProvider: AiProviderType,
    operation?: string,
): AiProviderType | undefined {
    const candidate: AiProviderType = primaryProvider === 'mistral' ? 'cloudflare' : 'mistral';
    if (isProviderCapableOf(candidate, operation)) {
        return candidate;
    }
    return undefined;
}
