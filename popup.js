// --- Установка темы при открытии окна ---
chrome.storage.local.get(['selectedTheme'], function(res) {
    const theme = res.selectedTheme || 'auto';
    if (theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
});

// --- Обработчики кнопок ---
document.getElementById('btn-history').addEventListener('click', () => {
    chrome.tabs.create({ url: 'history.html' });
    window.close();
});

document.getElementById('btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
});