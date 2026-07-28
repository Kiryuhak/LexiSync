const DEFAULT_CHUNK_SIZE = 6_000;
const MIN_SOFT_SPLIT_RATIO = 0.55;

function findSentenceBoundary(value: string, minimum: number): number {
    const pattern = /[.!?…][»"'’”)\]]?(?:\s+|$)/gu;
    let boundary = -1;
    for (const match of value.matchAll(pattern)) {
        const end = (match.index ?? 0) + match[0].length;
        if (end >= minimum) boundary = end;
    }
    return boundary;
}

function avoidBrokenCharacterBoundary(text: string, start: number, end: number): number {
    let safeEnd = end;
    if (safeEnd > start && safeEnd < text.length) {
        const previous = text.charCodeAt(safeEnd - 1);
        const next = text.charCodeAt(safeEnd);
        if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) safeEnd--;
        if (text[safeEnd - 1] === '\r' && text[safeEnd] === '\n') safeEnd--;
    }
    return Math.max(start + 1, safeEnd);
}

/**
 * Делит текст без потери символов. Мягкие границы используются только тогда,
 * когда они не создают слишком маленький фрагмент.
 */
export function splitTextIntoChunks(text: string, maxChunkSize = DEFAULT_CHUNK_SIZE): string[] {
    if (!text) return [];
    const limit = Math.max(256, Math.trunc(maxChunkSize));
    if (text.length <= limit) return [text];

    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        const hardEnd = Math.min(text.length, start + limit);
        let end = hardEnd;
        if (hardEnd < text.length) {
            const window = text.slice(start, hardEnd);
            const minimum = Math.floor(limit * MIN_SOFT_SPLIT_RATIO);
            const paragraph = window.lastIndexOf('\n\n');
            const line = window.lastIndexOf('\n');
            const sentence = findSentenceBoundary(window, minimum);
            const softBoundary = Math.max(
                paragraph >= minimum ? paragraph + 2 : -1,
                line >= minimum ? line + 1 : -1,
                sentence,
            );
            if (softBoundary > 0) end = start + softBoundary;
        }
        end = avoidBrokenCharacterBoundary(text, start, end);
        chunks.push(text.slice(start, end));
        start = end;
    }
    return chunks;
}
