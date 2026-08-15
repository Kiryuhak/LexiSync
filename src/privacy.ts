import type { PrivacySettings } from './types';

const DEFAULT_SETTINGS: PrivacySettings = {
    historyEnabled: true,
    historyRetentionDays: 30,
    disabledSites: [],
};

export interface NormalizedSiteEntries {
    valid: string[];
    invalid: string[];
}

function splitSiteEntries(value: unknown): string[] {
    const values = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
    return values
        .map(String)
        .map((site) => site.trim())
        .filter(Boolean);
}

function normalizeHostname(value: string): string | null {
    if (/\s/.test(value)) return null;
    const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
    const hasUnsupportedScheme =
        !hasScheme && /^[a-z][a-z\d+.-]*:/i.test(value) && !/^[^/:]+:\d+(?:[/?#]|$)/.test(value);
    if ((hasScheme && !/^https?:\/\//i.test(value)) || hasUnsupportedScheme) return null;
    try {
        const url = new URL(hasScheme ? value : `https://${value}`);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
        const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
        if (hostname === 'localhost') return hostname;
        if (hostname.length > 253 || (!hostname.includes('.') && !hostname.includes(':'))) return null;
        if (hostname.includes(':')) return /^\[[\da-f:]+\]$/i.test(hostname) ? hostname : null;
        const labels = hostname.split('.');
        if (
            labels.some(
                (label) =>
                    !label ||
                    label.length > 63 ||
                    !/^[a-z\d-]+$/i.test(label) ||
                    label.startsWith('-') ||
                    label.endsWith('-'),
            )
        )
            return null;
        return hostname;
    } catch {
        return null;
    }
}

export function normalizeSiteEntries(value: unknown): NormalizedSiteEntries {
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const entry of splitSiteEntries(value)) {
        const hostname = normalizeHostname(entry);
        if (hostname) valid.push(hostname);
        else invalid.push(entry);
    }
    return {
        valid: [...new Set(valid)].sort(),
        invalid: [...new Set(invalid)],
    };
}

export function normalizeDisabledSites(value: unknown): string[] {
    return normalizeSiteEntries(value).valid;
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

export async function shouldStoreOnCurrentPage(currentHostname?: string): Promise<boolean> {
    if (chrome.extension?.inIncognitoContext === true) return false;
    const settings = await getPrivacySettings();
    const hostname = currentHostname ?? (typeof location !== 'undefined' ? location.hostname : '');
    return settings.historyEnabled && !isSiteDisabled(hostname, settings.disabledSites);
}
