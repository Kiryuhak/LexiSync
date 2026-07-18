import type { RequestMode, UsageStats } from './types';

const STORAGE_KEY = 'usageStats';

export const EMPTY_USAGE_STATS: UsageStats = {
    requests: 0,
    cacheHits: 0,
    failures: 0,
    totalLatencyMs: 0,
    byMode: {},
};

function normalizeStats(value: unknown): UsageStats {
    const candidate = value && typeof value === 'object' ? value as Partial<UsageStats> : {};
    return {
        requests: Math.max(0, Number(candidate.requests) || 0),
        cacheHits: Math.max(0, Number(candidate.cacheHits) || 0),
        failures: Math.max(0, Number(candidate.failures) || 0),
        totalLatencyMs: Math.max(0, Number(candidate.totalLatencyMs) || 0),
        byMode: candidate.byMode && typeof candidate.byMode === 'object' ? candidate.byMode : {},
    };
}

export async function getUsageStats(): Promise<UsageStats> {
    const stored = await chrome.storage.local.get({ [STORAGE_KEY]: EMPTY_USAGE_STATS });
    return normalizeStats(stored[STORAGE_KEY]);
}

export async function recordRequest(mode: RequestMode, latencyMs: number, success: boolean): Promise<void> {
    const stats = await getUsageStats();
    stats.requests++;
    stats.totalLatencyMs += Math.max(0, latencyMs);
    if (!success) stats.failures++;
    stats.byMode[mode] = (stats.byMode[mode] || 0) + 1;
    await chrome.storage.local.set({ [STORAGE_KEY]: stats });
}

export async function recordCacheHit(): Promise<void> {
    const stats = await getUsageStats();
    stats.cacheHits++;
    await chrome.storage.local.set({ [STORAGE_KEY]: stats });
}

export async function clearUsageStats(): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: EMPTY_USAGE_STATS });
}
