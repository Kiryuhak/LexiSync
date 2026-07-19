import { ICONS } from './icons';
import { getCachedText, getCacheHash, setCachedText } from './ai-cache';
import { initializeAdaptiveSuggestions } from './adaptive-suggestions';
import { t } from './i18n';
import { addHistoryItem, updateHistoryItemResult } from './history-store';
import { isSiteDisabled, normalizeDisabledSites, shouldStoreOnCurrentPage } from './privacy';
import { getWordCorrections, normalizeSpellcheckResult, renderSpellcheckDiffFragment, resolveCorrections, type WordCorrection } from './spellcheck';
import { replaceSelectedText } from './text-replacement';
import type { CustomCommand, HistoryItem, RequestMode, SelectionData, StreamResponse } from './types';
import { recordCacheHit } from './usage-stats';
import { captureSelection, getSelectedText, getSelectionCoords as readSelectionCoords } from './selection-state';
import { appendIconAndText, createSvgIcon, renderMarkdown, setIcon } from './dom-rendering';
import { initializeOcrOverlay } from './ocr-overlay';

initializeAdaptiveSuggestions();

let extensionEnabledOnSite = true;
void chrome.storage.local.get({ blockedSites: [] }).then((stored) => {
    extensionEnabledOnSite = !isSiteDisabled(location.hostname, normalizeDisabledSites(stored.blockedSites));
});
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.blockedSites) {
        extensionEnabledOnSite = !isSiteDisabled(location.hostname, normalizeDisabledSites(changes.blockedSites.newValue));
        if (!extensionEnabledOnSite) closePopup();
    }
});

let currentSelection: SelectionData = { text: "", context: "", range: null, activeElement: null, start: null, end: null, isInput: false };
let popupUI: HTMLElement | null = null;
let popupHost: HTMLElement | null = null;
let popupShadow: ShadowRoot | null = null;
let previousFocus: HTMLElement | null = null;
let popupStyleText = '';
function getLanguageName(code: string): string {
    try {
        return new Intl.DisplayNames([chrome.i18n.getUILanguage()], { type: 'language' }).of(code) || code;
    } catch {
        return code;
    }
}

let currentTargetLang: string = getLanguageName('en');
let currentTheme: string = 'auto';
let currentSearchEngine: string = 'google';
let currentInterfaceScale: number = 90;

let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let isManuallyPositioned = false;

let lastMouseX = 0;
let lastMouseY = 0;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'lexisyncPing') {
        sendResponse({ ok: true });
        return;
    }
    if (request.action === 'setSiteEnabled') {
        extensionEnabledOnSite = request.enabled === true;
        if (!extensionEnabledOnSite) closePopup();
        sendResponse({ ok: true });
        return;
    }
    if (!extensionEnabledOnSite) return;
    if (request.action === "contextMenuClicked") {
        saveSelectionState(request.text);
        const x = lastMouseX || (window.innerWidth / 2);
        const y = lastMouseY || (window.innerHeight / 2);
        showAIMenu(x, y);
        handleActionClick(request.mode);
    }
    
    if (request.action === "hotkeyTriggered") {
        (async () => {
            let text = getSelectedText();
            if (!text || text.trim().length === 0) {
                try {
                    text = await navigator.clipboard.readText();
                    if (!text || text.trim().length === 0) {
                        showToast(t('textNotFound', 'Текст не найден. В Google Docs выделите текст, нажмите Ctrl+C и повторите горячую клавишу.'));
                        return;
                    }
                } catch (err) {
                    showToast(t('clipboardDenied', 'Нет доступа к буферу обмена. Кликните по документу и попробуйте снова.'));
                    return;
                }
            }
            if (text && text.trim().length > 0) {
                saveSelectionState(text);
                const coords = getSelectionCoords();
                showAIMenu(coords.x, coords.y);
                handleActionClick(request.mode);
            }
        })();
        // Убрали return true, чтобы не было ошибки в консоли!
    }

    if (request.action === 'historyReplay') {
        void (async () => {
            saveSelectionState(typeof request.text === 'string' ? request.text : '');
            const coords = getSelectionCoords();
            showAIMenu(coords.x, coords.y);
            if (request.mode === 'custom') {
                const stored = await chrome.storage.local.get({ customCommands: [] });
                const commands = Array.isArray(stored.customCommands) ? stored.customCommands as CustomCommand[] : [];
                const command = commands.find((item) => item.name === request.customName);
                if (command) executeRequest('custom', command);
                else showToast(t('commandNotFound', 'Исходная пользовательская команда не найдена.'));
            } else {
                handleActionClick(request.mode as RequestMode);
            }
        })();
    }
});

document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!extensionEnabledOnSite) return;
    if (!isDragging || !popupUI) return;
    let newX = e.clientX - dragOffsetX;
    let newY = e.clientY - dragOffsetY;
    if (newX < 0) newX = 0;
    if (newY < 0) newY = 0;
    if (newX + popupUI.offsetWidth > window.innerWidth) newX = window.innerWidth - popupUI.offsetWidth;
    if (newY + popupUI.offsetHeight > window.innerHeight) newY = window.innerHeight - popupUI.offsetHeight;
    popupUI.style.left = `${newX}px`;
    popupUI.style.top = `${newY}px`;
});

document.addEventListener('mousedown', (e: MouseEvent) => {
    if (!extensionEnabledOnSite) return;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (popupUI) {
        if (!isPopupEvent(e)) closePopup();
        else {
            const moreWrap = getPopupElementById<HTMLElement>('lexisync-more-btn-wrap');
            const moreDropdown = getPopupElementById<HTMLElement>('lexisync-more-dropdown');
            if (moreWrap && moreDropdown && !e.composedPath().includes(moreWrap)) moreDropdown.style.display = 'none';
        }
    }
}, true);

document.addEventListener('mouseup', (e: MouseEvent) => {
    if (!extensionEnabledOnSite) return;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (isDragging && popupUI) {
        isDragging = false;
        const header = popupUI.querySelector('.lexisync-header') as HTMLElement;
        if (header) header.style.cursor = 'grab';
    }
    if (isPopupEvent(e)) return;
    if (e.button === 2) return; 
    
    setTimeout(() => {
        const text = getSelectedText();
        if (text && text.trim().length > 0) {
            saveSelectionState();
            showToolbarMenu(lastMouseX, lastMouseY);
        }
    }, 50);
}, true);

document.addEventListener('keydown', async (e: KeyboardEvent) => {
    if (!extensionEnabledOnSite) return;
    if (isPopupEvent(e)) return;
    const isSelectAll = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a';
    if (isSelectAll) {
        setTimeout(() => {
            const text = getSelectedText();
            if (text && text.trim().length > 0) {
                saveSelectionState();
                const coords = getSelectionCoords();
                showToolbarMenu(coords.x, coords.y);
            }
        }, 50);
        return;
    }
    if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const key = e.key.toLowerCase();
        if (key === 's' || key === 'ы') {
            e.preventDefault();
            void chrome.runtime.sendMessage({ action: 'requestOcrCapture' });
            return;
        }
        let mode: RequestMode | null = null;
        if (key === 'r' || key === 'к') mode = 'spellcheck';
        else if (key === 'y' || key === 'н') mode = 'style';
        else if (key === 't' || key === 'е') mode = 'emoji';

        if (mode) {
            e.preventDefault();
            let text = getSelectedText();
            if (!text || text.trim().length === 0) {
                try {
                    text = await navigator.clipboard.readText();
                    if (!text || text.trim().length === 0) {
                        showToast(t('textNotFound', 'Текст не найден. В Google Docs выделите текст, нажмите Ctrl+C и повторите горячую клавишу.'));
                        return;
                    }
                } catch (err) {
                    showToast(t('clipboardReadFailed', 'Не удалось прочитать буфер обмена. Разрешите доступ и попробуйте снова.'));
                    return;
                }
            }
            if (text && text.trim().length > 0) {
                saveSelectionState(text);
                const coords = getSelectionCoords();
                showAIMenu(coords.x, coords.y);
                handleActionClick(mode);
            }
        }
    }
}, true);

function normalizeInterfaceScale(value: unknown): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 90;
    return Math.min(110, Math.max(75, Math.round(numericValue / 5) * 5));
}

