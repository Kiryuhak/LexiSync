import type { RequestMode, UsageStats } from './types';
import { enqueueStorageMutation } from './storage-queue';
import { getLocalDayKey } from './budget';

const STORAGE_KEY = 'usageStats';
export const USAGE_MUTATION_QUEUE = 'usage-budget';
const MAX_RECORDED_LATENCY_MS = 5 * 60 * 1000;
const REQUEST_MODES = new Set<RequestMode>([
    'spellcheck',
    'style',
    'emoji',
    'layout',
    'translate',
    'summary',
    'ocr',
    'custom',
]);

export const EMPTY_USAGE_STATS: UsageStats = {
    requests: 0,
    cacheHits: 0,
    failures: 0,
    totalLatencyMs: 0,
    byMode: {},
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    daily: {},
};

function normalizeStats(value: unknown): UsageStats {
    const candidate = value && typeof value === 'object' ? (value as Partial<UsageStats>) : {};
    const byMode = Object.fromEntries(
        Object.entries(candidate.byMode && typeof candidate.byMode === 'object' ? candidate.byMode : {})
            .filter(([mode]) => REQUEST_MODES.has(mode as RequestMode))
            .map(([mode, count]) => [mode, Math.max(0, Math.trunc(Number(count) || 0))]),
    ) as Partial<Record<RequestMode, number>>;
    return {
        requests: Math.max(0, Math.trunc(Number(candidate.requests) || 0)),
        cacheHits: Math.max(0, Math.trunc(Number(candidate.cacheHits) || 0)),
        failures: Math.max(0, Math.trunc(Number(candidate.failures) || 0)),
        totalLatencyMs: Math.max(0, Math.trunc(Number(candidate.totalLatencyMs) || 0)),
        byMode,
        estimatedInputTokens: Math.max(0, Math.trunc(Number(candidate.estimatedInputTokens) || 0)),
        estimatedOutputTokens: Math.max(0, Math.trunc(Number(candidate.estimatedOutputTokens) || 0)),
        daily: Object.fromEntries(
            Object.entries(candidate.daily && typeof candidate.daily === 'object' ? candidate.daily : {})
                .filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day))
                .slice(-62)
                .map(([day, usage]) => {
                    const value = usage && typeof usage === 'object' ? usage : { requests: 0, tokens: 0 };
                    return [
                        day,
                        {
                            requests: Math.max(0, Math.trunc(Number(value.requests) || 0)),
                            tokens: Math.max(0, Math.trunc(Number(value.tokens) || 0)),
                        },
                    ];
                }),
        ),
    };
}

export async function getUsageStats(): Promise<UsageStats> {
    const stored = await chrome.storage.local.get({ [STORAGE_KEY]: EMPTY_USAGE_STATS });
    return normalizeStats(stored[STORAGE_KEY]);
}

export async function recordRequest(
    mode: RequestMode,
    latencyMs: number,
    success: boolean,
    inputTokens = 0,
    outputTokens = 0,
): Promise<void> {
    await requestUsageMutation('request', { mode, latencyMs, success, inputTokens, outputTokens });
}

export async function recordCacheHit(): Promise<void> {
    await requestUsageMutation('cacheHit', {});
}

export async function clearUsageStats(): Promise<void> {
    await requestUsageMutation('clear', {});
}

export type UsageMutation = 'request' | 'cacheHit' | 'clear';

export interface UsageMutationPayload {
    mode?: RequestMode;
    latencyMs?: number;
    success?: boolean;
    inputTokens?: number;
    outputTokens?: number;
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

export async function applyUsageMutationNow(mutation: UsageMutation, payload: UsageMutationPayload): Promise<void> {
    if (mutation === 'clear') {
        await chrome.storage.local.set({ [STORAGE_KEY]: EMPTY_USAGE_STATS });
        return;
    }
    const stats = await getUsageStats();
    if (mutation === 'cacheHit') {
        stats.cacheHits++;
    } else if (mutation === 'request' && payload.mode && REQUEST_MODES.has(payload.mode)) {
        stats.requests++;
        stats.totalLatencyMs += Math.min(MAX_RECORDED_LATENCY_MS, Math.max(0, Number(payload.latencyMs) || 0));
        if (payload.success !== true) stats.failures++;
        stats.byMode[payload.mode] = (stats.byMode[payload.mode] || 0) + 1;
        const inputTokens = Math.max(0, Math.trunc(Number(payload.inputTokens) || 0));
        const outputTokens = Math.max(0, Math.trunc(Number(payload.outputTokens) || 0));
        stats.estimatedInputTokens = (stats.estimatedInputTokens || 0) + inputTokens;
        stats.estimatedOutputTokens = (stats.estimatedOutputTokens || 0) + outputTokens;
        const day = getLocalDayKey();
        const daily = stats.daily || {};
        daily[day] = {
            requests: (daily[day]?.requests || 0) + 1,
            tokens: (daily[day]?.tokens || 0) + inputTokens + outputTokens,
        };
        stats.daily = Object.fromEntries(Object.entries(daily).sort().slice(-62));
    } else {
        throw new Error('INVALID_USAGE_MUTATION');
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: stats });
}

export function applyUsageMutation(mutation: UsageMutation, payload: UsageMutationPayload): Promise<void> {
    return enqueueStorageMutation(() => applyUsageMutationNow(mutation, payload), USAGE_MUTATION_QUEUE);
}
