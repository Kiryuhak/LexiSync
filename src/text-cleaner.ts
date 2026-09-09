export interface CleanTextOptions {
    trimLines?: boolean;
    collapseSpaces?: boolean;
    removeInvisible?: boolean;
    fixLineBreaks?: boolean;
    typography?: boolean;
    quotes?: boolean;
    dashes?: boolean;
    ranges?: boolean;
    nonBreakingSpaces?: boolean;
    fixPunctuationSpaces?: boolean;
    fixDoubleCaps?: boolean;
    specialSymbols?: boolean;
    ellipsis?: boolean;
}

export interface TypographySettings {
    trimLines: boolean;
    collapseSpaces: boolean;
    removeInvisible: boolean;
    fixLineBreaks: boolean;
    quotes: boolean;
    dashes: boolean;
    ranges: boolean;
    nonBreakingSpaces: boolean;
    fixPunctuationSpaces: boolean;
    fixDoubleCaps: boolean;
    specialSymbols: boolean;
    ellipsis: boolean;
}

export const DEFAULT_TYPOGRAPHY_SETTINGS: TypographySettings = {
    trimLines: true,
    collapseSpaces: true,
    removeInvisible: true,
    fixLineBreaks: true,
    quotes: true,
    dashes: true,
    ranges: true,
    nonBreakingSpaces: false,
    fixPunctuationSpaces: true,
    fixDoubleCaps: true,
    specialSymbols: true,
    ellipsis: true,
};

export function normalizeTypographySettings(input: unknown): TypographySettings {
    if (!input || typeof input !== 'object') return { ...DEFAULT_TYPOGRAPHY_SETTINGS };
    const raw = input as Partial<TypographySettings>;
    return {
        trimLines: typeof raw.trimLines === 'boolean' ? raw.trimLines : DEFAULT_TYPOGRAPHY_SETTINGS.trimLines,
        collapseSpaces:
            typeof raw.collapseSpaces === 'boolean' ? raw.collapseSpaces : DEFAULT_TYPOGRAPHY_SETTINGS.collapseSpaces,
        removeInvisible:
            typeof raw.removeInvisible === 'boolean'
                ? raw.removeInvisible
                : DEFAULT_TYPOGRAPHY_SETTINGS.removeInvisible,
        fixLineBreaks:
            typeof raw.fixLineBreaks === 'boolean' ? raw.fixLineBreaks : DEFAULT_TYPOGRAPHY_SETTINGS.fixLineBreaks,
        quotes: typeof raw.quotes === 'boolean' ? raw.quotes : DEFAULT_TYPOGRAPHY_SETTINGS.quotes,
        dashes: typeof raw.dashes === 'boolean' ? raw.dashes : DEFAULT_TYPOGRAPHY_SETTINGS.dashes,
        ranges: typeof raw.ranges === 'boolean' ? raw.ranges : DEFAULT_TYPOGRAPHY_SETTINGS.ranges,
        nonBreakingSpaces:
            typeof raw.nonBreakingSpaces === 'boolean'
                ? raw.nonBreakingSpaces
                : DEFAULT_TYPOGRAPHY_SETTINGS.nonBreakingSpaces,
        fixPunctuationSpaces:
            typeof raw.fixPunctuationSpaces === 'boolean'
                ? raw.fixPunctuationSpaces
                : DEFAULT_TYPOGRAPHY_SETTINGS.fixPunctuationSpaces,
        fixDoubleCaps:
            typeof raw.fixDoubleCaps === 'boolean' ? raw.fixDoubleCaps : DEFAULT_TYPOGRAPHY_SETTINGS.fixDoubleCaps,
        specialSymbols:
            typeof raw.specialSymbols === 'boolean' ? raw.specialSymbols : DEFAULT_TYPOGRAPHY_SETTINGS.specialSymbols,
        ellipsis: typeof raw.ellipsis === 'boolean' ? raw.ellipsis : DEFAULT_TYPOGRAPHY_SETTINGS.ellipsis,
    };
}

