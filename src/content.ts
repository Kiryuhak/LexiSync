import { ICONS } from './icons';
import { getCachedText, getCacheHash, setCachedText } from './ai-cache';
import { initializeAdaptiveSuggestions } from './adaptive-suggestions';
import { addHistoryItem, updateHistoryItemResult } from './history-store';
import { shouldStoreOnCurrentPage } from './privacy';
import { getWordCorrections, normalizeSpellcheckResult, renderSpellcheckDiff, resolveCorrections, type WordCorrection } from './spellcheck';
import { replaceSelectedText } from './text-replacement';
import type { HistoryItem, RequestMode, SelectionData, StreamResponse } from './types';

initializeAdaptiveSuggestions();

let currentSelection: SelectionData = { text: "", context: "", range: null, activeElement: null, start: null, end: null, isInput: false };
let popupUI: HTMLElement | null = null;
let popupHost: HTMLElement | null = null;
let popupShadow: ShadowRoot | null = null;
let popupStyleText = '';
let currentTargetLang: string = "Английский"; 
let currentTheme: string = 'auto';
let currentSearchEngine: string = 'google';
let currentInterfaceScale: number = 90;

let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let isManuallyPositioned = false;

let lastMouseX = 0;
let lastMouseY = 0;

// УТИЛИТА 2: безопасный парсер ограниченного Markdown
function parseMarkdownToHTML(text: string): string {
    // Никогда не вставляем HTML модели напрямую в страницу.
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // 3. Парсим двойные звездочки в красивую зеленую подсветку
    html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<mark>$1</mark>'); 
    if (html.includes('**')) html = html.replace(/\*\*([^*]*)$/, '<mark>$1</mark>'); 
    html = html.replace(/\*/g, ''); // Удаляем случайные одиночные звездочки
    
    // 4. Парсим списки
    html = html.replace(/^- (.*)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\.\s(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>(\n<li>.*<\/li>)*)/g, '<ul style="margin: 8px 0; padding-left: 20px;">$1</ul>');
    
    // 5. Оставшиеся переносы строк делаем абзацами
    html = html.replace(/\n/g, '<br>');
    return html;
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
                        showToast('Текст не найден. В Google Docs выделите текст, нажмите Ctrl+C и повторите горячую клавишу.');
                        return;
                    }
                } catch (err) {
                    showToast('Нет доступа к буферу обмена. Кликните по документу и попробуйте снова.');
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
});

document.addEventListener('mousemove', (e: MouseEvent) => {
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
                        showToast('Текст не найден. В Google Docs выделите текст, нажмите Ctrl+C и повторите горячую клавишу.');
                        return;
                    }
                } catch (err) {
                    showToast('Не удалось прочитать буфер обмена. Разрешите доступ и попробуйте снова.');
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

function getSelectedText(): string {
    const activeEl = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
    if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
        try {
            if (activeEl.selectionStart !== null && activeEl.selectionEnd !== null) {
                return activeEl.value.substring(activeEl.selectionStart, activeEl.selectionEnd);
            }
        } catch(e) {}
    }
    return window.getSelection()?.toString() || "";
}

