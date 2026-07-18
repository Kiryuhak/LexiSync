type AppearanceTheme = 'auto' | 'light' | 'dark';

const systemDarkTheme = window.matchMedia('(prefers-color-scheme: dark)');

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
    stats.textContent = `Изучено ${wordCount} слов и ${pairCount} словосочетаний`;
    clearButton.disabled = wordCount === 0 && pairCount === 0;
}

// Функция для сохранения настроек
// Изменяем функцию на асинхронную (async)
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

    // 1. Анимация загрузки на кнопке
    const originalBtnText = saveBtn.textContent;
    saveBtn.textContent = 'Проверка ключа...';
    saveBtn.style.opacity = '0.7';
    saveBtn.disabled = true;

    // 2. ПРОВЕРКА КЛЮЧА
    if (apiKey) {
        try {
            // Делаем тестовый запрос к бесплатному эндпоинту Mistral
            const response = await fetch('https://api.mistral.ai/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            
            if (!response.ok) {
                // Если Mistral ответил ошибкой (например, 401 Unauthorized)
                statusDiv.textContent = '❌ Ошибка: Неверный API ключ!';
                statusDiv.style.color = '#ef4444'; // Красный
                statusDiv.style.display = 'block';
                
                saveBtn.textContent = originalBtnText;
                saveBtn.style.opacity = '1';
                saveBtn.disabled = false;
                return; // Прерываем сохранение!
            }
        } catch (error) {
            console.error("Ошибка сети при проверке ключа", error);
        }
    }

    // 3. Сохраняем, если всё отлично
    chrome.storage.local.set({
        mistralApiKey: apiKey,
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
        personalDictionary: personalDictionaryInput.value.split(/\r?\n/).map((word) => word.trim()).filter(Boolean)
    }, () => {
        if (statusDiv) {
            statusDiv.textContent = '✓ Настройки успешно сохранены!';
            statusDiv.style.color = '#10b981'; // Зеленый
            statusDiv.style.display = 'block';
            setTimeout(() => { statusDiv.style.display = 'none'; }, 2000);
        }
        // Возвращаем кнопку в норму
        saveBtn.textContent = originalBtnText;
        saveBtn.style.opacity = '1';
        saveBtn.disabled = false;
    });
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
        adaptiveLanguageModel: { version: 1, words: {}, pairs: {} },
        searchEngine: 'google',
        sendPageContext: false,
        historyEnabled: true,
        historyRetentionDays: 30,
        disabledSites: [],
        personalDictionary: []
    });
    
    apiKeyInput.value = items.mistralApiKey as string;
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
    updateAppearancePreview();
    updateAdaptiveControls();
    renderAdaptiveStats(items.adaptiveLanguageModel);
}

document.addEventListener('DOMContentLoaded', () => {
    restoreOptions();
    
    const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement | null;
    if (saveBtn) saveBtn.addEventListener('click', saveOptions);

    const themeSelect = document.getElementById('themeSelect');
    const interfaceScaleInput = document.getElementById('interfaceScale');
    const adaptiveSuggestionsInput = document.getElementById('adaptiveSuggestionsEnabled');
    themeSelect?.addEventListener('change', updateAppearancePreview);
    interfaceScaleInput?.addEventListener('input', updateAppearancePreview);
    adaptiveSuggestionsInput?.addEventListener('change', updateAdaptiveControls);

    const clearAdaptiveDataButton = document.getElementById('clearAdaptiveData') as HTMLButtonElement | null;
    clearAdaptiveDataButton?.addEventListener('click', async () => {
        const confirmed = window.confirm('Удалить все локально изученные слова и словосочетания?');
        if (!confirmed) return;
        const emptyModel = { version: 1, words: {}, pairs: {} };
        await chrome.storage.local.set({ adaptiveLanguageModel: emptyModel });
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