chrome.storage.local.get({ selectedTheme: 'auto', searchEngine: 'google', interfaceScale: 90 }, (res) => {
    if (res.selectedTheme) currentTheme = res.selectedTheme as string;
    if (res.searchEngine) currentSearchEngine = res.searchEngine as string;
    currentInterfaceScale = normalizeInterfaceScale(res.interfaceScale);
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        if (changes.selectedTheme) {
            currentTheme = changes.selectedTheme.newValue as string;
            if (popupUI) applyThemeToPopup(popupUI);
        }
        if (changes.searchEngine) currentSearchEngine = changes.searchEngine.newValue as string;
        if (changes.interfaceScale) {
            currentInterfaceScale = normalizeInterfaceScale(changes.interfaceScale.newValue);
            popupUI?.style.setProperty('zoom', String(currentInterfaceScale / 100));
            adjustPopupPosition();
        }
    }
});

let lastAnchorX: number = 0;
let lastAnchorY: number = 0;

function injectStyles(): void {
    if (!popupStyleText) {
        const style = document.createElement('style');
        style.textContent = `
            #lexisync-extension-ui {
                --bg-primary: rgba(248, 250, 255, 0.78); --bg-solid: #f8faff; --bg-elevated: rgba(248, 250, 255, 0.96); --bg-secondary: rgba(255, 255, 255, 0.72);
                --text-primary: #1c2438; --text-secondary: #69738d; --primary: #6d5ce7; --primary-strong: #5947d2;
                --primary-soft: rgba(109, 92, 231, 0.12); --cyan-soft: rgba(31, 174, 190, 0.12);
                --border-color: rgba(255,255,255,0.74); --inner-border: rgba(83, 91, 126, 0.12);
                --hover-bg: rgba(255,255,255,0.9); --shadow-color: rgba(41, 43, 77, 0.18);
                transition: opacity 0.15s ease; border-radius: 18px;
                border: 1px solid var(--border-color);
                animation: lexiSyncFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                box-shadow: 0 20px 52px var(--shadow-color), 0 3px 10px rgba(38, 40, 72, 0.08), inset 0 1px 0 rgba(255,255,255,0.42);
                backdrop-filter: blur(22px) saturate(155%);
                -webkit-backdrop-filter: blur(22px) saturate(155%);
            }
            #lexisync-extension-ui[data-theme="dark"] {
                --bg-primary: rgba(27, 30, 49, 0.82); --bg-solid: #1b1e31; --bg-elevated: rgba(27, 30, 49, 0.96); --bg-secondary: rgba(49, 54, 82, 0.72);
                --text-primary: #f5f6fc; --text-secondary: #abb4ce; --primary: #b7a8ff; --primary-strong: #9c89ff;
                --primary-soft: rgba(183, 168, 255, 0.15); --cyan-soft: rgba(102, 215, 228, 0.14);
                --border-color: rgba(255,255,255,0.14); --inner-border: rgba(255,255,255,0.08);
                --hover-bg: rgba(64, 70, 104, 0.9); --shadow-color: rgba(0,0,0,0.48);
            }
            #lexisync-extension-ui span { flex-shrink: 0 !important; }
            #lexisync-extension-ui svg { width: 16px !important; height: 16px !important; min-width: 16px !important; min-height: 16px !important; max-width: 16px !important; max-height: 16px !important; flex-shrink: 0 !important; display: block !important; }
            @keyframes lexisync-spin { to { transform: rotate(360deg); } }
            @keyframes lexisync-flip { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(180deg); } }
            @keyframes lexiSyncFadeIn { 0% { opacity: 0; transform: translateY(12px) scale(0.98); } 100% { opacity: 1; transform: translateY(0) scale(1); }}
            .lexisync-loader { width: 14px; height: 14px; border: 2.5px solid var(--text-secondary); border-top-color: transparent; border-radius: 50%; animation: lexisync-spin 0.8s linear infinite; }
            .lexisync-hourglass { animation: lexisync-flip 2s ease-in-out infinite; display: flex; align-items: center; justify-content: center; }
            #lexisync-extension-ui mark { background: #dcfce7; color: #166534; padding: 2px 4px; border-radius: 4px; font-weight: 500; }
            #lexisync-extension-ui[data-theme="dark"] mark { background: #0f5223; color: #c4eed0; }
            /* Общие стили для обеих кнопок */
            .lexisync-btn-action, .lexisync-translate-btn {
                background: var(--bg-secondary) !important; 
                border: none !important; 
                border-radius: 8px !important; 
                padding: 0 16px !important; 
                height: 38px !important; /* Строгая высота */
                font-size: 13px !important; 
                cursor: pointer !important; 
                color: var(--text-primary) !important; 
                display: flex !important; 
                flex-direction: row !important; /* Выстраиваем в линию */
                align-items: center !important; 
                justify-content: center !important; 
                gap: 8px !important; 
                font-family: inherit !important; 
                font-weight: 500 !important; 
                box-sizing: border-box !important; 
                white-space: nowrap !important; /* ЗАПРЕЩАЕМ ПЕРЕНОС ТЕКСТА */
                flex-shrink: 0 !important; /* Запрещаем сжатие кнопки */
                transition: all 0.2s cubic-bezier(0.2, 0, 0, 1) !important;
            }

            .lexisync-btn-action:hover, .lexisync-translate-btn:hover {
                background: var(--hover-bg) !important; 
            }

            .lexisync-btn-action:active, .lexisync-translate-btn:active {
                transform: translateY(1px) scale(0.98) !important; 
            }

            /* Стили только для квадратной кнопки копирования */
            .lexisync-translate-btn.icon-only, .lexisync-btn-action.icon-only {
                padding: 0 !important; 
                width: 38px !important; 
                min-width: 38px !important; 
            }

            /* Иконки внутри кнопок */
            .lexisync-btn-action svg, .lexisync-translate-btn svg {
                width: 16px !important;
                height: 16px !important;
                min-width: 16px !important;
                flex-shrink: 0 !important;
                display: block !important;
                margin: 0 !important;
            }
            .lexisync-scroll::-webkit-scrollbar { width: 6px; }
            .lexisync-scroll::-webkit-scrollbar-track { background: transparent; }
            .lexisync-scroll::-webkit-scrollbar-thumb { background: var(--text-secondary); border-radius: 4px; }

            #lexisync-extension-ui[data-surface="toolbar"] {
                border-radius: 14px;
                background: var(--bg-primary) !important;
            }
            .lexisync-toolbar-button {
                min-height: 32px !important;
                border-radius: 9px !important;
                font-family: system-ui, -apple-system, sans-serif !important;
            }
            .lexisync-toolbar-button:hover,
            .lexisync-menu-button:hover,
            .lexisync-dropdown-item:hover {
                background: var(--hover-bg) !important;
                box-shadow: inset 0 0 0 1px var(--inner-border);
            }
            .lexisync-toolbar-button:focus-visible,
            .lexisync-menu-button:focus-visible,
            .lexisync-result-button:focus-visible {
                outline: 3px solid color-mix(in srgb, var(--primary) 30%, transparent) !important;
                outline-offset: 1px !important;
            }
            .lexisync-toolbar-divider {
                background: var(--inner-border) !important;
            }
            .lexisync-dropdown {
                background: var(--bg-elevated) !important;
                border-color: var(--border-color) !important;
                box-shadow: 0 18px 42px rgba(37, 39, 68, 0.22), inset 0 1px 0 rgba(255,255,255,.4) !important;
                backdrop-filter: blur(32px) saturate(125%);
                -webkit-backdrop-filter: blur(32px) saturate(125%);
            }

            #lexisync-extension-ui[data-surface="menu"] {
                background: var(--bg-primary) !important;
                border-radius: 18px;
            }
            .lexisync-menu-label {
                display: flex;
                align-items: center;
                gap: 7px;
                padding: 7px 10px 8px;
                color: var(--text-secondary);
                font: 650 10px/1 system-ui, sans-serif;
                letter-spacing: .08em;
                text-transform: uppercase;
                user-select: none;
            }
            .lexisync-menu-label::before {
                width: 7px;
                height: 7px;
                content: "";
                background: linear-gradient(135deg, var(--primary), #43c9d4);
                border-radius: 50%;
                box-shadow: 0 0 0 4px var(--primary-soft);
            }
            .lexisync-menu-button {
                min-height: 43px !important;
                margin-top: 3px !important;
                padding: 7px 10px !important;
                border: 1px solid transparent !important;
                border-radius: 12px !important;
                font-family: system-ui, -apple-system, sans-serif !important;
                text-align: left !important;
            }
            .lexisync-menu-icon {
                width: 30px !important;
                height: 30px !important;
                margin-right: 10px !important;
                color: var(--primary) !important;
                background: var(--primary-soft);
                border-radius: 9px;
            }
            .lexisync-menu-button:nth-of-type(3) .lexisync-menu-icon { color: #19a5b6 !important; background: var(--cyan-soft); }
            .lexisync-shortcut {
                padding: 4px 6px;
                color: var(--text-secondary) !important;
                background: var(--bg-secondary);
                border: 1px solid var(--inner-border);
                border-radius: 6px;
                box-shadow: inset 0 -1px 0 var(--inner-border);
                font: 600 10px/1 ui-monospace, Consolas, monospace !important;
            }

            #lexisync-extension-ui[data-surface="result"] {
                overflow: visible;
                background: var(--bg-primary) !important;
                border-radius: 20px;
            }
            .lexisync-header {
                min-height: 50px;
                padding: 11px 14px !important;
                background: linear-gradient(135deg, var(--primary-soft), transparent 62%) !important;
                border-bottom-color: var(--inner-border) !important;
                border-radius: 20px 20px 0 0 !important;
            }
            .lexisync-header-title {
                color: var(--text-primary);
                letter-spacing: -0.01em;
            }
            .lexisync-content-pane {
                padding: 17px 18px !important;
                line-height: 1.65 !important;
            }
            .lexisync-actions {
                padding: 4px 14px 14px !important;
                border-radius: 0 0 20px 20px;
            }
            .lexisync-result-tools {
                display: none;
                flex-wrap: wrap;
                gap: 5px;
                padding: 0 14px 10px;
            }
            .lexisync-tool-chip {
                padding: 6px 8px;
                color: var(--text-secondary);
                background: var(--bg-secondary);
                border: 1px solid var(--inner-border);
                border-radius: 8px;
                cursor: pointer;
                font: 600 10px/1 system-ui, sans-serif;
            }
            .lexisync-tool-chip:hover { color: var(--primary); background: var(--hover-bg); }
            .lexisync-content-pane[contenteditable="true"] {
                margin: 7px 10px 12px;
                padding: 12px !important;
                background: var(--bg-secondary);
                border: 1px solid transparent;
                border-radius: 11px;
                outline: none;
            }
            .lexisync-content-pane[contenteditable="true"]:focus {
                border-color: var(--primary);
                box-shadow: 0 0 0 3px var(--primary-soft);
            }
            .lexisync-corrections { padding: 0 14px 12px !important; }
            .lexisync-correction-row {
                background: var(--bg-secondary);
                border-color: var(--inner-border) !important;
                border-radius: 10px !important;
            }
            .lexisync-result-button {
                border: 1px solid var(--inner-border) !important;
                border-radius: 11px !important;
                background: var(--bg-secondary) !important;
                box-shadow: 0 4px 12px rgba(38, 40, 72, 0.06);
            }
            .lexisync-result-button--primary {
                color: #fff !important;
                background: linear-gradient(135deg, var(--primary), var(--primary-strong)) !important;
                border-color: transparent !important;
                box-shadow: 0 8px 18px color-mix(in srgb, var(--primary) 25%, transparent) !important;
            }
            .lexisync-result-button--primary:hover {
                filter: brightness(1.06);
                transform: translateY(-1px);
            }
            .lexisync-result-button--success {
                color: #166534 !important;
                background: #dcfce7 !important;
                border-color: rgba(22, 101, 52, .14) !important;
                box-shadow: 0 7px 16px rgba(22, 101, 52, .12) !important;
            }
            #lexisync-extension-ui[data-theme="dark"] .lexisync-result-button--success {
                color: #b9f6ce !important;
                background: #173f2b !important;
            }
            .lexisync-close-button:hover,
            .lexisync-cancel-button:hover { background: var(--hover-bg) !important; }

            .lexisync-skeleton {
                display: grid;
                gap: 9px;
                padding: 4px 0;
            }
            .lexisync-skeleton-line {
                height: 9px;
                overflow: hidden;
                background: var(--primary-soft);
                border-radius: 999px;
            }
            .lexisync-skeleton-line::after {
                display: block;
                width: 46%;
                height: 100%;
                content: "";
                background: linear-gradient(90deg, transparent, rgba(255,255,255,.62), transparent);
                animation: lexisync-shimmer 1.2s ease-in-out infinite;
            }
            .lexisync-skeleton-line:nth-child(2) { width: 88%; }
            .lexisync-skeleton-line:nth-child(3) { width: 64%; }
            @keyframes lexisync-shimmer { from { transform: translateX(-110%); } to { transform: translateX(240%); } }

            @media (prefers-reduced-motion: reduce) {
                #lexisync-extension-ui { animation-duration: 0.01ms; }
                .lexisync-loader, .lexisync-hourglass, .lexisync-skeleton-line::after { animation: none; }
                .lexisync-btn-action, .lexisync-translate-btn { transition: none !important; }
            }
        `;
        popupStyleText = style.textContent;
    }
}

