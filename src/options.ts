// Функция для сохранения настроек
// Изменяем функцию на асинхронную (async)
async function saveOptions(): Promise<void> {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
    const toneSelect = document.getElementById('toneSelect') as HTMLSelectElement;
    const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement;    
    const searchSelect = document.getElementById('searchEngine') as HTMLSelectElement; 
    const sendPageContextInput = document.getElementById('sendPageContext') as HTMLInputElement;
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
        searchEngine: searchSelect.value,
        sendPageContext: sendPageContextInput.checked
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
    const searchSelect = document.getElementById('searchEngine') as HTMLSelectElement; 
    const sendPageContextInput = document.getElementById('sendPageContext') as HTMLInputElement;
    
    const items = await chrome.storage.local.get({
        mistralApiKey: '',
        selectedTone: 'business',
        selectedTheme: 'auto',
        searchEngine: 'google',
        sendPageContext: false
    });
    
    apiKeyInput.value = items.mistralApiKey as string;
    toneSelect.value = items.selectedTone as string;
    themeSelect.value = items.selectedTheme as string;
    searchSelect.value = items.searchEngine as string; 
    sendPageContextInput.checked = items.sendPageContext === true;
}

document.addEventListener('DOMContentLoaded', () => {
    restoreOptions();
    
    const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement | null;
    if (saveBtn) saveBtn.addEventListener('click', saveOptions);

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
