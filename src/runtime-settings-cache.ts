/**
 * Небольшие настройки, которые нужны service worker на горячем пути запроса.
 * История, диагностические данные, адаптивная модель и ai_cache_* намеренно
 * отсутствуют: они могут занимать мегабайты и не должны дублироваться в памяти.
 */
export const RUNTIME_SETTING_KEYS = [
    'selectedTone',
    'sendPageContext',
    'personalDictionary',
    'glossary',
    'styleProfiles',
    'activeStyleProfileId',
    'aiMode',
    'contextDisabledSites',
    'compactResultMode',
    'resultDisplayMode',
    'dailyRequestLimit',
    'monthlyTokenLimit',
    'warnLargeText',
    'autoFastMode',
    'enablePiiMasking',
] as const;

export type RuntimeSettingKey = (typeof RUNTIME_SETTING_KEYS)[number];

const RUNTIME_SETTING_KEY_SET = new Set<string>(RUNTIME_SETTING_KEYS);

export function isRuntimeSettingKey(key: string): key is RuntimeSettingKey {
    return RUNTIME_SETTING_KEY_SET.has(key);
}

export function pickRuntimeSettings(source: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of RUNTIME_SETTING_KEYS) {
        if (source[key] !== undefined) result[key] = source[key];
    }
    return result;
}
