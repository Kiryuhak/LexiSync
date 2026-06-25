document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveBtn').addEventListener('click', saveOptions);

function saveOptions() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const tone = document.getElementById('toneSelect').value;
    const theme = document.getElementById('themeSelect').value;
    
    // Сохраняем ключ, тональность и тему
    chrome.storage.local.set({ 
        mistralApiKey: apiKey,
        selectedTone: tone,
        selectedTheme: theme
    }, () => {
        // Мгновенное применение темы без перезагрузки страницы
        if (theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }

        const status = document.getElementById('status');
        status.style.opacity = 1;
        setTimeout(() => { status.style.opacity = 0; }, 2000);
    });
}

function restoreOptions() {
    // Подгружаем сохраненные настройки
    chrome.storage.local.get(['mistralApiKey', 'selectedTone', 'selectedTheme'], (result) => {
        if (result.mistralApiKey) {
            document.getElementById('apiKey').value = result.mistralApiKey;
        }
        if (result.selectedTone) {
            document.getElementById('toneSelect').value = result.selectedTone;
        }
        if (result.selectedTheme) {
            document.getElementById('themeSelect').value = result.selectedTheme;
        }
    });

    const manifestData = chrome.runtime.getManifest();
    document.getElementById('app-version').textContent = 'v' + manifestData.version;
}