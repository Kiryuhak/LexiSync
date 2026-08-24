import type { HistoryItem, RequestMode } from './types';

function protectSpreadsheetCell(value: string): string {
    return /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
}

function escapeCsv(value: unknown): string {
    return `"${protectSpreadsheetCell(String(value)).replace(/"/g, '""')}"`;
}

export function formatHistoryAsCsv(items: HistoryItem[]): string {
    const header = ['id', 'mode', 'date', 'favorite', 'original', 'result'];
    const rows = items.map((item) => [
        String(item.id),
        escapeCsv(item.mode),
        escapeCsv(item.date),
        item.favorite ? 'true' : 'false',
        escapeCsv(item.original),
        escapeCsv(item.result),
    ]);
    return `\uFEFF${[header.join(','), ...rows.map((row) => row.join(','))].join('\r\n')}`;
}

export function formatHistoryAsMarkdown(items: HistoryItem[], modeNames: Partial<Record<RequestMode, string>>): string {
    const lines: string[] = [`# История LexiSync (${new Date().toLocaleDateString()})\n`];
    items.forEach((item, index) => {
        lines.push(`### ${index + 1}. [${modeNames[item.mode] || item.mode}] ${item.date}${item.favorite ? ' ★' : ''}`);
        lines.push(`**Исходный текст:**\n> ${item.original.replace(/\n/g, '\n> ')}\n`);
        lines.push(`**Результат:**\n${item.result}\n`);
        lines.push('---\n');
    });
    return lines.join('\n');
}
