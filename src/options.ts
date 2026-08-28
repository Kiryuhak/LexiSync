import { localizeDocument, t } from './i18n';
import type { UsageStats } from './types';
import { calculateProductivityMetrics, clearUsageStats, EMPTY_USAGE_STATS } from './usage-stats';
import {
    exportPortableSettings,
    importPortableSettings,
    parsePortableSettingsJson,
    retrySettingsSync,
    type SettingsSyncStatus,
} from './settings-transfer';
import { restoreStyleProfileSettings, setupStyleProfileSettings } from './style-profile-settings';
import {
    restoreCustomCommandSettings,
    restoreTextSnippetSettings,
    setupCustomCommandSettings,
    setupTextSnippetSettings,
} from './custom-command-settings';
import { normalizeResultDisplayMode } from './result-display-mode';
import { normalizeSiteEntries } from './privacy';
import { normalizeAppearanceStyle } from './appearance-style';
import { restoreV4Settings, setupV4Settings } from './v4-settings';
import { applyThemeCustomization, DEFAULT_THEME_CUSTOMIZATION } from './theme-customization';
import { DEFAULT_BUDGET_SETTINGS } from './budget';
import { validateApiKey } from './mistral-client';
import { validateGroqApiKey } from './groq-client';
import {
    checkProviderHealth,
    loadCachedHealthStatus,
    saveCachedHealthStatus,
    type ProviderHealthStatus,
} from './provider-health';
import { logger } from './logger';
import { normalizeAutoFallbackEnabled, normalizePrimaryAiProvider } from './runtime-settings-cache';
import { setupSettingsTabs } from './options-tabs';
import { setupInteractiveGuide } from './options-guide';
import { PROMPT_LIBRARY_TEMPLATES } from './prompt-library';
import { factoryResetAllSettings, upsertCustomCommand } from './settings-store';
import {
    clampInterfaceScale,
    installResultPreviewStyles,
    systemDarkTheme,
    updateAppearancePreview,
} from './options-appearance';
import { hasAllSitesAccess, requestAllSitesAccess, removeAllSitesAccess } from './site-access';
import { setupOnboarding } from './options-onboarding';
import { DEFAULT_TEXT_SNIPPETS } from './text-snippets';
import { normalizeSearchEngine, SEARCH_ENGINE_IDS, type SearchEngine } from './search-url';

let restoredApiKey = '';
let restoredGroqApiKey = '';
let serverHealthRefresh: Promise<void> | null = null;
let savedOptionsState = '';
let saveInProgress = false;
let syncSearchEngineSelector = (): void => undefined;

function setupReleaseNotesTrigger(): void {
    const trigger = document.getElementById('app-version') as HTMLButtonElement | null;
    const versionValue = document.getElementById('app-version-value');
    if (!trigger || !versionValue) return;
    const currentVersion = chrome.runtime.getManifest().version;
    versionValue.textContent = `v${currentVersion}`;
    trigger.setAttribute(
        'aria-label',
        t('releaseNotesOpenVersion', `Версия LexiSync ${currentVersion}. Открыть историю обновлений`, currentVersion),
    );
    trigger.addEventListener('click', async () => {
        trigger.setAttribute('aria-busy', 'true');
        try {
            const { openReleaseNotes } = await import('./release-notes');
            openReleaseNotes();
        } finally {
            trigger.removeAttribute('aria-busy');
        }
    });
}

async function readPrivateApiKey(): Promise<string> {
    const response = await chrome.runtime.sendMessage({ action: 'getApiKey' });
    if (response?.ok !== true) throw new Error(response?.error || 'Не удалось прочитать API-ключ.');
    return typeof response.value === 'string' ? response.value : '';
}

async function writePrivateApiKey(value: string): Promise<void> {
    const response = await chrome.runtime.sendMessage({ action: 'setApiKey', value });
    if (response?.ok !== true) throw new Error(response?.error || 'Не удалось сохранить API-ключ.');
}

async function readPrivateGroqApiKey(): Promise<string> {
    const response = await chrome.runtime.sendMessage({ action: 'getGroqApiKey' });
    if (response?.ok !== true) throw new Error(response?.error || 'Не удалось прочитать Groq API-ключ.');
    return typeof response.value === 'string' ? response.value : '';
}

async function writePrivateGroqApiKey(value: string): Promise<void> {
    const response = await chrome.runtime.sendMessage({ action: 'setGroqApiKey', value });
    if (response?.ok !== true) throw new Error(response?.error || 'Не удалось сохранить Groq API-ключ.');
}

async function verifyMistralApiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
    return validateApiKey(apiKey);
}

const SAVED_OPTION_IDS = [
    'apiKey',
    'groqApiKey',
    'primaryAiProvider',
    'autoFallbackEnabled',
    'toneSelect',
    'themeSelect',
    'visualStyleSelect',
    'interfaceScale',
    'resultDisplayMode',
    'adaptiveSuggestionsEnabled',
    'adaptiveLearningEnabled',
    'searchEngine',
    'sendPageContext',
    'enablePiiMasking',
    'historyEnabled',
    'historyRetentionDays',
    'disabledSites',
    'personalDictionary',
    'aiMode',
    'glossary',
] as const;

function readOptionValue(id: (typeof SAVED_OPTION_IDS)[number]): string | boolean {
    const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    return element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value;
}

function captureOptionsState(): string {
    return JSON.stringify(SAVED_OPTION_IDS.map((id) => [id, readOptionValue(id)]));
}

function updateSaveButtonState(): void {
    const saveButton = document.getElementById('saveBtn') as HTMLButtonElement | null;
    if (!saveButton) return;
    const dirty = Boolean(savedOptionsState) && captureOptionsState() !== savedOptionsState;
    saveButton.disabled = saveInProgress || !dirty;
    saveButton.dataset.dirty = String(dirty);
    saveButton.title = dirty
        ? t('unsavedChanges', 'Есть несохранённые изменения')
        : t('noUnsavedChanges', 'Все изменения сохранены');
}