function isPopupEvent(event: Event): boolean {
    return event.composedPath().some((node) => node === popupHost || node === popupUI);
}

function getPopupElementById<T extends HTMLElement>(id: string): T | null {
    return popupShadow?.getElementById(id) as T | null;
}

function createPopupElement(): HTMLElement {
    injectStyles();
    if (!popupHost && document.activeElement instanceof HTMLElement) previousFocus = document.activeElement;
    popupHost = document.createElement('div');
    popupHost.id = 'lexisync-shadow-host';
    popupHost.style.cssText = 'all: initial !important; position: fixed !important; inset: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; pointer-events: auto !important;';
    popupShadow = popupHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `:host { all: initial; } ${popupStyleText}`;
    popupShadow.appendChild(style);

    const popup = document.createElement('div');
    popup.id = 'lexisync-extension-ui';
    popup.style.pointerEvents = 'auto';
    popup.style.setProperty('zoom', String(currentInterfaceScale / 100));
    popupShadow.appendChild(popup);
    getPopupContainer().appendChild(popupHost);
    return popup;
}

function showToast(message: string): void {
    closePopup();
    popupUI = createPopupElement();
    applyThemeToPopup(popupUI);
    popupUI.dataset.surface = 'toast';
    popupUI.setAttribute('role', 'status');
    popupUI.setAttribute('aria-live', 'polite');
    popupUI.style.cssText = 'position:fixed !important; left:50% !important; top:24px !important; transform:translateX(-50%); max-width:360px; padding:12px 16px; background:var(--bg-primary); color:var(--text-primary); font:14px/1.45 system-ui,sans-serif; z-index:2147483647;';
    popupUI.textContent = message;
    const host = popupHost;
    setTimeout(() => {
        if (popupHost === host) closePopup();
    }, 4500);
}

function applyThemeToPopup(popup: HTMLElement): void {
    let isDark = currentTheme === 'dark' || (currentTheme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) popup.setAttribute('data-theme', 'dark');
    else popup.removeAttribute('data-theme');
}

function getPopupContainer(): HTMLElement {
    let container: HTMLElement = document.body;
    const activeEl = document.activeElement;
    if (activeEl && activeEl.closest('dialog')) {
        container = activeEl.closest('dialog') as HTMLElement;
    } else {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            let node = sel.anchorNode;
            if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
            if (node && (node as Element).closest('dialog')) container = (node as Element).closest('dialog') as HTMLElement;
        }
    }
    return container;
}

function saveSelectionState(fallbackText?: string): void {
    currentSelection = captureSelection(fallbackText);
}

function getSelectionCoords(): { x: number, y: number } {
    return readSelectionCoords(lastMouseX, lastMouseY);
}

