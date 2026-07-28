import { isSiteDisabled, normalizeDisabledSites } from './privacy';
import { localizeDocument, t } from './i18n';
import { setSitePreference, type SitePreference } from './settings-store';
import { applyAppearanceStyle, normalizeAppearanceStyle, type AppearanceStyle } from './appearance-style';

type Theme = 'auto' | 'light' | 'dark';

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let selectedTheme: Theme = 'auto';
let visualStyle: AppearanceStyle = 'liquid-glass';

function applyTheme(theme: Theme): void {
    const useDarkTheme = theme === 'dark' || (theme === 'auto' && systemTheme.matches);
    document.documentElement.toggleAttribute('data-theme', useDarkTheme);
}

async function initializeTheme(): Promise<void> {
    const result = await chrome.storage.local.get({ selectedTheme: 'auto', visualStyle: 'liquid-glass' });
    selectedTheme = result.selectedTheme as Theme;
    visualStyle = normalizeAppearanceStyle(result.visualStyle);
    applyTheme(selectedTheme);
    applyAppearanceStyle(document.documentElement, visualStyle);
}

void initializeTheme();
localizeDocument();

systemTheme.addEventListener('change', () => {
    if (selectedTheme === 'auto') applyTheme(selectedTheme);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.selectedTheme) {
        selectedTheme = (changes.selectedTheme.newValue || 'auto') as Theme;
        applyTheme(selectedTheme);
    }
    if (changes.visualStyle) {
        visualStyle = normalizeAppearanceStyle(changes.visualStyle.newValue);
        applyAppearanceStyle(document.documentElement, visualStyle);
    }
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
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    status.style.cssText = 'margin:4px 0 0;color:var(--text-muted);font-size:9.5px;';
    document.getElementById('site-panel')?.appendChild(status);
    let busy = false;
    const updateDependentControls = () => {
        enabledInput.disabled = busy;
        for (const input of [suggestionsInput, historyInput, contextInput])
            input.disabled = busy || !enabledInput.checked;
    };
    const setBusy = (value: boolean) => {
        busy = value;
        siteCard.setAttribute('aria-busy', String(value));
        updateDependentControls();
    };
    const showStatus = (message = '', error = false) => {
        status.textContent = message;
        status.hidden = !message;
        status.style.color = error ? '#c43f5d' : 'var(--text-muted)';
    };
    const savePreference = async (
        input: HTMLInputElement,
        preference: Exclude<SitePreference, 'access'>,
    ): Promise<void> => {
        const next = input.checked;
        const previous = !next;
        setBusy(true);
        showStatus();
        try {
            await setSitePreference(preference, hostname, next);
            showStatus(t('siteSettingSaved', 'Настройка сайта сохранена.'));
        } catch (error) {
            input.checked = previous;
            showStatus(t('siteSettingUpdateFailed', 'Не удалось изменить настройку сайта.'), true);
            console.error('LexiSync site preference update failed:', error);
        } finally {
            setBusy(false);
        }
    };
    updateDependentControls();
    siteCard.hidden = false;

    siteSummary.addEventListener('click', () => {
        const isOpen = siteCard.classList.toggle('is-open');
        siteSummary.setAttribute('aria-expanded', String(isOpen));
    });

    enabledInput.addEventListener('change', async () => {
        const requestedState = enabledInput.checked;
        const previousState = !requestedState;
        let permissionBefore = false;
        let permissionChecked = false;
        let storageChanged = false;
        setBusy(true);
        showStatus();
        try {
            permissionBefore = await chrome.permissions.contains({ origins: [originPattern] });
            permissionChecked = true;
            if (requestedState && !permissionBefore) {
                const granted = await chrome.permissions.request({ origins: [originPattern] });
                if (!granted) throw new Error('SITE_PERMISSION_DENIED');
            }
            await setSitePreference('access', hostname, requestedState);
            storageChanged = true;
            const response = await chrome.runtime.sendMessage({
                action: 'siteAccessChanged',
                tabId: activeTab.id,
                enabled: requestedState,
            });
            if (response?.ok !== true) throw new Error(response?.error || 'SITE_ACCESS_UPDATE_FAILED');
            if (!requestedState) await chrome.permissions.remove({ origins: [originPattern] });
            showStatus(t('siteSettingSaved', 'Настройка сайта сохранена.'));
        } catch (error) {
            enabledInput.checked = previousState;
            if (storageChanged) {
                try {
                    await setSitePreference('access', hostname, previousState);
                    await chrome.runtime.sendMessage({
                        action: 'siteAccessChanged',
                        tabId: activeTab.id,
                        enabled: previousState,
                    });
                } catch (rollbackError) {
                    console.error('LexiSync site access rollback failed:', rollbackError);
                }
            }
            if (requestedState && permissionChecked && !permissionBefore)
                await chrome.permissions.remove({ origins: [originPattern] }).catch(() => false);
            const denied = error instanceof Error && error.message === 'SITE_PERMISSION_DENIED';
            showStatus(
                denied
                    ? t('sitePermissionDenied', 'Доступ к сайту не предоставлен.')
                    : t('siteSettingUpdateFailed', 'Не удалось изменить настройку сайта.'),
                true,
            );
            console.error('LexiSync site access update failed:', error);
        } finally {
            setBusy(false);
        }
    });

    suggestionsInput.addEventListener('change', () => void savePreference(suggestionsInput, 'suggestions'));
    historyInput.addEventListener('change', () => void savePreference(historyInput, 'history'));
    contextInput.addEventListener('change', () => void savePreference(contextInput, 'context'));
}

void initializeSiteControls();