function showOptionsStatus(message: string, kind: 'success' | 'warning' | 'error'): void {
    const status = document.getElementById('status');
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
    status.style.display = 'block';
}

function updateAdaptiveControls(): void {
    const enabledInput = document.getElementById('adaptiveSuggestionsEnabled') as HTMLInputElement | null;
    const learningInput = document.getElementById('adaptiveLearningEnabled') as HTMLInputElement | null;
    const learningOption = document.getElementById('adaptiveLearningOption');
    if (!enabledInput || !learningInput || !learningOption) return;
    learningInput.disabled = !enabledInput.checked;
    learningOption.classList.toggle('is-disabled', !enabledInput.checked);
}

function renderAdaptiveStats(model: unknown): void {
    const stats = document.getElementById('adaptiveStats');
    const clearButton = document.getElementById('clearAdaptiveData') as HTMLButtonElement | null;
    if (!stats || !clearButton) return;
    const candidate = model && typeof model === 'object' ? (model as { words?: unknown; pairs?: unknown }) : {};
    const wordCount = candidate.words && typeof candidate.words === 'object' ? Object.keys(candidate.words).length : 0;
    const pairCount = candidate.pairs && typeof candidate.pairs === 'object' ? Object.keys(candidate.pairs).length : 0;
    const words = candidate.words && typeof candidate.words === 'object' ? Object.keys(candidate.words) : [];
    const cyrillicCount = words.filter((word) => /\p{Script=Cyrillic}/u.test(word)).length;
    const latinCount = words.filter((word) => /\p{Script=Latin}/u.test(word)).length;
    stats.textContent = `${t('learnedWords', 'Изучено')} ${wordCount} ${t('words', 'слов')} (RU ${cyrillicCount} / EN ${latinCount}) · ${pairCount} ${t('phrases', 'словосочетаний')}`;
    clearButton.disabled = wordCount === 0 && pairCount === 0;
}

function renderUsageStats(stats: UsageStats): void {
    const metrics = calculateProductivityMetrics(stats);
    const requests = document.getElementById('usageRequests');
    const hits = document.getElementById('usageCacheHits');
    const latency = document.getElementById('usageLatency');
    const timeSaved = document.getElementById('usageTimeSaved');
    const successRate = document.getElementById('usageSuccessRate');
    const mostUsedMode = document.getElementById('usageMostUsedMode');
    if (requests) requests.textContent = String(metrics.totalRequests);
    if (hits) hits.textContent = String(stats.cacheHits);
    if (latency)
        latency.textContent = stats.requests ? `${(stats.totalLatencyMs / stats.requests / 1000).toFixed(1)} с` : '0 с';
    if (timeSaved) {
        const totalMinutes = metrics.estimatedMinutesSaved;
        timeSaved.textContent = totalMinutes >= 60 ? `~${(totalMinutes / 60).toFixed(1)} ч` : `~${totalMinutes} мин`;
    }
    if (successRate) successRate.textContent = metrics.totalRequests ? `${metrics.successRatePercent}%` : '—';
    if (mostUsedMode) {
        const modeLabels: Partial<Record<string, string>> = {
            spellcheck: t('modeSpellcheck', 'Исправление'),
            style: t('modeStyle', 'Стиль'),
            emoji: t('modeEmoji', 'Эмодзи'),
            layout: t('modeLayout', 'Раскладка'),
            translate: t('modeTranslate', 'Перевод'),
            summary: t('summaryTitle', 'Выжимка'),
            reply: t('modeReply', 'Ответ'),
            explain: t('modeExplain', 'Объяснение'),
            format: t('modeFormat', 'Форматирование'),
            tone: t('modeTone', 'Тон'),
            continue: t('modeContinue', 'Продолжение'),
            notes_to_doc: t('modeNotesToDoc', 'Документ'),
            headline: t('modeHeadline', 'Заголовок'),
            ocr: 'OCR',
            custom: t('modeCustom', 'Своя команда'),
        };
        mostUsedMode.textContent = metrics.mostUsedMode
            ? modeLabels[metrics.mostUsedMode] || metrics.mostUsedMode
            : '—';
    }
}

function setupShortcutTester(): void {
    const card = document.getElementById('shortcutTesterCard');
    const status = document.getElementById('shortcutTesterStatus');
    const badges = document.querySelectorAll<HTMLElement>('.shortcut-badge');
    if (!card || !status) return;

    card.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') return;
        event.preventDefault();
        event.stopPropagation();

        const alt = event.altKey;
        const ctrl = event.ctrlKey;
        const meta = event.metaKey;
        const shift = event.shiftKey;
        const key = event.key.toUpperCase();

        const modifiers: string[] = [];
        if (ctrl) modifiers.push('Ctrl');
        if (alt) modifiers.push('Alt');
        if (meta) modifiers.push('Cmd');
        if (shift) modifiers.push('Shift');

        if (['ALT', 'CONTROL', 'META', 'SHIFT'].includes(key)) {
            status.textContent = `${modifiers.join('+')} + ...`;
            return;
        }

        const combo = `${modifiers.join('+')}${modifiers.length ? '+' : ''}${key}`;
        status.textContent = `✓ ${combo}`;

        badges.forEach((badge) => {
            const badgeKey = badge.dataset.key || '';
            const match =
                combo.toUpperCase() === badgeKey.toUpperCase() ||
                (alt && (key === 'R' || key === 'К') && badgeKey.includes('Alt+R')) ||
                (alt && (key === 'Y' || key === 'Н') && badgeKey.includes('Alt+Y')) ||
                (alt && (key === 'T' || key === 'Е') && badgeKey.includes('Alt+T')) ||
                (alt && (key === 'S' || key === 'Ы') && badgeKey.includes('Alt+S'));

            if (match) {
                badge.classList.add('is-hit');
                setTimeout(() => badge.classList.remove('is-hit'), 1200);
            }
        });
    });

    const openShortcutsBtn = document.getElementById('openShortcutsBtn');
    openShortcutsBtn?.addEventListener('click', () => {
        const isFirefox = navigator.userAgent.includes('Firefox/');
        const url = isFirefox ? 'about:addons' : 'chrome://extensions/shortcuts';
        void chrome.tabs
            .create({ url })
            .then(() => {
                if (isFirefox) {
                    status.textContent = t(
                        'firefoxShortcutHint',
                        'В Firefox откройте шестерёнку → «Управление клавишами расширений».',
                    );
                }
            })
            .catch(() => {
                status.textContent = isFirefox
                    ? t('firefoxShortcutHint', 'В Firefox откройте шестерёнку → «Управление клавишами расширений».')
                    : t('shortcutManagerOpenFailed', 'Не удалось открыть менеджер сочетаний клавиш.');
            });
    });
}

