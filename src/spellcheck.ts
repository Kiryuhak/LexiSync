import { t } from './i18n';

interface TextToken {
    value: string;
    significant: boolean;
    start: number;
    end: number;
}

export interface WordCorrection {
    tokenIndex: number;
    original: string;
    corrected: string;
    start: number;
    end: number;
}

const MAX_LCS_CELLS = 1_000_000;

function isWordChar(char: string | undefined): boolean {
    return !!char && /[\p{L}\p{N}]/u.test(char);
}

function getSegmentCorrection(
    original: string,
    corrected: string,
    correctedOffset = 0,
    tokenIndex = 0,
): WordCorrection | null {
    if (original === corrected) return null;
    let commonPrefix = 0;
    const prefixLimit = Math.min(original.length, corrected.length);
    while (commonPrefix < prefixLimit && original[commonPrefix] === corrected[commonPrefix]) commonPrefix++;

    let commonSuffix = 0;
    const suffixLimit = Math.min(original.length - commonPrefix, corrected.length - commonPrefix);
    while (
        commonSuffix < suffixLimit &&
        original[original.length - commonSuffix - 1] === corrected[corrected.length - commonSuffix - 1]
    )
        commonSuffix++;

    // Если граница префикса разрезает слово изнутри — откатываемся к началу слова
    if (commonPrefix > 0 && isWordChar(original[commonPrefix - 1]) && isWordChar(original[commonPrefix])) {
        while (commonPrefix > 0 && isWordChar(original[commonPrefix - 1])) {
            commonPrefix--;
        }
    }

    // Если граница суффикса разрезает слово изнутри — откатываемся к концу слова
    if (
        commonSuffix > 0 &&
        isWordChar(original[original.length - commonSuffix]) &&
        isWordChar(original[original.length - commonSuffix - 1])
    ) {
        while (commonSuffix > 0 && isWordChar(original[original.length - commonSuffix])) {
            commonSuffix--;
        }
    }

    const origSlice = original.slice(commonPrefix, original.length - commonSuffix);
    const corrSlice = corrected.slice(commonPrefix, corrected.length - commonSuffix);

    if (origSlice === corrSlice) return null;

    return {
        tokenIndex,
        original: origSlice,
        corrected: corrSlice,
        start: correctedOffset + commonPrefix,
        end: correctedOffset + corrected.length - commonSuffix,
    };
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
    const pattern = /\s+|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;
    return [...text.matchAll(pattern)].map((match) => ({
        value: match[0],
        significant: !/^\s+$/u.test(match[0]),
        start: match.index,
        end: match.index + match[0].length,
    }));
}

export function normalizeSpellcheckResult(text: string): string {
    return text.replace(/\*\*([\s\S]*?)\*\*/g, '$1').replace(/\*\*/g, '');
}

export function getWordCorrections(original: string, corrected: string): WordCorrection[] {
    const originalTokens = tokenizeText(original).filter((token) => token.significant);
    const correctedTokens = tokenizeText(corrected).filter((token) => token.significant);
    if ((originalTokens.length + 1) * (correctedTokens.length + 1) > MAX_LCS_CELLS) {
        const correction = getSegmentCorrection(original, corrected);
        return correction ? [correction] : [];
    }
    const rows = Array.from({ length: originalTokens.length + 1 }, () => new Uint16Array(correctedTokens.length + 1));

    for (let originalIndex = 1; originalIndex <= originalTokens.length; originalIndex++) {
        for (let correctedIndex = 1; correctedIndex <= correctedTokens.length; correctedIndex++) {
            rows[originalIndex][correctedIndex] =
                originalTokens[originalIndex - 1].value === correctedTokens[correctedIndex - 1].value
                    ? rows[originalIndex - 1][correctedIndex - 1] + 1
                    : Math.max(rows[originalIndex - 1][correctedIndex], rows[originalIndex][correctedIndex - 1]);
        }
    }

    const anchors: Array<{ original: TextToken; corrected: TextToken }> = [];
    let originalIndex = originalTokens.length;
    let correctedIndex = correctedTokens.length;
    while (originalIndex > 0 && correctedIndex > 0) {
        const originalToken = originalTokens[originalIndex - 1];
        const correctedToken = correctedTokens[correctedIndex - 1];
        if (originalToken.value === correctedToken.value) {
            anchors.push({ original: originalToken, corrected: correctedToken });
            originalIndex--;
            correctedIndex--;
        } else if (rows[originalIndex - 1][correctedIndex] >= rows[originalIndex][correctedIndex - 1]) {
            originalIndex--;
        } else {
            correctedIndex--;
        }
    }
    anchors.reverse();

    const corrections: WordCorrection[] = [];
    let originalCursor = 0;
    let correctedCursor = 0;
    for (const anchor of [...anchors, null]) {
        const originalEnd = anchor?.original.start ?? original.length;
        const correctedEnd = anchor?.corrected.start ?? corrected.length;
        const originalSegment = original.slice(originalCursor, originalEnd);
        const correctedSegment = corrected.slice(correctedCursor, correctedEnd);
        const correction = getSegmentCorrection(originalSegment, correctedSegment, correctedCursor, corrections.length);
        if (correction) corrections.push(correction);
        if (anchor) {
            originalCursor = anchor.original.end;
            correctedCursor = anchor.corrected.end;
        }
    }
    return corrections;
}

