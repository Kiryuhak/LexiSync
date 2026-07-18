import { localizeDocument, t } from './i18n';

type AppearanceTheme = 'auto' | 'light' | 'dark';

interface EditableCustomCommand {
    id: string;
    name: string;
    prompt: string;
}

const systemDarkTheme = window.matchMedia('(prefers-color-scheme: dark)');
let restoredApiKey = '';
let customCommands: EditableCustomCommand[] = [];

function clampInterfaceScale(value: number): number {
    return Math.min(110, Math.max(75, Math.round(value / 5) * 5));
}

function updateAppearancePreview(): void {
    const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement | null;
    const scaleInput = document.getElementById('interfaceScale') as HTMLInputElement | null;
    const scaleValue = document.getElementById('interfaceScaleValue') as HTMLOutputElement | null;
    const previewStage = document.getElementById('interfacePreview');
    const previewToolbar = document.getElementById('previewToolbar');
    if (!themeSelect || !scaleInput || !scaleValue || !previewStage || !previewToolbar) return;

    const scale = clampInterfaceScale(Number(scaleInput.value) || 90);
    const theme = themeSelect.value as AppearanceTheme;
    const isDark = theme === 'dark' || (theme === 'auto' && systemDarkTheme.matches);

    scaleInput.value = String(scale);
    scaleValue.value = `${scale}%`;
    scaleValue.textContent = `${scale}%`;
    previewToolbar.style.transform = `scale(${scale / 100})`;
    previewStage.dataset.theme = isDark ? 'dark' : 'light';
    document.documentElement.toggleAttribute('data-theme', isDark);
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
    const candidate = model && typeof model === 'object' ? model as { words?: unknown; pairs?: unknown } : {};
    const wordCount = candidate.words && typeof candidate.words === 'object' ? Object.keys(candidate.words).length : 0;
    const pairCount = candidate.pairs && typeof candidate.pairs === 'object' ? Object.keys(candidate.pairs).length : 0;
    const words = candidate.words && typeof candidate.words === 'object' ? Object.keys(candidate.words) : [];
    const cyrillicCount = words.filter((word) => /\p{Script=Cyrillic}/u.test(word)).length;
    const latinCount = words.filter((word) => /\p{Script=Latin}/u.test(word)).length;
    stats.textContent = `Изучено ${wordCount} слов (RU ${cyrillicCount} / EN ${latinCount}) и ${pairCount} словосочетаний`;
    clearButton.disabled = wordCount === 0 && pairCount === 0;
}

function resetCustomCommandForm(): void {
    const form = document.getElementById('customCommandForm') as HTMLFormElement | null;
    const idInput = document.getElementById('customCommandId') as HTMLInputElement | null;
    const cancelButton = document.getElementById('cancelCommandEdit') as HTMLButtonElement | null;
    form?.reset();
    if (idInput) idInput.value = '';
    if (cancelButton) cancelButton.hidden = true;
}

function renderCustomCommands(): void {
    const list = document.getElementById('customCommandList');
    if (!list) return;
    list.replaceChildren();
    if (customCommands.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'Пока нет пользовательских команд.';
        empty.style.margin = '0 0 4px';
        list.appendChild(empty);
        return;
    }
    for (const command of customCommands) {
        const card = document.createElement('article');
        card.className = 'command-card';
        const copy = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = command.name;
        const prompt = document.createElement('span');
        prompt.textContent = command.prompt;
        copy.append(name, prompt);
        const actions = document.createElement('div');
        actions.className = 'command-card-actions';
        const edit = document.createElement('button');
        edit.type = 'button'; edit.className = 'command-icon-button'; edit.title = 'Изменить'; edit.textContent = '✎';
        edit.onclick = () => {
            (document.getElementById('customCommandId') as HTMLInputElement).value = command.id;
            (document.getElementById('customCommandName') as HTMLInputElement).value = command.name;
            (document.getElementById('customCommandPrompt') as HTMLTextAreaElement).value = command.prompt;
            (document.getElementById('cancelCommandEdit') as HTMLButtonElement).hidden = false;
        };
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'command-icon-button'; remove.title = 'Удалить'; remove.textContent = '×';
        remove.onclick = async () => {
            customCommands = customCommands.filter((item) => item.id !== command.id);
            await chrome.storage.local.set({ customCommands });
            renderCustomCommands();
        };
        actions.append(edit, remove);
        card.append(copy, actions);
        list.appendChild(card);
    }
}