function renderSettingsSyncStatus(value: unknown): void {
    const status = document.getElementById('settingsSyncStatus');
    const retryButton = document.getElementById('retrySettingsSync') as HTMLButtonElement | null;
    if (!status || !retryButton) return;
    const syncStatus = value && typeof value === 'object' ? (value as Partial<SettingsSyncStatus>) : {};
    const failed = syncStatus.state === 'error';
    status.textContent = failed
        ? t('settingsSyncFailed', 'Синхронизация настроек недоступна. Изменения сохранены на этом устройстве.')
        : t('settingsSynced', 'Настройки синхронизированы между браузерами.');
    status.dataset.state = failed ? 'error' : 'synced';
    retryButton.hidden = !failed;
}

function renderDisabledSites(): void {
    const input = document.getElementById('disabledSites') as HTMLTextAreaElement | null;
    const search = document.getElementById('disabledSitesSearch') as HTMLInputElement | null;
    const list = document.getElementById('disabledSitesList');
    if (!input || !search || !list) return;
    const sites = normalizeSiteEntries(input.value).valid;
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = sites.filter((site) => site.toLocaleLowerCase().includes(query));
    list.replaceChildren();
    if (!filtered.length) {
        const empty = document.createElement('p');
        empty.className = 'site-manager-empty';
        empty.textContent = sites.length
            ? t('siteSearchNoMatches', 'Сайтов по этому запросу нет.')
            : t('siteListEmpty', 'Исключённые сайты появятся здесь.');
        list.appendChild(empty);
        return;
    }
    for (const site of filtered) {
        const row = document.createElement('div');
        row.className = 'site-manager-row';
        const name = document.createElement('code');
        name.textContent = site;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'secondary-button site-manager-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `${t('removeSite', 'Удалить сайт')}: ${site}`);
        remove.addEventListener('click', () => {
            input.value = sites.filter((entry) => entry !== site).join('\n');
            renderDisabledSites();
            updateSaveButtonState();
        });
        row.append(name, remove);
        list.appendChild(row);
    }
}