function saveSelectionState(fallbackText?: string): void {
    const activeEl = document.activeElement;
    const sel = window.getSelection();
    currentSelection = { text: "", context: "", range: null, activeElement: null, start: null, end: null, isInput: false };

    if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
        const inputEl = activeEl as HTMLInputElement | HTMLTextAreaElement;
        currentSelection.isInput = true;
        currentSelection.activeElement = inputEl;
        try {
            currentSelection.start = inputEl.selectionStart;
            currentSelection.end = inputEl.selectionEnd;
            currentSelection.text = inputEl.value.substring(currentSelection.start || 0, currentSelection.end || 0);
        } catch(e) {}
        
        if (!currentSelection.text && fallbackText) currentSelection.text = fallbackText;
        const val = inputEl.value || "";
        const start = currentSelection.start || 0;
        const end = currentSelection.end || 0;
        currentSelection.context = val.substring(Math.max(0, start - 1000), Math.min(val.length, end + 1000));
    } else {
        if (sel && sel.rangeCount > 0) {
            currentSelection.range = sel.getRangeAt(0).cloneRange();
            const container = document.createElement('div');
            container.appendChild(currentSelection.range.cloneContents());
            currentSelection.text = sel.toString() || container.textContent || '';
        }
        if (!currentSelection.text && fallbackText) currentSelection.text = fallbackText;
        let blockText = currentSelection.text;
        if (sel && sel.anchorNode) {
            let node: HTMLElement | null = sel.anchorNode.parentElement;
            while (node && window.getComputedStyle(node).display === 'inline') node = node.parentElement;
            if (node) blockText = node.innerText || node.textContent || currentSelection.text;
        }
        if (blockText && blockText.length > 2000) {
            const idx = blockText.indexOf(currentSelection.text);
            if (idx !== -1) currentSelection.context = blockText.substring(Math.max(0, idx - 1000), Math.min(blockText.length, idx + currentSelection.text.length + 1000));
            else currentSelection.context = currentSelection.text;
        } else {
            currentSelection.context = blockText || currentSelection.text;
        }
    }
}

function getSelectionCoords(): { x: number, y: number } {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        return { x: rect.left, y: rect.bottom };
    }
    return { x: lastMouseX || window.innerWidth / 2, y: lastMouseY || window.innerHeight / 2 };
}

