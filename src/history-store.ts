import { getPrivacySettings } from './privacy';
import type { HistoryItem } from './types';

const HISTORY_LIMIT = 100;
const HISTORY_MODES = new Set(['spellcheck', 'style', 'emoji', 'layout', 'translate', 'ocr', 'custom']);

function isHistoryItem(value: unknown): value is HistoryItem {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<HistoryItem>;
    return typeof item.id === 'number'
        && typeof item.mode === 'string'
        && HISTORY_MODES.has(item.mode)
        && typeof item.original === 'string'
        && typeof item.result === 'string'
        && typeof item.date === 'string';
}

export async function getHistory(): Promise<HistoryItem[]> {
    const [data, settings] = await Promise.all([
        chrome.storage.local.get({ aiHistory: [] }),
        getPrivacySettings(),
    ]);
    const cutoff = Date.now() - settings.historyRetentionDays * 24 * 60 * 60 * 1000;
    const raw = Array.isArray(data.aiHistory) ? data.aiHistory : [];
    const history = raw
        .filter(isHistoryItem)
        .filter((item) => item.favorite === true || new Date(item.date).getTime() >= cutoff)
        .slice(0, HISTORY_LIMIT);

    if (history.length !== raw.length) await chrome.storage.local.set({ aiHistory: history });
    return history;
}

export async function addHistoryItem(item: HistoryItem): Promise<void> {
    const history = await getHistory();
    await chrome.storage.local.set({ aiHistory: [item, ...history].slice(0, HISTORY_LIMIT) });
}

export async function deleteHistoryItem(id: number): Promise<void> {
    const history = await getHistory();
    await chrome.storage.local.set({ aiHistory: history.filter((item) => item.id !== id) });
}

export async function updateHistoryItemResult(id: number, result: string): Promise<void> {
    const history = await getHistory();
    await chrome.storage.local.set({
        aiHistory: history.map((item) => item.id === id ? { ...item, result } : item),
    });
}

export async function setHistoryItemFavorite(id: number, favorite: boolean): Promise<void> {
    const history = await getHistory();
    await chrome.storage.local.set({
        aiHistory: history.map((item) => item.id === id ? { ...item, favorite } : item),
    });
}

export async function clearHistory(): Promise<void> {
    await chrome.storage.local.set({ aiHistory: [] });
}
