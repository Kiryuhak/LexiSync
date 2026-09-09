/**
 * Модуль санитарной проверки и постобработки ответов моделей ИИ.
 * Предотвращает применение некорректных ответов, удаляет служебные фразы и проверяет сохранение структуры.
 */

export interface AiSanityCheckOptions {
    originalText: string;
    correctedText: string;
    mode?: string;
    targetLang?: string;
}

export interface AiSanityResult {
    valid: boolean;
    reason?: string;
    cleanedText: string;
}

const CONVERSATIONAL_PREFIX_REGEXES = [
    /^(?:Вот\s+(?:исправленный|готовый|обработанный|ваш|отредактированный)\s+(?:текст|вариант|результат|ответ)|Исправленный\s+(?:текст|вариант|результат|ответ)|Текст\s+с\s+исправленными\s+ошибками|Вот\s+что\s+получилось|Результат\s+обработки|Результат|Готовый\s+текст|Исправленная\s+версия|Ниже\s+приведён\s+исправленный\s+текст):\s*\n*/i,
    /^(?:Here\s+is\s+the\s+(?:corrected|edited|revised)\s+(?:text|version|result)|Corrected\s+(?:text|version|result)|Here\s+are\s+the\s+corrections|Output):\s*\n*/i,
];

const META_COMMENTARY_PATTERNS = [
    /^(?:Я\s+исправил\s+следующие|В\s+данном\s+тексте\s+были|Пожалуйста,\s+обратите\s+внимание|Обратите\s+внимание:)/i,
    /^(?:As\s+an\s+AI\s+language\s+model|Note:\s*I\s+have|Please\s+note\s+that)/i,
];

/**
 * Очищает ответ модели от Markdown code fences, служебных тегов, вступительных фраз и лишних внешних кавычек.
 */
export function cleanAiOutputText(rawText: string, originalText = ''): string {
    if (!rawText || typeof rawText !== 'string') return '';
    let cleaned = rawText.trim();

    // 1. Снимаем обрамляющие Markdown code blocks: ```...``` или ```text ... ```
    const codeBlockRegex = /^```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)\n?```$/;
    const blockMatch = cleaned.match(codeBlockRegex);
    if (blockMatch) {
        cleaned = blockMatch[1].trim();
    }

    // 2. Снимаем теги <TEXT_TO_PROCESS>...</TEXT_TO_PROCESS> если модель их эхонула
    cleaned = cleaned
        .replace(/^<TEXT_TO_PROCESS(?:_JSON)?>\s*([\s\S]*?)\s*<\/TEXT_TO_PROCESS(?:_JSON)?>$/i, '$1')
        .trim();

    // 3. Удаляем вступительные фразы ("Вот исправленный текст:", "Результат:" и др.)
    for (const prefixRegex of CONVERSATIONAL_PREFIX_REGEXES) {
        cleaned = cleaned.replace(prefixRegex, '').trim();
    }

    // 4. Если в ответе нет переносов строк, но есть литералы \n, преобразуем их в настоящие переносы
    if (!cleaned.includes('\n') && cleaned.includes('\\n')) {
        cleaned = cleaned.replace(/\\n/g, '\n');
    }

    // 5. Удаляем внешние кавычки, если модель обернула весь текст в кавычки, а исходный текст в них не был
    const origTrimmed = originalText.trim();
    const hasOriginalDoubleQuotes = origTrimmed.startsWith('"') && origTrimmed.endsWith('"');
    const hasOriginalGuillemets = origTrimmed.startsWith('«') && origTrimmed.endsWith('»');
    const hasOriginalSingleQuotes = origTrimmed.startsWith("'") && origTrimmed.endsWith("'");

    if (!hasOriginalDoubleQuotes && cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2) {
        cleaned = cleaned.slice(1, -1).trim();
    } else if (!hasOriginalGuillemets && cleaned.startsWith('«') && cleaned.endsWith('»') && cleaned.length >= 2) {
        cleaned = cleaned.slice(1, -1).trim();
    } else if (!hasOriginalSingleQuotes && cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length >= 2) {
        cleaned = cleaned.slice(1, -1).trim();
    }

    return cleaned;
}

