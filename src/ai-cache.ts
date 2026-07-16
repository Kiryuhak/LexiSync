const CACHE_INDEX_KEY = 'ai_cache_index';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

interface CacheEntry {
    value: string;
    expiresAt: number;
}

interface CacheIndexItem {
    key: string;
    expiresAt: number;
}

export async function getCacheHash(mode: string, text: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(`${mode}:${text.trim()}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return `ai_cache_${hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function getCachedText(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get([key]);
    const cached = result[key] as string | CacheEntry | undefined;
    if (typeof cached === 'string') return cached;
    if (!cached || typeof cached.value !== 'string') return null;

    if (cached.expiresAt <= Date.now()) {
        await chrome.storage.local.remove(key);
        return null;
    }
    return cached.value;
}

export async function setCachedText(key: string, value: string): Promise<void> {
    const now = Date.now();
    const expiresAt = now + CACHE_TTL_MS;
    const result = await chrome.storage.local.get([CACHE_INDEX_KEY]);
    const previousIndex = Array.isArray(result[CACHE_INDEX_KEY])
        ? result[CACHE_INDEX_KEY] as CacheIndexItem[]
        : [];

    const activeIndex = previousIndex
        .filter((item) => item?.key !== key && item?.expiresAt > now)
        .concat({ key, expiresAt })
        .slice(-CACHE_MAX_ENTRIES);
    const activeKeys = new Set(activeIndex.map((item) => item.key));
    const keysToRemove = previousIndex
        .map((item) => item?.key)
        .filter((oldKey): oldKey is string => Boolean(oldKey) && !activeKeys.has(oldKey));

    if (keysToRemove.length > 0) await chrome.storage.local.remove(keysToRemove);
    await chrome.storage.local.set({
        [key]: { value, expiresAt } satisfies CacheEntry,
        [CACHE_INDEX_KEY]: activeIndex,
    });
}

export async function clearAiCache(): Promise<void> {
    const result = await chrome.storage.local.get([CACHE_INDEX_KEY]);
    const index = Array.isArray(result[CACHE_INDEX_KEY]) ? result[CACHE_INDEX_KEY] as CacheIndexItem[] : [];
    await chrome.storage.local.remove([...index.map((item) => item.key), CACHE_INDEX_KEY]);
}