function showToolbarMenu(x: number, y: number): void {
    closePopup(); injectStyles(); lastAnchorX = x; lastAnchorY = y;
    popupUI = createPopupElement();
    applyThemeToPopup(popupUI);
    popupUI.dataset.surface = 'toolbar';
    
    popupUI.addEventListener('mousedown', e => e.stopPropagation());
    popupUI.addEventListener('mouseup', e => e.stopPropagation());
    popupUI.addEventListener('click', e => e.stopPropagation());
    
    popupUI.style.cssText = `position: fixed !important; left: -9999px; top: -9999px; background: var(--bg-primary); z-index: 2147483647 !important; font-family: system-ui, sans-serif; font-size: 13px; color: var(--text-primary); display: flex; align-items: center; padding: 4px; gap: 2px;`;

    const createBtn = (icon: string, text: string, title: string, onClick: (e: MouseEvent, btn: HTMLButtonElement) => void) => {
        const btn = document.createElement('button'); btn.type = 'button'; 
        btn.className = 'lexisync-toolbar-button';
        btn.innerHTML = `<span style="display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex-shrink: 0; color: var(--text-secondary); overflow: visible;">${icon}</span>${text ? `<span style="margin-left: 6px; font-weight: 500;">${text}</span>` : ''}`;
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
    let searchTitle = 'Искать в Google';
    if (currentSearchEngine === 'yandex') { searchIcon = ICONS.yandex; searchUrl = 'https://yandex.ru/search/?text='; searchTitle = 'Искать в Яндексе'; } 
    else if (currentSearchEngine === 'duckduckgo') { searchIcon = ICONS.duckduckgo; searchUrl = 'https://duckduckgo.com/?q='; searchTitle = 'Искать в DuckDuckGo'; }

    popupUI.appendChild(createBtn(searchIcon, '', searchTitle, () => { window.open(searchUrl + encodeURIComponent(currentSelection.text), '_blank'); closePopup(); }));
    popupUI.appendChild(divider());
    popupUI.appendChild(createBtn(ICONS.edit, 'Редактировать', 'Функции текста', () => { showAIMenu(lastAnchorX, lastAnchorY); }));
    popupUI.appendChild(divider());
    popupUI.appendChild(createBtn(ICONS.copy, '', 'Копировать', (e, btn) => {
        navigator.clipboard.writeText(currentSelection.text);
        btn.innerHTML = `<span style="display: flex; align-items: center; justify-content: center; width:16px; height:16px;">${ICONS.check}</span>`;
        setTimeout(() => closePopup(), 1000);
    }));
    popupUI.appendChild(divider());

    const moreWrap = document.createElement('div');
    moreWrap.id = 'lexisync-more-btn-wrap';
    moreWrap.style.cssText = 'position: relative; display: flex; align-items: center;';

    const moreBtn = createBtn(ICONS.dots, '', 'Ещё опции', () => {
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
        item.innerHTML = `<span style="display:flex; align-items: center; justify-content: center; margin-right: 12px; width: 16px; height: 16px; flex-shrink: 0;">${icon}</span> <span style="font-weight: 500;">${text}</span>`;
        item.style.cssText = `padding: 10px 14px; font-size: 13px; cursor: pointer; display: flex; align-items: center; color: var(--text-primary); transition: background 0.15s; white-space: nowrap;`;
        item.onmousedown = (e) => e.preventDefault();
        item.onmouseover = () => item.style.backgroundColor = 'var(--hover-bg)';
        item.onmouseout = () => item.style.backgroundColor = 'transparent';
        item.onclick = (e) => { e.stopPropagation(); moreDropdown.style.display = 'none'; onClick(); };
        return item;
    };

    moreDropdown.appendChild(createDropdownItem(ICONS.translate, 'Перевести', () => handleActionClick('translate')));
    moreDropdown.appendChild(createDropdownItem(ICONS.keyboard, 'Исправить раскладку', () => handleActionClick('layout')));
    moreDropdown.appendChild(createDropdownItem(ICONS.history, 'История', () => { chrome.runtime.sendMessage({ action: "openHistory" }); closePopup(); }));

    moreWrap.appendChild(moreDropdown);
    popupUI.appendChild(moreWrap);
    popupUI.appendChild(divider());
    popupUI.appendChild(createBtn(ICONS.closeColored, '', 'Закрыть панель', () => closePopup()));

    adjustPopupPosition();
}

function showAIMenu(x: number, y: number): void {
    closePopup(); injectStyles(); lastAnchorX = x; lastAnchorY = y;
    popupUI = createPopupElement();
    applyThemeToPopup(popupUI);
    popupUI.dataset.surface = 'menu';

    popupUI.addEventListener('mousedown', e => e.stopPropagation());
    popupUI.addEventListener('mouseup', e => e.stopPropagation());
    popupUI.addEventListener('click', e => e.stopPropagation());

    popupUI.style.cssText = `position: fixed !important; left: -9999px; top: -9999px; background: var(--bg-primary); z-index: 2147483647 !important; font-family: system-ui, sans-serif; font-size: 13px; color: var(--text-primary); width: 250px; padding: 7px;`;

    const menuLabel = document.createElement('div');
    menuLabel.className = 'lexisync-menu-label';
    menuLabel.textContent = 'AI-инструменты';
    popupUI.appendChild(menuLabel);

    const createMenuBtn = (icon: string, text: string, mode: RequestMode, shortcut?: string) => {
        const btn = document.createElement('button'); btn.type = 'button'; 
        btn.className = 'lexisync-menu-button';
        btn.innerHTML = `
            <div style="display: flex; align-items: center;">
                <span class="lexisync-menu-icon" style="display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icon}</span>
                <span style="font-weight: 600;">${text}</span>
            </div>
            ${shortcut ? `<span class="lexisync-shortcut">${shortcut}</span>` : ''}
        `;
        btn.style.cssText = `width: 100%; padding: 8px 12px; cursor: pointer; transition: background 0.15s; display: flex; align-items: center; justify-content: space-between; border-radius: 8px; color: var(--text-primary); background: transparent; border: none;`;
        btn.onmousedown = (e) => e.preventDefault();
        btn.onmouseover = () => btn.style.backgroundColor = 'var(--hover-bg)';
        btn.onmouseout = () => btn.style.backgroundColor = 'transparent';
        btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); handleActionClick(mode); };
        return btn;
    };

    popupUI.appendChild(createMenuBtn(ICONS.spell, 'Исправить ошибки', 'spellcheck', 'Alt+R'));
    popupUI.appendChild(createMenuBtn(ICONS.style, 'Переписать текст', 'style', 'Alt+Y'));
    popupUI.appendChild(createMenuBtn(ICONS.emoji, 'Подобрать эмодзи', 'emoji', 'Alt+T'));

    adjustPopupPosition();
}

