import type { StyleProfile } from './types';

export function normalizeSitePatterns(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const normalized = value
        .map(String)
        .map((entry) => entry.trim().toLowerCase())
        .map((entry) =>
            entry
                .replace(/^https?:\/\//, '')
                .replace(/\/.*$/, '')
                .replace(/^\*\./, '')
                .replace(/^\./, ''),
        )
        .filter((entry) => entry.length > 0 && entry.length <= 253 && /^[a-z0-9.-]+$/i.test(entry));
    return [...new Set(normalized)].slice(0, 100);
}

export function readHostname(value: string | undefined): string {
    if (!value) return '';
    try {
        return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
    } catch {
        return value.trim().toLowerCase().split('/')[0];
    }
}

export function matchesSite(hostname: string, pattern: string): boolean {
    const normalizedHost = readHostname(hostname);
    const normalizedPattern = normalizeSitePatterns([pattern])[0] || '';
    return Boolean(
        normalizedHost &&
            normalizedPattern &&
            (normalizedHost === normalizedPattern || normalizedHost.endsWith(`.${normalizedPattern}`)),
    );
}

export function resolveStyleProfile(
    profiles: StyleProfile[],
    activeProfileId: string,
    pageUrlOrHostname?: string,
): StyleProfile | undefined {
    const hostname = readHostname(pageUrlOrHostname);
    if (hostname) {
        const automatic = profiles.find((profile) =>
            normalizeSitePatterns(profile.sites).some((site) => matchesSite(hostname, site)),
        );
        if (automatic) return automatic;
    }
    return profiles.find((profile) => profile.id === activeProfileId);
}
