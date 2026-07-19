import { normalizeSitePatterns } from './site-profiles';

const PORTABLE_SETTING_KEYS = [
    'selectedTone', 'selectedTheme', 'interfaceScale', 'searchEngine', 'sendPageContext',
    'historyEnabled', 'historyRetentionDays', 'disabledSites', 'contextDisabledSites', 'blockedSites',
    'adaptiveSuggestionsEnabled', 'adaptiveLearningEnabled', 'adaptiveDisabledSites',
    'adaptiveBlockedWords', 'personalDictionary', 'customCommands', 'aiMode', 'glossary',
    'styleProfiles', 'activeStyleProfileId',
] as const;

const SYNC_SETTING_KEYS = [
    'selectedTone', 'selectedTheme', 'interfaceScale', 'searchEngine', 'historyEnabled',
    'historyRetentionDays', 'adaptiveSuggestionsEnabled', 'adaptiveLearningEnabled',
    'aiMode',
] as const;

export interface PortableSettings {
    format: 'lexisync-settings';
    version: 1;
    exportedAt: string;
    settings: Record<string, unknown>;
}

function stringList(value: unknown, limit: number, itemLength: number): string[] {
    return Array.isArray(value)
        ? value.map(String).map((item) => item.trim().slice(0, itemLength)).filter(Boolean).slice(0, limit)
        : [];
}

function sanitizePortableSetting(key: typeof PORTABLE_SETTING_KEYS[number], value: unknown): unknown {
    if (['sendPageContext', 'historyEnabled', 'adaptiveSuggestionsEnabled', 'adaptiveLearningEnabled'].includes(key)) return value === true;
    if (key === 'selectedTone') return ['business', 'friendly', 'persuasive', 'creative'].includes(String(value)) ? value : 'business';
    if (key === 'selectedTheme') return ['auto', 'light', 'dark'].includes(String(value)) ? value : 'auto';
    if (key === 'searchEngine') return ['google', 'yandex', 'duckduckgo'].includes(String(value)) ? value : 'google';
    if (key === 'aiMode') return value === 'fast' ? 'fast' : 'quality';
    if (key === 'interfaceScale') return Math.min(110, Math.max(75, Number(value) || 90));
    if (key === 'historyRetentionDays') return [1, 7, 30].includes(Number(value)) ? Number(value) : 30;
    if (['disabledSites', 'contextDisabledSites', 'blockedSites', 'adaptiveDisabledSites'].includes(key)) return stringList(value, 500, 253);
    if (key === 'adaptiveBlockedWords' || key === 'personalDictionary') return stringList(value, 2000, 120);
    if (key === 'glossary') return stringList(value, 200, 240);
    if (key === 'activeStyleProfileId') return String(value || '').slice(0, 100);
    if (key === 'customCommands') {
        if (!Array.isArray(value)) return [];
        return value.filter((item) => item && typeof item === 'object').slice(0, 8).map((item) => {
            const command = item as Record<string, unknown>;
            return { id: String(command.id || crypto.randomUUID()).slice(0, 100), name: String(command.name || '').slice(0, 40), prompt: String(command.prompt || '').slice(0, 2000) };
        }).filter((item) => item.name && item.prompt);
    }
    if (key === 'styleProfiles') {
        if (!Array.isArray(value)) return [];
        return value.filter((item) => item && typeof item === 'object').slice(0, 8).map((item) => {
            const profile = item as Record<string, unknown>;
            return {
                id: String(profile.id || crypto.randomUUID()).slice(0, 100),
                name: String(profile.name || '').slice(0, 40),
                tone: String(profile.tone || 'custom').slice(0, 40),
                instruction: String(profile.instruction || '').slice(0, 1000),
                sites: normalizeSitePatterns(profile.sites),
            };
        }).filter((item) => item.name && item.instruction);
    }
    return undefined;
}

export async function exportPortableSettings(): Promise<PortableSettings> {
    const stored = await chrome.storage.local.get([...PORTABLE_SETTING_KEYS]);
    const settings: Record<string, unknown> = {};
    for (const key of PORTABLE_SETTING_KEYS) {
        if (stored[key] !== undefined) settings[key] = stored[key];
    }
    return { format: 'lexisync-settings', version: 1, exportedAt: new Date().toISOString(), settings };
}

export async function importPortableSettings(value: unknown): Promise<void> {
    if (!value || typeof value !== 'object') throw new Error('INVALID_SETTINGS_FILE');
    const payload = value as Partial<PortableSettings>;
    if (payload.format !== 'lexisync-settings' || payload.version !== 1 || !payload.settings || typeof payload.settings !== 'object') {
        throw new Error('UNSUPPORTED_SETTINGS_FORMAT');
    }
    const updates: Record<string, unknown> = {};
    for (const key of PORTABLE_SETTING_KEYS) {
        if (Object.prototype.hasOwnProperty.call(payload.settings, key)) updates[key] = sanitizePortableSetting(key, payload.settings[key]);
    }
    await chrome.storage.local.set(updates);
}

export async function restoreSyncedSettings(): Promise<void> {
    try {
        const [synced, local] = await Promise.all([
            chrome.storage.sync.get([...SYNC_SETTING_KEYS]),
            chrome.storage.local.get([...SYNC_SETTING_KEYS]),
        ]);
        const updates: Record<string, unknown> = {};
        for (const key of SYNC_SETTING_KEYS) {
            if (local[key] === undefined && synced[key] !== undefined) updates[key] = synced[key];
        }
        if (Object.keys(updates).length) {
            const latest = await chrome.storage.local.get(Object.keys(updates));
            for (const key of Object.keys(updates)) if (latest[key] !== undefined) delete updates[key];
            if (Object.keys(updates).length) await chrome.storage.local.set(updates);
        }
    } catch {
        // Sync can be unavailable in private or enterprise-managed browsers.
    }
}

export function initializeSettingsSync(): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        const updates: Record<string, unknown> = {};
        for (const key of SYNC_SETTING_KEYS) if (changes[key]) updates[key] = changes[key].newValue;
        if (!Object.keys(updates).length) return;
        if (areaName === 'local') void chrome.storage.sync.set(updates).catch(() => undefined);
        else if (areaName === 'sync') void chrome.storage.local.set(updates).catch(() => undefined);
    });
}
