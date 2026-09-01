import { cleanupExpiredAiCacheLocally } from './ai-cache';
import { MAX_ERROR_LOGS } from './error-log';
import { logger } from './logger';

export interface StorageGcReport {
    bytesInUse: number;
    expiredCacheRemoved: number;
    logsTrimmed: number;
    timestamp: number;
}

const STORAGE_MAX_SAFE_BYTES = 4 * 1024 * 1024; // 4 MB safety limit
const LOG_STORAGE_KEY = 'appErrorLogs';
let storageGcInFlight: Promise<StorageGcReport> | null = null;

export async function getStorageBytesInUse(): Promise<number> {
    try {
        if (typeof chrome.storage?.local?.getBytesInUse === 'function') {
            return await chrome.storage.local.getBytesInUse(null);
        }
        const all = await chrome.storage.local.get(null);
        return new TextEncoder().encode(JSON.stringify(all)).length;
    } catch {
        return 0;
    }
}

async function collectStorageGarbage(): Promise<StorageGcReport> {
    let expiredCacheRemoved = 0;
    let logsTrimmed = 0;

    try {
        // 1. Очистка устаревшего кэша AI
        expiredCacheRemoved = await cleanupExpiredAiCacheLocally();
    } catch (err) {
        logger.warn('[StorageGC] Failed to cleanup expired cache:', err);
    }

    try {
        // 2. Ротация журнала ошибок
        const storedLogs = await chrome.storage.local.get([LOG_STORAGE_KEY]);
        const logs = storedLogs[LOG_STORAGE_KEY];
        if (Array.isArray(logs) && logs.length > MAX_ERROR_LOGS) {
            const pruned = logs.slice(0, MAX_ERROR_LOGS);
            logsTrimmed = logs.length - pruned.length;
            await chrome.storage.local.set({ [LOG_STORAGE_KEY]: pruned });
        }
    } catch (err) {
        logger.warn('[StorageGC] Failed to prune error logs:', err);
    }

    const bytesInUse = await getStorageBytesInUse();

    if (bytesInUse > STORAGE_MAX_SAFE_BYTES) {
        logger.warn(`[StorageGC] Storage usage is high (${Math.round(bytesInUse / 1024)} KB)`);
    }

    return {
        bytesInUse,
        expiredCacheRemoved,
        logsTrimmed,
        timestamp: Date.now(),
    };
}

export function runStorageGarbageCollection(): Promise<StorageGcReport> {
    if (storageGcInFlight) return storageGcInFlight;
    storageGcInFlight = collectStorageGarbage().finally(() => {
        storageGcInFlight = null;
    });
    return storageGcInFlight;
}