function showRateLimitTimer(seconds: number, retryCallback: () => void, container: HTMLElement | null): void {
    let timeLeft = seconds;
    const render = () => {
        if (!container || !container.isConnected) return false;
        container.innerHTML = `
            <div style="padding: 16px; font-weight: 500; color: #b06000; display: flex; align-items: center; justify-content: center; gap: 10px; background: #fff8f0; border-radius: 12px; border: 1px solid #ffe8cc; margin: 4px;">
                <span class="lexisync-hourglass">${ICONS.hourglass}</span>
                <span>Лимит. Автоповтор через <b>${timeLeft}</b> сек...</span>
            </div>
        `;
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
        currentTargetLang = (ruCount > 0 && ruCount >= enCount) ? "Английский" : "Русский";
    }
    executeRequest(mode);
}

function executeRequest(mode: RequestMode): void {
    if (!popupUI) return;
    
    popupUI.dataset.surface = 'result';
    popupUI.style.width = '340px';
    popupUI.style.padding = '0';
    popupUI.style.display = 'block';
    
    let headerText = '';
    if (mode === "spellcheck") headerText = `<span style="font-weight: 600;">Ошибки исправлены</span>`;
    else if (mode === "style") headerText = `<span style="display:flex; align-items:center; gap:8px;">${ICONS.style} Измененный стиль</span>`;
    else if (mode === "emoji") headerText = `<span style="display:flex; align-items:center; gap:8px;">${ICONS.emoji} Варианты с эмодзи</span>`;
    else if (mode === "layout") headerText = `<span style="display:flex; align-items:center; gap:8px;">${ICONS.keyboard} Раскладка исправлена</span>`;
    else if (mode === "translate") headerText = 'Перевод';
    else if (mode === "ocr") headerText = `<span style="display:flex; align-items:center; gap:8px;">📸 Распознанный текст</span>`; // 🔥 НОВОЕ
    
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
        langWrap.innerHTML = `<span id="lexisync-lang-label">${currentTargetLang}</span> <span style="margin-top:2px;">${ICONS.chevronDown}</span>`;
        langWrap.onmouseover = () => langWrap.style.background = 'var(--hover-bg)';
        langWrap.onmouseout = () => langWrap.style.background = 'transparent';
        
        const langDropdown = document.createElement('div');
        langDropdown.className = 'lexisync-scroll';
        langDropdown.style.cssText = 'display: none; position: absolute; top: 100%; left: -4px; margin-top: 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 12px 24px var(--shadow-color); flex-direction: column; min-width: 140px; z-index: 9999; padding: 8px 0; max-height: 220px; overflow-y: auto; font-weight: normal;';
        
        const popularLangs = ['Английский', 'Русский', 'Немецкий', 'Французский', 'Испанский', 'Итальянский', 'Польский', 'Китайский', 'Турецкий', 'Японский'];
        
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
        headerTitleWrapper.innerHTML = headerText;
    }

    const loaderOrClose = document.createElement('div');
    loaderOrClose.innerHTML = `<div class="lexisync-loader"></div>`;
    
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
    
    popupUI.innerHTML = '';
    popupUI.appendChild(header);
    popupUI.appendChild(contentPane);
    popupUI.appendChild(correctionsContainer);
    popupUI.appendChild(actionsContainer);
    adjustPopupPosition();

    let fullResult = "";
    let streamPort: chrome.runtime.Port | null = null;
    let usePageContext = false;
    let storageAllowed = false;
    let savedHistoryId: number | null = null;
    let wordCorrections: WordCorrection[] = [];
    const rejectedCorrections = new Set<number>();

    function getCacheSource(): string {
        return usePageContext
            ? `${currentSelection.text}\ncontext:${currentSelection.context}`
            : currentSelection.text;
    }

    function getEffectiveResult(): string {
        const clean = fullResult.replace(/\*/g, '');
        return mode === 'spellcheck'
            ? resolveCorrections(clean, wordCorrections, rejectedCorrections)
            : clean;
    }

    function refreshSpellcheck(): void {
        if (mode !== 'spellcheck') return;
        contentPane.innerHTML = renderSpellcheckDiff(currentSelection.text, fullResult, rejectedCorrections);
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
            choice.textContent = rejectedCorrections.has(correction.tokenIndex) ? 'Вернуть' : 'Принято';
            choice.title = rejectedCorrections.has(correction.tokenIndex) ? 'Снова принять исправление' : 'Оставить исходное слово';
            choice.style.cssText = 'border:0; border-radius:6px; padding:5px 7px; cursor:pointer; background:var(--bg-secondary); color:var(--text-primary);';
            choice.onclick = () => toggleCorrection(correction);
            const dictionary = document.createElement('button');
            dictionary.type = 'button';
            dictionary.textContent = '+ Словарь';
            dictionary.title = 'Не исправлять это слово в будущем';
            dictionary.style.cssText = choice.style.cssText;
            dictionary.onclick = async () => {
                await addToDictionary(correction.original);
                rejectedCorrections.add(correction.tokenIndex);
                dictionary.textContent = 'Добавлено';
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

    function renderLoadingControl(): void {
        loaderOrClose.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; align-items:center; gap:8px;';
        const loader = document.createElement('div');
        loader.className = 'lexisync-loader';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'lexisync-cancel-button';
        cancelBtn.title = 'Отменить запрос';
        cancelBtn.setAttribute('aria-label', 'Отменить запрос');
        cancelBtn.innerHTML = ICONS.closeStandard;
        cancelBtn.style.cssText = 'display:flex; align-items:center; justify-content:center; padding:4px; border:0; border-radius:6px; background:transparent; color:var(--text-secondary); cursor:pointer;';
        cancelBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            cancelBtn.disabled = true;
            contentPane.textContent = 'Отменяем запрос…';
            streamPort?.postMessage({ action: 'cancelMistral' });
        };
        wrapper.append(loader, cancelBtn);
        loaderOrClose.appendChild(wrapper);
    }

    function startStream() {
        streamPort?.disconnect();
        streamPort = null;
        fullResult = "";
        contentPane.innerHTML = `
            <div class="lexisync-skeleton" role="status" aria-label="LexiSync обрабатывает текст">
                <span class="lexisync-skeleton-line"></span>
                <span class="lexisync-skeleton-line"></span>
                <span class="lexisync-skeleton-line"></span>
            </div>`;
        contentPane.style.color = '';
        actionsContainer.style.display = 'none';
        renderLoadingControl();
        
        if (!navigator.onLine) {
            contentPane.innerHTML = `<span style="color: #d32f2f;">Нет подключения к интернету. Проверьте сеть и попробуйте снова.</span>`;
            finishStream(false);
            return;
        }

        if (currentSelection.text.length > 3000) {
            contentPane.innerHTML = `<span style="color: #d32f2f;">Текст слишком длинный (${currentSelection.text.length} симв.). Пожалуйста, выделите не более 3000 символов за раз.</span>`;
            finishStream(false);
            return;
        }

        if (!chrome.runtime || !chrome.runtime.connect) {
            contentPane.innerHTML = `<span style="color: #d32f2f;">Пожалуйста, обновите страницу (F5).</span>`;
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
            imageUrl: currentSelection.imageUrl // 🔥 НОВОЕ
        });        
        streamPort.onMessage.addListener((response: StreamResponse) => {
            if (response.status === "chunk") {
                fullResult += response.text;
                contentPane.innerHTML = parseMarkdownToHTML(fullResult);
                contentPane.scrollTop = contentPane.scrollHeight; 
                adjustPopupPosition();

            } else if (response.status === "done") {
                if (mode === 'spellcheck') {
                    fullResult = normalizeSpellcheckResult(fullResult);
                    wordCorrections = getWordCorrections(currentSelection.text, fullResult);
                    refreshSpellcheck();
                } else {
                    contentPane.innerHTML = parseMarkdownToHTML(fullResult);
                }
                finishStream();

                
                const historyItem: HistoryItem = {
                    id: Date.now(),
                    mode,
                    original: currentSelection.text,
                    result: getEffectiveResult(),
                    date: new Date().toISOString(),
                };

                if (storageAllowed) {
                    const cacheModeKey = mode === 'translate' ? mode + currentTargetLang : mode;
                    void getCacheHash(cacheModeKey, getCacheSource())
                        .then((cacheKey) => setCachedText(cacheKey, fullResult))
                        .catch((error) => console.error('Ошибка сохранения кэша:', error));
                    void addHistoryItem(historyItem).then(async () => {
                        savedHistoryId = historyItem.id;
                        await updateHistoryItemResult(historyItem.id, getEffectiveResult());
                    });
                }

            } else if (response.status === "error") {
                const errorMessage = typeof response.error === 'string' ? response.error : 'Неизвестная ошибка.';
                if (errorMessage.toLowerCase().includes('rate limit') || errorMessage.toLowerCase().includes('лимит') || errorMessage.includes('429')) {
                    showRateLimitTimer(5, startStream, contentPane);
                } else {
                    contentPane.textContent = `Ошибка: ${errorMessage}`;
                    contentPane.style.color = '#d32f2f';
                }
                finishStream(false);
            } else if (response.status === 'cancelled') {
                contentPane.textContent = 'Запрос отменён.';
                contentPane.style.color = 'var(--text-secondary)';
                finishStream(false);
            }
        });
    }

    function finishStream(success = true) {
        streamPort?.disconnect();
        streamPort = null;
        const closeBtn = document.createElement('div');
        closeBtn.className = 'lexisync-close-button';
        closeBtn.innerHTML = ICONS.closeStandard;
        closeBtn.style.cssText = 'cursor: pointer; display: flex; align-items: center; margin-right: -4px; padding: 6px; border-radius: 8px; color: var(--text-secondary); transition: background 0.15s;';
        closeBtn.onmouseover = () => closeBtn.style.background = 'var(--hover-bg)';
        closeBtn.onmouseout = () => closeBtn.style.background = 'transparent';
        closeBtn.onclick = closePopup;
        loaderOrClose.innerHTML = '';
        loaderOrClose.appendChild(closeBtn);

        if (success && fullResult.trim().length > 0) {
            actionsContainer.style.display = 'flex';
            actionsContainer.innerHTML = '';
            
            
            const btnClass = (mode === 'translate' || mode === 'layout') ? 'lexisync-translate-btn' : 'lexisync-btn-action';
            const replaceIcon = (mode === 'translate' || mode === 'layout') ? ICONS.replaceCurved : ICONS.replace;
            const copyIcon = (mode === 'translate' || mode === 'layout') ? ICONS.copyStandard : ICONS.copy;
            
            const replaceBtn = document.createElement('button');
            replaceBtn.type = 'button'; 
            replaceBtn.className = `${btnClass} lexisync-result-button lexisync-result-button--primary`;
            replaceBtn.innerHTML = `${replaceIcon} Заменить текст`;
            // ✅ НОВАЯ ЛОГИКА (ВСТАВИТЬ)
            replaceBtn.onclick = (e) => { 
                e.preventDefault();
                e.stopPropagation();

                const undo = replaceSelectedText(currentSelection, getEffectiveResult());

                // Делаем красивую анимацию кнопки
                replaceBtn.innerHTML = `${ICONS.check} Заменено!`;
                replaceBtn.classList.add('lexisync-result-button--success');
                replaceBtn.style.backgroundColor = '#dcfce7';
                replaceBtn.style.color = '#166534';
                replaceBtn.style.fontWeight = '600';

                if (undo) {
                    const undoBtn = document.createElement('button');
                    undoBtn.type = 'button';
                    undoBtn.className = `${btnClass} lexisync-result-button`;
                    undoBtn.textContent = 'Отменить замену';
                    undoBtn.onclick = () => {
                        undo();
                        undoBtn.remove();
                        replaceBtn.disabled = false;
                        replaceBtn.classList.remove('lexisync-result-button--success');
                        replaceBtn.innerHTML = `${replaceIcon} Заменить текст`;
                    };
                    actionsContainer.appendChild(undoBtn);
                }
                replaceBtn.disabled = true;
            };

            if (mode === 'ocr') {
                navigator.clipboard.writeText(getEffectiveResult());
                headerTitleWrapper.innerHTML = `<span style="display:flex; align-items:center; gap:8px; color: #166534;">${ICONS.check} Текст скопирован!</span>`;
            }

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button'; 
            copyBtn.className = `${btnClass} lexisync-result-button icon-only`;
            copyBtn.innerHTML = copyIcon;
            copyBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText(getEffectiveResult());
                copyBtn.innerHTML = (mode === 'translate' || mode === 'layout') ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ICONS.check;
                setTimeout(() => copyBtn.innerHTML = copyIcon, 1500);
            };

            actionsContainer.appendChild(replaceBtn);
            actionsContainer.appendChild(copyBtn);
        }
        adjustPopupPosition();
    }

    async function checkCacheAndRun() {
        chrome.storage.local.get(['mistralApiKey', 'sendPageContext'], async (res) => {
            const apiKey = res.mistralApiKey as string;
            usePageContext = res.sendPageContext === true;
            storageAllowed = await shouldStoreOnCurrentPage();
            if (!apiKey || apiKey.trim() === '') {
                contentPane.innerHTML = `
                    <div style="text-align: center; padding: 24px 16px;">
                        <span style="font-size: 32px; display: block; margin-bottom: 12px;">🔑</span>
                        <div style="font-weight: 600; font-size: 16px; margin-bottom: 8px;">API-ключ не настроен</div>
                        <div style="color: var(--text-secondary); margin-bottom: 16px; font-size: 13px;">Открываем настройки через <span id="redirectTimer" style="font-weight:bold; color:var(--primary);">3</span>...</div>
                        <button id="openSettingsBtn" style="background: var(--primary); color: #fff; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 500;">Открыть сейчас</button>
                    </div>`;
                
                let timeLeft = 3;
                const timerSpan = getPopupElementById<HTMLElement>('redirectTimer');
                const interval = setInterval(() => {
                    timeLeft--;
                    if (timerSpan) timerSpan.textContent = timeLeft.toString();
                    if (timeLeft <= 0) {
                        clearInterval(interval);
                        chrome.runtime.sendMessage({ action: "openOptionsPage" });
                        closePopup();
                    }
                }, 1000);

                setTimeout(() => {
                    getPopupElementById<HTMLButtonElement>('openSettingsBtn')?.addEventListener('click', () => {
                        clearInterval(interval);
                        chrome.runtime.sendMessage({ action: "openOptionsPage" });
                        closePopup();
                    });
                }, 50);
                return;
            }

            if (mode === 'ocr') {
                startStream();
                return;
            }

            const cacheModeKey = mode === 'translate' ? mode + currentTargetLang : mode;
            const cacheKey = await getCacheHash(cacheModeKey, getCacheSource());
            const cachedResult = storageAllowed ? await getCachedText(cacheKey) : null;
            if (cachedResult) {
                fullResult = mode === 'spellcheck'
                    ? normalizeSpellcheckResult(cachedResult)
                    : cachedResult;
                if (mode === 'spellcheck') wordCorrections = getWordCorrections(currentSelection.text, fullResult);
                const finalHtml = mode === 'spellcheck'
                    ? renderSpellcheckDiff(currentSelection.text, fullResult)
                    : parseMarkdownToHTML(fullResult);
                contentPane.innerHTML = finalHtml;
                renderCorrectionControls();
                finishStream(true);
            } else {
                startStream();
            }
        });
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
    }
}

