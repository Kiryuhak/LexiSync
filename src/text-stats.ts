export interface TextStatsLabels {
    words: string;
    chars: string;
    minShort?: string;
    charsNoSpaces?: string;
    sentences?: string;
    readability?: string;
}

export interface DetailedTextStats {
    words: number;
    chars: number;
    charsNoSpaces: number;
    sentences: number;
    readingMinutes: number;
    readabilityScore: number;
    readabilityLevel: 'easy' | 'medium' | 'hard';
}

export function estimateReadingTimeMinutes(text: string, wpm = 200): number {
    const words = text.trim().split(/\s+/u).filter(Boolean).length;
    if (words === 0) return 0;
    return Math.max(1, Math.round(words / wpm));
}

export function calculateDetailedStats(text: string): DetailedTextStats {
    const trimmed = text.trim();
    if (!trimmed) {
        return {
            words: 0,
            chars: 0,
            charsNoSpaces: 0,
            sentences: 0,
            readingMinutes: 0,
            readabilityScore: 100,
            readabilityLevel: 'easy',
        };
    }

    const wordsArray = trimmed.split(/\s+/u).filter(Boolean);
    const words = wordsArray.length;
    const chars = trimmed.length;
    const charsNoSpaces = trimmed.replace(/\s+/g, '').length;

    // Считаем предложения (по знакам препинания .!? или переносам строк)
    const sentences = Math.max(1, trimmed.split(/[.!?]+(?:\s+|$)/u).filter((s) => s.trim().length > 0).length);

    const readingMinutes = estimateReadingTimeMinutes(trimmed);

    // Подсчет слогов (по гласным буквам для RU и EN)
    const vowelsMatch = trimmed.match(/[аеёиоуыэюяaeiouyАЕЁИОУЫЭЮЯAEIOUY]/g);
    const syllables = vowelsMatch ? vowelsMatch.length : words;

    // Адаптированная формула удобочитаемости Флеша
    const asl = words / sentences; // средняя длина предложения в словах
    const asw = words > 0 ? syllables / words : 1; // среднее число слогов на слово
    const isRussian = /[а-яА-ЯёЁ]/.test(trimmed);

    const rawScore = isRussian ? 206.835 - 1.3 * asl - 60.1 * asw : 206.835 - 1.015 * asl - 84.6 * asw;
    const readabilityScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    let readabilityLevel: 'easy' | 'medium' | 'hard' = 'medium';
    if (readabilityScore >= 60) readabilityLevel = 'easy';
    else if (readabilityScore < 40) readabilityLevel = 'hard';

    return {
        words,
        chars,
        charsNoSpaces,
        sentences,
        readingMinutes,
        readabilityScore,
        readabilityLevel,
    };
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
