import { browser } from 'wxt/browser';
import { EMPTY_USAGE_STATS } from './usage-stats';
import type { UsageStats } from './types';

export interface DiagnosticReport {
    format: 'lexisync-diagnostics';
    generatedAt: string;
    extension: { version: string; manifestVersion: number };
    environment: { userAgent: string; language: string };
    permissions: string[];
    storageBytes: number;
    features: Record<string, boolean | number | string>;
    counts: Record<string, number>;
    usage: Omit<UsageStats, 'daily'> & { recordedDays: number };
}

export async function createDiagnosticReport(): Promise<DiagnosticReport> {
    const [stored, permissions, storageBytes] = await Promise.all([
        browser.storage.local.get({
            selectedTheme: 'auto',
            visualStyle: 'liquid-glass',
            resultDisplayMode: 'compact',
            liveProofreadEnabled: false,
            adaptiveSuggestionsEnabled: false,
            historyEnabled: true,
            workflows: [],
            customCommands: [],
            styleProfiles: [],
            disabledSites: [],
            liveProofreadDisabledSites: [],
            aiHistory: [],
            usageStats: EMPTY_USAGE_STATS,
        }),
        browser.permissions.getAll(),
        browser.storage.local.getBytesInUse(null),
    ]);
    const stats = stored.usageStats as UsageStats;
    return {
        format: 'lexisync-diagnostics',
        generatedAt: new Date().toISOString(),
        extension: {
            version: browser.runtime.getManifest().version,
            manifestVersion: browser.runtime.getManifest().manifest_version,
        },
        environment: {
            userAgent: navigator.userAgent,
            language: navigator.language,
        },
        permissions: [...(permissions.permissions || [])].sort(),
        storageBytes,
        features: {
            selectedTheme: String(stored.selectedTheme),
            visualStyle: String(stored.visualStyle),
            resultDisplayMode: String(stored.resultDisplayMode),
            liveProofreadEnabled: stored.liveProofreadEnabled === true,
            adaptiveSuggestionsEnabled: stored.adaptiveSuggestionsEnabled === true,
            historyEnabled: stored.historyEnabled !== false,
        },
        counts: {
            workflows: Array.isArray(stored.workflows) ? stored.workflows.length : 0,
            customCommands: Array.isArray(stored.customCommands) ? stored.customCommands.length : 0,
            styleProfiles: Array.isArray(stored.styleProfiles) ? stored.styleProfiles.length : 0,
            privacyExcludedSites: Array.isArray(stored.disabledSites) ? stored.disabledSites.length : 0,
            proofreadExcludedSites: Array.isArray(stored.liveProofreadDisabledSites)
                ? stored.liveProofreadDisabledSites.length
                : 0,
            historyItems: Array.isArray(stored.aiHistory) ? stored.aiHistory.length : 0,
        },
        usage: {
            requests: Number(stats.requests) || 0,
            cacheHits: Number(stats.cacheHits) || 0,
            failures: Number(stats.failures) || 0,
            totalLatencyMs: Number(stats.totalLatencyMs) || 0,
            byMode: stats.byMode || {},
            estimatedInputTokens: Number(stats.estimatedInputTokens) || 0,
            estimatedOutputTokens: Number(stats.estimatedOutputTokens) || 0,
            recordedDays: Object.keys(stats.daily || {}).length,
        },
    };
}

export async function downloadDiagnosticReport(): Promise<void> {
    const report = await createDiagnosticReport();
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `lexisync-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
