interface TextToken {
    value: string;
    significant: boolean;
}

export interface WordCorrection {
    tokenIndex: number;
    original: string;
    corrected: string;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function tokenizeText(text: string): TextToken[] {
    const values = text.match(/\s+|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu) ?? [];
    return values.map((value) => ({ value, significant: !/^\s+$/u.test(value) }));
}

export function normalizeSpellcheckResult(text: string): string {
    return text.replace(/\*\*([\s\S]*?)\*\*/g, '$1').replace(/\*\*/g, '');
}

export function getWordCorrections(original: string, corrected: string): WordCorrection[] {
    const originalTokens = tokenizeText(original).filter((token) => token.significant);
    const correctedTokens = tokenizeText(corrected)
        .map((token, tokenIndex) => ({ ...token, tokenIndex }))
        .filter((token) => token.significant);
    const count = Math.min(originalTokens.length, correctedTokens.length);
    const corrections: WordCorrection[] = [];

    // Индивидуальный выбор применяется к заменам один-к-одному. Вставки и удаления
    // по-прежнему подсвечиваются, но остаются частью общего исправления.
    if (originalTokens.length === correctedTokens.length) {
        for (let index = 0; index < count; index++) {
            if (originalTokens[index].value !== correctedTokens[index].value) {
                corrections.push({
                    tokenIndex: correctedTokens[index].tokenIndex,
                    original: originalTokens[index].value,
                    corrected: correctedTokens[index].value,
                });
            }
        }
    }
    return corrections;
}

export function resolveCorrections(corrected: string, corrections: WordCorrection[], rejected: Set<number>): string {
    const tokens = tokenizeText(corrected);
    const originals = new Map(corrections.map((item) => [item.tokenIndex, item.original]));
    return tokens.map((token, index) => rejected.has(index) ? originals.get(index) || token.value : token.value).join('');
}

export function renderSpellcheckDiff(original: string, corrected: string, rejected = new Set<number>()): string {
    const originalTokens = tokenizeText(original);
    const correctedTokens = tokenizeText(corrected);
    const originalSignificant = originalTokens.filter((token) => token.significant);
    const correctedSignificant = correctedTokens
        .map((token, tokenIndex) => ({ ...token, tokenIndex }))
        .filter((token) => token.significant);
    const correctionOriginals = new Map(
        getWordCorrections(original, corrected).map((item) => [item.tokenIndex, item.original]),
    );
    const rows = Array.from(
        { length: originalSignificant.length + 1 },
        () => new Uint16Array(correctedSignificant.length + 1),
    );

    for (let originalIndex = 1; originalIndex <= originalSignificant.length; originalIndex++) {
        for (let correctedIndex = 1; correctedIndex <= correctedSignificant.length; correctedIndex++) {
            rows[originalIndex][correctedIndex] = originalSignificant[originalIndex - 1].value === correctedSignificant[correctedIndex - 1].value
                ? rows[originalIndex - 1][correctedIndex - 1] + 1
                : Math.max(rows[originalIndex - 1][correctedIndex], rows[originalIndex][correctedIndex - 1]);
        }
    }

    const unchanged = new Set<number>();
    let originalIndex = originalSignificant.length;
    let correctedIndex = correctedSignificant.length;
    while (originalIndex > 0 && correctedIndex > 0) {
        if (originalSignificant[originalIndex - 1].value === correctedSignificant[correctedIndex - 1].value) {
            unchanged.add(correctedSignificant[correctedIndex - 1].tokenIndex);
            originalIndex--;
            correctedIndex--;
        } else if (rows[originalIndex - 1][correctedIndex] >= rows[originalIndex][correctedIndex - 1]) {
            originalIndex--;
        } else {
            correctedIndex--;
        }
    }

    return correctedTokens.map((token, tokenIndex) => {
        const displayValue = rejected.has(tokenIndex)
            ? correctionOriginals.get(tokenIndex) || token.value
            : token.value;
        const escaped = escapeHtml(displayValue).replace(/\n/g, '<br>');
        return token.significant && !unchanged.has(tokenIndex) && !rejected.has(tokenIndex)
            ? `<mark data-token-index="${tokenIndex}">${escaped}</mark>`
            : escaped;
    }).join('');
}
