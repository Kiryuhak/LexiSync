import { getPrivacySettings } from './privacy';
import { enqueueStorageMutation } from './storage-queue';
import type { HistoryItem } from './types';
import { openDatabase, idbGet, idbGetAll, idbPut, idbDelete, idbClear, idbCount } from './idb';
import { logger } from './logger';

const HISTORY_LIMIT = 500; // Increased limit for IndexedDB
const HISTORY_TEXT_MAX_LENGTH = 50_000;
const HISTORY_NAME_MAX_LENGTH = 80;
const HISTORY_MODES = new Set(['spellcheck', 'style', 'emoji', 'layout', 'translate', 'ocr', 'custom']);
const DB_NAME = 'LexiSyncDB';
const STORE_NAME = 'history';

function isHistoryItem(value: unknown): value is HistoryItem {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<HistoryItem>;
    return (
        typeof item.id === 'number' &&
        Number.isFinite(item.id) &&
        typeof item.mode === 'string' &&
        HISTORY_MODES.has(item.mode) &&
        typeof item.original === 'string' &&
        item.original.length <= HISTORY_TEXT_MAX_LENGTH &&
        typeof item.result === 'string' &&
        item.result.length <= HISTORY_TEXT_MAX_LENGTH &&
        typeof item.date === 'string' &&
        Number.isFinite(new Date(item.date).getTime()) &&
        (item.customName === undefined ||
            (typeof item.customName === 'string' && item.customName.length <= HISTORY_NAME_MAX_LENGTH)) &&
        (item.favorite === undefined || typeof item.favorite === 'boolean')
    );
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = openDatabase(DB_NAME, 1, (db) => {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        })
            .then(async (db) => {
                try {
                    const data = await chrome.storage.local.get('aiHistory');
                    if (data.aiHistory && Array.isArray(data.aiHistory)) {
                        logger.info('Migrating history to IndexedDB...');
                        for (const item of data.aiHistory) {
                            if (isHistoryItem(item)) {
                                try {
                                    await idbPut(db, STORE_NAME, item);
                                } catch (putError) {
                                    logger.error('Failed to migrate history item', putError);
                                }
                            }
                        }
                        await chrome.storage.local.remove('aiHistory');
                        logger.info('History migration complete.');
                    }
                } catch (e) {
                    logger.error('History migration error', e);
                }
                return db;
            })
            .catch((error) => {
                dbPromise = null;
                throw error;
            });
    }
    return dbPromise;
}

export async function getHistory(): Promise<HistoryItem[]> {
    const [db, settings] = await Promise.all([getDB(), getPrivacySettings()]);
    const cutoff = Date.now() - settings.historyRetentionDays * 24 * 60 * 60 * 1000;

    const raw = await idbGetAll<HistoryItem>(db, STORE_NAME);
    const history = raw
        .filter(isHistoryItem)
        .filter((item) => item.favorite === true || new Date(item.date).getTime() >= cutoff)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, HISTORY_LIMIT);

    if (history.length < raw.length) {
        const toKeep = new Set(history.map((i) => i.id));
        for (const item of raw) {
            if (!toKeep.has(item.id)) {
                await idbDelete(db, STORE_NAME, item.id);
            }
        }
    }

    return history;
}

/** Возвращает только число записей, не загружая тексты истории в память. */
export async function getHistoryItemCount(): Promise<number> {
    return idbCount(await getDB(), STORE_NAME);
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
        const db = await getDB();
        if (mutation === 'clear') {
            await idbClear(db, STORE_NAME);
            return;
        }
        if (mutation === 'add' && payload.item && isHistoryItem(payload.item)) {
            await idbPut(db, STORE_NAME, payload.item);

            const all = await idbGetAll<HistoryItem>(db, STORE_NAME);
            if (all.length > HISTORY_LIMIT) {
                const sorted = all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                const toDelete = sorted.slice(HISTORY_LIMIT);
                for (const item of toDelete) {
                    if (!item.favorite) await idbDelete(db, STORE_NAME, item.id);
                }
            }
        } else if (mutation === 'delete' && typeof payload.id === 'number' && Number.isFinite(payload.id)) {
            await idbDelete(db, STORE_NAME, payload.id);
        } else if (
            mutation === 'updateResult' &&
            typeof payload.id === 'number' &&
            Number.isFinite(payload.id) &&
            typeof payload.result === 'string' &&
            payload.result.length <= HISTORY_TEXT_MAX_LENGTH
        ) {
            const item = await idbGet<HistoryItem>(db, STORE_NAME, payload.id);
            if (item) {
                item.result = payload.result;
                await idbPut(db, STORE_NAME, item);
            }
        } else if (
            mutation === 'setFavorite' &&
            typeof payload.id === 'number' &&
            Number.isFinite(payload.id) &&
            typeof payload.favorite === 'boolean'
        ) {
            const item = await idbGet<HistoryItem>(db, STORE_NAME, payload.id);
            if (item) {
                item.favorite = payload.favorite;
                await idbPut(db, STORE_NAME, item);
            }
        } else {
            throw new Error('INVALID_HISTORY_MUTATION');
        }
    });
}
