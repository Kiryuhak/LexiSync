import { estimateTokens } from './budget';
import type { AiMode, RequestMode } from './types';

function getRequestInputTokens(text: string, rawMessages?: Array<{ content: string }>): number {
    const source = text || rawMessages?.map((message) => message.content).join('\n') || '';
    return estimateTokens(source);
}

/** Ограничивает только ответ AI; исходный текст никогда не обрезается. */
export function getAiOutputTokenLimit(
    mode: RequestMode | undefined,
    aiMode: AiMode,
    text = '',
    rawMessages?: Array<{ content: string }>,
): number {
    const inputTokens = getRequestInputTokens(text, rawMessages);
    const isShortAnswer = mode === 'summary' || mode === 'emoji' || mode === 'headline' || mode === 'tone';
    const expected = isShortAnswer ? Math.ceil(inputTokens * 0.75) + 256 : Math.ceil(inputTokens * 1.35) + 384;
    const maximum = aiMode === 'fast' ? 1536 : 3072;
    return Math.min(maximum, Math.max(512, expected));
}
