import { enqueueStorageMutation } from './storage-queue';

const CACHE_INDEX_KEY = 'ai_cache_index';
export const CACHE_STATS_KEY = 'ai_cache_stats';
const CACHE_SCHEMA_VERSION = 2;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;
const CACHE_VALUE_MAX_LENGTH = 50_000;
const CACHE_KEY_PATTERN = /^ai_cache_[0-9a-f]{64}$/;

export interface CacheStats {
    hits: number;
    misses: number;
    savedTokens: number;
    savedDurationMs: number;
}

export async function getCacheStats(): Promise<CacheStats> {
    try {
        const result = await chrome.storage.local.get([CACHE_STATS_KEY]);
        const stats = result[CACHE_STATS_KEY] as Partial<CacheStats> | undefined;
        return {
            hits: Number(stats?.hits) || 0,
            misses: Number(stats?.misses) || 0,
            savedTokens: Number(stats?.savedTokens) || 0,
            savedDurationMs: Number(stats?.savedDurationMs) || 0,
        };
    } catch {
        return { hits: 0, misses: 0, savedTokens: 0, savedDurationMs: 0 };
    }
}

export async function recordCacheHit(valueLength: number): Promise<void> {
    try {
        const stats = await getCacheStats();
        stats.hits += 1;
        stats.savedTokens += Math.max(20, Math.ceil(valueLength / 3.2));
        stats.savedDurationMs += 1500;
        await chrome.storage.local.set({ [CACHE_STATS_KEY]: stats });
    } catch {
        // Non-blocking
    }
}

export async function recordCacheMiss(): Promise<void> {
    try {
        const stats = await getCacheStats();
        stats.misses += 1;
        await chrome.storage.local.set({ [CACHE_STATS_KEY]: stats });
    } catch {
        // Non-blocking
    }
}

interface CacheEntry {
    value: string;
    expiresAt: number;
}

interface CacheIndexItem {
    key: string;
    expiresAt: number;
}

function isCacheKey(value: unknown): value is string {
    return typeof value === 'string' && CACHE_KEY_PATTERN.test(value);
}

function isCacheIndexItem(value: unknown): value is CacheIndexItem {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<CacheIndexItem>;
    return isCacheKey(item.key) && Number.isFinite(item.expiresAt);
}

export function normalizeTextForCache(text: string): string {
    return text
        .trim()
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ');
}

export async function getCacheHash(mode: string, text: string): Promise<string> {
    const normalized = normalizeTextForCache(text);
    const msgBuffer = new TextEncoder().encode(`v${CACHE_SCHEMA_VERSION}:${mode}:${normalized}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return `ai_cache_${hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function getCachedText(key: string): Promise<string | null> {
    if (!isCacheKey(key)) return null;
    const result = await chrome.storage.local.get([key]);
    const cached = result[key] as string | CacheEntry | undefined;
    if (typeof cached === 'string') {
        void recordCacheHit(cached.length);
        return cached;
    }
    if (!cached || typeof cached.value !== 'string') {
        void recordCacheMiss();
        return null;
    }

    if (cached.expiresAt <= Date.now()) {
        await chrome.storage.local.remove(key);
        void recordCacheMiss();
        return null;
    }
    void recordCacheHit(cached.value.length);
    return cached.value;
}

export async function setCachedText(key: string, value: string): Promise<void> {
    const response = await chrome.runtime.sendMessage({
        action: 'storageMutation',
        domain: 'cache',
        mutation: 'set',
        payload: { key, value },
    });
    if (response?.ok !== true) throw new Error(response?.error || 'CACHE_MUTATION_FAILED');
}

async function setCachedTextLocally(key: string, value: string): Promise<void> {
    if (!isCacheKey(key) || value.length > CACHE_VALUE_MAX_LENGTH) throw new Error('INVALID_CACHE_MUTATION');
    const now = Date.now();
    const expiresAt = now + CACHE_TTL_MS;
    const result = await chrome.storage.local.get([CACHE_INDEX_KEY]);
    const previousIndex = Array.isArray(result[CACHE_INDEX_KEY])
        ? result[CACHE_INDEX_KEY].filter(isCacheIndexItem)
        : [];

    const activeIndex = previousIndex
        .filter((item) => item?.key !== key && item?.expiresAt > now)
        .concat({ key, expiresAt })
        .slice(-CACHE_MAX_ENTRIES);
    const activeKeys = new Set(activeIndex.map((item) => item.key));
    const keysToRemove = previousIndex.map((item) => item?.key).filter((oldKey) => !activeKeys.has(oldKey));

    if (keysToRemove.length > 0) await chrome.storage.local.remove(keysToRemove);
    await chrome.storage.local.set({
        [key]: { value, expiresAt } satisfies CacheEntry,
        [CACHE_INDEX_KEY]: activeIndex,
    });
}

export async function clearAiCache(): Promise<void> {
    const response = await chrome.runtime.sendMessage({
        action: 'storageMutation',
        domain: 'cache',
        mutation: 'clear',
        payload: {},
    });
    if (response?.ok !== true) throw new Error(response?.error || 'CACHE_MUTATION_FAILED');
}

export async function cleanupExpiredAiCacheLocally(): Promise<number> {
    const now = Date.now();
    const result = await chrome.storage.local.get([CACHE_INDEX_KEY]);
    const previousIndex = Array.isArray(result[CACHE_INDEX_KEY])
        ? result[CACHE_INDEX_KEY].filter(isCacheIndexItem)
        : [];
    const activeIndex = previousIndex.filter((item) => item.expiresAt > now);
    const activeKeys = new Set(activeIndex.map((item) => item.key));
    const expiredKeys = previousIndex.filter((item) => !activeKeys.has(item.key)).map((item) => item.key);

    if (expiredKeys.length > 0) {
        await chrome.storage.local.remove(expiredKeys);
        await chrome.storage.local.set({ [CACHE_INDEX_KEY]: activeIndex });
    }
    return expiredKeys.length;
}

async function clearAiCacheLocally(): Promise<void> {
    const result = await chrome.storage.local.get([CACHE_INDEX_KEY]);
    const index = Array.isArray(result[CACHE_INDEX_KEY]) ? result[CACHE_INDEX_KEY].filter(isCacheIndexItem) : [];
    await chrome.storage.local.remove([...index.map((item) => item.key), CACHE_INDEX_KEY]);
}

export type CacheMutation = 'set' | 'clear' | 'cleanup';

export function applyCacheMutation(
    mutation: CacheMutation,
    payload: { key?: unknown; value?: unknown },
): Promise<void> {
    return enqueueStorageMutation(async () => {
        if (mutation === 'clear') {
            await clearAiCacheLocally();
        } else if (mutation === 'cleanup') {
            await cleanupExpiredAiCacheLocally();
        } else if (
            mutation === 'set' &&
            isCacheKey(payload.key) &&
            typeof payload.value === 'string' &&
            payload.value.length <= CACHE_VALUE_MAX_LENGTH
        ) {
            await setCachedTextLocally(payload.key, payload.value);
        } else {
            throw new Error('INVALID_CACHE_MUTATION');
        }
    });
}
