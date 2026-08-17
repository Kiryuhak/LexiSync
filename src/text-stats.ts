export interface TextStatsLabels {
    words: string;
    chars: string;
}

export function formatTextStats(
    original: string,
    result: string,
    labels: TextStatsLabels = { words: 'слов', chars: 'симв.' },
): string {
    const origTrim = original.trim();
    const resTrim = result.trim();
    if (!resTrim) return '';

    const origWords = origTrim ? origTrim.split(/\s+/u).filter(Boolean).length : 0;
    const resWords = resTrim.split(/\s+/u).filter(Boolean).length;
    const resChars = resTrim.length;

    if (origWords > 0 && resWords > 0 && origWords !== resWords) {
        const diffPercent = Math.round(((resWords - origWords) / origWords) * 100);
        const sign = diffPercent > 0 ? `+${diffPercent}%` : `${diffPercent}%`;
        return `${resWords} ${labels.words} (${sign}) • ${resChars} ${labels.chars}`;
    }
    return `${resWords} ${labels.words} • ${resChars} ${labels.chars}`;
}
