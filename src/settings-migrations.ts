const CURRENT_SETTINGS_SCHEMA = 3;

export async function migrateSettings(): Promise<void> {
    const stored = await chrome.storage.local.get(null);
    const currentVersion = Math.max(0, Number(stored.settingsSchemaVersion) || 0);
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
            const languageModel = stored.adaptiveLanguageModel as { words?: unknown; pairs?: unknown; rejections?: unknown };
            updates.adaptiveLanguageModel = {
                version: 2,
                words: languageModel.words && typeof languageModel.words === 'object' ? languageModel.words : {},
                pairs: languageModel.pairs && typeof languageModel.pairs === 'object' ? languageModel.pairs : {},
                rejections: languageModel.rejections && typeof languageModel.rejections === 'object' ? languageModel.rejections : {},
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
    updates.settingsSchemaVersion = CURRENT_SETTINGS_SCHEMA;
    const migratedKeys = Object.keys(updates).filter((key) => key !== 'settingsSchemaVersion');
    const latest = migratedKeys.length ? await chrome.storage.local.get(migratedKeys) : {};
    let concurrentChange = false;
    for (const key of migratedKeys) {
        if (JSON.stringify(latest[key]) !== JSON.stringify(stored[key])) {
            delete updates[key];
            concurrentChange = true;
        }
    }
    if (concurrentChange) delete updates.settingsSchemaVersion;
    await chrome.storage.local.set(updates);
    if (concurrentChange) await migrateSettings();
}
