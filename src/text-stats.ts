export interface TextStatsLabels {
    words: string;
    chars: string;
    minShort?: string;
}

export function estimateReadingTimeMinutes(text: string, wpm = 200): number {
    const words = text.trim().split(/\s+/u).filter(Boolean).length;
    if (words === 0) return 0;
    return Math.max(1, Math.round(words / wpm));
}

export function formatTextStats(
    original: string,
    result: string,
    labels: TextStatsLabels = { words: 'слов', chars: 'симв.', minShort: 'мин' },
): string {
    const origTrim = original.trim();
    const resTrim = result.trim();
    if (!resTrim) return '';

    const origWords = origTrim ? origTrim.split(/\s+/u).filter(Boolean).length : 0;
    const resWords = resTrim.split(/\s+/u).filter(Boolean).length;
    const resChars = resTrim.length;

    const minShort = labels.minShort || 'мин';
    const readingMinutes = estimateReadingTimeMinutes(resTrim);
    const readingBadge = resWords >= 100 ? `⏱ ~${readingMinutes} ${minShort} • ` : '';

    if (origWords > 0 && resWords > 0 && origWords !== resWords) {
        const diffPercent = Math.round(((resWords - origWords) / origWords) * 100);
        const sign = diffPercent > 0 ? `+${diffPercent}%` : `${diffPercent}%`;
        return `${readingBadge}${resWords} ${labels.words} (${sign}) • ${resChars} ${labels.chars}`;
    }
    return `${readingBadge}${resWords} ${labels.words} • ${resChars} ${labels.chars}`;
}
