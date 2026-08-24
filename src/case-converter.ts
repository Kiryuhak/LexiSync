export type CaseType = 'sentence' | 'lower' | 'upper' | 'title' | 'camel' | 'snake';

export function toSentenceCase(text: string): string {
    if (!text) return '';
    return text.replace(/(^\s*|[.!?]\s+)([\p{L}])/gu, (_, prefix, char: string) => {
        return prefix + char.toLocaleUpperCase();
    });
}

export function toLowerCase(text: string): string {
    return text.toLocaleLowerCase();
}

export function toUpperCase(text: string): string {
    return text.toLocaleUpperCase();
}

export function toTitleCase(text: string): string {
    if (!text) return '';
    return text.replace(/(^|[^\p{L}\p{N}])([\p{L}])([\p{L}]*)/gu, (_, prefix: string, first: string, rest: string) => {
        return prefix + first.toLocaleUpperCase() + rest.toLocaleLowerCase();
    });
}

export function toCamelCase(text: string): string {
    if (!text) return '';
    const words = text
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/);
    if (words.length === 0) return '';
    return words
        .map((word, index) => {
            if (index === 0) return word.toLocaleLowerCase();
            return word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase();
        })
        .join('');
}

export function toSnakeCase(text: string): string {
    if (!text) return '';
    return text
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLocaleLowerCase();
}

export function cycleCase(text: string): string {
    if (!text) return '';
    const isAllUpper = text === text.toLocaleUpperCase() && text !== text.toLocaleLowerCase();
    const isAllLower = text === text.toLocaleLowerCase() && text !== text.toLocaleUpperCase();

    if (isAllUpper) {
        return toSentenceCase(text.toLocaleLowerCase());
    } else if (isAllLower) {
        return toTitleCase(text);
    } else if (text === toTitleCase(text)) {
        return toUpperCase(text);
    } else {
        return toLowerCase(text);
    }
}
