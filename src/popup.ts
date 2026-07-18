type Theme = 'auto' | 'light' | 'dark';

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let selectedTheme: Theme = 'auto';

function applyTheme(theme: Theme): void {
    const useDarkTheme = theme === 'dark' || (theme === 'auto' && systemTheme.matches);
    document.documentElement.toggleAttribute('data-theme', useDarkTheme);
}

async function initializeTheme(): Promise<void> {
    const result = await chrome.storage.local.get({ selectedTheme: 'auto' });
    selectedTheme = result.selectedTheme as Theme;
    applyTheme(selectedTheme);
}

void initializeTheme();

systemTheme.addEventListener('change', () => {
    if (selectedTheme === 'auto') applyTheme(selectedTheme);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.selectedTheme) return;
    selectedTheme = (changes.selectedTheme.newValue || 'auto') as Theme;
    applyTheme(selectedTheme);
});

// --- Обработчики кнопок ---
document.getElementById('btn-history')!.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('lexisync-history.html') });
    window.close();
});

document.getElementById('btn-options')!.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
});