function setupCustomCommands(): void {
    const form = document.getElementById('customCommandForm') as HTMLFormElement | null;
    const idInput = document.getElementById('customCommandId') as HTMLInputElement | null;
    const nameInput = document.getElementById('customCommandName') as HTMLInputElement | null;
    const promptInput = document.getElementById('customCommandPrompt') as HTMLTextAreaElement | null;
    if (!form || !idInput || !nameInput || !promptInput) return;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = nameInput.value.trim().slice(0, 40);
        const prompt = promptInput.value.trim().slice(0, 2000);
        if (!name || !prompt) return;
        if (!idInput.value && customCommands.length >= 8) {
            const status = document.getElementById('status');
            if (status) { status.textContent = 'Можно создать не более 8 команд.'; status.style.color = '#d97706'; status.style.display = 'block'; }
            return;
        }
        const command: EditableCustomCommand = { id: idInput.value || crypto.randomUUID(), name, prompt };
        const index = customCommands.findIndex((item) => item.id === command.id);
        if (index >= 0) customCommands[index] = command;
        else customCommands.push(command);
        await chrome.storage.local.set({ customCommands });
        resetCustomCommandForm();
        renderCustomCommands();
    });
    document.getElementById('cancelCommandEdit')?.addEventListener('click', resetCustomCommandForm);
    document.querySelectorAll<HTMLButtonElement>('.preset-button').forEach((button) => {
        button.addEventListener('click', () => {
            idInput.value = '';
            nameInput.value = button.dataset.commandName || '';
            promptInput.value = button.dataset.commandPrompt || '';
            nameInput.focus();
        });
    });
}