async function saveOptions(): Promise<void> {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
    const groqApiKeyInput = document.getElementById('groqApiKey') as HTMLInputElement;
    const primaryAiProviderSelect = document.getElementById('primaryAiProvider') as HTMLSelectElement;
    const autoFallbackEnabledInput = document.getElementById('autoFallbackEnabled') as HTMLInputElement;
    const toneSelect = document.getElementById('toneSelect') as HTMLSelectElement;
    const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement;
    const visualStyleSelect = document.getElementById('visualStyleSelect') as HTMLSelectElement;
    const interfaceScaleInput = document.getElementById('interfaceScale') as HTMLInputElement;
    const resultDisplayModeSelect = document.getElementById('resultDisplayMode') as HTMLSelectElement;
    const adaptiveSuggestionsInput = document.getElementById('adaptiveSuggestionsEnabled') as HTMLInputElement;
    const adaptiveLearningInput = document.getElementById('adaptiveLearningEnabled') as HTMLInputElement;
    const searchSelect = document.getElementById('searchEngine') as HTMLSelectElement;
    const sendPageContextInput = document.getElementById('sendPageContext') as HTMLInputElement;
    const enablePiiMaskingInput = document.getElementById('enablePiiMasking') as HTMLInputElement;
    const historyEnabledInput = document.getElementById('historyEnabled') as HTMLInputElement;
    const historyRetentionSelect = document.getElementById('historyRetentionDays') as HTMLSelectElement;
    const disabledSitesInput = document.getElementById('disabledSites') as HTMLTextAreaElement;
    const personalDictionaryInput = document.getElementById('personalDictionary') as HTMLTextAreaElement;
    const aiModeSelect = document.getElementById('aiMode') as HTMLSelectElement;
    const glossaryInput = document.getElementById('glossary') as HTMLTextAreaElement;
    const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;

    const apiKey = apiKeyInput.value.trim();
    const groqApiKey = groqApiKeyInput.value.trim();
    const normalizedDisabledSites = normalizeSiteEntries(disabledSitesInput.value);
    const originalBtnText = saveBtn.textContent;
    saveInProgress = true;
    saveBtn.textContent = t('saving', 'Сохранение…');
    saveBtn.style.opacity = '0.7';
    saveBtn.disabled = true;
    try {
        if (normalizedDisabledSites.invalid.length) {
            throw new Error(
                `${t('invalidSiteEntries', 'Исправьте некорректные адреса сайтов:')} ${normalizedDisabledSites.invalid.join(', ')}`,
            );
        }
        const savedValues = new Map<string, string | boolean>(
            savedOptionsState ? (JSON.parse(savedOptionsState) as Array<[string, string | boolean]>) : [],
        );
        const changed = (id: (typeof SAVED_OPTION_IDS)[number]) => savedValues.get(id) !== readOptionValue(id);
        const updates: Record<string, unknown> = {};
        if (changed('primaryAiProvider')) updates.primaryAiProvider = primaryAiProviderSelect.value;
        if (changed('autoFallbackEnabled')) updates.autoFallbackEnabled = autoFallbackEnabledInput.checked;
        if (changed('toneSelect')) updates.selectedTone = toneSelect.value;
        if (changed('themeSelect')) updates.selectedTheme = themeSelect.value;
        if (changed('visualStyleSelect')) updates.visualStyle = normalizeAppearanceStyle(visualStyleSelect.value);
        if (changed('interfaceScale'))
            updates.interfaceScale = clampInterfaceScale(Number(interfaceScaleInput.value) || 90);
        if (changed('resultDisplayMode')) {
            updates.resultDisplayMode = normalizeResultDisplayMode(resultDisplayModeSelect.value);
            updates.compactResultMode = resultDisplayModeSelect.value === 'compact';
        }
        if (changed('adaptiveSuggestionsEnabled'))
            updates.adaptiveSuggestionsEnabled = adaptiveSuggestionsInput.checked;
        if (changed('adaptiveLearningEnabled')) updates.adaptiveLearningEnabled = adaptiveLearningInput.checked;
        if (changed('searchEngine')) updates.searchEngine = searchSelect.value;
        if (changed('sendPageContext')) updates.sendPageContext = sendPageContextInput.checked;
        if (changed('enablePiiMasking')) updates.enablePiiMasking = enablePiiMaskingInput.checked;
        if (changed('historyEnabled')) updates.historyEnabled = historyEnabledInput.checked;
        if (changed('historyRetentionDays')) updates.historyRetentionDays = Number(historyRetentionSelect.value);
        if (changed('disabledSites')) updates.disabledSites = normalizedDisabledSites.valid;
        if (changed('personalDictionary'))
            updates.personalDictionary = personalDictionaryInput.value
                .split(/\r?\n/)
                .map((word) => word.trim())
                .filter(Boolean)
                .slice(0, 2000);
        if (changed('aiMode')) updates.aiMode = aiModeSelect.value === 'fast' ? 'fast' : 'quality';
        if (changed('glossary'))
            updates.glossary = glossaryInput.value
                .split(/\r?\n/)
                .map((entry) => entry.trim())
                .filter(Boolean)
                .slice(0, 200);
        if (Object.keys(updates).length) await chrome.storage.local.set(updates);
        disabledSitesInput.value = normalizedDisabledSites.valid.join('\n');

        let apiKeyStatus = '';
        if (apiKey !== restoredApiKey && apiKey) {
            saveBtn.textContent = t('checkingKey', 'Проверка ключа…');
            try {
                const validation = await verifyMistralApiKey(apiKey);
                if (validation.ok) {
                    await writePrivateApiKey(apiKey);
                    restoredApiKey = apiKey;
                } else {
                    apiKeyStatus = validation.message;
                    apiKeyInput.value = restoredApiKey;
                }
            } catch (error) {
                logger.error('Ошибка сети при проверке ключа Mistral', error);
                apiKeyStatus = t('keyCheckUnavailable', 'Настройки сохранены. Проверить API-ключ сейчас не удалось.');
                apiKeyInput.value = restoredApiKey;
            }
        } else if (!apiKey && restoredApiKey) {
            await writePrivateApiKey('');
            restoredApiKey = '';
        }

        let groqKeyStatus = '';
        if (groqApiKey !== restoredGroqApiKey && groqApiKey) {
            saveBtn.textContent = t('checkingKey', 'Проверка ключа…');
            try {
                const validation = await validateGroqApiKey(groqApiKey);
                if (validation.ok) {
                    await writePrivateGroqApiKey(groqApiKey);
                    restoredGroqApiKey = groqApiKey;
                } else {
                    groqKeyStatus = validation.message;
                    groqApiKeyInput.value = restoredGroqApiKey;
                }
            } catch (error) {
                logger.error('Ошибка сети при проверке ключа Groq', error);
                groqKeyStatus = t('keyCheckUnavailable', 'Настройки сохранены. Проверить API-ключ сейчас не удалось.');
                groqApiKeyInput.value = restoredGroqApiKey;
            }
        } else if (!groqApiKey && restoredGroqApiKey) {
            await writePrivateGroqApiKey('');
            restoredGroqApiKey = '';
        }

        savedOptionsState = captureOptionsState();
        const combinedStatus = apiKeyStatus || groqKeyStatus || t('saveSuccess', '✓ Настройки успешно сохранены!');
        showOptionsStatus(combinedStatus, apiKeyStatus || groqKeyStatus ? 'warning' : 'success');
        void refreshServerHealthStatus(false);
        window.setTimeout(() => {
            const status = document.getElementById('status');
            if (status) status.style.display = 'none';
        }, 3500);
    } catch (error) {
        const message = error instanceof Error ? error.message : t('saveFailed', 'Не удалось сохранить настройки.');
        showOptionsStatus(message, 'error');
    } finally {
        saveInProgress = false;
        saveBtn.textContent = originalBtnText;
        saveBtn.style.opacity = '1';
        updateSaveButtonState();
    }
}