export function resolveCorrections(corrected: string, corrections: WordCorrection[], rejected: Set<number>): string {
    let result = corrected;
    const reversed = corrections.filter((item) => rejected.has(item.tokenIndex)).sort((a, b) => b.start - a.start);
    for (const correction of reversed) {
        result = result.slice(0, correction.start) + correction.original + result.slice(correction.end);
    }
    return result;
}

export function renderSpellcheckDiff(original: string, corrected: string, rejected = new Set<number>()): string {
    const corrections = getWordCorrections(original, corrected);
    let cursor = 0;
    let html = '';
    for (const correction of corrections) {
        html += escapeHtml(corrected.slice(cursor, correction.start)).replace(/\n/g, '<br>');
        const value = rejected.has(correction.tokenIndex) ? correction.original : correction.corrected;
        const escaped = escapeHtml(value).replace(/\n/g, '<br>') || '&#8203;';
        html += rejected.has(correction.tokenIndex)
            ? escaped
            : `<mark data-token-index="${correction.tokenIndex}">${escaped}</mark>`;
        cursor = correction.end;
    }
    return html + escapeHtml(corrected.slice(cursor)).replace(/\n/g, '<br>');
}

export function renderSpellcheckDiffFragment(
    original: string,
    corrected: string,
    rejected = new Set<number>(),
    options: { showDeletionMarkers?: boolean; corrections?: readonly WordCorrection[] } = {},
): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const appendText = (container: Node, value: string) => {
        value.split('\n').forEach((line, index, lines) => {
            container.appendChild(document.createTextNode(line));
            if (index < lines.length - 1) container.appendChild(document.createElement('br'));
        });
    };
    const corrections = options.corrections ?? getWordCorrections(original, corrected);
    let cursor = 0;
    for (const correction of corrections) {
        appendText(fragment, corrected.slice(cursor, correction.start));
        const isRejected = rejected.has(correction.tokenIndex);
        if (isRejected) {
            appendText(fragment, correction.original);
        } else {
            const mark = document.createElement('mark');
            mark.dataset.tokenIndex = String(correction.tokenIndex);
            if (correction.corrected) appendText(mark, correction.corrected);
            else if (options.showDeletionMarkers !== false) {
                mark.appendChild(document.createTextNode('\u200b'));
                mark.title = `${t('deletedCorrection', 'Удалено')}: ${correction.original.trim()}`;
                mark.setAttribute('aria-label', mark.title);
                mark.style.cssText =
                    'display:inline-block;min-width:0.45em;border-left:2px solid currentColor;vertical-align:text-bottom;';
            }
            if (correction.corrected || options.showDeletionMarkers !== false) fragment.appendChild(mark);
        }
        cursor = correction.end;
    }
    appendText(fragment, corrected.slice(cursor));
    return fragment;
}
