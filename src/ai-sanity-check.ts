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
    numericDiagnostics?: NumericValidationDiagnostics;
}

export interface NumericValidationDiagnostics {
    inputNumberCount: number;
    outputNumberCount: number;
    mismatchCount: number;
    numericMismatchType: 'none' | 'count_changed' | 'value_changed' | 'order_changed';
    normalizationApplied: string[];
    validationInputStage: 'ai_input';
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
    if (originalText.includes('\n') && !cleaned.includes('\n') && cleaned.includes('\\n')) {
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

    const leadingWhitespace = originalText.match(/^\s*/)?.[0] || '';
    const trailingWhitespace = originalText.match(/\s*$/)?.[0] || '';
    if (leadingWhitespace || trailingWhitespace) {
        cleaned = `${leadingWhitespace}${cleaned.trim()}${trailingWhitespace}`;
    }

    return cleaned;
}

function extractMatches(value: string, pattern: RegExp): string[] {
    return [...value.matchAll(pattern)].map((match) => match[0]).sort((a, b) => a.localeCompare(b));
}

function sameMatches(original: string, corrected: string, pattern: RegExp): boolean {
    return JSON.stringify(extractMatches(original, pattern)) === JSON.stringify(extractMatches(corrected, pattern));
}

type NumericTokenKind = 'integer' | 'decimal' | 'range' | 'date' | 'version' | 'ip' | 'structured';

interface NumericToken {
    kind: NumericTokenKind;
    canonical: string;
    normalizations: string[];
}

const NUMERIC_EXPRESSION_REGEX =
    /(?<![\p{L}\p{N}_])[-+]?\d+(?:[ \u00A0\u202F\u2009]\d{3})*(?:[.,:/\-–—]\d+(?:[ \u00A0\u202F\u2009]\d{3})*)*(?![\p{L}\p{N}_])/gu;

function classifyNumericToken(raw: string, prefix: string): NumericToken {
    const normalizations: string[] = [];
    let compact = raw;
    if (/[ \u00A0\u202F\u2009]/u.test(compact)) {
        compact = compact.replace(/[ \u00A0\u202F\u2009]/gu, '');
        normalizations.push('grouping_spaces');
    }

    if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(compact)) {
        return { kind: 'ip', canonical: `ip:${compact}`, normalizations };
    }
    if (/(?:верси(?:я|и|ю)|version|\bv)\s*$/iu.test(prefix) && /^\d+(?:\.\d+){1,3}$/u.test(compact)) {
        return { kind: 'version', canonical: `version:${compact}`, normalizations };
    }
    if (/^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})$/u.test(compact)) {
        return { kind: 'date', canonical: `date:${compact}`, normalizations };
    }
    const range = compact.match(/^([-+]?\d+)[-–—](\d+)$/u);
    if (range) {
        if (!compact.includes('-')) normalizations.push('range_dash');
        return { kind: 'range', canonical: `range:${range[1]}:${range[2]}`, normalizations };
    }
    const decimal = compact.match(/^([-+]?\d+)([.,])(\d+)$/u);
    if (decimal) {
        if (decimal[2] === ',') normalizations.push('decimal_separator');
        return { kind: 'decimal', canonical: `decimal:${decimal[1]}.${decimal[3]}`, normalizations };
    }
    if (/^[-+]?\d+$/u.test(compact)) {
        return { kind: 'integer', canonical: `integer:${compact}`, normalizations };
    }
    return { kind: 'structured', canonical: `structured:${compact}`, normalizations };
}

function extractNumericTokens(value: string): NumericToken[] {
    const tokens: NumericToken[] = [];
    for (const match of value.matchAll(NUMERIC_EXPRESSION_REGEX)) {
        const offset = match.index ?? 0;
        tokens.push(classifyNumericToken(match[0], value.slice(Math.max(0, offset - 16), offset)));
    }
    return tokens;
}

/** Сравнивает числовой смысл без включения самих пользовательских чисел в диагностику. */
export function validateNumericIntegrity(input: string, output: string): NumericValidationDiagnostics {
    const inputTokens = extractNumericTokens(input);
    const outputTokens = extractNumericTokens(output);
    const normalizationApplied = [
        ...new Set([...inputTokens, ...outputTokens].flatMap((token) => token.normalizations)),
    ].sort();
    const inputCanonical = inputTokens.map((token) => token.canonical);
    const outputCanonical = outputTokens.map((token) => token.canonical);
    let numericMismatchType: NumericValidationDiagnostics['numericMismatchType'] = 'none';
    let mismatchCount: number;

    if (inputCanonical.length !== outputCanonical.length) {
        numericMismatchType = 'count_changed';
        mismatchCount = Math.abs(inputCanonical.length - outputCanonical.length);
    } else {
        mismatchCount = inputCanonical.reduce(
            (count, token, index) => count + (token === outputCanonical[index] ? 0 : 1),
            0,
        );
        if (mismatchCount > 0) {
            const sortedInput = [...inputCanonical].sort();
            const sortedOutput = [...outputCanonical].sort();
            numericMismatchType =
                JSON.stringify(sortedInput) === JSON.stringify(sortedOutput) ? 'order_changed' : 'value_changed';
        }
    }

    return {
        inputNumberCount: inputTokens.length,
        outputNumberCount: outputTokens.length,
        mismatchCount,
        numericMismatchType,
        normalizationApplied,
        validationInputStage: 'ai_input',
    };
}