export function cleanText(text: string, options: CleanTextOptions = {}): string {
    if (!text) return '';

    const {
        trimLines = true,
        collapseSpaces = true,
        removeInvisible = true,
        fixLineBreaks = true,
        typography = true,
        quotes = typography,
        dashes = typography,
        ranges = typography,
        nonBreakingSpaces = false,
        fixPunctuationSpaces = typography,
        fixDoubleCaps = typography,
        specialSymbols = typography,
        ellipsis = typography,
    } = options;

    let result = text;

    // 1. Удаление невидимых символов и мягких переносов
    if (removeInvisible) {
        result = result.replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/gu, '');
    }

    // 2. Нормализация переводов строк Windows / Mac в \n
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 3. Восстановление разорванных строк внутри абзацев (например, при копировании из PDF)
    if (fixLineBreaks) {
        result = result.replace(/([^\n.!?…:])\n([a-zа-яё])/giu, '$1 $2');
    }

    // 4. Схлопывание дублирующихся пробелов и табуляций в один пробел
    if (collapseSpaces) {
        result = result.replace(/[ \t]+/g, ' ');
    }

    // 5. Исправление пробелов вокруг знаков препинания и скобок
    if (fixPunctuationSpaces) {
        // Убираем пробелы перед знаками препинания: "слово , слово !" -> "слово, слово!"
        result = result.replace(/[ \t]+([,.;:!?…%‰])/g, '$1');
        // Убираем пробелы внутри круглых и квадратных скобок: "( текст )" -> "(текст)"
        result = result.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
        result = result.replace(/\[\s+/g, '[').replace(/\s+\]/g, ']');
        // Добавляем пробел после запятой, если сразу идёт буква (в т.ч. после скобки/кавычки)
        result = result.replace(/([)\]»”"а-яёa-z0-9]),([а-яёa-z])/giu, '$1, $2');
        // Добавляем пробел после двоеточия или точки с запятой перед буквой
        result = result.replace(/([)\]»”"а-яёa-z0-9])([;:])([а-яёa-z])/giu, '$1$2 $3');
        // Добавляем пробел после завершающей предложение точки перед заглавной русской буквой
        result = result.replace(/([а-яё])[.!?]([А-ЯЁ])/gu, '$1. $2');
    }

    // 6. Исправление случайных двойных заглавных букв при быстрой печати (ПРивет -> Привет)
    if (fixDoubleCaps) {
        result = result.replace(
            /(^|[^\p{L}\p{N}_])([А-ЯЁ])([А-ЯЁ])([а-яё]+)(?=[^\p{L}\p{N}_]|$)/gu,
            (_match, prefix: string, first: string, second: string, rest: string) => {
                return `${prefix}${first}${second.toLowerCase()}${rest}`;
            },
        );
    }

    // 7. Спецсимволы: (c) -> ©, (r) -> ®, (tm) -> ™, +- -> ±
    if (specialSymbols) {
        result = result.replace(/\([cс]\)/giu, '©');
        result = result.replace(/\([rр]\)/giu, '®');
        result = result.replace(/\([tт][mм]\)/giu, '™');
        result = result.replace(/\+-/g, '±');
    }

    // 8. Многоточие: три или более точек -> …
    if (ellipsis) {
        result = result.replace(/\.{3,}/g, '…');
    }

    // 9. Тире (длинное тире, прямая речь, диапазоны)
    if (dashes) {
        result = result.replace(/(\s)--(\s)/g, '$1—$2');
        if (nonBreakingSpaces) {
            result = result.replace(/(\s)-(\s)/g, '\u00A0—$2');
        } else {
            result = result.replace(/(\s)-(\s)/g, '$1—$2');
        }
        // Прямая речь / реплика диалога в начале строки: - Привет! -> — Привет!
        result = result.replace(/(^|\n)- ([а-яёa-zА-ЯЁA-Z])/gu, '$1— $2');
    }

    if (ranges) {
        // Короткое тире (en dash) в диапазонах чисел: 1941-1945 -> 1941–1945, 1-2 -> 1–2
        result = result.replace(/(\b\d+)-(\d+\b)/g, '$1–$2');
        // Математический минус перед отрицательными числами
        result = result.replace(/(^|[\s(])-(\d+)/gu, '$1−$2');
    }

    // 10. Кавычки («ёлочки» снаружи и „лапки“ внутри цитаты)
    if (quotes) {
        let depth = 0;
        result = result.replace(/(^|[\s([])"([а-яёa-z0-9])/giu, (match, prefix: string, nextChar: string) => {
            if (!/[а-яё]/iu.test(result)) return match;
            depth++;
            const openChar = depth > 1 ? '„' : '«';
            return `${prefix}${openChar}${nextChar}`;
        });
        result = result.replace(
            /([а-яёa-z0-9.!?…])"([\s.,!?:;)\]]|$)/giu,
            (match, prevChar: string, suffix: string) => {
                if (!/[а-яё]/iu.test(result)) return match;
                const closeChar = depth > 1 ? '“' : '»';
                if (depth > 0) depth--;
                return `${prevChar}${closeChar}${suffix}`;
            },
        );
        result = result.replace(/(^|[\s(])"([^"\n]+)"/gu, (match, prefix: string, content: string) => {
            if (!/[а-яё]/iu.test(content)) return match;
            return `${prefix}«${content}»`;
        });
        result = result.replace(/(^|[\s(])[“„]([^“”„\n]+)[”"]/gu, (match, prefix: string, content: string) =>
            /[а-яё]/iu.test(content) ? `${prefix}«${content}»` : match,
        );
    }

    // 11. Неразрывные пробелы (non-breaking spaces)
    if (nonBreakingSpaces) {
        // Неразрывные пробелы после коротких предлогов и союзов (1-2 буквы)
        result = result.replace(
            /(^|[\s(«„])(в|во|на|с|со|к|ко|о|об|обо|у|и|а|но|по|из|за|от|до|не|ни|же|ли|бы|да|под|над|про|для)\s+([а-яёa-z0-9])/giu,
            '$1$2\u00A0$3',
        );
        // Неразрывные пробелы перед единицами измерения и сокращениями
        result = result.replace(
            /(\d+)\s+(г\.|руб\.|коп\.|млн|млрд|тыс\.|шт\.|см|мм|м|км|кг|г|л|°C|%|‰)/giu,
            '$1\u00A0$2',
        );
        // Неразрывные пробелы после знаков № и §
        result = result.replace(/(№|§)\s*(\d+)/gu, '$1\u00A0$2');
        // Неразрывные пробелы в инициалах: А. С. Пушкин -> А. С. Пушкин
        result = result.replace(/([А-ЯЁ]\.)\s*([А-ЯЁ]\.)\s*([А-ЯЁ][а-яё]+)/gu, '$1\u00A0$2\u00A0$3');
    }

    // 12. Обрезка строк и ограничение пустых строк
    if (trimLines) {
        result = result
            .split('\n')
            .map((line) => line.trim())
            .join('\n');
    }

    result = result.replace(/\n{3,}/g, '\n\n');

    return trimLines ? result.trim() : result;
}
