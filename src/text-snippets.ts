import type { TextSnippet } from './types';

export const SNIPPET_LIMIT = 20;

export const DEFAULT_TEXT_SNIPPETS: TextSnippet[] = [
    {
        id: 'snip-hello',
        trigger: '/hello',
        content: 'Здравствуйте! Надеюсь, у вас всё отлично.',
        description: 'Вежливое приветствие',
    },
    {
        id: 'snip-thanks',
        trigger: '/thanks',
        content: 'Большое спасибо за сотрудничество и оперативный ответ!',
        description: 'Благодарность',
    },
    {
        id: 'snip-meeting',
        trigger: '/meeting',
        content: 'Предлагаю созвониться и обсудить детали. Какое время вам удобно?',
        description: 'Предложение встречи',
    },
    {
        id: 'snip-sign',
        trigger: '/sign',
        content: 'С уважением,\nКоманда LexiSync',
        description: 'Подпись в письме',
    },
];

const SNIPPET_TRIGGER_PATTERN = /^\/[\p{L}\p{N}_-]{1,39}$/u;

export function normalizeTextSnippet(snippet: TextSnippet): TextSnippet {
    let trigger = snippet.trigger.trim();
    if (!trigger.startsWith('/')) trigger = `/${trigger}`;
    return {
        id: snippet.id.trim().slice(0, 100),
        trigger: trigger.slice(0, 40),
        content: snippet.content.slice(0, 5000),
        description: snippet.description?.trim().slice(0, 100),
    };
}

export function isTextSnippet(value: unknown): value is TextSnippet {
    if (!value || typeof value !== 'object') return false;
    const snippet = value as Partial<TextSnippet>;
    if (typeof snippet.id !== 'string' || typeof snippet.trigger !== 'string' || typeof snippet.content !== 'string') {
        return false;
    }
    const normalized = normalizeTextSnippet(snippet as TextSnippet);
    return Boolean(normalized.id && normalized.content && SNIPPET_TRIGGER_PATTERN.test(normalized.trigger));
}

export function normalizeTextSnippets(value: unknown, fallback = DEFAULT_TEXT_SNIPPETS): TextSnippet[] {
    if (!Array.isArray(value)) return fallback.map((snippet) => ({ ...snippet }));
    const result: TextSnippet[] = [];
    const triggers = new Set<string>();
    for (const item of value) {
        if (!isTextSnippet(item)) continue;
        const snippet = normalizeTextSnippet(item);
        const triggerKey = snippet.trigger.toLocaleLowerCase();
        if (triggers.has(triggerKey)) continue;
        triggers.add(triggerKey);
        result.push(snippet);
        if (result.length >= SNIPPET_LIMIT) break;
    }
    return result;
}

export interface TextSnippetExpansion {
    nextValue: string;
    nextCursor: number;
    snippet: TextSnippet;
}

export function getTextSnippetExpansion(
    value: string,
    cursor: number,
    snippets: TextSnippet[],
): TextSnippetExpansion | null {
    const safeCursor = Math.min(value.length, Math.max(0, cursor));
    const beforeCursor = value.slice(0, safeCursor);
    const match = beforeCursor.match(/\/[\p{L}\p{N}_-]+$/u);
    if (!match) return null;
    const trigger = match[0].toLocaleLowerCase();
    const snippet = snippets.find((item) => item.trigger.toLocaleLowerCase() === trigger);
    if (!snippet) return null;
    const start = safeCursor - match[0].length;
    const nextValue = `${value.slice(0, start)}${snippet.content}${value.slice(safeCursor)}`;
    return { nextValue, nextCursor: start + snippet.content.length, snippet };
}