/**
 * Проверяет применимость ответа модели к исходному тексту (Sanity Check).
 */
export function validateAiOutput(options: AiSanityCheckOptions): AiSanityResult {
    const { originalText = '', correctedText = '', mode } = options;
    const cleaned = cleanAiOutputText(correctedText, originalText);

    // 1. Проверка на непустой результат
    if (!cleaned || cleaned.trim().length === 0) {
        return { valid: false, reason: 'AI_OUTPUT_EMPTY', cleanedText: '' };
    }

    // Проверки специфичные для режима "spellcheck" (исправление ошибок)
    if (mode === 'spellcheck') {
        const origTrim = originalText.trim();
        const origLen = origTrim.length;

        if (origLen >= 15) {
            // 2. Аномальное сокращение (более чем на 45% при исправлении орфографии недопустимо)
            if (cleaned.length < origLen * 0.55) {
                return {
                    valid: false,
                    reason: `AI_OUTPUT_TOO_SHORT: length decreased from ${origLen} to ${cleaned.length}`,
                    cleanedText: cleaned,
                };
            }

            // 3. Аномальное удлинение (более чем на 75% и +60 символов недопустимо для корректора)
            if (cleaned.length > origLen * 1.75 && cleaned.length > origLen + 60) {
                return {
                    valid: false,
                    reason: `AI_OUTPUT_TOO_LONG: length increased from ${origLen} to ${cleaned.length}`,
                    cleanedText: cleaned,
                };
            }
        }

        // 4. Проверка смены языка (Language Drift):
        // Если в исходном тексте была преимущественно кириллица, она не должна исчезать
        const origCyrLetters = (origTrim.match(/[\p{sc=Cyrillic}]/gu) || []).length;
        const origTotalLetters = (origTrim.match(/[\p{L}]/gu) || []).length;

        if (origTotalLetters >= 10 && origCyrLetters / origTotalLetters >= 0.45) {
            const cleanCyrLetters = (cleaned.match(/[\p{sc=Cyrillic}]/gu) || []).length;
            const cleanTotalLetters = (cleaned.match(/[\p{L}]/gu) || []).length;
            if (cleanTotalLetters > 0 && cleanCyrLetters / cleanTotalLetters < 0.2) {
                return {
                    valid: false,
                    reason: 'AI_OUTPUT_LANGUAGE_DRIFT: Cyrillic text lost in output',
                    cleanedText: cleaned,
                };
            }
        }

        // 5. Сохранение URL
        const urlRegex = /\bhttps?:\/\/[^\s<>"')]+/gi;
        const origUrls = origTrim.match(urlRegex) || [];
        for (const url of origUrls) {
            if (!cleaned.includes(url)) {
                return {
                    valid: false,
                    reason: `AI_OUTPUT_LOST_URL: ${url}`,
                    cleanedText: cleaned,
                };
            }
        }

        // 6. Сохранение Email
        const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
        const origEmails = origTrim.match(emailRegex) || [];
        for (const email of origEmails) {
            if (!cleaned.includes(email)) {
                return {
                    valid: false,
                    reason: `AI_OUTPUT_LOST_EMAIL: ${email}`,
                    cleanedText: cleaned,
                };
            }
        }

        // 7. Сохранение ключевых чисел (номера телефонов, годы, точные цифровые значения от 3 цифр)
        const numberMatches = origTrim.match(/\b\d{3,}(?:[.,]\d+)?\b/g) || [];
        for (const num of numberMatches) {
            if (!cleaned.includes(num)) {
                return {
                    valid: false,
                    reason: `AI_OUTPUT_LOST_NUMBER: ${num}`,
                    cleanedText: cleaned,
                };
            }
        }

        // 8. Проверка на служебные мета-комментарии модели
        for (const metaPattern of META_COMMENTARY_PATTERNS) {
            if (metaPattern.test(cleaned)) {
                return {
                    valid: false,
                    reason: 'AI_OUTPUT_META_COMMENTARY: model returned conversational comment',
                    cleanedText: cleaned,
                };
            }
        }
    }

    return { valid: true, cleanedText: cleaned };
}