function wordEditDistance(left: string, right: string): number {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        let diagonal = row[0];
        row[0] = leftIndex;
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            const previous = row[rightIndex];
            row[rightIndex] = Math.min(
                row[rightIndex] + 1,
                row[rightIndex - 1] + 1,
                diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
            );
            diagonal = previous;
        }
    }
    return row[right.length];
}

function areLikelySpellingVariants(left: string, right: string): boolean {
    const longest = Math.max(left.length, right.length);
    if (longest < 3 || Math.abs(left.length - right.length) > 2) return false;
    const allowedDistance = longest >= 8 ? 2 : 1;
    return wordEditDistance(left, right) <= allowedDistance;
}

function getWordOverlapRatio(original: string, corrected: string): number {
    const originalWords = original.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const correctedWords = corrected.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (originalWords.length < 3) return 1;
    if (correctedWords.length === 0) return 0;

    const remaining = [...originalWords];
    let common = 0;
    for (const word of correctedWords) {
        let index = remaining.indexOf(word);
        if (index < 0) index = remaining.findIndex((candidate) => areLikelySpellingVariants(candidate, word));
        if (index < 0) continue;
        common += 1;
        remaining.splice(index, 1);
    }
    return (2 * common) / (originalWords.length + correctedWords.length);
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
        const cleanTrim = cleaned.trim();
        const origLen = origTrim.length;

        if (origLen >= 8) {
            // 2. Корректор не должен возвращать обрезанный фрагмент даже для короткого выделения.
            if (cleanTrim.length < origLen * 0.7) {
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

        if (!sameMatches(origTrim, cleanTrim, urlRegex)) {
            return {
                valid: false,
                reason: 'AI_OUTPUT_CHANGED_URLS',
                cleanedText: cleaned,
            };
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

        if (!sameMatches(origTrim, cleanTrim, emailRegex)) {
            return {
                valid: false,
                reason: 'AI_OUTPUT_CHANGED_EMAILS',
                cleanedText: cleaned,
            };
        }

        // 7. Числовые значения сравниваются с фактическим входом AI в исходном порядке.
        // Допустимы только явно эквивалентные типографические формы диапазонов,
        // разрядных пробелов и десятичного разделителя; даты, версии и IP классифицируются отдельно.
        const numericDiagnostics = validateNumericIntegrity(origTrim, cleanTrim);
        if (numericDiagnostics.numericMismatchType !== 'none') {
            return {
                valid: false,
                reason: 'AI_OUTPUT_CHANGED_NUMBERS',
                cleanedText: cleaned,
                numericDiagnostics,
            };
        }

        // 8. Не позволяем модели менять фрагменты кода и технические идентификаторы.
        const codeSpanRegex = /`[^`\n]+`/g;
        const technicalIdentifierRegex =
            /\b(?:[A-Z]{2,}|[A-Za-z_$][A-Za-z0-9$]*[_$][A-Za-z0-9_$]*|[a-z]+[A-Z][A-Za-z0-9]*)\b/g;
        if (
            !sameMatches(origTrim, cleanTrim, codeSpanRegex) ||
            !sameMatches(origTrim, cleanTrim, technicalIdentifierRegex)
        ) {
            return {
                valid: false,
                reason: 'AI_OUTPUT_CHANGED_TECHNICAL_ENTITY',
                cleanedText: cleaned,
            };
        }

        // 9. Мета-комментарий диагностируем раньше общей проверки переписывания.
        for (const metaPattern of META_COMMENTARY_PATTERNS) {
            if (metaPattern.test(cleaned)) {
                return {
                    valid: false,
                    reason: 'AI_OUTPUT_META_COMMENTARY: model returned conversational comment',
                    cleanedText: cleaned,
                };
            }
        }

        // 10. Корректор не должен менять структуру абзацев или переписывать большую часть слов.
        // Нормализуем CRLF и CR к LF, чтобы различия переносов Windows/Unix не давали ложных сбоев.
        const normOrigLines = originalText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const normCleanLines = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const originalLineBreaks = (normOrigLines.trimEnd().match(/\n/g) || []).length;
        const correctedLineBreaks = (normCleanLines.trimEnd().match(/\n/g) || []).length;
        if (originalLineBreaks !== correctedLineBreaks) {
            return {
                valid: false,
                reason: 'AI_OUTPUT_CHANGED_LINE_STRUCTURE',
                cleanedText: cleaned,
            };
        }
        if (getWordOverlapRatio(origTrim, cleanTrim) < 0.45) {
            return {
                valid: false,
                reason: 'AI_OUTPUT_EXCESSIVE_REWRITE',
                cleanedText: cleaned,
            };
        }
    }

    return { valid: true, cleanedText: cleaned };
}