// ==========================================
// 🔥 МОДУЛЬ УМНОГО OCR (НОЖНИЦЫ)
// ==========================================

let ocrOverlay: HTMLDivElement | null = null;
let ocrSelection: HTMLDivElement | null = null;
let ocrStartX = 0;
let ocrStartY = 0;
let isOcrSelecting = false;
let capturedScreenshotDataUrl = "";

// Слушаем команду на запуск OCR от background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startOcrMode") {
        capturedScreenshotDataUrl = request.screenshotUrl;
        initOcrOverlay();
    }
});

function initOcrOverlay() {
    if (ocrOverlay) return; // Если уже открыто - игнорируем

    // 1. Создаем затемняющий фон
    ocrOverlay = document.createElement('div');
    ocrOverlay.id = 'lexisync-ocr-overlay';
    ocrOverlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.4); z-index: 2147483646; cursor: crosshair;
    `;

    // 2. Создаем прямоугольник выделения (светлое окно)
    ocrSelection = document.createElement('div');
    ocrSelection.id = 'lexisync-ocr-selection';
    ocrSelection.style.cssText = `
        position: fixed; border: 2px dashed #ffffff; background: rgba(255, 255, 255, 0.1);
        display: none; z-index: 2147483647; pointer-events: none;
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4); /* Эффект прорези в темном фоне */
    `;
    
    // Прячем стандартный фон, так как тень от рамки сделает затемнение
    ocrOverlay.style.background = 'transparent'; 

    ocrOverlay.appendChild(ocrSelection);
    document.body.appendChild(ocrOverlay);

    // 3. Логика рисования рамки
    ocrOverlay.addEventListener('mousedown', (e) => {
        isOcrSelecting = true;
        ocrStartX = e.clientX;
        ocrStartY = e.clientY;
        if (ocrSelection) {
            ocrSelection.style.display = 'block';
            ocrSelection.style.left = `${ocrStartX}px`;
            ocrSelection.style.top = `${ocrStartY}px`;
            ocrSelection.style.width = '0px';
            ocrSelection.style.height = '0px';
        }
    });

    ocrOverlay.addEventListener('mousemove', (e) => {
        if (!isOcrSelecting || !ocrSelection) return;
        const currentX = e.clientX;
        const currentY = e.clientY;
        
        const left = Math.min(ocrStartX, currentX);
        const top = Math.min(ocrStartY, currentY);
        const width = Math.abs(currentX - ocrStartX);
        const height = Math.abs(currentY - ocrStartY);
        
        ocrSelection.style.left = `${left}px`;
        ocrSelection.style.top = `${top}px`;
        ocrSelection.style.width = `${width}px`;
        ocrSelection.style.height = `${height}px`;
    });

    ocrOverlay.addEventListener('mouseup', (e) => {
        isOcrSelecting = false;
        if (!ocrSelection) return;
        
        const rect = ocrSelection.getBoundingClientRect();
        closeOcrOverlay();
        
        if (rect.width > 10 && rect.height > 10) {
            cropAndProcessImage(rect);
        }
    });

    // Отмена по Escape
    document.addEventListener('keydown', function escapeListener(e) {
        if (e.key === 'Escape' && ocrOverlay) {
            closeOcrOverlay();
            document.removeEventListener('keydown', escapeListener);
        }
    });
}

function closeOcrOverlay() {
    if (ocrOverlay && ocrOverlay.parentNode) {
        ocrOverlay.parentNode.removeChild(ocrOverlay);
    }
    ocrOverlay = null;
    ocrSelection = null;
}

// 4. Вырезаем кусок изображения через Canvas
function cropAndProcessImage(rect: DOMRect) {
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.drawImage(img, rect.left * dpr, rect.top * dpr, rect.width * dpr, rect.height * dpr, 0, 0, canvas.width, canvas.height);

        const croppedBase64 = canvas.toDataURL('image/jpeg', 0.9);
        
        currentSelection = { text: "Извлекаем текст...", context: "", range: null, activeElement: null, start: null, end: null, isInput: false, imageUrl: croppedBase64 };
        
        lastAnchorX = rect.left + rect.width / 2;
        lastAnchorY = rect.bottom + 10; 
        
        closePopup();
        injectStyles();
        popupUI = createPopupElement();
        applyThemeToPopup(popupUI);

        // 🔥 ИСПРАВЛЕНИЕ: ВОТ ОНА — ПОТЕРЯННАЯ СТРОКА (CSS-стили панели)
        popupUI.style.cssText = `position: fixed !important; left: -9999px; top: -9999px; background: var(--bg-primary); z-index: 2147483647 !important; font-family: system-ui, sans-serif; font-size: 13px; color: var(--text-primary);`;
        
        // Поехали!
        executeRequest('ocr'); 
    };
    img.src = capturedScreenshotDataUrl;
}
