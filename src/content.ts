import { t } from './i18n';
import { isSiteDisabled, normalizeDisabledSites } from './privacy';
import type { CustomCommand, RequestMode, SelectionData } from './types';
import { captureSelection, getSelectedText, getSelectionCoords as readSelectionCoords } from './selection-state';
import {
    showToolbarMenu as showContentToolbar,
    showAIMenu as showContentAiMenu,
    type ContentMenuContext,
} from './content-menus';
import { POPUP_STYLE_TEXT } from './content-ui-style';
import {
    handleActionClick as handleContentAction,
    executeRequest as executeContentRequest,
    type ContentRequestContext,
} from './content-request-panel';
import { ensureOptionalContentFeature, OCR_IMAGE_EVENT, OCR_START_EVENT } from './optional-content-features';
import { applyAppearanceStyle, normalizeAppearanceStyle, type AppearanceStyle } from './appearance-style';
import { startLiveProofread } from './live-proofread';
import { applyThemeCustomization, DEFAULT_THEME_CUSTOMIZATION } from './theme-customization';
import type { ThemeCustomization } from './types';
import { replaceSelectedText } from './text-replacement';

const contentRuntime = globalThis as typeof globalThis & { __lexisyncContentInitialized?: boolean };
if (!contentRuntime.__lexisyncContentInitialized) {
    contentRuntime.__lexisyncContentInitialized = true;
    startLiveProofread();

    let adaptiveSuggestionsInitialized = false;
    const ensureAdaptiveSuggestions = async () => {
        if (adaptiveSuggestionsInitialized) return;
        adaptiveSuggestionsInitialized = true;
        try {
            await ensureOptionalContentFeature('adaptive');
        } catch (error) {
            adaptiveSuggestionsInitialized = false;
            console.error(t('adaptiveLoadFailed', 'Не удалось загрузить персональные подсказки.'), error);
        }
    };
    void chrome.storage.local.get({ adaptiveSuggestionsEnabled: false }).then((stored) => {
        if (stored.adaptiveSuggestionsEnabled === true) void ensureAdaptiveSuggestions();
    });

    let extensionEnabledOnSite = true;
    void chrome.storage.local.get({ blockedSites: [] }).then((stored) => {
        extensionEnabledOnSite = !isSiteDisabled(location.hostname, normalizeDisabledSites(stored.blockedSites));
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.adaptiveSuggestionsEnabled?.newValue === true) {
            void ensureAdaptiveSuggestions();
        }
        if (areaName === 'local' && changes.blockedSites) {
            extensionEnabledOnSite = !isSiteDisabled(
                location.hostname,
                normalizeDisabledSites(changes.blockedSites.newValue),
            );
            if (!extensionEnabledOnSite) closePopup();
        }
    });

    let currentSelection: SelectionData = {
        text: '',
        context: '',
        range: null,
        activeElement: null,
        start: null,
        end: null,
        isInput: false,
    };
    let popupUI: HTMLElement | null = null;
    let popupHost: HTMLElement | null = null;
    let popupShadow: ShadowRoot | null = null;
    let previousFocus: HTMLElement | null = null;
    let popupStyleText = '';
    let activeRequestCleanup: (() => void) | null = null;
    let sidepanelUndo: (() => void) | null = null;
    function getLanguageName(code: string): string {
        try {
            return new Intl.DisplayNames([chrome.i18n.getUILanguage()], { type: 'language' }).of(code) || code;
        } catch {
            return code;
        }
    }

    let currentTargetLang: string = getLanguageName('en');
    let currentTheme: string = 'auto';
    let currentVisualStyle: AppearanceStyle = 'liquid-glass';
    let currentThemeCustomization: ThemeCustomization = DEFAULT_THEME_CUSTOMIZATION;
    let currentSearchEngine: string = 'google';
    let currentInterfaceScale: number = 90;

    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let isManuallyPositioned = false;

    let lastMouseX = 0;
    let lastMouseY = 0;
    let pendingSelectionMenuTimer: ReturnType<typeof setTimeout> | null = null;

    function cancelPendingSelectionMenu(): void {
        if (pendingSelectionMenuTimer === null) return;
        clearTimeout(pendingSelectionMenuTimer);
        pendingSelectionMenuTimer = null;
    }

    function scheduleSelectionMenu(delay = 50): void {
        cancelPendingSelectionMenu();
        pendingSelectionMenuTimer = setTimeout(() => {
            pendingSelectionMenuTimer = null;
            const text = getSelectedText();
            if (!text || text.trim().length === 0) return;
            saveSelectionState();
            showToolbarMenu(lastMouseX || getSelectionCoords().x, lastMouseY || getSelectionCoords().y);
        }, delay);
    }

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
        if (request.action === 'sidepanelApplyDirect') {
            const text = typeof request.text === 'string' ? request.text : '';
            const selection = captureSelection();
            const undo = text ? replaceSelectedText(selection, text) : null;
            if (!undo) {
                sendResponse({ ok: false, error: 'Не удалось определить место замены.' });
                return;
            }
            sidepanelUndo = undo;
            sendResponse({ ok: true });
            return;
        }
        if (request.action === 'sidepanelUndoDirect') {
            if (!sidepanelUndo) {
                sendResponse({ ok: false, error: 'Нет замены, которую можно отменить.' });
                return;
            }
            sidepanelUndo();
            sidepanelUndo = null;
            sendResponse({ ok: true });
            return;
        }
        if (request.action === 'startOcrMode') {
            const screenshotUrl = typeof request.screenshotUrl === 'string' ? request.screenshotUrl : '';
            if (screenshotUrl) {
                void ensureOcrOverlay()
                    .then(() => {
                        document.dispatchEvent(new CustomEvent(OCR_START_EVENT, { detail: { screenshotUrl } }));
                    })
                    .catch(() => undefined);
            }
            return;
        }
        if (request.action === 'contextMenuClicked') {
            saveSelectionState(request.text);
            const x = lastMouseX || window.innerWidth / 2;
            const y = lastMouseY || window.innerHeight / 2;
            showAIMenu(x, y);
            handleActionClick(request.mode);
        }

        if (request.action === 'hotkeyTriggered') {
            cancelPendingSelectionMenu();
            (async () => {
                let text = getSelectedText();
                if (!text || text.trim().length === 0) {
                    try {
                        text = await navigator.clipboard.readText();
                        if (!text || text.trim().length === 0) {
                            showToast(
                                t(
                                    'textNotFound',
                                    'Текст не найден. В Google Docs выделите текст, нажмите Ctrl+C и повторите горячую клавишу.',
                                ),
                            );
                            return;
                        }
                    } catch {
                        showToast(
                            t(
                                'clipboardDenied',
                                'Нет доступа к буферу обмена. Кликните по документу и попробуйте снова.',
                            ),
                        );
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
                    const commands = Array.isArray(stored.customCommands)
                        ? (stored.customCommands as CustomCommand[])
                        : [];
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

    document.addEventListener(
        'mousedown',
        (e: MouseEvent) => {
            if (!extensionEnabledOnSite) return;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            if (popupUI) {
                if (!isPopupEvent(e)) closePopup();
                else {
                    const moreWrap = getPopupElementById<HTMLElement>('lexisync-more-btn-wrap');
                    const moreDropdown = getPopupElementById<HTMLElement>('lexisync-more-dropdown');
                    if (moreWrap && moreDropdown && !e.composedPath().includes(moreWrap))
                        moreDropdown.style.display = 'none';
                }
            }
        },
        true,
    );

    document.addEventListener(
        'mouseup',
        (e: MouseEvent) => {
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

            scheduleSelectionMenu();
        },
        true,
    );

    // Клавиатурное выделение, iframe и некоторые редакторы не всегда посылают mouseup.
    // selectionchange покрывает эти случаи, а debounce не показывает панель во время перетаскивания мышью.
    document.addEventListener('selectionchange', () => {
        if (!extensionEnabledOnSite || isDragging || isManuallyPositioned) return;
        scheduleSelectionMenu(80);
    });

    document.addEventListener(
        'keydown',
        async (e: KeyboardEvent) => {
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
                    cancelPendingSelectionMenu();
                    let text = getSelectedText();
                    if (!text || text.trim().length === 0) {
                        try {
                            text = await navigator.clipboard.readText();
                            if (!text || text.trim().length === 0) {
                                showToast(
                                    t(
                                        'textNotFound',
                                        'Текст не найден. В Google Docs выделите текст, нажмите Ctrl+C и повторите горячую клавишу.',
                                    ),
                                );
                                return;
                            }
                        } catch {
                            showToast(
                                t(
                                    'clipboardReadFailed',
                                    'Не удалось прочитать буфер обмена. Разрешите доступ и попробуйте снова.',
                                ),
                            );
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
        },
        true,
    );

    function normalizeInterfaceScale(value: unknown): number {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) return 90;
        return Math.min(110, Math.max(75, Math.round(numericValue / 5) * 5));
    }

    chrome.storage.local.get(
        {
            selectedTheme: 'auto',
            visualStyle: 'liquid-glass',
            searchEngine: 'google',
            interfaceScale: 90,
            themeCustomization: DEFAULT_THEME_CUSTOMIZATION,
        },
        (res) => {
            if (res.selectedTheme) currentTheme = res.selectedTheme as string;
            currentVisualStyle = normalizeAppearanceStyle(res.visualStyle);
            currentThemeCustomization = applyThemeCustomization(document.documentElement, res.themeCustomization);
            if (res.searchEngine) currentSearchEngine = res.searchEngine as string;
            currentInterfaceScale = normalizeInterfaceScale(res.interfaceScale);
        },
    );

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            if (changes.selectedTheme) {
                currentTheme = changes.selectedTheme.newValue as string;
                if (popupUI) applyThemeToPopup(popupUI);
            }
            if (changes.visualStyle) {
                currentVisualStyle = normalizeAppearanceStyle(changes.visualStyle.newValue);
                if (popupUI) applyAppearanceStyle(popupUI, currentVisualStyle);
            }
            if (changes.themeCustomization) {
                currentThemeCustomization = applyThemeCustomization(
                    document.documentElement,
                    changes.themeCustomization.newValue,
                );
                if (popupUI) applyThemeCustomization(popupUI, currentThemeCustomization);
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
        if (!popupStyleText) popupStyleText = POPUP_STYLE_TEXT;
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
        popupHost.style.cssText =
            'all: initial !important; position: fixed !important; inset: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; pointer-events: auto !important;';
        popupShadow = popupHost.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = `:host { all: initial; } ${popupStyleText}`;
        popupShadow.appendChild(style);

        const popup = document.createElement('div');
        popup.id = 'lexisync-extension-ui';
        applyAppearanceStyle(popup, currentVisualStyle);
        applyThemeCustomization(popup, currentThemeCustomization);
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
        popupUI.style.cssText =
            'position:fixed !important; left:50% !important; top:24px !important; transform:translateX(-50%); max-width:360px; padding:12px 16px; background:var(--bg-primary); color:var(--text-primary); font:14px/1.45 system-ui,sans-serif; z-index:2147483647;';
        popupUI.textContent = message;
        const host = popupHost;
        setTimeout(() => {
            if (popupHost === host) closePopup();
        }, 4500);
    }

    function applyThemeToPopup(popup: HTMLElement): void {
        const isDark =
            currentTheme === 'dark' ||
            (currentTheme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
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
                if (node && (node as Element).closest('dialog'))
                    container = (node as Element).closest('dialog') as HTMLElement;
            }
        }
        return container;
    }

    function saveSelectionState(fallbackText?: string): void {
        currentSelection = captureSelection(fallbackText);
    }

    function getSelectionCoords(): { x: number; y: number } {
        return readSelectionCoords(lastMouseX, lastMouseY);
    }

    const menuContext: ContentMenuContext = {
        openPopup: (x, y) => {
            closePopup();
            injectStyles();
            lastAnchorX = x;
            lastAnchorY = y;
            popupUI = createPopupElement();
            applyThemeToPopup(popupUI);
            return popupUI;
        },
        getPopup: () => popupUI,
        getSelectionText: () => currentSelection.text,
        getSearchEngine: () => currentSearchEngine,
        getPopupElementById,
        closePopup,
        adjustPopupPosition,
        handleAction: (mode) => handleActionClick(mode),
        executeCustom: (command) => executeRequest('custom', command),
    };

    function showToolbarMenu(x: number, y: number): void {
        showContentToolbar(x, y, menuContext);
    }

    function showAIMenu(x: number, y: number): void {
        showContentAiMenu(x, y, menuContext);
    }

    const requestContext: ContentRequestContext = {
        getPopup: () => popupUI,
        getSelection: () => currentSelection,
        getTargetLanguage: () => currentTargetLang,
        setTargetLanguage: (language) => {
            currentTargetLang = language;
        },
        getLanguageName,
        getPopupElementById,
        adjustPopupPosition,
        closePopup,
        startDragging: (offsetX, offsetY) => {
            isDragging = true;
            isManuallyPositioned = true;
            dragOffsetX = offsetX;
            dragOffsetY = offsetY;
        },
        registerRequestCleanup: (cleanup) => {
            activeRequestCleanup?.();
            activeRequestCleanup = cleanup;
        },
    };

    function handleActionClick(mode: RequestMode): void {
        handleContentAction(mode, requestContext);
    }

    function executeRequest(mode: RequestMode, customCommand?: CustomCommand): void {
        executeContentRequest(mode, customCommand, requestContext);
    }

    function adjustPopupPosition(): void {
        if (!popupUI || isManuallyPositioned) return;
        const rect = popupUI.getBoundingClientRect();
        const absoluteLeft = lastAnchorX;
        const absoluteTop = lastAnchorY + 6;
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
        activeRequestCleanup?.();
        activeRequestCleanup = null;
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

    let ocrOverlayPromise: Promise<void> | null = null;
    function ensureOcrOverlay(): Promise<void> {
        ocrOverlayPromise ??= ensureOptionalContentFeature('ocr').catch((error) => {
            ocrOverlayPromise = null;
            showToast(t('ocrLoadFailed', 'Не удалось запустить распознавание текста.'));
            throw error;
        });
        return ocrOverlayPromise;
    }

    document.addEventListener(OCR_IMAGE_EVENT, (event) => {
        if (!extensionEnabledOnSite) return;
        const detail = (event as CustomEvent<{ imageUrl?: unknown; rect?: Partial<DOMRect> }>).detail;
        if (typeof detail?.imageUrl !== 'string' || !detail.rect) return;
        currentSelection = {
            text: t('extractingText', 'Извлекаем текст…'),
            context: '',
            range: null,
            activeElement: null,
            start: null,
            end: null,
            isInput: false,
            imageUrl: detail.imageUrl,
        };
        lastAnchorX = Number(detail.rect.left || 0) + Number(detail.rect.width || 0) / 2;
        lastAnchorY = Number(detail.rect.bottom || 0) + 10;
        closePopup();
        injectStyles();
        popupUI = createPopupElement();
        applyThemeToPopup(popupUI);
        popupUI.style.cssText =
            'position:fixed!important;left:-9999px;top:-9999px;background:var(--bg-primary);z-index:2147483647!important;font-family:system-ui,sans-serif;font-size:13px;color:var(--text-primary);';
        executeRequest('ocr');
    });
}
