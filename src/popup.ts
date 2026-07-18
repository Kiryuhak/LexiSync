import { isSiteDisabled, normalizeDisabledSites } from './privacy';
import { localizeDocument } from './i18n';

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
localizeDocument();

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

function updateSiteList(list: unknown, hostname: string, enabled: boolean): string[] {
    const sites = normalizeDisabledSites(list).filter((site) => site !== hostname);
    if (!enabled) sites.push(hostname);
    return [...new Set(sites)].sort();
}

async function initializeSiteControls(): Promise<void> {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.url) return;
    let url: URL;
    try {
        url = new URL(activeTab.url);
    } catch {
        return;
    }
    if (!['http:', 'https:'].includes(url.protocol)) return;

    const hostname = url.hostname.toLowerCase();
    const siteCard = document.getElementById('site-card');
    const siteSummary = document.getElementById('site-summary') as HTMLButtonElement | null;
    const domainLabel = document.getElementById('site-domain');
    const suggestionsInput = document.getElementById('site-suggestions') as HTMLInputElement | null;
    const historyInput = document.getElementById('site-history') as HTMLInputElement | null;
    const contextInput = document.getElementById('site-context') as HTMLInputElement | null;
    if (!siteCard || !siteSummary || !domainLabel || !suggestionsInput || !historyInput || !contextInput) return;

    const stored = await chrome.storage.local.get({
        adaptiveSuggestionsEnabled: false,
        adaptiveDisabledSites: [],
        disabledSites: [],
        sendPageContext: false,
        contextDisabledSites: [],
    });
    domainLabel.textContent = hostname;
    suggestionsInput.checked = stored.adaptiveSuggestionsEnabled === true
        && !isSiteDisabled(hostname, normalizeDisabledSites(stored.adaptiveDisabledSites));
    historyInput.checked = !isSiteDisabled(hostname, normalizeDisabledSites(stored.disabledSites));
    contextInput.checked = stored.sendPageContext === true
        && !isSiteDisabled(hostname, normalizeDisabledSites(stored.contextDisabledSites));
    siteCard.hidden = false;

    siteSummary.addEventListener('click', () => {
        const isOpen = siteCard.classList.toggle('is-open');
        siteSummary.setAttribute('aria-expanded', String(isOpen));
    });

    suggestionsInput.addEventListener('change', async () => {
        const current = await chrome.storage.local.get({ adaptiveSuggestionsEnabled: false, adaptiveDisabledSites: [] });
        await chrome.storage.local.set({
            adaptiveSuggestionsEnabled: suggestionsInput.checked ? true : current.adaptiveSuggestionsEnabled,
            adaptiveDisabledSites: updateSiteList(current.adaptiveDisabledSites, hostname, suggestionsInput.checked),
        });
    });
    historyInput.addEventListener('change', async () => {
        const current = await chrome.storage.local.get({ disabledSites: [] });
        await chrome.storage.local.set({
            disabledSites: updateSiteList(current.disabledSites, hostname, historyInput.checked),
        });
    });
    contextInput.addEventListener('change', async () => {
        const current = await chrome.storage.local.get({ sendPageContext: false, contextDisabledSites: [] });
        await chrome.storage.local.set({
            sendPageContext: contextInput.checked ? true : current.sendPageContext,
            contextDisabledSites: updateSiteList(current.contextDisabledSites, hostname, contextInput.checked),
        });
    });
}

void initializeSiteControls();
