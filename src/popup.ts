import { isSiteDisabled, normalizeDisabledSites } from './privacy';
import { localizeDocument, t } from './i18n';
import { setSitePreference, type SitePreference } from './settings-store';
import { applyAppearanceStyle, normalizeAppearanceStyle, type AppearanceStyle } from './appearance-style';
import { applyThemeCustomization } from './theme-customization';
import { hasAllSitesAccess, requestAllSitesAccess, removeAllSitesAccess, detectTabFrameOrigins } from './site-access';
import { applyFastTypographyAndTypoFixes } from './local-text-rules';
import { logger } from './logger';
import { loadCachedHealthStatus, type ProviderHealthStatus } from './provider-health';
import { getHistory } from './history-store';

type Theme = 'auto' | 'light' | 'dark';

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let selectedTheme: Theme = 'auto';
let visualStyle: AppearanceStyle = 'liquid-glass';

function applyTheme(theme: Theme): void {
    const useDarkTheme = theme === 'dark' || (theme === 'auto' && systemTheme.matches);
    document.documentElement.dataset.theme = useDarkTheme ? 'dark' : 'light';
}

async function initializeTheme(): Promise<void> {
    const result = await chrome.storage.local.get({
        selectedTheme: 'auto',
        visualStyle: 'liquid-glass',
        themeCustomization: {},
    });
    selectedTheme = result.selectedTheme as Theme;
    visualStyle = normalizeAppearanceStyle(result.visualStyle);
    applyTheme(selectedTheme);
    applyAppearanceStyle(document.documentElement, visualStyle);
    applyThemeCustomization(document.documentElement, result.themeCustomization);
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
    if (changes.themeCustomization)
        applyThemeCustomization(document.documentElement, changes.themeCustomization.newValue);
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

const btnClipboardFix = document.getElementById('btn-clipboard-fix') as HTMLButtonElement | null;
const clipboardFixStatus = document.getElementById('clipboard-fix-status');
if (btnClipboardFix) {
    btnClipboardFix.addEventListener('click', async () => {
        try {
            btnClipboardFix.disabled = true;
            const text = await navigator.clipboard.readText();
            if (!text || !text.trim()) {
                if (clipboardFixStatus) clipboardFixStatus.textContent = t('clipboardEmpty', 'Буфер обмена пуст');
                setTimeout(() => {
                    if (clipboardFixStatus)
                        clipboardFixStatus.textContent = t('clipboardFixNote', 'Проверить скопированный текст (0 мс)');
                    btnClipboardFix.disabled = false;
                }, 2000);
                return;
            }
            const localFixed = applyFastTypographyAndTypoFixes(text);
            await navigator.clipboard.writeText(localFixed.text);
            if (clipboardFixStatus) {
                clipboardFixStatus.textContent = t('clipboardSuccess', '✓ Исправлено и скопировано!');
                clipboardFixStatus.style.color = '#1b7340';
            }
            setTimeout(() => {
                if (clipboardFixStatus) {
                    clipboardFixStatus.textContent = t('clipboardFixNote', 'Проверить скопированный текст (0 мс)');
                    clipboardFixStatus.style.color = '';
                }
                btnClipboardFix.disabled = false;
            }, 2500);
        } catch {
            if (clipboardFixStatus) clipboardFixStatus.textContent = t('clipboardError', 'Нет доступа к буферу');
            btnClipboardFix.disabled = false;
        }
    });
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
    const allAccessInput = document.getElementById('site-all-access') as HTMLInputElement | null;
    const suggestionsInput = document.getElementById('site-suggestions') as HTMLInputElement | null;
    const enabledInput = document.getElementById('site-enabled') as HTMLInputElement | null;
    const historyInput = document.getElementById('site-history') as HTMLInputElement | null;
    const contextInput = document.getElementById('site-context') as HTMLInputElement | null;
    if (
        !siteCard ||
        !siteSummary ||
        !domainLabel ||
        !enabledInput ||
        !allAccessInput ||
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
    let hasGlobalAccess = await hasAllSitesAccess();
    let siteIsBlocked = isSiteDisabled(hostname, normalizeDisabledSites(stored.blockedSites));
    const hasSiteAccess = hasGlobalAccess || (await chrome.permissions.contains({ origins: [originPattern] }));
    allAccessInput.checked = hasGlobalAccess;
    enabledInput.checked = hasSiteAccess && !siteIsBlocked;
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
        // Глобальное разрешение определяет доступ браузера, а этот переключатель —
        // явное исключение LexiSync для текущего сайта. Эти состояния не дублируют друг друга.
        enabledInput.disabled = busy;
        allAccessInput.disabled = busy;
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
            logger.error('LexiSync site preference update failed:', error);
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

    allAccessInput.addEventListener('change', async () => {
        const requestedState = allAccessInput.checked;
        setBusy(true);
        showStatus();
        try {
            if (requestedState) {
                const granted = await requestAllSitesAccess();
                if (!granted) throw new Error('ALL_SITES_PERMISSION_DENIED');
                hasGlobalAccess = true;
                enabledInput.checked = !siteIsBlocked;
            } else {
                const removed = await removeAllSitesAccess();
                if (!removed) throw new Error('ALL_SITES_PERMISSION_REMOVE_FAILED');
                hasGlobalAccess = false;
                const hasLocal = await chrome.permissions.contains({ origins: [originPattern] });
                enabledInput.checked = hasLocal && !siteIsBlocked;
            }
            if (activeTab.id) {
                await chrome.runtime.sendMessage({
                    action: 'siteAccessChanged',
                    tabId: activeTab.id,
                    enabled: enabledInput.checked,
                });
            }
            showStatus(t('siteSettingSaved', 'Настройка сайта сохранена.'));
        } catch (error) {
            hasGlobalAccess = await hasAllSitesAccess();
            allAccessInput.checked = hasGlobalAccess;
            const hasLocal = await chrome.permissions.contains({ origins: [originPattern] }).catch(() => false);
            enabledInput.checked = (hasGlobalAccess || hasLocal) && !siteIsBlocked;
            const denied = error instanceof Error && error.message === 'ALL_SITES_PERMISSION_DENIED';
            showStatus(
                denied
                    ? t('sitePermissionDenied', 'Доступ к сайту не предоставлен.')
                    : t('siteSettingUpdateFailed', 'Не удалось изменить настройку сайта.'),
                true,
            );
            logger.error('LexiSync all sites access update failed:', error);
        } finally {
            setBusy(false);
        }
    });

    enabledInput.addEventListener('change', async () => {
        const requestedState = enabledInput.checked;
        const previousState = !requestedState;
        let permissionBefore = false;
        let permissionChecked = false;
        let storageChanged = false;
        setBusy(true);
        showStatus();
        const detectedFrames = typeof activeTab.id === 'number' ? await detectTabFrameOrigins(activeTab.id) : [];
        const originsToManage = [...new Set([originPattern, ...detectedFrames])];
        try {
            permissionBefore = await chrome.permissions.contains({ origins: [originPattern] });
            permissionChecked = true;
            if (requestedState && !permissionBefore) {
                const granted = await chrome.permissions.request({ origins: originsToManage });
                if (!granted) throw new Error('SITE_PERMISSION_DENIED');
            }
            await setSitePreference('access', hostname, requestedState);
            storageChanged = true;
            siteIsBlocked = !requestedState;
            const response = await chrome.runtime.sendMessage({
                action: 'siteAccessChanged',
                tabId: activeTab.id,
                enabled: requestedState,
            });
            if (response?.ok !== true) throw new Error(response?.error || 'SITE_ACCESS_UPDATE_FAILED');
            if (!requestedState && !hasGlobalAccess)
                await chrome.permissions.remove({ origins: originsToManage }).catch(() => false);
            showStatus(t('siteSettingSaved', 'Настройка сайта сохранена.'));
        } catch (error) {
            enabledInput.checked = previousState;
            if (storageChanged) {
                try {
                    await setSitePreference('access', hostname, previousState);
                    siteIsBlocked = !previousState;
                    await chrome.runtime.sendMessage({
                        action: 'siteAccessChanged',
                        tabId: activeTab.id,
                        enabled: previousState,
                    });
                } catch (rollbackError) {
                    logger.error('LexiSync site access rollback failed:', rollbackError);
                }
            }
            if (requestedState && permissionChecked && !permissionBefore && !hasGlobalAccess)
                await chrome.permissions.remove({ origins: originsToManage }).catch(() => false);
            const denied = error instanceof Error && error.message === 'SITE_PERMISSION_DENIED';
            showStatus(
                denied
                    ? t('sitePermissionDenied', 'Доступ к сайту не предоставлен.')
                    : t('siteSettingUpdateFailed', 'Не удалось изменить настройку сайта.'),
                true,
            );
            logger.error('LexiSync site access update failed:', error);
        } finally {
            setBusy(false);
        }
    });

    suggestionsInput.addEventListener('change', () => void savePreference(suggestionsInput, 'suggestions'));
    historyInput.addEventListener('change', () => void savePreference(historyInput, 'history'));
    contextInput.addEventListener('change', () => void savePreference(contextInput, 'context'));
}

function renderPopupHealthDot(provider: 'groq' | 'mistral', status: ProviderHealthStatus | null): void {
    const dot = document.getElementById(`popup${provider === 'groq' ? 'Groq' : 'Mistral'}Dot`);
    const item = document.getElementById(`popup${provider === 'groq' ? 'Groq' : 'Mistral'}Status`);
    if (!dot || !item) return;

    if (!status) {
        dot.className = 'popup-status-dot';
        item.title = `${provider === 'groq' ? 'Groq' : 'Mistral'}: ${t('serverStatusUnconfigured', 'Ключ не настроен')}`;
        return;
    }

    dot.className = `popup-status-dot dot-${status.state}`;
    const latencyStr =
        typeof status.latencyMs === 'number'
            ? ` (${Math.round(status.latencyMs)} ${t('millisecondsShort', 'мс')})`
            : '';
    item.title = `${provider === 'groq' ? 'Groq' : 'Mistral'}: ${status.message}${latencyStr}`;
}

async function initializePopupServerStatus(): Promise<void> {
    const cached = await loadCachedHealthStatus();
    renderPopupHealthDot('groq', cached.groq);
    renderPopupHealthDot('mistral', cached.mistral);
}

async function initializeRecentResults(): Promise<void> {
    const card = document.getElementById('recent-results-card');
    const list = document.getElementById('recent-results-list');
    const btnHistory = document.getElementById('btn-recent-history');
    if (!card || !list) return;

    btnHistory?.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('lexisync-history.html') });
        window.close();
    });

    try {
        const history = await getHistory();
        if (!history || history.length === 0) {
            card.hidden = true;
            return;
        }
        const recent = history.slice(0, 3);
        list.replaceChildren();

        for (const item of recent) {
            const row = document.createElement('div');
            row.className = 'recent-item';

            const textSpan = document.createElement('span');
            textSpan.className = 'recent-item-text';
            const cleanText = item.result.trim().replace(/\s+/g, ' ');
            textSpan.textContent = cleanText;
            textSpan.title = item.result.trim();

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'recent-copy-btn';
            copyBtn.textContent = t('copy', 'Копировать');
            copyBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(item.result);
                    copyBtn.textContent = t('copied', 'Скопировано!');
                    setTimeout(() => {
                        copyBtn.textContent = t('copy', 'Копировать');
                    }, 1500);
                } catch {
                    // ignore
                }
            };

            row.append(textSpan, copyBtn);
            list.appendChild(row);
        }
        card.hidden = false;
    } catch {
        card.hidden = true;
    }
}

void initializeSiteControls();
void initializePopupServerStatus();
void initializeRecentResults();