async function restoreOptions(): Promise<void> {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
    const groqApiKeyInput = document.getElementById('groqApiKey') as HTMLInputElement;
    const primaryAiProviderSelect = document.getElementById('primaryAiProvider') as HTMLSelectElement;
    const autoFallbackEnabledInput = document.getElementById('autoFallbackEnabled') as HTMLInputElement;
    const toneSelect = document.getElementById('toneSelect') as HTMLSelectElement;
    const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement;
    const visualStyleSelect = document.getElementById('visualStyleSelect') as HTMLSelectElement;
    const interfaceScaleInput = document.getElementById('interfaceScale') as HTMLInputElement;
    const resultDisplayModeSelect = document.getElementById('resultDisplayMode') as HTMLSelectElement;
    const adaptiveSuggestionsInput = document.getElementById('adaptiveSuggestionsEnabled') as HTMLInputElement;
    const adaptiveLearningInput = document.getElementById('adaptiveLearningEnabled') as HTMLInputElement;
    const searchSelect = document.getElementById('searchEngine') as HTMLSelectElement;
    const sendPageContextInput = document.getElementById('sendPageContext') as HTMLInputElement;
    const enablePiiMaskingInput = document.getElementById('enablePiiMasking') as HTMLInputElement;
    const historyEnabledInput = document.getElementById('historyEnabled') as HTMLInputElement;
    const historyRetentionSelect = document.getElementById('historyRetentionDays') as HTMLSelectElement;
    const disabledSitesInput = document.getElementById('disabledSites') as HTMLTextAreaElement;
    const personalDictionaryInput = document.getElementById('personalDictionary') as HTMLTextAreaElement;
    const aiModeSelect = document.getElementById('aiMode') as HTMLSelectElement;
    const glossaryInput = document.getElementById('glossary') as HTMLTextAreaElement;

    const [items, privateApiKey, privateGroqApiKey] = await Promise.all([
        chrome.storage.local.get({
            primaryAiProvider: 'auto',
            autoFallbackEnabled: true,
            selectedTone: 'business',
            selectedTheme: 'auto',
            visualStyle: 'liquid-glass',
            interfaceScale: 90,
            resultDisplayMode: 'compact',
            compactResultMode: true,
            adaptiveSuggestionsEnabled: false,
            adaptiveLearningEnabled: true,
            adaptiveLanguageModel: { version: 2, words: {}, pairs: {}, rejections: {} },
            searchEngine: 'google',
            sendPageContext: false,
            enablePiiMasking: true,
            historyEnabled: true,
            historyRetentionDays: 30,
            disabledSites: [],
            personalDictionary: [],
            customCommands: [],
            textSnippets: DEFAULT_TEXT_SNIPPETS,
            aiMode: 'quality',
            glossary: [],
            styleProfiles: [],
            activeStyleProfileId: '',
            themeCustomization: DEFAULT_THEME_CUSTOMIZATION,
            liveProofreadEnabled: false,
            liveProofreadDelay: 900,
            liveProofreadDisabledSites: [],
            ...DEFAULT_BUDGET_SETTINGS,
            usageStats: EMPTY_USAGE_STATS,
            settingsSyncStatus: { state: 'synced', updatedAt: 0 },
        }),
        readPrivateApiKey(),
        readPrivateGroqApiKey(),
    ]);

    apiKeyInput.value = privateApiKey;
    restoredApiKey = apiKeyInput.value;
    groqApiKeyInput.value = privateGroqApiKey;
    restoredGroqApiKey = groqApiKeyInput.value;
    primaryAiProviderSelect.value = normalizePrimaryAiProvider(items.primaryAiProvider);
    autoFallbackEnabledInput.checked = normalizeAutoFallbackEnabled(items.autoFallbackEnabled);
    toneSelect.value = items.selectedTone as string;
    themeSelect.value = items.selectedTheme as string;
    visualStyleSelect.value = normalizeAppearanceStyle(items.visualStyle);
    interfaceScaleInput.value = String(clampInterfaceScale(Number(items.interfaceScale) || 90));
    resultDisplayModeSelect.value = normalizeResultDisplayMode(items.resultDisplayMode, items.compactResultMode);
    adaptiveSuggestionsInput.checked = items.adaptiveSuggestionsEnabled === true;
    adaptiveLearningInput.checked = items.adaptiveLearningEnabled !== false;
    searchSelect.value = normalizeSearchEngine(items.searchEngine);
    sendPageContextInput.checked = items.sendPageContext === true;
    enablePiiMaskingInput.checked = items.enablePiiMasking !== false;
    historyEnabledInput.checked = items.historyEnabled !== false;
    historyRetentionSelect.value = String(items.historyRetentionDays || 30);
    disabledSitesInput.value = Array.isArray(items.disabledSites) ? items.disabledSites.join('\n') : '';
    personalDictionaryInput.value = Array.isArray(items.personalDictionary) ? items.personalDictionary.join('\n') : '';
    aiModeSelect.value = items.aiMode === 'fast' ? 'fast' : 'quality';
    glossaryInput.value = Array.isArray(items.glossary) ? items.glossary.join('\n') : '';
    const allSitesAccessInput = document.getElementById('allSitesAccess') as HTMLInputElement | null;
    if (allSitesAccessInput) {
        allSitesAccessInput.checked = await hasAllSitesAccess();
        allSitesAccessInput.onchange = async () => {
            const next = allSitesAccessInput.checked;
            const prev = !next;
            try {
                if (next) {
                    const granted = await requestAllSitesAccess();
                    if (!granted) {
                        allSitesAccessInput.checked = prev;
                        showOptionsStatus(t('sitePermissionDenied', 'Доступ к сайту не предоставлен.'), 'error');
                    } else {
                        showOptionsStatus(t('siteSettingSaved', 'Настройка сайта сохранена.'), 'success');
                    }
                } else {
                    await removeAllSitesAccess();
                    showOptionsStatus(t('siteSettingSaved', 'Настройка сайта сохранена.'), 'success');
                }
            } catch (error) {
                allSitesAccessInput.checked = prev;
                showOptionsStatus(t('siteSettingUpdateFailed', 'Не удалось изменить настройку сайта.'), 'error');
                logger.error('Failed to change all sites access:', error);
            }
        };
    }
    restoreCustomCommandSettings(items.customCommands);
    restoreTextSnippetSettings(items.textSnippets);
    restoreStyleProfileSettings(items.styleProfiles, items.activeStyleProfileId);
    await restoreV4Settings(items);
    renderUsageStats(items.usageStats as UsageStats);
    renderSettingsSyncStatus(items.settingsSyncStatus);
    renderDisabledSites();
    syncSearchEngineSelector();
    updateAppearancePreview();
    updateAdaptiveControls();
    renderAdaptiveStats(items.adaptiveLanguageModel);
    savedOptionsState = captureOptionsState();
    updateSaveButtonState();

    void initializeServerHealth();
}

