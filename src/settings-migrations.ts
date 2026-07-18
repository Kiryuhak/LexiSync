const CURRENT_SETTINGS_SCHEMA = 2;

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
    updates.settingsSchemaVersion = CURRENT_SETTINGS_SCHEMA;
    await chrome.storage.local.set(updates);
}
