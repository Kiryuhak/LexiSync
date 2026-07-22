import type { PrivacySettings } from './types';

const DEFAULT_SETTINGS: PrivacySettings = {
    historyEnabled: true,
    historyRetentionDays: 30,
    disabledSites: [],
};

export function normalizeDisabledSites(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map(String)
            .map((site) => site.trim().toLowerCase())
            .filter(Boolean);
    }
    return String(value || '')
        .split(/[\n,]/)
        .map((site) => site.trim().toLowerCase())
        .filter(Boolean);
}

export async function getPrivacySettings(): Promise<PrivacySettings> {
    const stored = await chrome.storage.local.get({
        historyEnabled: DEFAULT_SETTINGS.historyEnabled,
        historyRetentionDays: DEFAULT_SETTINGS.historyRetentionDays,
        disabledSites: DEFAULT_SETTINGS.disabledSites,
    });
    return {
        historyEnabled: stored.historyEnabled !== false,
        historyRetentionDays: Math.max(1, Number(stored.historyRetentionDays) || 30),
        disabledSites: normalizeDisabledSites(stored.disabledSites),
    };
}

export function isSiteDisabled(hostname: string, disabledSites: string[]): boolean {
    const host = hostname.toLowerCase();
    return disabledSites.some((site) => host === site || host.endsWith(`.${site}`));
}

export async function shouldStoreOnCurrentPage(): Promise<boolean> {
    if (chrome.extension.inIncognitoContext) return false;
    const settings = await getPrivacySettings();
    return settings.historyEnabled && !isSiteDisabled(location.hostname, settings.disabledSites);
}