function activateSettingsTab(tabName: string): void {
    document.querySelectorAll<HTMLElement>('[data-settings-group]').forEach((element) => {
        element.hidden = element.dataset.settingsGroup !== tabName;
    });
    document.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach((button) => {
        const active = button.dataset.tab === tabName;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
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

    let activeStep = 0;
    const render = () => {
        steps.forEach((step, index) => step.classList.toggle('is-active', index === activeStep));
        progress.textContent = `${activeStep + 1} из ${steps.length}`;
        nextButton.textContent = activeStep === steps.length - 1 ? t('start', 'Начать работу') : t('next', 'Далее');
    };
    const complete = async () => {
        onboarding.hidden = true;
        await chrome.storage.local.set({ onboardingCompleted: true });
    };
    nextButton.addEventListener('click', () => {
        if (activeStep >= steps.length - 1) void complete();
        else { activeStep++; render(); }
    });
    skipButton.addEventListener('click', () => void complete());
    onboarding.hidden = false;
    render();
}

async function saveOptions(): Promise<void> {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
    const toneSelect = document.getElementById('toneSelect') as HTMLSelectElement;
    const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement;    
    const interfaceScaleInput = document.getElementById('interfaceScale') as HTMLInputElement;
    const adaptiveSuggestionsInput = document.getElementById('adaptiveSuggestionsEnabled') as HTMLInputElement;
    const adaptiveLearningInput = document.getElementById('adaptiveLearningEnabled') as HTMLInputElement;
    const searchSelect = document.getElementById('searchEngine') as HTMLSelectElement; 
    const sendPageContextInput = document.getElementById('sendPageContext') as HTMLInputElement;
    const historyEnabledInput = document.getElementById('historyEnabled') as HTMLInputElement;
    const historyRetentionSelect = document.getElementById('historyRetentionDays') as HTMLSelectElement;
    const disabledSitesInput = document.getElementById('disabledSites') as HTMLTextAreaElement;
    const personalDictionaryInput = document.getElementById('personalDictionary') as HTMLTextAreaElement;
    const statusDiv = document.getElementById('status') as HTMLElement; 
    const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
    
    const apiKey = apiKeyInput.value.trim();

    const originalBtnText = saveBtn.textContent;
    saveBtn.textContent = 'Сохранение...';
    saveBtn.style.opacity = '0.7';
    saveBtn.disabled = true;

    await chrome.storage.local.set({
        selectedTone: toneSelect.value,
        selectedTheme: themeSelect.value,
        interfaceScale: clampInterfaceScale(Number(interfaceScaleInput.value) || 90),
        adaptiveSuggestionsEnabled: adaptiveSuggestionsInput.checked,
        adaptiveLearningEnabled: adaptiveLearningInput.checked,
        searchEngine: searchSelect.value,
        sendPageContext: sendPageContextInput.checked,
        historyEnabled: historyEnabledInput.checked,
        historyRetentionDays: Number(historyRetentionSelect.value),
        disabledSites: disabledSitesInput.value.split(/\r?\n/).map((site) => site.trim()).filter(Boolean),
        personalDictionary: personalDictionaryInput.value.split(/\r?\n/).map((word) => word.trim()).filter(Boolean),
    });

    let apiKeyStatus = '';
    if (apiKey !== restoredApiKey && apiKey) {
        saveBtn.textContent = 'Проверка ключа...';
        try {
            const response = await fetch('https://api.mistral.ai/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (response.ok) {
                await chrome.storage.local.set({ mistralApiKey: apiKey });
                restoredApiKey = apiKey;
            } else {
                apiKeyStatus = 'Настройки сохранены, но новый API-ключ не прошёл проверку.';
            }
        } catch (error) {
            console.error('Ошибка сети при проверке ключа', error);
            apiKeyStatus = 'Настройки сохранены. Проверить API-ключ сейчас не удалось.';
        }
    } else if (!apiKey && restoredApiKey) {
        await chrome.storage.local.set({ mistralApiKey: '' });
        restoredApiKey = '';
    }

    statusDiv.textContent = apiKeyStatus || '✓ Настройки успешно сохранены!';
    statusDiv.style.color = apiKeyStatus ? '#d97706' : '#10b981';
    statusDiv.style.display = 'block';
    window.setTimeout(() => { statusDiv.style.display = 'none'; }, 3500);
    saveBtn.textContent = originalBtnText;
    saveBtn.style.opacity = '1';
    saveBtn.disabled = false;
}

// Функция для восстановления настроек (Promise-based)
async function restoreOptions(): Promise<void> {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
    const toneSelect = document.getElementById('toneSelect') as HTMLSelectElement;
    const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement;
    const interfaceScaleInput = document.getElementById('interfaceScale') as HTMLInputElement;
    const adaptiveSuggestionsInput = document.getElementById('adaptiveSuggestionsEnabled') as HTMLInputElement;
    const adaptiveLearningInput = document.getElementById('adaptiveLearningEnabled') as HTMLInputElement;
    const searchSelect = document.getElementById('searchEngine') as HTMLSelectElement; 
    const sendPageContextInput = document.getElementById('sendPageContext') as HTMLInputElement;
    const historyEnabledInput = document.getElementById('historyEnabled') as HTMLInputElement;
    const historyRetentionSelect = document.getElementById('historyRetentionDays') as HTMLSelectElement;
    const disabledSitesInput = document.getElementById('disabledSites') as HTMLTextAreaElement;
    const personalDictionaryInput = document.getElementById('personalDictionary') as HTMLTextAreaElement;
    
    const items = await chrome.storage.local.get({
        mistralApiKey: '',
        selectedTone: 'business',
        selectedTheme: 'auto',
        interfaceScale: 90,
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
    });
    
    apiKeyInput.value = items.mistralApiKey as string;
    restoredApiKey = apiKeyInput.value;
    toneSelect.value = items.selectedTone as string;
    themeSelect.value = items.selectedTheme as string;
    interfaceScaleInput.value = String(clampInterfaceScale(Number(items.interfaceScale) || 90));
    adaptiveSuggestionsInput.checked = items.adaptiveSuggestionsEnabled === true;
    adaptiveLearningInput.checked = items.adaptiveLearningEnabled !== false;
    searchSelect.value = items.searchEngine as string; 
    sendPageContextInput.checked = items.sendPageContext === true;
    historyEnabledInput.checked = items.historyEnabled !== false;
    historyRetentionSelect.value = String(items.historyRetentionDays || 30);
    disabledSitesInput.value = Array.isArray(items.disabledSites) ? items.disabledSites.join('\n') : '';
    personalDictionaryInput.value = Array.isArray(items.personalDictionary) ? items.personalDictionary.join('\n') : '';
    customCommands = Array.isArray(items.customCommands)
        ? items.customCommands.filter((item: unknown): item is EditableCustomCommand => Boolean(item && typeof item === 'object' && 'id' in item && 'name' in item && 'prompt' in item)).slice(0, 8)
        : [];
    renderCustomCommands();
    updateAppearancePreview();
    updateAdaptiveControls();
    renderAdaptiveStats(items.adaptiveLanguageModel);
}

document.addEventListener('DOMContentLoaded', () => {
    localizeDocument();
    void restoreOptions();
    void setupOnboarding();
    
    const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement | null;
    if (saveBtn) saveBtn.addEventListener('click', saveOptions);

    const themeSelect = document.getElementById('themeSelect');
    const interfaceScaleInput = document.getElementById('interfaceScale');
    const adaptiveSuggestionsInput = document.getElementById('adaptiveSuggestionsEnabled');
    themeSelect?.addEventListener('change', updateAppearancePreview);
    interfaceScaleInput?.addEventListener('input', updateAppearancePreview);
    adaptiveSuggestionsInput?.addEventListener('change', updateAdaptiveControls);
    setupCustomCommands();
    document.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach((button) => {
        button.addEventListener('click', () => activateSettingsTab(button.dataset.tab || 'main'));
    });
    activateSettingsTab('main');

    const clearAdaptiveDataButton = document.getElementById('clearAdaptiveData') as HTMLButtonElement | null;
    clearAdaptiveDataButton?.addEventListener('click', async () => {
        const confirmed = window.confirm('Удалить все локально изученные слова и словосочетания?');
        if (!confirmed) return;
        const emptyModel = { version: 2, words: {}, pairs: {}, rejections: {} };
        await chrome.storage.local.set({ adaptiveLanguageModel: emptyModel, adaptiveBlockedWords: [] });
        renderAdaptiveStats(emptyModel);
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

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.adaptiveLanguageModel) {
        renderAdaptiveStats(changes.adaptiveLanguageModel.newValue);
    }
});
