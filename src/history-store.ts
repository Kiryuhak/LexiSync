import { getPrivacySettings } from './privacy';
import { enqueueStorageMutation } from './storage-queue';
import type { HistoryItem } from './types';

const HISTORY_LIMIT = 100;
const HISTORY_MODES = new Set(['spellcheck', 'style', 'emoji', 'layout', 'translate', 'ocr', 'custom']);

function isHistoryItem(value: unknown): value is HistoryItem {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<HistoryItem>;
    return (
        typeof item.id === 'number' &&
        typeof item.mode === 'string' &&
        HISTORY_MODES.has(item.mode) &&
        typeof item.original === 'string' &&
        typeof item.result === 'string' &&
        typeof item.date === 'string'
    );
}

export async function getHistory(): Promise<HistoryItem[]> {
    const [data, settings] = await Promise.all([chrome.storage.local.get({ aiHistory: [] }), getPrivacySettings()]);
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
    await requestHistoryMutation('add', { item });
}

export async function deleteHistoryItem(id: number): Promise<void> {
    await requestHistoryMutation('delete', { id });
}

export async function updateHistoryItemResult(id: number, result: string): Promise<void> {
    await requestHistoryMutation('updateResult', { id, result });
}

export async function setHistoryItemFavorite(id: number, favorite: boolean): Promise<void> {
    await requestHistoryMutation('setFavorite', { id, favorite });
}

export async function clearHistory(): Promise<void> {
    await requestHistoryMutation('clear', {});
}

export type HistoryMutation = 'add' | 'delete' | 'updateResult' | 'setFavorite' | 'clear';

type HistoryMutationPayload = {
    item?: HistoryItem;
    id?: number;
    result?: string;
    favorite?: boolean;
};

async function requestHistoryMutation(mutation: HistoryMutation, payload: HistoryMutationPayload): Promise<void> {
    const response = await chrome.runtime.sendMessage({
        action: 'storageMutation',
        domain: 'history',
        mutation,
        payload,
    });
    if (response?.ok !== true) throw new Error(response?.error || 'HISTORY_MUTATION_FAILED');
}

export function applyHistoryMutation(mutation: HistoryMutation, payload: HistoryMutationPayload): Promise<void> {
    return enqueueStorageMutation(async () => {
        if (mutation === 'clear') {
            await chrome.storage.local.set({ aiHistory: [] });
            return;
        }
        const history = await getHistory();
        if (mutation === 'add' && payload.item && isHistoryItem(payload.item)) {
            await chrome.storage.local.set({ aiHistory: [payload.item, ...history].slice(0, HISTORY_LIMIT) });
        } else if (mutation === 'delete' && typeof payload.id === 'number') {
            await chrome.storage.local.set({ aiHistory: history.filter((item) => item.id !== payload.id) });
        } else if (
            mutation === 'updateResult' &&
            typeof payload.id === 'number' &&
            typeof payload.result === 'string'
        ) {
            await chrome.storage.local.set({
                aiHistory: history.map((item) => (item.id === payload.id ? { ...item, result: payload.result } : item)),
            });
        } else if (
            mutation === 'setFavorite' &&
            typeof payload.id === 'number' &&
            typeof payload.favorite === 'boolean'
        ) {
            await chrome.storage.local.set({
                aiHistory: history.map((item) =>
                    item.id === payload.id ? { ...item, favorite: payload.favorite } : item,
                ),
            });
        } else {
            throw new Error('INVALID_HISTORY_MUTATION');
        }
    });
}
