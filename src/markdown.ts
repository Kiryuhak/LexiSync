export function stripSummaryPrefix(text: string): string {
    return text.replace(
        /^(\s*(?:\*\*)?(?:TL;?DR|Выжимка|Краткая выжимка|Краткое содержание|Summary|Overview):?(?:\*\*)?[:\s]*\n*)/i,
        '',
    );
}

export function cleanMarkdownArtifacts(text: string): string {
    if (!text) return '';

    let cleaned = text;

    if (cleaned.includes('|')) {
        const lines = cleaned.split('\n');
        const hasTableDivider = lines.some((line) => /^\s*\|?[\s:-]+(?:\|[\s:-]+)+\|?\s*$/.test(line));

        if (hasTableDivider) {
            const cleanedLines: string[] = [];
            for (const line of lines) {
                if (/^\s*\|?[\s:-]+(?:\|[\s:-]+)+\|?\s*$/.test(line)) {
                    continue;
                }
                if (/^\s*\|.*\|\s*$/.test(line)) {
                    const cells = line
                        .split('|')
                        .map((c) => c.trim())
                        .filter(Boolean);
                    if (cells.length > 0) {
                        cleanedLines.push(cells.join(' • '));
                    }
                } else {
                    cleanedLines.push(line);
                }
            }
            cleaned = cleanedLines.join('\n').trim();
        } else {
            cleaned = cleaned.replace(/^\s*\|\s*([^|\n]+?)\s*(?:\|\s*)*$/gm, '$1').trim();
        }
    }

    // Удаление парных маркеров Markdown; обычный символ умножения `*` сохраняется.
    cleaned = cleaned.replace(/\*{1,3}([^*]+?)\*{1,3}/g, '$1');
    cleaned = cleaned.replace(/^\s*\*\s+/gm, '- ');

    return cleaned.trim();
}

export function escapeHTML(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function parseMarkdownToHTML(text: string): string {
    let html = escapeHTML(text);
    html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<mark>$1</mark>');
    if (html.includes('**')) html = html.replace(/\*\*([^*]*)$/, '<mark>$1</mark>');
    html = html.replace(/\*/g, '');
    html = html.replace(/^- (.*)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\.\s(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>(\n<li>.*<\/li>)*)/g, '<ul style="margin: 8px 0; padding-left: 20px;">$1</ul>');
    return html.replace(/\n/g, '<br>');
}
