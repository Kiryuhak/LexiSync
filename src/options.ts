import { localizeDocument, t } from './i18n';
import type { UsageStats } from './types';
import { clearUsageStats, EMPTY_USAGE_STATS } from './usage-stats';
import { exportPortableSettings, importPortableSettings } from './settings-transfer';
import { restoreStyleProfileSettings, setupStyleProfileSettings } from './style-profile-settings';
import { restoreCustomCommandSettings, setupCustomCommandSettings } from './custom-command-settings';
import { normalizeResultDisplayMode } from './result-display-mode';
import { normalizeSiteEntries } from './privacy';
import { applyAppearanceStyle, normalizeAppearanceStyle } from './appearance-style';

type AppearanceTheme = 'auto' | 'light' | 'dark';

const systemDarkTheme = window.matchMedia('(prefers-color-scheme: dark)');
let restoredApiKey = '';
let savedOptionsState = '';
let saveInProgress = false;

const SAVED_OPTION_IDS = [
    'apiKey',
    'toneSelect',
    'themeSelect',
    'visualStyleSelect',
    'interfaceScale',
    'resultDisplayMode',
    'adaptiveSuggestionsEnabled',
    'adaptiveLearningEnabled',
    'searchEngine',
    'sendPageContext',
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
    status.style.color = kind === 'success' ? '#10b981' : kind === 'warning' ? '#d97706' : '#dc2626';
    status.style.display = 'block';
}

function clampInterfaceScale(value: number): number {
    return Math.min(110, Math.max(75, Math.round(value / 5) * 5));
}

function updateAppearancePreview(): void {
    const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement | null;
    const visualStyleSelect = document.getElementById('visualStyleSelect') as HTMLSelectElement | null;
    const scaleInput = document.getElementById('interfaceScale') as HTMLInputElement | null;
    const scaleValue = document.getElementById('interfaceScaleValue') as HTMLOutputElement | null;
    const previewStage = document.getElementById('interfacePreview');
    const previewToolbar = document.getElementById('previewToolbar');
    const resultDisplayModeSelect = document.getElementById('resultDisplayMode') as HTMLSelectElement | null;
    const compactPreviewStage = document.getElementById('compactResultPreviewStage');
    const compactResultPreview = document.getElementById('compactResultPreview');
    if (
        !themeSelect ||
        !visualStyleSelect ||
        !scaleInput ||
        !scaleValue ||
        !previewStage ||
        !previewToolbar ||
        !resultDisplayModeSelect ||
        !compactPreviewStage ||
        !compactResultPreview
    )
        return;

    const scale = clampInterfaceScale(Number(scaleInput.value) || 90);
    const theme = themeSelect.value as AppearanceTheme;
    const isDark = theme === 'dark' || (theme === 'auto' && systemDarkTheme.matches);

    scaleInput.value = String(scale);
    scaleValue.value = `${scale}%`;
    scaleValue.textContent = `${scale}%`;
    previewToolbar.style.transform = `scale(${scale / 100})`;
    compactResultPreview.style.transform = `scale(${scale / 100})`;
    previewStage.dataset.theme = isDark ? 'dark' : 'light';
    compactPreviewStage.dataset.theme = isDark ? 'dark' : 'light';
    compactPreviewStage.dataset.mode = normalizeResultDisplayMode(resultDisplayModeSelect.value);
    document.documentElement.toggleAttribute('data-theme', isDark);
    const visualStyle = applyAppearanceStyle(document.documentElement, visualStyleSelect.value);
    previewStage.dataset.uiStyle = visualStyle;
    compactPreviewStage.dataset.uiStyle = visualStyle;
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
    const requests = document.getElementById('usageRequests');
    const hits = document.getElementById('usageCacheHits');
    const latency = document.getElementById('usageLatency');
    if (requests) requests.textContent = String(stats.requests);
    if (hits) hits.textContent = String(stats.cacheHits);
    if (latency)
        latency.textContent = stats.requests ? `${(stats.totalLatencyMs / stats.requests / 1000).toFixed(1)} с` : '0 с';
}

function activateSettingsTab(tabName: string): void {
    document.querySelectorAll<HTMLElement>('[data-settings-group]').forEach((element) => {
        element.hidden = element.dataset.settingsGroup !== tabName;
    });
    const saveActions = document.getElementById('saveActions');
    if (saveActions) saveActions.hidden = tabName === 'commands';
    document.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach((button) => {
        const active = button.dataset.tab === tabName;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
    });
}

