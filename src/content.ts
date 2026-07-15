import { ICONS } from './icons';
interface SelectionData {
    text: string;
    context: string;
    range: Range | null;
    activeElement: HTMLInputElement | HTMLTextAreaElement | null;
    start: number | null;
    end: number | null;
    isInput: boolean;
    imageUrl?: string; // 🔥 НОВОЕ: Сюда будет складываться вырезанная картинка
}

let currentSelection: SelectionData = { text: "", context: "", range: null, activeElement: null, start: null, end: null, isInput: false };
let popupUI: HTMLElement | null = null;
let popupHost: HTMLElement | null = null;
let popupShadow: ShadowRoot | null = null;
let popupStyleText = '';
let currentTargetLang: string = "Английский"; 
let currentTheme: string = 'auto';
let currentSearchEngine: string = 'google';

let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let isManuallyPositioned = false;

let lastMouseX = 0;
let lastMouseY = 0;

// УТИЛИТА 1: Кэширование
const CACHE_INDEX_KEY = 'ai_cache_index';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

interface CacheEntry {
    value: string;
    expiresAt: number;
}

interface CacheIndexItem {
    key: string;
    expiresAt: number;
}

async function getCacheHash(mode: string, text: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(mode + ":" + text.trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return 'ai_cache_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getCachedText(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get([key]);
    const cached = result[key] as string | CacheEntry | undefined;

    // Поддержка кэша, созданного версиями до 2.8.0.
    if (typeof cached === 'string') return cached;
    if (!cached || typeof cached.value !== 'string') return null;

    if (cached.expiresAt <= Date.now()) {
        await chrome.storage.local.remove(key);
        return null;
    }

    return cached.value;
}

async function setCachedText(key: string, value: string): Promise<void> {
    const now = Date.now();
    const expiresAt = now + CACHE_TTL_MS;
    const result = await chrome.storage.local.get([CACHE_INDEX_KEY]);
    const previousIndex = Array.isArray(result[CACHE_INDEX_KEY])
        ? result[CACHE_INDEX_KEY] as CacheIndexItem[]
        : [];

    const activeIndex = previousIndex
        .filter(item => item?.key !== key && item?.expiresAt > now)
        .concat({ key, expiresAt })
        .slice(-CACHE_MAX_ENTRIES);

    const activeKeys = new Set(activeIndex.map(item => item.key));
    const keysToRemove = previousIndex
        .map(item => item?.key)
        .filter((oldKey): oldKey is string => Boolean(oldKey) && !activeKeys.has(oldKey));

    if (keysToRemove.length > 0) await chrome.storage.local.remove(keysToRemove);
    await chrome.storage.local.set({
        [key]: { value, expiresAt } satisfies CacheEntry,
        [CACHE_INDEX_KEY]: activeIndex,
    });
}

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

interface TextToken {
    value: string;
    significant: boolean;
}

function tokenizeText(text: string): TextToken[] {
    const values = text.match(/\s+|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu) ?? [];
    return values.map(value => ({
        value,
        significant: !/^\s+$/u.test(value),
    }));
}

function normalizeSpellcheckResult(text: string): string {
    // Убираем разметку старого формата из уже сохраненного кэша.
    return text
        .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
        .replace(/\*\*/g, '');
}

function renderSpellcheckDiff(original: string, corrected: string): string {
    const originalTokens = tokenizeText(original);
    const correctedTokens = tokenizeText(corrected);
    const originalSignificant = originalTokens.filter(token => token.significant);
    const correctedSignificant = correctedTokens
        .map((token, tokenIndex) => ({ ...token, tokenIndex }))
        .filter(token => token.significant);

    // LCS позволяет корректно находить изменения даже при добавлении или удалении слов.
    const rows = Array.from(
        { length: originalSignificant.length + 1 },
        () => new Uint16Array(correctedSignificant.length + 1),
    );

    for (let originalIndex = 1; originalIndex <= originalSignificant.length; originalIndex++) {
        for (let correctedIndex = 1; correctedIndex <= correctedSignificant.length; correctedIndex++) {
            if (originalSignificant[originalIndex - 1].value === correctedSignificant[correctedIndex - 1].value) {
                rows[originalIndex][correctedIndex] = rows[originalIndex - 1][correctedIndex - 1] + 1;
            } else {
                rows[originalIndex][correctedIndex] = Math.max(
                    rows[originalIndex - 1][correctedIndex],
                    rows[originalIndex][correctedIndex - 1],
                );
            }
        }
    }

    const unchangedTokenIndexes = new Set<number>();
    let originalIndex = originalSignificant.length;
    let correctedIndex = correctedSignificant.length;

    while (originalIndex > 0 && correctedIndex > 0) {
        if (originalSignificant[originalIndex - 1].value === correctedSignificant[correctedIndex - 1].value) {
            unchangedTokenIndexes.add(correctedSignificant[correctedIndex - 1].tokenIndex);
            originalIndex--;
            correctedIndex--;
        } else if (rows[originalIndex - 1][correctedIndex] >= rows[originalIndex][correctedIndex - 1]) {
            originalIndex--;
        } else {
            correctedIndex--;
        }
    }

    return correctedTokens.map((token, tokenIndex) => {
        const escaped = token.value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');

        return token.significant && !unchangedTokenIndexes.has(tokenIndex)
            ? `<mark>${escaped}</mark>`
            : escaped;
    }).join('');
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
                        alert("✨ LexiSync: Текст не найден!\n\nВ Google Docs:\n1. Выделите текст\n2. Нажмите Ctrl+C\n3. Снова нажмите хоткей");
                        return;
                    }
                } catch (err) {
                    alert("✨ LexiSync: Нет доступа к буферу обмена. Кликните мышкой по документу и попробуйте снова.");
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
        let mode: string | null = null;
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
                        alert("✨ LexiSync: Текст не найден!\n\nЕсли вы находитесь в Google Docs:\n1. Выделите текст\n2. Нажмите Ctrl+C (скопировать)\n3. Снова нажмите горячую клавишу");
                        return;
                    }
                } catch (err) {
                    alert("✨ LexiSync: Ошибка доступа к буферу обмена.");
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

chrome.storage.local.get(['selectedTheme', 'searchEngine'], (res) => {
    if (res.selectedTheme) currentTheme = res.selectedTheme as string;
    if (res.searchEngine) currentSearchEngine = res.searchEngine as string;
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        if (changes.selectedTheme) currentTheme = changes.selectedTheme.newValue as string;
        if (changes.searchEngine) currentSearchEngine = changes.searchEngine.newValue as string;
    }
});

