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
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const candidates = await chrome.tabs.query({ currentWindow: true });
    const requestedTabId = Number(new URLSearchParams(location.search).get('tabId'));
    const requestedTab = Number.isInteger(requestedTabId)
        ? candidates.find((tab) => tab.id === requestedTabId)
        : undefined;
    const requestedUrl = new URLSearchParams(location.search).get('targetUrl') || '';
    const requestedTarget =
        requestedTab && /^https?:/.test(requestedUrl) ? { ...requestedTab, url: requestedUrl } : requestedTab;
    const activeTab =
        requestedTarget?.url && /^https?:/.test(requestedTarget.url)
            ? requestedTarget
            : currentTab?.url && /^https?:/.test(currentTab.url)
              ? currentTab
              : candidates
                    .filter((tab) => tab.url && /^https?:/.test(tab.url))
                    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (!activeTab?.url) return;
    let url: URL;
    try {
        url = new URL(activeTab.url);
    } catch {
        return;
    }
    if (!['http:', 'https:'].includes(url.protocol)) return;

    const hostname = url.hostname.toLowerCase();
    const originPattern = `${url.origin}/*`;
    const siteCard = document.getElementById('site-card');
    const siteSummary = document.getElementById('site-summary') as HTMLButtonElement | null;
    const domainLabel = document.getElementById('site-domain');
    const suggestionsInput = document.getElementById('site-suggestions') as HTMLInputElement | null;
    const enabledInput = document.getElementById('site-enabled') as HTMLInputElement | null;
    const historyInput = document.getElementById('site-history') as HTMLInputElement | null;
    const contextInput = document.getElementById('site-context') as HTMLInputElement | null;
    if (
        !siteCard ||
        !siteSummary ||
        !domainLabel ||
        !enabledInput ||
        !suggestionsInput ||
        !historyInput ||
        !contextInput
    )
        return;

    const stored = await chrome.storage.local.get({
        adaptiveSuggestionsEnabled: false,
        adaptiveDisabledSites: [],
        disabledSites: [],
        sendPageContext: false,
        contextDisabledSites: [],
        blockedSites: [],
    });
    domainLabel.textContent = hostname;
    const hasSiteAccess = await chrome.permissions.contains({ origins: [originPattern] });
    enabledInput.checked = hasSiteAccess && !isSiteDisabled(hostname, normalizeDisabledSites(stored.blockedSites));
    suggestionsInput.checked =
        stored.adaptiveSuggestionsEnabled === true &&
        !isSiteDisabled(hostname, normalizeDisabledSites(stored.adaptiveDisabledSites));
    historyInput.checked = !isSiteDisabled(hostname, normalizeDisabledSites(stored.disabledSites));
    contextInput.checked =
        stored.sendPageContext === true &&
        !isSiteDisabled(hostname, normalizeDisabledSites(stored.contextDisabledSites));
    const updateDependentControls = () => {
        for (const input of [suggestionsInput, historyInput, contextInput]) input.disabled = !enabledInput.checked;
    };
    updateDependentControls();
    siteCard.hidden = false;

    siteSummary.addEventListener('click', () => {
        const isOpen = siteCard.classList.toggle('is-open');
        siteSummary.setAttribute('aria-expanded', String(isOpen));
    });

    enabledInput.addEventListener('change', async () => {
        const requestedState = enabledInput.checked;
        if (requestedState) {
            const granted = await chrome.permissions.request({ origins: [originPattern] });
            if (!granted) {
                enabledInput.checked = false;
                updateDependentControls();
                return;
            }
        }
        const current = await chrome.storage.local.get({ blockedSites: [] });
        await chrome.storage.local.set({
            blockedSites: updateSiteList(current.blockedSites, hostname, requestedState),
        });
        if (!requestedState) {
            await chrome.runtime.sendMessage({ action: 'siteAccessChanged', tabId: activeTab.id, enabled: false });
            await chrome.permissions.remove({ origins: [originPattern] });
        } else {
            const response = await chrome.runtime.sendMessage({
                action: 'siteAccessChanged',
                tabId: activeTab.id,
                enabled: true,
            });
            if (response?.ok !== true) {
                enabledInput.checked = false;
                await chrome.permissions.remove({ origins: [originPattern] });
            }
        }
        updateDependentControls();
    });

    suggestionsInput.addEventListener('change', async () => {
        const current = await chrome.storage.local.get({
            adaptiveSuggestionsEnabled: false,
            adaptiveDisabledSites: [],
        });
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
