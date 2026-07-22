import type { RequestMode, UsageStats } from './types';
import { enqueueStorageMutation } from './storage-queue';

const STORAGE_KEY = 'usageStats';

export const EMPTY_USAGE_STATS: UsageStats = {
    requests: 0,
    cacheHits: 0,
    failures: 0,
    totalLatencyMs: 0,
    byMode: {},
};

function normalizeStats(value: unknown): UsageStats {
    const candidate = value && typeof value === 'object' ? (value as Partial<UsageStats>) : {};
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
    await requestUsageMutation('request', { mode, latencyMs, success });
}

export async function recordCacheHit(): Promise<void> {
    await requestUsageMutation('cacheHit', {});
}

export async function clearUsageStats(): Promise<void> {
    await requestUsageMutation('clear', {});
}

export type UsageMutation = 'request' | 'cacheHit' | 'clear';

interface UsageMutationPayload {
    mode?: RequestMode;
    latencyMs?: number;
    success?: boolean;
}

async function requestUsageMutation(mutation: UsageMutation, payload: UsageMutationPayload): Promise<void> {
    const response = await chrome.runtime.sendMessage({
        action: 'storageMutation',
        domain: 'usage',
        mutation,
        payload,
    });
    if (response?.ok !== true) throw new Error(response?.error || 'USAGE_MUTATION_FAILED');
}

export function applyUsageMutation(mutation: UsageMutation, payload: UsageMutationPayload): Promise<void> {
    return enqueueStorageMutation(async () => {
        if (mutation === 'clear') {
            await chrome.storage.local.set({ [STORAGE_KEY]: EMPTY_USAGE_STATS });
            return;
        }
        const stats = await getUsageStats();
        if (mutation === 'cacheHit') {
            stats.cacheHits++;
        } else if (mutation === 'request' && payload.mode) {
            stats.requests++;
            stats.totalLatencyMs += Math.max(0, Number(payload.latencyMs) || 0);
            if (payload.success !== true) stats.failures++;
            stats.byMode[payload.mode] = (stats.byMode[payload.mode] || 0) + 1;
        } else {
            throw new Error('INVALID_USAGE_MUTATION');
        }
        await chrome.storage.local.set({ [STORAGE_KEY]: stats });
    });
}