let lastAnchorX: number = 0;
let lastAnchorY: number = 0;

function injectStyles(): void {
    if (!popupStyleText) {
        const style = document.createElement('style');
        style.textContent = `
            #lexisync-extension-ui {
                --bg-primary: #ffffff; --bg-secondary: #f1f5f9; --text-primary: #1e293b; --text-secondary: #64748b;
                --border-color: rgba(0,0,0,0.06); --hover-bg: #e2e8f0; --shadow-color: rgba(0,0,0,0.1);
                transition: opacity 0.15s ease; border-radius: 12px;
                border: 1px solid var(--border-color);
                animation: lexiSyncFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
            }
            #lexisync-extension-ui[data-theme="dark"] {
            --bg-primary: #1e1e24; --bg-secondary: #2b2b36; --text-primary: #f8fafc; --text-secondary: #94a3b8;
            --border-color: rgba(255,255,255,0.08); --hover-bg: #3f3f46; --shadow-color: rgba(0,0,0,0.5);
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
    popupHost.style.cssText = 'all: initial !important; position: fixed !important; inset: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; pointer-events: none !important;';
    popupShadow = popupHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `:host { all: initial; } ${popupStyleText}`;
    popupShadow.appendChild(style);

    const popup = document.createElement('div');
    popup.id = 'lexisync-extension-ui';
    popup.style.pointerEvents = 'auto';
    popupShadow.appendChild(popup);
    getPopupContainer().appendChild(popupHost);
    return popup;
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
    
    popupUI.addEventListener('mousedown', e => e.stopPropagation());
    popupUI.addEventListener('mouseup', e => e.stopPropagation());
    popupUI.addEventListener('click', e => e.stopPropagation());
    
    popupUI.style.cssText = `position: fixed !important; left: -9999px; top: -9999px; background: var(--bg-primary); z-index: 2147483647 !important; font-family: system-ui, sans-serif; font-size: 13px; color: var(--text-primary); display: flex; align-items: center; padding: 4px; gap: 2px;`;

    const createBtn = (icon: string, text: string, title: string, onClick: (e: MouseEvent, btn: HTMLButtonElement) => void) => {
        const btn = document.createElement('button'); btn.type = 'button'; 
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
    moreDropdown.style.cssText = `display: none; position: absolute; top: 100%; right: 0; margin-top: 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 16px 32px rgba(0,0,0,0.15); width: max-content; min-width: 120px; z-index: 9999; padding: 8px 0; flex-direction: column; overflow: hidden;`;

    const createDropdownItem = (icon: string, text: string, onClick: () => void) => {
        const item = document.createElement('div');
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

    popupUI.addEventListener('mousedown', e => e.stopPropagation());
    popupUI.addEventListener('mouseup', e => e.stopPropagation());
    popupUI.addEventListener('click', e => e.stopPropagation());

    popupUI.style.cssText = `position: fixed !important; left: -9999px; top: -9999px; background: var(--bg-primary); z-index: 2147483647 !important; font-family: system-ui, sans-serif; font-size: 13px; color: var(--text-primary); width: max-content; min-width: 220px; padding: 4px;`;

    const createMenuBtn = (icon: string, text: string, mode: string, shortcut?: string) => {
        const btn = document.createElement('button'); btn.type = 'button'; 
        btn.innerHTML = `
            <div style="display: flex; align-items: center;">
                <span style="margin-right: 12px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); width: 16px; height: 16px; flex-shrink: 0;">${icon}</span>
                <span style="font-weight: 500;">${text}</span>
            </div>
            ${shortcut ? `<span style="color: var(--text-secondary); font-size: 11px; margin-left: 24px; opacity: 0.8;">${shortcut}</span>` : ''}
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

function handleActionClick(mode: string): void {
    if (mode === 'translate') {
        const text = currentSelection.text || "";
        const ruCount = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
        const enCount = (text.match(/[a-zA-Z]/g) || []).length;
        currentTargetLang = (ruCount > 0 && ruCount >= enCount) ? "Английский" : "Русский";
    }
    executeRequest(mode);
}

function executeRequest(mode: string): void {
    if (!popupUI) return;
    
    popupUI.style.width = '320px';
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
    contentPane.className = 'lexisync-scroll';
    contentPane.style.cssText = 'padding: 16px; min-height: 50px; max-height: 50vh; overflow-y: auto; overflow-x: hidden; font-size: 14px; color: var(--text-primary); line-height: 1.6; font-family: system-ui, sans-serif; word-wrap: break-word; white-space: pre-wrap;';
    
    const actionsContainer = document.createElement('div');
    actionsContainer.style.cssText = 'display: none; padding: 0 16px 16px 16px; gap: 10px; align-items: center; justify-content: flex-start;';
    
    popupUI.innerHTML = '';
    popupUI.appendChild(header);
    popupUI.appendChild(contentPane);
    popupUI.appendChild(actionsContainer);
    adjustPopupPosition();

    let fullResult = "";
    let streamPort: chrome.runtime.Port | null = null;
    let usePageContext = false;

    function getCacheSource(): string {
        return usePageContext
            ? `${currentSelection.text}\ncontext:${currentSelection.context}`
            : currentSelection.text;
    }

    function renderLoadingControl(): void {
        loaderOrClose.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; align-items:center; gap:8px;';
        const loader = document.createElement('div');
        loader.className = 'lexisync-loader';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
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
        contentPane.textContent = "";
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
        streamPort.onMessage.addListener((response) => {
            if (response.status === "chunk") {
                fullResult += response.text;
                contentPane.innerHTML = parseMarkdownToHTML(fullResult);
                contentPane.scrollTop = contentPane.scrollHeight; 
                adjustPopupPosition();

            } else if (response.status === "done") {
                if (mode === 'spellcheck') {
                    fullResult = normalizeSpellcheckResult(fullResult);
                    contentPane.innerHTML = renderSpellcheckDiff(currentSelection.text, fullResult);
                } else {
                    contentPane.innerHTML = parseMarkdownToHTML(fullResult);
                }
                finishStream();

                
                const saveToHistorySafe = async (newItem: any) => {
                    const data = await chrome.storage.local.get({ aiHistory: [] });
                    let history = data.aiHistory as any[];
                    
                    // Добавляем свежий запрос в начало
                    history.unshift(newItem);
                    
                    // СТРОГИЙ ЛИМИТ: Оставляем только 50 последних записей
                    if (history.length > 50) {
                        history = history.slice(0, 50);
                    }
                    
                    await chrome.storage.local.set({ aiHistory: history });
                };
                
                // 🔥 СОХРАНЯЕМ В КЭШ
                const cacheModeKey = mode === 'translate' ? mode + currentTargetLang : mode;
                void getCacheHash(cacheModeKey, getCacheSource())
                    .then(cacheKey => setCachedText(cacheKey, fullResult))
                    .catch(error => console.error('Ошибка сохранения кэша:', error));

                // 🔥 СОХРАНЯЕМ В ИСТОРИЮ
                const historyItem = {
                    id: Date.now(),
                    mode: mode,
                    original: currentSelection.text,
                    result: fullResult.replace(/\*/g, ''),
                    date: new Date().toISOString()
                };

                // Вызываем функцию с лимитом, передавая ей сформированный объект
                saveToHistorySafe(historyItem);

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
            
            
            const cleanResult = fullResult.replace(/\*/g, '');
            const btnClass = (mode === 'translate' || mode === 'layout') ? 'lexisync-translate-btn' : 'lexisync-btn-action';
            const replaceIcon = (mode === 'translate' || mode === 'layout') ? ICONS.replaceCurved : ICONS.replace;
            const copyIcon = (mode === 'translate' || mode === 'layout') ? ICONS.copyStandard : ICONS.copy;
            
            const replaceBtn = document.createElement('button');
            replaceBtn.type = 'button'; 
            replaceBtn.className = btnClass;
            replaceBtn.innerHTML = `${replaceIcon} Заменить текст`;
            // ✅ НОВАЯ ЛОГИКА (ВСТАВИТЬ)
            replaceBtn.onclick = (e) => { 
                e.preventDefault();
                e.stopPropagation();

                // Вставляем очищенный текст (без звездочек) умным методом
                replaceSelectedTextSafely(cleanResult);

                // Делаем красивую анимацию кнопки
                replaceBtn.innerHTML = `${ICONS.check} Заменено!`;
                replaceBtn.style.backgroundColor = '#dcfce7';
                replaceBtn.style.color = '#166534';
                replaceBtn.style.fontWeight = '600';

                setTimeout(() => closePopup(), 1500);
            };

            if (mode === 'ocr') {
                navigator.clipboard.writeText(cleanResult);
                headerTitleWrapper.innerHTML = `<span style="display:flex; align-items:center; gap:8px; color: #166534;">${ICONS.check} Текст скопирован!</span>`;
            }

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button'; 
            copyBtn.className = `${btnClass} icon-only`;
            copyBtn.innerHTML = copyIcon;
            copyBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText(cleanResult);
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
            
            const cachedResult = await getCachedText(cacheKey);
            if (cachedResult) {
                fullResult = mode === 'spellcheck'
                    ? normalizeSpellcheckResult(cachedResult)
                    : cachedResult;
                const finalHtml = mode === 'spellcheck'
                    ? renderSpellcheckDiff(currentSelection.text, fullResult)
                    : parseMarkdownToHTML(fullResult);
                contentPane.innerHTML = finalHtml;
                finishStream(true);
            } else {
                startStream();
            }
        });
    }

    checkCacheAndRun();
}


/**
 * Умная и безопасная замена выделенного текста.
 * Восстанавливает фокус и пробивает защиту React/Vue/Angular.
 */
function replaceSelectedTextSafely(newText: string) {
    const { isInput, activeElement, start, end, range } = currentSelection;

    try {
        // СЦЕНАРИЙ 1: Стандартные поля (input, textarea)
        if (isInput && activeElement) {
            const val = activeElement.value;
            const safeStart = start || 0;
            const safeEnd = end || 0;
            const newFullText = val.substring(0, safeStart) + newText + val.substring(safeEnd);

            // Магия для обхода Virtual DOM современных фреймворков
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

            if (activeElement.tagName === 'INPUT' && nativeInputValueSetter) {
                nativeInputValueSetter.call(activeElement, newFullText);
            } else if (activeElement.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) {
                nativeTextAreaValueSetter.call(activeElement, newFullText);
            } else {
                activeElement.value = newFullText;
            }

            // Восстанавливаем положение каретки (курсора)
            activeElement.selectionStart = activeElement.selectionEnd = safeStart + newText.length;

            // Форсируем обновление состояния сайта
            activeElement.dispatchEvent(new Event('input', { bubbles: true }));
            activeElement.dispatchEvent(new Event('change', { bubbles: true }));
            
            // Обязательно возвращаем фокус в поле ввода!
            activeElement.focus();
        }
        // СЦЕНАРИЙ 2: Сложные редакторы (contenteditable) и Google Translate
        else if (range) {
            const sel = window.getSelection();
            if (sel) {
                // Восстанавливаем выделение текста там, где оно было до клика по кнопке
                sel.removeAllRanges();
                sel.addRange(range);
            }
            // Нативный метод браузера для вставки (сохраняет историю Ctrl+Z)
            document.execCommand('insertText', false, newText);
        }
    } catch (err) {
        console.error("Ошибка при вставке текста:", err);
        // Резервный план на случай непредвиденных блокировок сайта
        navigator.clipboard.writeText(newText);
    }
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