function renderServerHealthCard(provider: 'groq' | 'mistral', status: ProviderHealthStatus): void {
    const card = document.getElementById(`${provider}StatusCard`);
    const dot = document.getElementById(`${provider}StatusDot`);
    const text = document.getElementById(`${provider}StatusText`);
    const latency = document.getElementById(`${provider}StatusLatency`);
    if (!card || !dot || !text || !latency) return;

    card.dataset.status = status.state;
    dot.className = `server-status-dot dot-${status.state}`;
    text.textContent = status.message;
    latency.textContent =
        typeof status.latencyMs === 'number' ? `${Math.round(status.latencyMs)} ${t('millisecondsShort', 'мс')}` : '';
}

async function refreshServerHealthStatus(showChecking = true): Promise<void> {
    if (serverHealthRefresh) return serverHealthRefresh;

    const refreshButton = document.getElementById('checkServerStatusBtn') as HTMLButtonElement | null;
    const groqKey = (document.getElementById('groqApiKey') as HTMLInputElement)?.value || restoredGroqApiKey;
    const mistralKey = (document.getElementById('apiKey') as HTMLInputElement)?.value || restoredApiKey;

    if (showChecking) {
        renderServerHealthCard('groq', {
            provider: 'groq',
            state: 'checking',
            message: t('serverStatusChecking', 'Проверка связи...'),
            checkedAt: Date.now(),
        });
        renderServerHealthCard('mistral', {
            provider: 'mistral',
            state: 'checking',
            message: t('serverStatusChecking', 'Проверка связи...'),
            checkedAt: Date.now(),
        });
    }

    refreshButton?.setAttribute('aria-busy', 'true');
    if (refreshButton) refreshButton.disabled = true;
    serverHealthRefresh = (async () => {
        const [groqStatus, mistralStatus] = await Promise.all([
            checkProviderHealth('groq', groqKey),
            checkProviderHealth('mistral', mistralKey),
        ]);

        renderServerHealthCard('groq', groqStatus);
        renderServerHealthCard('mistral', mistralStatus);
        await saveCachedHealthStatus({ groq: groqStatus, mistral: mistralStatus });
    })().finally(() => {
        refreshButton?.removeAttribute('aria-busy');
        if (refreshButton) refreshButton.disabled = false;
        serverHealthRefresh = null;
    });
    return serverHealthRefresh;
}

async function initializeServerHealth(): Promise<void> {
    const cached = await loadCachedHealthStatus();
    if (cached.groq) renderServerHealthCard('groq', cached.groq);
    if (cached.mistral) renderServerHealthCard('mistral', cached.mistral);
    await refreshServerHealthStatus(false);
}

function setupPromptLibrary(): void {
    const toggleBtn = document.getElementById('togglePromptLibraryBtn') as HTMLButtonElement | null;
    const section = document.getElementById('promptLibrarySection') as HTMLElement | null;
    const grid = document.getElementById('promptLibraryGrid') as HTMLElement | null;
    if (!toggleBtn || !section || !grid) return;

    grid.replaceChildren(
        ...PROMPT_LIBRARY_TEMPLATES.map((template) => {
            const card = document.createElement('div');
            card.className = 'prompt-library-card';

            const title = document.createElement('div');
            title.className = 'prompt-library-card-title';
            title.textContent = template.name;

            const desc = document.createElement('div');
            desc.className = 'prompt-library-card-desc';
            desc.textContent = template.description;

            const promptText = document.createElement('div');
            promptText.className = 'prompt-library-card-prompt';
            promptText.textContent = template.prompt;

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'prompt-library-add-btn';
            addBtn.textContent = t('addTemplateToCommands', '+ Добавить в свои команды');
            addBtn.onclick = async () => {
                try {
                    addBtn.disabled = true;
                    const commands = await upsertCustomCommand({
                        id: template.id,
                        name: template.name,
                        prompt: template.prompt,
                    });
                    restoreCustomCommandSettings(commands);
                    addBtn.textContent = t('templateAdded', '✓ Добавлено!');
                    setTimeout(() => {
                        addBtn.disabled = false;
                        addBtn.textContent = t('addTemplateToCommands', '+ Добавить в свои команды');
                    }, 2000);
                } catch (error) {
                    addBtn.disabled = false;
                    showOptionsStatus(
                        error instanceof Error ? error.message : t('saveFailed', 'Не удалось сохранить настройки.'),
                        'error',
                    );
                }
            };

            card.append(title, desc, promptText, addBtn);
            return card;
        }),
    );

    toggleBtn.addEventListener('click', () => {
        const isHidden = section.hidden;
        section.hidden = !isHidden;
        toggleBtn.setAttribute('aria-expanded', String(!isHidden));
    });
}

