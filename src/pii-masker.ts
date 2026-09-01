export interface MaskPiiResult {
    maskedText: string;
    maskMap: Record<string, string>;
    maskedCount: number;
}

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_PATTERN = /(?:\+7|8|\+1|\+44|\+49|\+33|\+81|\+86)[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g;
const CARD_PATTERN = /\b(?:\d{4}[ -]?){3}\d{4}\b/g;
const API_KEY_PATTERN =
    /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|ey[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,})\b/g;
const IP_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

/**
 * Локально маскирует чувствительные данные перед отправкой в AI (0 мс).
 */
export function maskPii(text: string, startIndex = 0): MaskPiiResult {
    if (!text || typeof text !== 'string') {
        return { maskedText: text, maskMap: {}, maskedCount: 0 };
    }

    const maskMap: Record<string, string> = {};
    let counter = Math.max(0, Math.trunc(startIndex));
    let maskedCount = 0;

    const replaceWithToken = (match: string, type: string): string => {
        counter++;
        maskedCount++;
        const token = `[__${type}_${counter}__]`;
        maskMap[token] = match;
        return token;
    };

    const result = text
        .replace(API_KEY_PATTERN, (match) => replaceWithToken(match, 'SECRET'))
        .replace(CARD_PATTERN, (match) => replaceWithToken(match, 'CARD'))
        .replace(EMAIL_PATTERN, (match) => replaceWithToken(match, 'EMAIL'))
        .replace(PHONE_PATTERN, (match) => replaceWithToken(match, 'PHONE'))
        .replace(IP_PATTERN, (match) => replaceWithToken(match, 'IP'));

    return {
        maskedText: result,
        maskMap,
        maskedCount,
    };
}

/**
 * Восстанавливает исходные данные из токенов маскировки за один проход без каскадных коллизий.
 */
export function unmaskPii(text: string, maskMap: Record<string, string>): string {
    if (!text || !maskMap || Object.keys(maskMap).length === 0) {
        return text;
    }

    return text.replace(/\[__[A-Z]+_\d+__\]/g, (match) => {
        return maskMap[match] ?? match;
    });
}
