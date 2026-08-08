import { normalizeSitePatterns } from './site-profiles';
import type { StyleProfile } from './types';
import { DEFAULT_THEME_CUSTOMIZATION } from './theme-customization';

const CURRENT_SETTINGS_SCHEMA = 10;
const MIGRATION_SETTING_KEYS = [
    'settingsSchemaVersion',
    'disabledSites',
    'personalDictionary',
    'interfaceScale',
    'adaptiveDisabledSites',
    'contextDisabledSites',
    'adaptiveBlockedWords',
    'customCommands',
    'adaptiveLanguageModel',
    'blockedSites',
    'aiMode',
    'glossary',
    'styleProfiles',
    'activeStyleProfileId',
    'usageStats',
    'compactResultMode',
    'resultDisplayMode',
    'visualStyle',
    'themeCustomization',
    'liveProofreadEnabled',
    'liveProofreadDelay',
    'dailyRequestLimit',
    'monthlyTokenLimit',
    'warnLargeText',
    'autoFastMode',
    'liveProofreadDisabledSites',
] as const;

function getSchemaVersion(value: unknown): number {
    return Math.max(0, Number(value) || 0);
}

export async function migrateSettings(): Promise<void> {
    const schema = await chrome.storage.local.get('settingsSchemaVersion');
    if (getSchemaVersion(schema.settingsSchemaVersion) >= CURRENT_SETTINGS_SCHEMA) return;

    // История, кэш и API-ключ могут быть объёмными и не участвуют в миграциях.
    const stored = await chrome.storage.local.get([...MIGRATION_SETTING_KEYS]);
    const currentVersion = getSchemaVersion(stored.settingsSchemaVersion);
    if (currentVersion >= CURRENT_SETTINGS_SCHEMA) return;

    const updates: Record<string, unknown> = {};
    if (currentVersion < 1) {
        if (!Array.isArray(stored.disabledSites)) updates.disabledSites = [];
        if (!Array.isArray(stored.personalDictionary)) updates.personalDictionary = [];
        if (typeof stored.interfaceScale !== 'number') updates.interfaceScale = 90;
    }
    if (currentVersion < 2) {
        if (!Array.isArray(stored.adaptiveDisabledSites)) updates.adaptiveDisabledSites = [];
        if (!Array.isArray(stored.contextDisabledSites)) updates.contextDisabledSites = [];
        if (!Array.isArray(stored.adaptiveBlockedWords)) updates.adaptiveBlockedWords = [];
        if (!Array.isArray(stored.customCommands)) updates.customCommands = [];
        if (!stored.adaptiveLanguageModel || typeof stored.adaptiveLanguageModel !== 'object') {
            updates.adaptiveLanguageModel = { version: 2, words: {}, pairs: {}, rejections: {} };
        } else {
            const languageModel = stored.adaptiveLanguageModel as {
                words?: unknown;
                pairs?: unknown;
                rejections?: unknown;
            };
            updates.adaptiveLanguageModel = {
                version: 2,
                words: languageModel.words && typeof languageModel.words === 'object' ? languageModel.words : {},
                pairs: languageModel.pairs && typeof languageModel.pairs === 'object' ? languageModel.pairs : {},
                rejections:
                    languageModel.rejections && typeof languageModel.rejections === 'object'
                        ? languageModel.rejections
                        : {},
            };
        }
    }
    if (currentVersion < 3) {
        if (!Array.isArray(stored.blockedSites)) updates.blockedSites = [];
        if (stored.aiMode !== 'fast' && stored.aiMode !== 'quality') updates.aiMode = 'quality';
        if (!Array.isArray(stored.glossary)) updates.glossary = [];
        if (!Array.isArray(stored.styleProfiles)) updates.styleProfiles = [];
        if (typeof stored.activeStyleProfileId !== 'string') updates.activeStyleProfileId = '';
        if (!stored.usageStats || typeof stored.usageStats !== 'object') {
            updates.usageStats = { requests: 0, cacheHits: 0, failures: 0, totalLatencyMs: 0, byMode: {} };
        }
    }
    if (currentVersion < 4) {
        const profiles = Array.isArray(stored.styleProfiles) ? (stored.styleProfiles as StyleProfile[]) : [];
        updates.styleProfiles = profiles
            .map((profile) => ({ ...profile, sites: normalizeSitePatterns(profile.sites) }))
            .slice(0, 8);
    }
    if (currentVersion < 5 && typeof stored.compactResultMode !== 'boolean') {
        updates.compactResultMode = true;
    }
    if (
        currentVersion < 6 &&
        stored.resultDisplayMode !== 'auto' &&
        stored.resultDisplayMode !== 'compact' &&
        stored.resultDisplayMode !== 'detailed'
    ) {
        updates.resultDisplayMode =
            typeof stored.compactResultMode === 'boolean'
                ? stored.compactResultMode
                    ? 'compact'
                    : 'detailed'
                : 'compact';
    }
    if (
        currentVersion < 7 &&
        !['liquid-glass', 'magicos-11', 'material-3', 'flutter', 'aurora-glass'].includes(String(stored.visualStyle))
    ) {
        updates.visualStyle = 'liquid-glass';
    }
    if (currentVersion < 8) {
        if (!stored.themeCustomization || typeof stored.themeCustomization !== 'object')
            updates.themeCustomization = DEFAULT_THEME_CUSTOMIZATION;
        if (typeof stored.liveProofreadEnabled !== 'boolean') updates.liveProofreadEnabled = false;
        if (![600, 900, 1500, 2500].includes(Number(stored.liveProofreadDelay))) updates.liveProofreadDelay = 900;
        if (!Number.isFinite(Number(stored.dailyRequestLimit)) || Number(stored.dailyRequestLimit) < 0)
            updates.dailyRequestLimit = 0;
        if (!Number.isFinite(Number(stored.monthlyTokenLimit)) || Number(stored.monthlyTokenLimit) < 0)
            updates.monthlyTokenLimit = 0;
        if (typeof stored.warnLargeText !== 'boolean') updates.warnLargeText = true;
        if (typeof stored.autoFastMode !== 'boolean') updates.autoFastMode = true;
    }
    if (currentVersion < 9 && !Array.isArray(stored.liveProofreadDisabledSites)) {
        updates.liveProofreadDisabledSites = [];
    }
    if (currentVersion < 10 && stored.visualStyle === 'bento') {
        updates.visualStyle = 'liquid-glass';
    }
    updates.settingsSchemaVersion = CURRENT_SETTINGS_SCHEMA;
    const migratedKeys = Object.keys(updates).filter((key) => key !== 'settingsSchemaVersion');
    const latest = await chrome.storage.local.get([...migratedKeys, 'settingsSchemaVersion']);
    let concurrentChange = false;
    for (const key of migratedKeys) {
        if (JSON.stringify(latest[key]) !== JSON.stringify(stored[key])) {
            delete updates[key];
            concurrentChange = true;
        }
    }
    if (getSchemaVersion(latest.settingsSchemaVersion) !== currentVersion) {
        concurrentChange = true;
    }
    if (concurrentChange) delete updates.settingsSchemaVersion;
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    if (concurrentChange) await migrateSettings();
}