function showToolbarMenu(x: number, y: number): void {
    closePopup(); injectStyles(); lastAnchorX = x; lastAnchorY = y;
    popupUI = createPopupElement();
    applyThemeToPopup(popupUI);
    popupUI.dataset.surface = 'toolbar';
    popupUI.setAttribute('role', 'toolbar');
    popupUI.setAttribute('aria-label', t('actionToolbar', 'Действия с выделенным текстом'));
    
    popupUI.addEventListener('mousedown', e => e.stopPropagation());
    popupUI.addEventListener('mouseup', e => e.stopPropagation());
    popupUI.addEventListener('click', e => e.stopPropagation());
    
    popupUI.style.cssText = `position: fixed !important; left: -9999px; top: -9999px; background: var(--bg-primary); z-index: 2147483647 !important; font-family: system-ui, sans-serif; font-size: 13px; color: var(--text-primary); display: flex; align-items: center; padding: 4px; gap: 2px;`;

    const createBtn = (icon: string, text: string, title: string, onClick: (e: MouseEvent, btn: HTMLButtonElement) => void) => {
        const btn = document.createElement('button'); btn.type = 'button'; 
        btn.className = 'lexisync-toolbar-button';
        const iconWrap = document.createElement('span');
        iconWrap.style.cssText = 'display:flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;color:var(--text-secondary);overflow:visible;';
        setIcon(iconWrap, icon);
        btn.appendChild(iconWrap);
        if (text) {
            const label = document.createElement('span');
            label.style.cssText = 'margin-left:6px;font-weight:500;';
            label.textContent = text;
            btn.appendChild(label);
        }
        btn.title = title;
        btn.style.cssText = `padding: 6px 8px; cursor: pointer; border-radius: 8px; display: flex; align-items: center; transition: background 0.15s; color: var(--text-primary); background: transparent; border: none; box-sizing: border-box; line-height: 1;`;
        btn.onmousedown = (e) => e.preventDefault(); 
        btn.onmouseover = () => btn.style.backgroundColor = 'var(--hover-bg)';
        btn.onmouseout = () => btn.style.backgroundColor = 'transparent';
        btn.onclick = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); onClick(e, btn); };
        return btn;
    };

    const divider = () => {
        const d = document.createElement('div');
        d.className = 'lexisync-toolbar-divider';
        d.style.cssText = `width: 1px; height: 16px; background: var(--border-color); margin: 0 2px;`;
        return d;
    };

    let searchIcon = ICONS.google;
    let searchUrl = 'https://www.google.com/search?q=';
    let searchTitle = t('searchGoogle', 'Искать в Google');
    if (currentSearchEngine === 'yandex') { searchIcon = ICONS.yandex; searchUrl = 'https://yandex.ru/search/?text='; searchTitle = t('searchYandex', 'Искать в Яндексе'); }
    else if (currentSearchEngine === 'duckduckgo') { searchIcon = ICONS.duckduckgo; searchUrl = 'https://duckduckgo.com/?q='; searchTitle = t('searchDuckDuckGo', 'Искать в DuckDuckGo'); }

    popupUI.appendChild(createBtn(searchIcon, '', searchTitle, () => { window.open(searchUrl + encodeURIComponent(currentSelection.text), '_blank'); closePopup(); }));
    popupUI.appendChild(divider());
    popupUI.appendChild(createBtn(ICONS.edit, t('editText', 'Редактировать'), t('textFunctions', 'Функции текста'), () => { showAIMenu(lastAnchorX, lastAnchorY); }));
    popupUI.appendChild(divider());
    popupUI.appendChild(createBtn(ICONS.copy, '', t('copy', 'Копировать'), (e, btn) => {
        navigator.clipboard.writeText(currentSelection.text);
        const iconWrap = document.createElement('span');
        iconWrap.style.cssText = 'display:flex;align-items:center;justify-content:center;width:16px;height:16px;';
        setIcon(iconWrap, ICONS.check);
        btn.replaceChildren(iconWrap);
        setTimeout(() => closePopup(), 1000);
    }));
    popupUI.appendChild(divider());

    const moreWrap = document.createElement('div');
    moreWrap.id = 'lexisync-more-btn-wrap';
    moreWrap.style.cssText = 'position: relative; display: flex; align-items: center;';

    const moreBtn = createBtn(ICONS.dots, '', t('moreOptions', 'Ещё опции'), () => {
        const dropdown = getPopupElementById<HTMLElement>('lexisync-more-dropdown');
        if (dropdown) {
            if (dropdown.style.display === 'flex') dropdown.style.display = 'none';
            else {
                dropdown.style.display = 'flex';
                const rect = dropdown.getBoundingClientRect();
                if (rect.bottom > window.innerHeight - 10) { dropdown.style.top = 'auto'; dropdown.style.bottom = '100%'; dropdown.style.marginTop = '0'; dropdown.style.marginBottom = '8px'; } 
                else { dropdown.style.top = '100%'; dropdown.style.bottom = 'auto'; dropdown.style.marginTop = '8px'; dropdown.style.marginBottom = '0'; }
            }
        }
    });
    moreWrap.appendChild(moreBtn);

    const moreDropdown = document.createElement('div');
    moreDropdown.id = 'lexisync-more-dropdown';
    moreDropdown.className = 'lexisync-dropdown';
    moreDropdown.style.cssText = `display: none; position: absolute; top: 100%; right: 0; margin-top: 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 16px 32px rgba(0,0,0,0.15); width: max-content; min-width: 120px; z-index: 9999; padding: 8px 0; flex-direction: column; overflow: hidden;`;

    const createDropdownItem = (icon: string, text: string, onClick: () => void) => {
        const item = document.createElement('div');
        item.className = 'lexisync-dropdown-item';
        const iconWrap = document.createElement('span');
        iconWrap.style.cssText = 'display:flex;align-items:center;justify-content:center;margin-right:12px;width:16px;height:16px;flex-shrink:0;';
        setIcon(iconWrap, icon);
        const label = document.createElement('span');
        label.style.fontWeight = '500';
        label.textContent = text;
        item.append(iconWrap, label);
        item.style.cssText = `padding: 10px 14px; font-size: 13px; cursor: pointer; display: flex; align-items: center; color: var(--text-primary); transition: background 0.15s; white-space: nowrap;`;
        item.onmousedown = (e) => e.preventDefault();
        item.onmouseover = () => item.style.backgroundColor = 'var(--hover-bg)';
        item.onmouseout = () => item.style.backgroundColor = 'transparent';
        item.onclick = (e) => { e.stopPropagation(); moreDropdown.style.display = 'none'; onClick(); };
        return item;
    };

    moreDropdown.appendChild(createDropdownItem(ICONS.translate, t('translate', 'Перевести'), () => handleActionClick('translate')));
    moreDropdown.appendChild(createDropdownItem(ICONS.keyboard, t('fixLayout', 'Исправить раскладку'), () => handleActionClick('layout')));
    moreDropdown.appendChild(createDropdownItem(ICONS.history, t('history', 'История'), () => { chrome.runtime.sendMessage({ action: "openHistory" }); closePopup(); }));

    moreWrap.appendChild(moreDropdown);
    popupUI.appendChild(moreWrap);
    popupUI.appendChild(divider());
    popupUI.appendChild(createBtn(ICONS.closeColored, '', t('closePanel', 'Закрыть панель'), () => closePopup()));

    adjustPopupPosition();
}

