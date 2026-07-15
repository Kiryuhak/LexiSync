// --- Установка темы при открытии окна ---
document.addEventListener('DOMContentLoaded', async () => {
    const res = await chrome.storage.local.get(['selectedTheme']);
    const theme = res.selectedTheme || 'auto';
    if (theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
});
// ... Обработчики кнопок оставляем без изменений ...

// --- Обработчики кнопок ---
document.getElementById('btn-history')!.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('lexisync-history.html') });
    window.close();
});

document.getElementById('btn-options')!.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
});