async function setupOnboarding(): Promise<void> {
    const onboarding = document.getElementById('onboarding');
    const nextButton = document.getElementById('onboardingNext') as HTMLButtonElement | null;
    const skipButton = document.getElementById('onboardingSkip') as HTMLButtonElement | null;
    const progress = document.getElementById('onboardingProgress');
    const steps = [...document.querySelectorAll<HTMLElement>('[data-onboarding-step]')];
    if (!onboarding || !nextButton || !skipButton || !progress || steps.length === 0) return;
    const stored = await chrome.storage.local.get({ onboardingCompleted: false });
    if (stored.onboardingCompleted === true) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    let activeStep = 0;
    const render = () => {
        steps.forEach((step, index) => step.classList.toggle('is-active', index === activeStep));
        progress.textContent = `${activeStep + 1} ${t('of', 'из')} ${steps.length}`;
        nextButton.textContent = activeStep === steps.length - 1 ? t('start', 'Начать работу') : t('next', 'Далее');
    };
    const complete = async () => {
        onboarding.hidden = true;
        await chrome.storage.local.set({ onboardingCompleted: true });
        previousFocus?.focus();
    };
    nextButton.addEventListener('click', () => {
        if (activeStep >= steps.length - 1) void complete();
        else {
            activeStep++;
            render();
        }
    });
    skipButton.addEventListener('click', () => void complete());
    onboarding.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            void complete();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [
            ...onboarding.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]'),
        ].filter((element) => !element.hidden && !element.hasAttribute('disabled'));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
    onboarding.hidden = false;
    render();
    nextButton.focus();
}

async function saveOptions(): Promise<void> {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
    const toneSelect = document.getElementById('toneSelect') as HTMLSelectElement;
    const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement;
    const visualStyleSelect = document.getElementById('visualStyleSelect') as HTMLSelectElement;
    const interfaceScaleInput = document.getElementById('interfaceScale') as HTMLInputElement;
    const resultDisplayModeSelect = document.getElementById('resultDisplayMode') as HTMLSelectElement;
    const adaptiveSuggestionsInput = document.getElementById('adaptiveSuggestionsEnabled') as HTMLInputElement;
    const adaptiveLearningInput = document.getElementById('adaptiveLearningEnabled') as HTMLInputElement;
    const searchSelect = document.getElementById('searchEngine') as HTMLSelectElement;
    const sendPageContextInput = document.getElementById('sendPageContext') as HTMLInputElement;
    const historyEnabledInput = document.getElementById('historyEnabled') as HTMLInputElement;
    const historyRetentionSelect = document.getElementById('historyRetentionDays') as HTMLSelectElement;
    const disabledSitesInput = document.getElementById('disabledSites') as HTMLTextAreaElement;
    const personalDictionaryInput = document.getElementById('personalDictionary') as HTMLTextAreaElement;
    const aiModeSelect = document.getElementById('aiMode') as HTMLSelectElement;
    const glossaryInput = document.getElementById('glossary') as HTMLTextAreaElement;
    const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;

    const apiKey = apiKeyInput.value.trim();
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
        if (changed('historyEnabled')) updates.historyEnabled = historyEnabledInput.checked;
        if (changed('historyRetentionDays')) updates.historyRetentionDays = Number(historyRetentionSelect.value);
        if (changed('disabledSites')) updates.disabledSites = normalizedDisabledSites.valid;
        if (changed('personalDictionary'))
            updates.personalDictionary = personalDictionaryInput.value
                .split(/\r?\n/)
                .map((word) => word.trim())
                .filter(Boolean)
                .slice(0, 500);
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
                const response = await fetch('https://api.mistral.ai/v1/models', {
                    headers: { Authorization: `Bearer ${apiKey}` },
                    cache: 'no-store',
                    signal: AbortSignal.timeout(10_000),
                });
                if (response.ok) {
                    await chrome.storage.local.set({ mistralApiKey: apiKey });
                    restoredApiKey = apiKey;
                } else {
                    apiKeyStatus = t('invalidKey', 'Настройки сохранены, но новый API-ключ не прошёл проверку.');
                    apiKeyInput.value = restoredApiKey;
                }
            } catch (error) {
                console.error('Ошибка сети при проверке ключа', error);
                apiKeyStatus = t('keyCheckUnavailable', 'Настройки сохранены. Проверить API-ключ сейчас не удалось.');
                apiKeyInput.value = restoredApiKey;
            }
        } else if (!apiKey && restoredApiKey) {
            await chrome.storage.local.set({ mistralApiKey: '' });
            restoredApiKey = '';
        }

        savedOptionsState = captureOptionsState();
        showOptionsStatus(
            apiKeyStatus || t('saveSuccess', '✓ Настройки успешно сохранены!'),
            apiKeyStatus ? 'warning' : 'success',
        );
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