function showAIMenu(x: number, y: number): void {
    closePopup(); injectStyles(); lastAnchorX = x; lastAnchorY = y;
    popupUI = createPopupElement();
    applyThemeToPopup(popupUI);
    popupUI.dataset.surface = 'menu';
    popupUI.setAttribute('role', 'menu');
    popupUI.setAttribute('aria-label', t('aiMenu', 'AI-инструменты'));
    const menuPopup = popupUI;

    popupUI.addEventListener('mousedown', e => e.stopPropagation());
    popupUI.addEventListener('mouseup', e => e.stopPropagation());
    popupUI.addEventListener('click', e => e.stopPropagation());

    popupUI.style.cssText = `position: fixed !important; left: -9999px; top: -9999px; background: var(--bg-primary); z-index: 2147483647 !important; font-family: system-ui, sans-serif; font-size: 13px; color: var(--text-primary); width: 250px; padding: 7px;`;

    const menuLabel = document.createElement('div');
    menuLabel.className = 'lexisync-menu-label';
    menuLabel.textContent = t('aiTools', 'AI-инструменты');
    popupUI.appendChild(menuLabel);

    const createMenuBtn = (icon: string, text: string, onClick: () => void, shortcut?: string) => {
        const btn = document.createElement('button'); btn.type = 'button'; 
        btn.className = 'lexisync-menu-button';
        btn.setAttribute('role', 'menuitem');
        const main = document.createElement('div');
        main.style.cssText = 'display:flex;align-items:center;';
        const iconWrap = document.createElement('span');
        iconWrap.className = 'lexisync-menu-icon';
        iconWrap.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        setIcon(iconWrap, icon);
        const label = document.createElement('span');
        label.style.fontWeight = '600';
        label.textContent = text;
        main.append(iconWrap, label);
        btn.appendChild(main);
        if (shortcut) {
            const shortcutLabel = document.createElement('span');
            shortcutLabel.className = 'lexisync-shortcut';
            shortcutLabel.textContent = shortcut;
            btn.appendChild(shortcutLabel);
        }
        btn.style.cssText = `width: 100%; padding: 8px 12px; cursor: pointer; transition: background 0.15s; display: flex; align-items: center; justify-content: space-between; border-radius: 8px; color: var(--text-primary); background: transparent; border: none;`;
        btn.onmousedown = (e) => e.preventDefault();
        btn.onmouseover = () => btn.style.backgroundColor = 'var(--hover-bg)';
        btn.onmouseout = () => btn.style.backgroundColor = 'transparent';
        btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onClick(); };
        return btn;
    };

    popupUI.appendChild(createMenuBtn(ICONS.spell, t('fixErrors', 'Исправить ошибки'), () => handleActionClick('spellcheck'), 'Alt+R'));
    popupUI.appendChild(createMenuBtn(ICONS.style, t('rewriteText', 'Переписать текст'), () => handleActionClick('style'), 'Alt+Y'));
    popupUI.appendChild(createMenuBtn(ICONS.emoji, t('addEmoji', 'Подобрать эмодзи'), () => handleActionClick('emoji'), 'Alt+T'));

    void chrome.storage.local.get({ customCommands: [] }).then((stored) => {
        if (popupUI !== menuPopup || !Array.isArray(stored.customCommands) || stored.customCommands.length === 0) return;
        const customLabel = document.createElement('div');
        customLabel.className = 'lexisync-menu-label';
        customLabel.textContent = t('myCommands', 'Мои команды');
        menuPopup.appendChild(customLabel);
        for (const command of stored.customCommands.slice(0, 8) as CustomCommand[]) {
            if (!command?.id || !command.name || !command.prompt) continue;
            menuPopup.appendChild(createMenuBtn(ICONS.style, command.name, () => executeRequest('custom', command)));
        }
        adjustPopupPosition();
    });

    adjustPopupPosition();
}

function showRateLimitTimer(seconds: number, retryCallback: () => void, container: HTMLElement | null): void {
    let timeLeft = seconds;
    const render = () => {
        if (!container || !container.isConnected) return false;
        const message = document.createElement('div');
        message.style.cssText = 'padding:16px;font-weight:500;color:#b06000;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff8f0;border-radius:12px;border:1px solid #ffe8cc;margin:4px;';
        const icon = document.createElement('span');
        icon.className = 'lexisync-hourglass';
        setIcon(icon, ICONS.hourglass);
        const copy = document.createElement('span');
        copy.append(
            document.createTextNode(`${t('rateLimitRetry', 'Лимит. Автоповтор через')} `),
            Object.assign(document.createElement('b'), { textContent: String(timeLeft) }),
            document.createTextNode(` ${t('seconds', 'сек…')}`),
        );
        message.append(icon, copy);
        container.replaceChildren(message);
        adjustPopupPosition(); 
        return true;
    };
    if (!render()) return;
    const interval = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(interval);
            if (container && container.isConnected) retryCallback();
        } else {
            if (!render()) clearInterval(interval);
        }
    }, 1000);
}

function handleActionClick(mode: RequestMode): void {
    if (mode === 'translate') {
        const text = currentSelection.text || "";
        const ruCount = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
        const enCount = (text.match(/[a-zA-Z]/g) || []).length;
        currentTargetLang = (ruCount > 0 && ruCount >= enCount) ? getLanguageName('en') : getLanguageName('ru');
    }
    executeRequest(mode);
}

