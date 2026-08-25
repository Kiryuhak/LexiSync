export type SearchEngine = 'google' | 'yandex' | 'duckduckgo';

export const SEARCH_ENGINE_IDS = ['google', 'yandex', 'duckduckgo'] as const satisfies readonly SearchEngine[];

const SEARCH_ENGINES: Record<SearchEngine, { baseUrl: string; parameter: string }> = {
    google: { baseUrl: 'https://www.google.com/search', parameter: 'q' },
    yandex: { baseUrl: 'https://yandex.ru/search/', parameter: 'text' },
    duckduckgo: { baseUrl: 'https://duckduckgo.com/', parameter: 'q' },
};

function normalizeSearchText(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

export function normalizeSearchEngine(value: unknown): SearchEngine {
    return SEARCH_ENGINE_IDS.includes(value as SearchEngine) ? (value as SearchEngine) : 'google';
}

export function resolveSearchText(capturedText: unknown, visibleText: unknown): string {
    const captured = normalizeSearchText(capturedText);
    const visible = normalizeSearchText(visibleText);
    if (!captured) return visible;
    if (!visible) return captured;

    // В сложных редакторах внутреннее поле иногда сообщает только часть визуально выделенной фразы.
    // Берём более полный вариант лишь тогда, когда один текст действительно содержит другой.
    if (visible.length > captured.length && visible.includes(captured)) return visible;
    return captured;
}

export function buildSearchUrl(engine: unknown, text: unknown): string {
    const normalizedEngine = normalizeSearchEngine(engine);
    const config = SEARCH_ENGINES[normalizedEngine];
    const url = new URL(config.baseUrl);
    url.searchParams.set(config.parameter, normalizeSearchText(text));
    return url.toString();
}