// Функция для восстановления настроек (Promise-based)
async function restoreOptions(): Promise<void> {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
    const toneSelect = document.getElementById('toneSelect') as HTMLSelectElement;
    const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement;
    const visualStyleSelect = document.getElementById('visualStyleSelect') as HTMLSelectElement;
    const interfaceScaleInput = document.getElementById('interfaceScale') as HTMLInputElement;
    const resultDisplayModeSelect = document.getElementById('resultDisplayMode') as HTMLSelectElement;
    const adaptiveSuggestionsInput = document.getElementById('adaptiveSuggestionsEnabled') as HTMLInputElement;
    const adaptiveLearningInput = document.getElementById('adaptiveLearningEnabled') as HTMLInputElement;
    const searchSelect = document.getElementById('searchEngine') as HTMLSelectElement;
    const sendPageContextInput = document.getElementById('sendPageContext') as HTMLInputElement;
    const historyEnabledInput = document.getElementById('historyEnabled') as HTMLInputElement;
    const historyRetentionSelect = document.getElementById('historyRetentionDays') as HTMLSelectElement;
    const disabledSitesInput = document.getElementById('disabledSites') as HTMLTextAreaElement;
    const personalDictionaryInput = document.getElementById('personalDictionary') as HTMLTextAreaElement;
    const aiModeSelect = document.getElementById('aiMode') as HTMLSelectElement;
    const glossaryInput = document.getElementById('glossary') as HTMLTextAreaElement;

    const items = await chrome.storage.local.get({
        mistralApiKey: '',
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
        historyEnabled: true,
        historyRetentionDays: 30,
        disabledSites: [],
        personalDictionary: [],
        customCommands: [],
        aiMode: 'quality',
        glossary: [],
        styleProfiles: [],
        activeStyleProfileId: '',
        usageStats: EMPTY_USAGE_STATS,
    });

    apiKeyInput.value = items.mistralApiKey as string;
    restoredApiKey = apiKeyInput.value;
    toneSelect.value = items.selectedTone as string;
    themeSelect.value = items.selectedTheme as string;
    visualStyleSelect.value = normalizeAppearanceStyle(items.visualStyle);
    interfaceScaleInput.value = String(clampInterfaceScale(Number(items.interfaceScale) || 90));
    resultDisplayModeSelect.value = normalizeResultDisplayMode(items.resultDisplayMode, items.compactResultMode);
    adaptiveSuggestionsInput.checked = items.adaptiveSuggestionsEnabled === true;
    adaptiveLearningInput.checked = items.adaptiveLearningEnabled !== false;
    searchSelect.value = items.searchEngine as string;
    sendPageContextInput.checked = items.sendPageContext === true;
    historyEnabledInput.checked = items.historyEnabled !== false;
    historyRetentionSelect.value = String(items.historyRetentionDays || 30);
    disabledSitesInput.value = Array.isArray(items.disabledSites) ? items.disabledSites.join('\n') : '';
    personalDictionaryInput.value = Array.isArray(items.personalDictionary) ? items.personalDictionary.join('\n') : '';
    aiModeSelect.value = items.aiMode === 'fast' ? 'fast' : 'quality';
    glossaryInput.value = Array.isArray(items.glossary) ? items.glossary.join('\n') : '';
    restoreCustomCommandSettings(items.customCommands);
    restoreStyleProfileSettings(items.styleProfiles, items.activeStyleProfileId);
    renderUsageStats(items.usageStats as UsageStats);
    updateAppearancePreview();
    updateAdaptiveControls();
    renderAdaptiveStats(items.adaptiveLanguageModel);
    savedOptionsState = captureOptionsState();
    updateSaveButtonState();
}

document.addEventListener('DOMContentLoaded', () => {
    localizeDocument();
    void restoreOptions();
    void setupOnboarding();

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
    setupCustomCommandSettings();
    setupStyleProfileSettings();
    document.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach((button) => {
        button.addEventListener('click', () => activateSettingsTab(button.dataset.tab || 'main'));
        button.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            const tabs = [...document.querySelectorAll<HTMLButtonElement>('.settings-tab')];
            const currentIndex = tabs.indexOf(button);
            const offset = event.key === 'ArrowRight' ? 1 : -1;
            const next = tabs[(currentIndex + offset + tabs.length) % tabs.length];
            activateSettingsTab(next.dataset.tab || 'main');
            next.focus();
        });
    });
    activateSettingsTab('main');

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
        link.click();
        URL.revokeObjectURL(url);
    });
    document.getElementById('importSettings')?.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', async () => {
        const file = importFile.files?.[0];
        if (!file) return;
        try {
            if (file.size > 1_000_000) throw new Error(t('settingsFileTooLarge', 'Файл настроек слишком большой.'));
            await importPortableSettings(JSON.parse(await file.text()));
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

    const versionBadge = document.getElementById('app-version');
    if (versionBadge) {
        const manifest = chrome.runtime.getManifest();
        versionBadge.textContent = `v${manifest.version}`;
    }

    // НОВАЯ ЧИСТАЯ ЛОГИКА ДЛЯ ГЛАЗКА ПАРОЛЯ
    const toggleBtn = document.getElementById('toggleApiKey');
    const eyeOpen = document.getElementById('eyeOpen');
    const eyeClosed = document.getElementById('eyeClosed');
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;

    if (toggleBtn && eyeOpen && eyeClosed && apiKeyInput) {
        toggleBtn.addEventListener('click', () => {
            const isPassword = apiKeyInput.getAttribute('type') === 'password';
            apiKeyInput.setAttribute('type', isPassword ? 'text' : 'password');

            // Переключаем видимость SVG-иконок
            if (isPassword) {
                eyeOpen.style.display = 'none';
                eyeClosed.style.display = 'block';
            } else {
                eyeOpen.style.display = 'block';
                eyeClosed.style.display = 'none';
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
    if (changes.usageStats) renderUsageStats(changes.usageStats.newValue as UsageStats);
});