function executeRequest(mode: RequestMode, customCommand?: CustomCommand): void {
    if (!popupUI) return;
    const originalText = currentSelection.text;
    
    popupUI.dataset.surface = 'result';
    popupUI.setAttribute('role', 'dialog');
    popupUI.setAttribute('aria-label', t('resultDialog', 'Результат обработки текста'));
    popupUI.style.width = '340px';
    popupUI.style.padding = '0';
    popupUI.style.display = 'block';
    
    let headerLabel = '';
    let headerIcon = '';
    let headerEmoji = '';
    if (mode === 'spellcheck') headerLabel = t('spellcheckDone', 'Ошибки исправлены');
    else if (mode === 'style') { headerIcon = ICONS.style; headerLabel = t('styleChanged', 'Стиль изменён'); }
    else if (mode === 'emoji') { headerIcon = ICONS.emoji; headerLabel = t('emojiVariants', 'Варианты с эмодзи'); }
    else if (mode === 'layout') { headerIcon = ICONS.keyboard; headerLabel = t('layoutFixed', 'Раскладка исправлена'); }
    else if (mode === 'translate') headerLabel = t('translation', 'Перевод');
    else if (mode === 'ocr') { headerEmoji = '📸'; headerLabel = t('ocrResult', 'Распознанный текст'); }
    else if (mode === 'custom') { headerIcon = ICONS.style; headerLabel = customCommand?.name || t('myCommand', 'Моя команда'); }
    
    const header = document.createElement('div');
    header.className = 'lexisync-header';
    header.style.cssText = 'padding: 12px 16px; font-size: 14px; color: var(--text-primary); border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; border-radius: 12px 12px 0 0; background: transparent; cursor: grab; user-select: none;';
    
    header.onmousedown = (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('svg') || target.closest('div[style*="cursor: pointer"]') || target.closest('#lexisync-lang-label')) return;
        isDragging = true;
        isManuallyPositioned = true; 
        header.style.cursor = 'grabbing';
        const rect = popupUI!.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        e.preventDefault();
    };

    const headerTitleWrapper = document.createElement('div');
    headerTitleWrapper.className = 'lexisync-header-title';
    headerTitleWrapper.style.cssText = 'display: flex; align-items: center; gap: 8px; font-weight: 600; pointer-events: none;';
    
    if (mode === "translate") {
        headerTitleWrapper.style.pointerEvents = 'auto'; 
        const langWrap = document.createElement('div');
        langWrap.style.cssText = 'display: flex; align-items: center; gap: 4px; cursor: pointer; position: relative; user-select: none; padding: 6px 10px; margin-left: -10px; border-radius: 8px; transition: background 0.15s;';
        const languageLabel = document.createElement('span');
        languageLabel.id = 'lexisync-lang-label';
        languageLabel.textContent = currentTargetLang;
        const chevron = document.createElement('span');
        chevron.style.marginTop = '2px';
        setIcon(chevron, ICONS.chevronDown);
        langWrap.append(languageLabel, chevron);
        langWrap.onmouseover = () => langWrap.style.background = 'var(--hover-bg)';
        langWrap.onmouseout = () => langWrap.style.background = 'transparent';
        
        const langDropdown = document.createElement('div');
        langDropdown.className = 'lexisync-scroll';
        langDropdown.style.cssText = 'display: none; position: absolute; top: 100%; left: -4px; margin-top: 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 12px 24px var(--shadow-color); flex-direction: column; min-width: 140px; z-index: 9999; padding: 8px 0; max-height: 220px; overflow-y: auto; font-weight: normal;';
        
        const popularLangs = ['en', 'ru', 'de', 'fr', 'es', 'it', 'pl', 'zh', 'tr', 'ja'].map(getLanguageName);
        
        popularLangs.forEach(lang => {
            const langItem = document.createElement('div');
            langItem.textContent = lang;
            langItem.style.cssText = `padding: 10px 16px; font-size: 13px; cursor: pointer; transition: background 0.1s; color: var(--text-primary);`;
            if (lang === currentTargetLang) { langItem.style.background = 'var(--hover-bg)'; langItem.style.fontWeight = '600'; }
            langItem.onmouseover = () => { if(lang !== currentTargetLang) langItem.style.background = 'var(--hover-bg)'; };
            langItem.onmouseout = () => { if(lang !== currentTargetLang) langItem.style.background = 'transparent'; };
            langItem.onclick = (e) => {
                e.stopPropagation();
                langDropdown.style.display = 'none';
                if (lang !== currentTargetLang) {
                    currentTargetLang = lang;
                    const languageLabel = getPopupElementById<HTMLElement>('lexisync-lang-label');
                    if (languageLabel) languageLabel.textContent = lang;
                    if (streamPort) streamPort.disconnect(); 
                    startStream(); 
                }
            };
            langDropdown.appendChild(langItem);
        });

        langWrap.appendChild(langDropdown);
        langWrap.onclick = (e) => { e.stopPropagation(); langDropdown.style.display = langDropdown.style.display === 'flex' ? 'none' : 'flex'; };
        headerTitleWrapper.appendChild(langWrap);
    } else {
        if (headerIcon) headerTitleWrapper.appendChild(createSvgIcon(headerIcon));
        if (headerEmoji) headerTitleWrapper.appendChild(document.createTextNode(headerEmoji));
        headerTitleWrapper.appendChild(document.createTextNode(headerLabel));
    }

    const loaderOrClose = document.createElement('div');
    const initialLoader = document.createElement('div');
    initialLoader.className = 'lexisync-loader';
    loaderOrClose.appendChild(initialLoader);
    
    header.appendChild(headerTitleWrapper);
    header.appendChild(loaderOrClose);
    
    const contentPane = document.createElement('div');
    contentPane.className = 'lexisync-scroll lexisync-content-pane';
    contentPane.style.cssText = 'padding: 16px; min-height: 50px; max-height: 50vh; overflow-y: auto; overflow-x: hidden; font-size: 14px; color: var(--text-primary); line-height: 1.6; font-family: system-ui, sans-serif; word-wrap: break-word; white-space: pre-wrap;';
    
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'lexisync-actions';
    actionsContainer.style.cssText = 'display: none; padding: 0 16px 16px 16px; gap: 10px; align-items: center; justify-content: flex-start;';

    const correctionsContainer = document.createElement('div');
    correctionsContainer.className = 'lexisync-corrections';
    correctionsContainer.style.cssText = 'display:none; padding:0 16px 12px; gap:6px; flex-direction:column;';

    const resultTools = document.createElement('div');
    resultTools.className = 'lexisync-result-tools';
    
    popupUI.replaceChildren();
    popupUI.appendChild(header);
    popupUI.appendChild(contentPane);
    popupUI.appendChild(correctionsContainer);
    popupUI.appendChild(resultTools);
    popupUI.appendChild(actionsContainer);
    adjustPopupPosition();

    let fullResult = "";
    let comparisonOriginalVisible = false;
    let editedResultSnapshot = '';
    let streamPort: chrome.runtime.Port | null = null;
    let usePageContext = false;
    let storageAllowed = false;
    let cacheSettingsFingerprint = 'default';
    let savedHistoryId: number | null = null;
    let wordCorrections: WordCorrection[] = [];
    const rejectedCorrections = new Set<number>();

    function getCacheSource(): string {
        return usePageContext
            ? `${currentSelection.text}\ncontext:${currentSelection.context}`
            : currentSelection.text;
    }

    function getEffectiveResult(): string {
        if (comparisonOriginalVisible && editedResultSnapshot) return editedResultSnapshot;
        if (contentPane.contentEditable === 'true') return contentPane.innerText.trim();
        const clean = fullResult.replace(/\*/g, '');
        return mode === 'spellcheck'
            ? resolveCorrections(clean, wordCorrections, rejectedCorrections)
            : clean;
    }

    function refreshSpellcheck(): void {
        if (mode !== 'spellcheck') return;
        contentPane.replaceChildren(renderSpellcheckDiffFragment(currentSelection.text, fullResult, rejectedCorrections));
        renderCorrectionControls();
    }

    async function addToDictionary(word: string): Promise<void> {
        const data = await chrome.storage.local.get({ personalDictionary: [] });
        const dictionary = Array.isArray(data.personalDictionary) ? data.personalDictionary.map(String) : [];
        if (!dictionary.some((item) => item.toLocaleLowerCase('ru-RU') === word.toLocaleLowerCase('ru-RU'))) {
            dictionary.push(word);
            await chrome.storage.local.set({ personalDictionary: dictionary.sort((a, b) => a.localeCompare(b, 'ru')) });
        }
    }

    function toggleCorrection(correction: WordCorrection): void {
        if (rejectedCorrections.has(correction.tokenIndex)) rejectedCorrections.delete(correction.tokenIndex);
        else rejectedCorrections.add(correction.tokenIndex);
        refreshSpellcheck();
        if (storageAllowed && savedHistoryId !== null) {
            void updateHistoryItemResult(savedHistoryId, getEffectiveResult());
        }
    }

    function renderCorrectionControls(): void {
        correctionsContainer.replaceChildren();
        correctionsContainer.style.display = wordCorrections.length > 0 ? 'flex' : 'none';
        for (const correction of wordCorrections) {
            const row = document.createElement('div');
            row.className = 'lexisync-correction-row';
            row.style.cssText = 'display:flex; align-items:center; gap:7px; padding:7px 9px; border:1px solid var(--border-color); border-radius:8px; font-size:12px;';
            const label = document.createElement('span');
            label.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            label.textContent = `${correction.original} → ${correction.corrected}`;
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.textContent = rejectedCorrections.has(correction.tokenIndex) ? t('restoreCorrection', 'Вернуть') : t('correctionAccepted', 'Принято');
            choice.title = rejectedCorrections.has(correction.tokenIndex) ? t('acceptAgain', 'Снова принять исправление') : t('keepOriginal', 'Оставить исходное слово');
            choice.style.cssText = 'border:0; border-radius:6px; padding:5px 7px; cursor:pointer; background:var(--bg-secondary); color:var(--text-primary);';
            choice.onclick = () => toggleCorrection(correction);
            const dictionary = document.createElement('button');
            dictionary.type = 'button';
            dictionary.textContent = t('addDictionary', '+ Словарь');
            dictionary.title = t('dictionaryFuture', 'Не исправлять это слово в будущем');
            dictionary.style.cssText = choice.style.cssText;
            dictionary.onclick = async () => {
                await addToDictionary(correction.original);
                rejectedCorrections.add(correction.tokenIndex);
                dictionary.textContent = t('added', 'Добавлено');
                dictionary.disabled = true;
                refreshSpellcheck();
                if (storageAllowed && savedHistoryId !== null) {
                    void updateHistoryItemResult(savedHistoryId, getEffectiveResult());
                }
            };
            row.append(label, choice, dictionary);
            correctionsContainer.appendChild(row);
        }
    }

    contentPane.addEventListener('click', (event) => {
        const mark = (event.target as HTMLElement).closest('mark[data-token-index]') as HTMLElement | null;
        const tokenIndex = Number(mark?.dataset.tokenIndex);
        const correction = wordCorrections.find((item) => item.tokenIndex === tokenIndex);
        if (correction) toggleCorrection(correction);
    });
    contentPane.addEventListener('input', () => {
        if (storageAllowed && savedHistoryId !== null && contentPane.contentEditable === 'true') {
            void updateHistoryItemResult(savedHistoryId, getEffectiveResult());
        }
    });

    function renderLoadingControl(): void {
        loaderOrClose.replaceChildren();
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; align-items:center; gap:8px;';
        const loader = document.createElement('div');
        loader.className = 'lexisync-loader';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'lexisync-cancel-button';
        cancelBtn.title = t('cancelRequest', 'Отменить запрос');
        cancelBtn.setAttribute('aria-label', t('cancelRequest', 'Отменить запрос'));
        setIcon(cancelBtn, ICONS.closeStandard);
        cancelBtn.style.cssText = 'display:flex; align-items:center; justify-content:center; padding:4px; border:0; border-radius:6px; background:transparent; color:var(--text-secondary); cursor:pointer;';
        cancelBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            cancelBtn.disabled = true;
            contentPane.textContent = t('cancelling', 'Отменяем запрос…');
            streamPort?.postMessage({ action: 'cancelMistral' });
        };
        wrapper.append(loader, cancelBtn);
        loaderOrClose.appendChild(wrapper);
    }

    function startStream() {
        streamPort?.disconnect();
        streamPort = null;
        fullResult = "";
        comparisonOriginalVisible = false;
        editedResultSnapshot = '';
        contentPane.contentEditable = 'false';
        contentPane.removeAttribute('contenteditable');
        resultTools.style.display = 'none';
        const skeleton = document.createElement('div');
        skeleton.className = 'lexisync-skeleton';
        skeleton.setAttribute('role', 'status');
        skeleton.setAttribute('aria-label', t('processing', 'LexiSync обрабатывает текст'));
        for (let index = 0; index < 3; index++) {
            const line = document.createElement('span');
            line.className = 'lexisync-skeleton-line';
            skeleton.appendChild(line);
        }
        contentPane.replaceChildren(skeleton);
        contentPane.style.color = '';
        actionsContainer.style.display = 'none';
        renderLoadingControl();
        
        if (!navigator.onLine) {
            contentPane.textContent = t('offlineError', 'Нет подключения к интернету. Проверьте сеть и попробуйте снова.');
            contentPane.style.color = '#d32f2f';
            finishStream(false);
            return;
        }

        if (currentSelection.text.length > 3000) {
            contentPane.textContent = t('textTooLong', 'Текст слишком длинный. Выделите не более 3000 символов за раз.');
            contentPane.style.color = '#d32f2f';
            finishStream(false);
            return;
        }

        if (!chrome.runtime || !chrome.runtime.connect) {
            contentPane.textContent = t('reloadPage', 'Пожалуйста, обновите страницу (F5).');
            contentPane.style.color = '#d32f2f';
            return;
        }

        streamPort = chrome.runtime.connect({ name: "mistralStream" });
        streamPort.postMessage({ 
            action: "callMistral",
            text: currentSelection.text, 
            context: currentSelection.context, 
            mode: mode, 
            targetLang: currentTargetLang, 
            pageTitle: document.title, 
            pageUrl: window.location.hostname,
            allowPageContext: usePageContext,
            customPrompt: customCommand?.prompt,
            imageUrl: currentSelection.imageUrl // 🔥 НОВОЕ
        });        
        streamPort.onMessage.addListener((response: StreamResponse) => {
            if (response.status === "chunk") {
                fullResult += response.text;
                renderMarkdown(contentPane, fullResult);
                contentPane.setAttribute('aria-live', 'polite');
                contentPane.scrollTop = contentPane.scrollHeight; 
                adjustPopupPosition();

            } else if (response.status === "done") {
                if (mode === 'spellcheck') {
                    fullResult = normalizeSpellcheckResult(fullResult);
                    wordCorrections = getWordCorrections(currentSelection.text, fullResult);
                    refreshSpellcheck();
                } else {
                    renderMarkdown(contentPane, fullResult);
                }
                contentPane.removeAttribute('aria-live');
                finishStream();

                
                const historyItem: HistoryItem = {
                    id: Date.now(),
                    mode,
                    original: currentSelection.text,
                    result: getEffectiveResult(),
                    date: new Date().toISOString(),
                    customName: customCommand?.name,
                };

                if (storageAllowed) {
                    const baseCacheMode = mode === 'translate' ? mode + currentTargetLang : mode === 'custom' ? `custom:${customCommand?.id || 'unknown'}` : mode;
                    const cacheModeKey = `${baseCacheMode}:${cacheSettingsFingerprint}`;
                    void getCacheHash(cacheModeKey, getCacheSource())
                        .then((cacheKey) => setCachedText(cacheKey, fullResult))
                        .catch((error) => console.error('Ошибка сохранения кэша:', error));
                    void addHistoryItem(historyItem).then(async () => {
                        savedHistoryId = historyItem.id;
                        await updateHistoryItemResult(historyItem.id, getEffectiveResult());
                    });
                }

            } else if (response.status === "error") {
                const errorMessage = typeof response.error === 'string' ? response.error : t('unknownError', 'Неизвестная ошибка.');
                if (errorMessage.toLowerCase().includes('rate limit') || errorMessage.toLowerCase().includes('лимит') || errorMessage.includes('429')) {
                    showRateLimitTimer(5, startStream, contentPane);
                } else {
                    contentPane.textContent = `${t('errorPrefix', 'Ошибка:')} ${errorMessage}`;
                    contentPane.style.color = '#d32f2f';
                }
                finishStream(false);
            } else if (response.status === 'cancelled') {
                contentPane.textContent = t('requestCancelled', 'Запрос отменён.');
                contentPane.style.color = 'var(--text-secondary)';
                finishStream(false);
            }
        });
    }

    function finishStream(success = true) {
        streamPort?.disconnect();
        streamPort = null;
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'lexisync-close-button';
        closeBtn.setAttribute('aria-label', t('closePanel', 'Закрыть панель'));
        setIcon(closeBtn, ICONS.closeStandard);
        closeBtn.style.cssText = 'cursor: pointer; display: flex; align-items: center; margin-right: -4px; padding: 6px; border-radius: 8px; color: var(--text-secondary); transition: background 0.15s;';
        closeBtn.onmouseover = () => closeBtn.style.background = 'var(--hover-bg)';
        closeBtn.onmouseout = () => closeBtn.style.background = 'transparent';
        closeBtn.onclick = closePopup;
        loaderOrClose.replaceChildren();
        loaderOrClose.appendChild(closeBtn);

        if (success && fullResult.trim().length > 0) {
            if (mode !== 'spellcheck' && mode !== 'ocr') {
                contentPane.contentEditable = 'true';
                contentPane.setAttribute('aria-label', t('editableResult', 'Результат можно редактировать'));
                resultTools.style.display = 'flex';
                editedResultSnapshot = getEffectiveResult();
                const createTool = (label: string, action: () => void): HTMLButtonElement => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'lexisync-tool-chip';
                    button.textContent = label;
                    button.onclick = action;
                    return button;
                };
                const compareButton = createTool(t('beforeAfter', 'До / После'), () => {
                    if (!comparisonOriginalVisible) {
                        editedResultSnapshot = getEffectiveResult();
                        contentPane.contentEditable = 'false';
                        contentPane.textContent = originalText;
                        compareButton.textContent = t('showResult', 'Показать результат');
                    } else {
                        contentPane.textContent = editedResultSnapshot;
                        contentPane.contentEditable = 'true';
                        compareButton.textContent = t('beforeAfter', 'До / После');
                    }
                    comparisonOriginalVisible = !comparisonOriginalVisible;
                });
                const refine = (name: string, prompt: string) => {
                    const source = getEffectiveResult();
                    currentSelection.text = source;
                    currentSelection.context = source;
                    executeRequest('custom', { id: `refine-${name}`, name, prompt });
                };
                resultTools.replaceChildren(
                    compareButton,
                    createTool(t('repeat', 'Повторить'), () => executeRequest(mode, customCommand)),
                    createTool(t('shorter', 'Короче'), () => refine(t('refineShortName', 'Сделать короче'), t('presetShortPrompt', 'Сократи текст, сохранив ключевые факты и исходный смысл.'))),
                    createTool(t('longer', 'Подробнее'), () => refine(t('refineLongName', 'Сделать подробнее'), t('refineLongPrompt', 'Раскрой текст подробнее, добавив полезные пояснения без лишней воды.'))),
                    createTool(t('moreFormal', 'Формальнее'), () => refine(t('refineFormalName', 'Сделать формальнее'), t('refineFormalPrompt', 'Перепиши текст в более формальном и профессиональном стиле.'))),
                );
            }
            actionsContainer.style.display = 'flex';
            actionsContainer.replaceChildren();
            
            
            const btnClass = (mode === 'translate' || mode === 'layout') ? 'lexisync-translate-btn' : 'lexisync-btn-action';
            const replaceIcon = (mode === 'translate' || mode === 'layout') ? ICONS.replaceCurved : ICONS.replace;
            const copyIcon = (mode === 'translate' || mode === 'layout') ? ICONS.copyStandard : ICONS.copy;
            
            const replaceBtn = document.createElement('button');
            replaceBtn.type = 'button'; 
            replaceBtn.className = `${btnClass} lexisync-result-button lexisync-result-button--primary`;
            appendIconAndText(replaceBtn, replaceIcon, t('replaceText', 'Заменить текст'));
            // ✅ НОВАЯ ЛОГИКА (ВСТАВИТЬ)
            replaceBtn.onclick = (e) => { 
                e.preventDefault();
                e.stopPropagation();

                const undo = replaceSelectedText(currentSelection, getEffectiveResult());

                // Делаем красивую анимацию кнопки
                appendIconAndText(replaceBtn, ICONS.check, t('replaced', 'Заменено!'));
                replaceBtn.classList.add('lexisync-result-button--success');
                replaceBtn.style.backgroundColor = '#dcfce7';
                replaceBtn.style.color = '#166534';
                replaceBtn.style.fontWeight = '600';

                if (undo) {
                    const undoBtn = document.createElement('button');
                    undoBtn.type = 'button';
                    undoBtn.className = `${btnClass} lexisync-result-button`;
                    undoBtn.textContent = t('undoReplacement', 'Отменить замену');
                    undoBtn.onclick = () => {
                        undo();
                        undoBtn.remove();
                        replaceBtn.disabled = false;
                        replaceBtn.classList.remove('lexisync-result-button--success');
                        appendIconAndText(replaceBtn, replaceIcon, t('replaceText', 'Заменить текст'));
                    };
                    actionsContainer.appendChild(undoBtn);
                }
                replaceBtn.disabled = true;
            };

            if (mode === 'ocr') {
                navigator.clipboard.writeText(getEffectiveResult());
                const copied = document.createElement('span');
                copied.style.cssText = 'display:flex;align-items:center;gap:8px;color:#166534;';
                appendIconAndText(copied, ICONS.check, t('copied', 'Текст скопирован!'));
                headerTitleWrapper.replaceChildren(copied);
            }

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button'; 
            copyBtn.className = `${btnClass} lexisync-result-button icon-only`;
            setIcon(copyBtn, copyIcon);
            copyBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText(getEffectiveResult());
                setIcon(copyBtn, ICONS.check);
                setTimeout(() => setIcon(copyBtn, copyIcon), 1500);
            };

            actionsContainer.appendChild(replaceBtn);
            actionsContainer.appendChild(copyBtn);
        }
        adjustPopupPosition();
    }

    async function checkCacheAndRun() {
        const res = await chrome.runtime.sendMessage({ action: 'getRuntimeSettings' }) as {
            hasApiKey?: boolean;
            sendPageContext?: boolean;
            contextDisabledSites?: unknown;
            cacheFingerprint?: string;
        };
            usePageContext = res.sendPageContext === true
                && !isSiteDisabled(location.hostname, normalizeDisabledSites(res.contextDisabledSites));
            cacheSettingsFingerprint = res.cacheFingerprint || 'default';
            storageAllowed = await shouldStoreOnCurrentPage();
            if (!res.hasApiKey && mode !== 'layout') {
                const emptyState = document.createElement('div');
                emptyState.style.cssText = 'text-align:center;padding:24px 16px;';
                const keyIcon = document.createElement('span');
                keyIcon.style.cssText = 'font-size:32px;display:block;margin-bottom:12px;';
                keyIcon.textContent = '🔑';
                const title = document.createElement('div');
                title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:8px;';
                title.textContent = t('apiKeyMissing', 'API-ключ не настроен');
                const countdown = document.createElement('div');
                countdown.style.cssText = 'color:var(--text-secondary);margin-bottom:16px;font-size:13px;';
                const timerSpan = document.createElement('span');
                timerSpan.id = 'redirectTimer';
                timerSpan.style.cssText = 'font-weight:bold;color:var(--primary);';
                timerSpan.textContent = '3';
                countdown.append(document.createTextNode(`${t('openingSettings', 'Открываем настройки через')} `), timerSpan, document.createTextNode('…'));
                const openButton = document.createElement('button');
                openButton.id = 'openSettingsBtn';
                openButton.type = 'button';
                openButton.style.cssText = 'background:var(--primary);color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:500;';
                openButton.textContent = t('openSettingsNow', 'Открыть сейчас');
                emptyState.append(keyIcon, title, countdown, openButton);
                contentPane.replaceChildren(emptyState);
                
                let timeLeft = 3;
                const interval = setInterval(() => {
                    timeLeft--;
                    if (timerSpan) timerSpan.textContent = timeLeft.toString();
                    if (timeLeft <= 0) {
                        clearInterval(interval);
                        chrome.runtime.sendMessage({ action: "openOptionsPage" });
                        closePopup();
                    }
                }, 1000);

                openButton.addEventListener('click', () => {
                    clearInterval(interval);
                    chrome.runtime.sendMessage({ action: 'openOptionsPage' });
                    closePopup();
                });
                return;
            }

            if (mode === 'ocr') {
                startStream();
                return;
            }

            const baseCacheMode = mode === 'translate' ? mode + currentTargetLang : mode === 'custom' ? `custom:${customCommand?.id || 'unknown'}` : mode;
            const cacheModeKey = `${baseCacheMode}:${cacheSettingsFingerprint}`;
            const cacheKey = await getCacheHash(cacheModeKey, getCacheSource());
            const cachedResult = storageAllowed ? await getCachedText(cacheKey) : null;
            if (cachedResult) {
                void recordCacheHit();
                fullResult = mode === 'spellcheck'
                    ? normalizeSpellcheckResult(cachedResult)
                    : cachedResult;
                if (mode === 'spellcheck') wordCorrections = getWordCorrections(currentSelection.text, fullResult);
                if (mode === 'spellcheck') {
                    contentPane.replaceChildren(renderSpellcheckDiffFragment(currentSelection.text, fullResult));
                } else {
                    renderMarkdown(contentPane, fullResult);
                }
                renderCorrectionControls();
                finishStream(true);
            } else {
                startStream();
            }
    }

    checkCacheAndRun();
}


