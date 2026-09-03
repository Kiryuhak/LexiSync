/**
 * Небольшие настройки, которые нужны service worker на горячем пути запроса.
 * История, диагностические данные, адаптивная модель и ai_cache_* намеренно
 * отсутствуют: они могут занимать мегабайты и не должны дублироваться в памяти.
 */
export const RUNTIME_SETTING_KEYS = [
    'selectedTone',
    'sendPageContext',
    'personalDictionary',
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
    'primaryAiProvider',
    'autoFallbackEnabled',
] as const;

export type RuntimeSettingKey = (typeof RUNTIME_SETTING_KEYS)[number];

export const AI_PROVIDER_RUNTIME_DEFAULTS = {
    primaryAiProvider: 'auto',
    autoFallbackEnabled: true,
} as const;

export function normalizePrimaryAiProvider(value: unknown): 'auto' | 'mistral' | 'groq' {
    return value === 'mistral' || value === 'groq' ? value : 'auto';
}

/**
 * Старые импорты настроек могли содержать строковые значения. Нормализуем их
 * здесь, чтобы `"false"` никогда не включал резервного провайдера случайно.
 */
export function normalizeAutoFallbackEnabled(value: unknown, defaultValue = true): boolean {
    if (typeof value === 'boolean') return value;
    if (value === 'false' || value === 0 || value === null) return false;
    if (value === 'true' || value === 1) return true;
    return defaultValue;
}

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
