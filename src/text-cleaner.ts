export interface CleanTextOptions {
    trimLines?: boolean;
    collapseSpaces?: boolean;
    removeInvisible?: boolean;
    fixLineBreaks?: boolean;
    typography?: boolean;
}

export function cleanText(text: string, options: CleanTextOptions = {}): string {
    if (!text) return '';

    const {
        trimLines = true,
        collapseSpaces = true,
        removeInvisible = true,
        fixLineBreaks = true,
        typography = true,
    } = options;

    let result = text;

    // 1. Remove zero-width spaces and invisible control characters
    if (removeInvisible) {
        result = result.replace(/\u200B|\u200C|\u200D|\uFEFF|\u00AD|\u2060/gu, '');
    }

    // 2. Normalize Windows/Mac line endings to \n
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 3. Fix broken line breaks inside paragraphs (e.g. from PDF copies)
    if (fixLineBreaks) {
        result = result.replace(/([^\n.!?…:])\n([a-zа-яё])/giu, '$1 $2');
    }

    // 4. Collapse multiple spaces and tabs within lines
    if (collapseSpaces) {
        result = result.replace(/[ \t]+/g, ' ');
    }

    // 5. Trim lines
    if (trimLines) {
        result = result
            .split('\n')
            .map((line) => line.trim())
            .join('\n');
    }

    // 6. Limit 3+ consecutive newlines to 2 newlines (one blank line)
    result = result.replace(/\n{3,}/g, '\n\n');

    // 7. Typography: quotes and dashes
    if (typography) {
        // Replace double hyphen with em dash
        result = result.replace(/(\s)--(\s)/g, '$1—$2');
        result = result.replace(/(\s)-(\s)/g, '$1—$2');
        // Русские кавычки применяем только к фрагментам с кириллицей.
        result = result.replace(/(^|[\s(])"([^"\n]+)"/gu, (match, prefix: string, content: string) =>
            /[а-яё]/iu.test(content) ? `${prefix}«${content}»` : match,
        );
    }

    return trimLines ? result.trim() : result;
}