function adjustPopupPosition(): void {
    if (!popupUI || isManuallyPositioned) return;
    const rect = popupUI.getBoundingClientRect();
    let absoluteLeft = lastAnchorX;
    let absoluteTop = lastAnchorY + 6; 
    let viewportX = absoluteLeft;
    let viewportY = absoluteTop;

    if (viewportX + rect.width > window.innerWidth - 20) viewportX = window.innerWidth - rect.width - 20;
    if (viewportX < 20) viewportX = 20;
    if (viewportY + rect.height > window.innerHeight - 20) viewportY = lastAnchorY - rect.height - 6; 
    if (viewportY < 20) viewportY = 20;

    popupUI.style.left = `${viewportX}px`;
    popupUI.style.top = `${viewportY}px`;
}

function closePopup(): void {
    if (popupUI) {
        isManuallyPositioned = false;
        isDragging = false;
        const el = popupUI;
        const host = popupHost;
        popupUI = null; 
        popupHost = null;
        popupShadow = null;
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        setTimeout(() => host?.remove(), 150);
        previousFocus?.focus({ preventScroll: true });
        previousFocus = null;
    }
}

initializeOcrOverlay({
    isEnabled: () => extensionEnabledOnSite,
    onImage: (imageUrl, rect) => {
        currentSelection = { text: t('extractingText', 'Извлекаем текст…'), context: '', range: null, activeElement: null, start: null, end: null, isInput: false, imageUrl };
        lastAnchorX = rect.left + rect.width / 2;
        lastAnchorY = rect.bottom + 10;
        closePopup();
        injectStyles();
        popupUI = createPopupElement();
        applyThemeToPopup(popupUI);
        popupUI.style.cssText = 'position:fixed!important;left:-9999px;top:-9999px;background:var(--bg-primary);z-index:2147483647!important;font-family:system-ui,sans-serif;font-size:13px;color:var(--text-primary);';
        executeRequest('ocr');
    },
});