function setupSearchEngineSelector(): void {
    const selector = document.getElementById('searchEngineSelector');
    const select = document.getElementById('searchEngine') as HTMLSelectElement | null;
    if (!selector || !select) return;

    const chips = [...selector.querySelectorAll<HTMLButtonElement>('.search-engine-chip')];
    const updateActiveChip = () => {
        const selectedEngine = normalizeSearchEngine(select.value);
        if (select.value !== selectedEngine) select.value = selectedEngine;
        chips.forEach((chip) => {
            const isActive = chip.dataset.engine === selectedEngine;
            chip.classList.toggle('is-active', isActive);
            chip.setAttribute('aria-checked', String(isActive));
            chip.tabIndex = isActive ? 0 : -1;
        });
    };

    const selectEngine = (engine: SearchEngine, focus = false) => {
        if (select.value !== engine) {
            select.value = engine;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        updateActiveChip();
        if (focus) chips.find((chip) => chip.dataset.engine === engine)?.focus();
    };

    selector.addEventListener('click', (event) => {
        const chip = (event.target as Element | null)?.closest<HTMLButtonElement>('.search-engine-chip');
        if (!chip || !selector.contains(chip)) return;
        const engine = normalizeSearchEngine(chip.dataset.engine);
        selectEngine(engine);
    });

    selector.addEventListener('keydown', (event) => {
        if (!(event.target instanceof HTMLButtonElement) || !event.target.matches('.search-engine-chip')) return;
        const currentIndex = SEARCH_ENGINE_IDS.indexOf(normalizeSearchEngine(event.target.dataset.engine));
        let nextIndex: number;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % chips.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
            nextIndex = (currentIndex - 1 + chips.length) % chips.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = chips.length - 1;
        else return;
        event.preventDefault();
        selectEngine(SEARCH_ENGINE_IDS[nextIndex], true);
    });

    select.addEventListener('change', updateActiveChip);
    syncSearchEngineSelector = updateActiveChip;
    updateActiveChip();
}

function setupFactoryReset(): void {
    const resetBtn = document.getElementById('factoryResetBtn') as HTMLButtonElement | null;
    const dialog = document.getElementById('factoryResetDialog') as HTMLDialogElement | null;
    const cancelBtn = document.getElementById('cancelFactoryReset') as HTMLButtonElement | null;
    const confirmBtn = document.getElementById('confirmFactoryReset') as HTMLButtonElement | null;
    if (!resetBtn || !dialog || !cancelBtn || !confirmBtn) return;

    resetBtn.addEventListener('click', () => {
        dialog.showModal();
    });

    cancelBtn.addEventListener('click', () => {
        dialog.close();
    });

    confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        try {
            await factoryResetAllSettings();
            window.location.reload();
        } catch {
            confirmBtn.disabled = false;
            dialog.close();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('settings-restoring');
    document.querySelector('main')?.setAttribute('aria-busy', 'true');
    localizeDocument();
    setupSearchEngineSelector();
    setupReleaseNotesTrigger();
    installResultPreviewStyles();
    void restoreOptions()
        .then(() => {
            // Подключаем автосохранение только после полного восстановления формы.
            // Так параллельное чтение больше не заменит сохранённые значения настройками по умолчанию.
            setupV4Settings();
            return setupOnboarding({
                getApiKey: () => restoredApiKey,
                getGroqApiKey: () => restoredGroqApiKey,
                onApiKeySaved: async (apiKey) => {
                    await writePrivateApiKey(apiKey);
                    restoredApiKey = apiKey;
                    const settingsKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
                    if (settingsKeyInput) settingsKeyInput.value = apiKey;
                    savedOptionsState = captureOptionsState();
                    updateSaveButtonState();
                },
                onGroqApiKeySaved: async (apiKey) => {
                    await writePrivateGroqApiKey(apiKey);
                    restoredGroqApiKey = apiKey;
                    const settingsKeyInput = document.getElementById('groqApiKey') as HTMLInputElement | null;
                    if (settingsKeyInput) settingsKeyInput.value = apiKey;
                    savedOptionsState = captureOptionsState();
                    updateSaveButtonState();
                },
            });
        })
        .catch((error) => {
            logger.error('Не удалось восстановить настройки:', error);
            showOptionsStatus(t('settingsLoadFailed', 'Не удалось загрузить настройки. Обновите страницу.'), 'error');
        })
        .finally(() => {
            document.body.classList.remove('settings-restoring');
            document.querySelector('main')?.removeAttribute('aria-busy');
        });
    void chrome.storage.local
        .get({ themeCustomization: {} })
        .then((stored) => applyThemeCustomization(document.documentElement, stored.themeCustomization));
    const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement | null;
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.addEventListener('click', saveOptions);
    }

    for (const id of SAVED_OPTION_IDS) {
        const element = document.getElementById(id);
        element?.addEventListener('input', updateSaveButtonState);
        element?.addEventListener('change', updateSaveButtonState);
    }

    const themeSelect = document.getElementById('themeSelect');
    const visualStyleSelect = document.getElementById('visualStyleSelect');
    const interfaceScaleInput = document.getElementById('interfaceScale');
    const resultDisplayModeSelect = document.getElementById('resultDisplayMode');
    const adaptiveSuggestionsInput = document.getElementById('adaptiveSuggestionsEnabled');
    themeSelect?.addEventListener('change', updateAppearancePreview);
    visualStyleSelect?.addEventListener('change', updateAppearancePreview);
    interfaceScaleInput?.addEventListener('input', updateAppearancePreview);
    resultDisplayModeSelect?.addEventListener('change', updateAppearancePreview);
    adaptiveSuggestionsInput?.addEventListener('change', updateAdaptiveControls);
    const disabledSitesInput = document.getElementById('disabledSites');
    const disabledSitesSearch = document.getElementById('disabledSitesSearch');
    disabledSitesInput?.addEventListener('input', renderDisabledSites);
    disabledSitesSearch?.addEventListener('input', renderDisabledSites);
    document.getElementById('retrySettingsSync')?.addEventListener('click', async () => {
        const retryButton = document.getElementById('retrySettingsSync') as HTMLButtonElement;
        retryButton.disabled = true;
        try {
            await retrySettingsSync();
            showOptionsStatus(t('settingsSyncRestored', 'Синхронизация настроек восстановлена.'), 'success');
        } catch {
            showOptionsStatus(
                t('settingsSyncRetryFailed', 'Не удалось синхронизировать настройки. Повторите попытку позже.'),
                'warning',
            );
        } finally {
            retryButton.disabled = false;
        }
    });
    setupCustomCommandSettings();
    setupTextSnippetSettings();
    setupStyleProfileSettings();
    setupSettingsTabs();
    setupShortcutTester();
    setupPromptLibrary();
    setupFactoryReset();
    setupInteractiveGuide();
    document.getElementById('checkServerStatusBtn')?.addEventListener('click', () => {
        void refreshServerHealthStatus(true);
    });

    const clearAdaptiveDataButton = document.getElementById('clearAdaptiveData') as HTMLButtonElement | null;
    clearAdaptiveDataButton?.addEventListener('click', async () => {
        const confirmed = window.confirm(
            t('clearAdaptiveConfirm', 'Удалить все локально изученные слова и словосочетания?'),
        );
        if (!confirmed) return;
        const emptyModel = { version: 2, words: {}, pairs: {}, rejections: {} };
        const response = await chrome.runtime.sendMessage({
            action: 'storageMutation',
            domain: 'adaptive',
            mutation: 'clear',
            payload: {},
        });
        if (response?.ok !== true) throw new Error(response?.error || 'ADAPTIVE_CLEAR_FAILED');
        renderAdaptiveStats(emptyModel);
    });

    document.getElementById('clearUsageStats')?.addEventListener('click', async () => {
        await clearUsageStats();
        renderUsageStats(EMPTY_USAGE_STATS);
    });

    const importFile = document.getElementById('importSettingsFile') as HTMLInputElement | null;
    document.getElementById('exportSettings')?.addEventListener('click', async () => {
        const payload = await exportPortableSettings();
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `lexisync-settings-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    });
    document.getElementById('importSettings')?.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', async () => {
        const file = importFile.files?.[0];
        if (!file) return;
        try {
            if (file.size > 1_000_000) throw new Error(t('settingsFileTooLarge', 'Файл настроек слишком большой.'));
            await importPortableSettings(parsePortableSettingsJson(await file.text()));
            await restoreOptions();
            const status = document.getElementById('status');
            if (status) {
                status.textContent = t('settingsImported', 'Настройки импортированы.');
                status.style.display = 'block';
            }
        } catch (error) {
            const status = document.getElementById('status');
            const code = error instanceof Error ? error.message : '';
            const message =
                code === 'INVALID_SETTINGS_FILE'
                    ? t('invalidSettingsFile', 'Некорректный файл настроек.')
                    : code === 'UNSUPPORTED_SETTINGS_FORMAT'
                      ? t('unsupportedSettingsFormat', 'Формат файла настроек не поддерживается.')
                      : code || t('importFailed', 'Не удалось импортировать настройки.');
            if (status) {
                status.textContent = message;
                status.style.display = 'block';
            }
        } finally {
            importFile.value = '';
        }
    });

    const toggleBtn = document.getElementById('toggleApiKey');
    const eyeOpen = document.getElementById('eyeOpen');
    const eyeClosed = document.getElementById('eyeClosed');
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;

    if (toggleBtn && eyeOpen && eyeClosed && apiKeyInput) {
        toggleBtn.addEventListener('click', () => {
            const isPassword = apiKeyInput.getAttribute('type') === 'password';
            apiKeyInput.setAttribute('type', isPassword ? 'text' : 'password');
            toggleBtn.setAttribute('aria-pressed', String(isPassword));
            const newLabel = isPassword ? t('hideApiKey', 'Скрыть API-ключ') : t('showApiKey', 'Показать API-ключ');
            toggleBtn.setAttribute('aria-label', newLabel);
            toggleBtn.title = newLabel;

            if (isPassword) {
                eyeOpen.style.display = 'none';
                eyeClosed.style.display = 'block';
            } else {
                eyeOpen.style.display = 'block';
                eyeClosed.style.display = 'none';
            }
        });
    }

    const toggleGroqBtn = document.getElementById('toggleGroqApiKey');
    const eyeOpenGroq = document.getElementById('eyeOpenGroq');
    const eyeClosedGroq = document.getElementById('eyeClosedGroq');
    const groqKeyInput = document.getElementById('groqApiKey') as HTMLInputElement | null;

    if (toggleGroqBtn && eyeOpenGroq && eyeClosedGroq && groqKeyInput) {
        toggleGroqBtn.addEventListener('click', () => {
            const isPassword = groqKeyInput.getAttribute('type') === 'password';
            groqKeyInput.setAttribute('type', isPassword ? 'text' : 'password');
            toggleGroqBtn.setAttribute('aria-pressed', String(isPassword));
            const newLabel = isPassword ? t('hideApiKey', 'Скрыть API-ключ') : t('showApiKey', 'Показать API-ключ');
            toggleGroqBtn.setAttribute('aria-label', newLabel);
            toggleGroqBtn.title = newLabel;

            if (isPassword) {
                eyeOpenGroq.style.display = 'none';
                eyeClosedGroq.style.display = 'block';
            } else {
                eyeOpenGroq.style.display = 'block';
                eyeClosedGroq.style.display = 'none';
            }
        });
    }
});

systemDarkTheme.addEventListener('change', updateAppearancePreview);

window.addEventListener('beforeunload', (event) => {
    if (!savedOptionsState || captureOptionsState() === savedOptionsState) return;
    event.preventDefault();
    event.returnValue = '';
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.adaptiveLanguageModel) renderAdaptiveStats(changes.adaptiveLanguageModel.newValue);
    if (changes.textSnippets) restoreTextSnippetSettings(changes.textSnippets.newValue);
    if (changes.usageStats) renderUsageStats(changes.usageStats.newValue as UsageStats);
    if (changes.settingsSyncStatus) renderSettingsSyncStatus(changes.settingsSyncStatus.newValue);
    if (changes.themeCustomization)
        applyThemeCustomization(document.documentElement, changes.themeCustomization.newValue);
});
