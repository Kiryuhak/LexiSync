import { t } from './i18n';
import { isSiteDisabled, normalizeDisabledSites } from './privacy';
import type { CustomCommand, RequestMode, SelectionData, TextSnippet } from './types';
import { DEFAULT_TEXT_SNIPPETS, getTextSnippetExpansion, normalizeTextSnippets } from './text-snippets';
import {
    captureSelection,
    getSelectedText,
    getSelectionCoords as readSelectionCoords,
    shouldShowSelectionMenu,
    type SelectionCoords,
} from './selection-state';
import {
    showToolbarMenu as showContentToolbar,
    showAIMenu as showContentAiMenu,
    type ContentMenuContext,
} from './content-menus';
import { showQuickBubble } from './content-quick-bubble';
import { POPUP_STYLE_TEXT } from './content-ui-style';
import { calculatePopupPosition } from './popup-position';
import { unmountResultDialogFrame } from './result-dialog-view';
import {
    handleActionClick as handleContentAction,
    executeRequest as executeContentRequest,
    type ContentRequestContext,
} from './content-request-panel';
import { ensureOptionalContentFeature, OCR_IMAGE_EVENT, OCR_START_EVENT } from './optional-content-features';
import { applyAppearanceStyle, normalizeAppearanceStyle, type AppearanceStyle } from './appearance-style';
import {
    applyThemeCustomization,
    normalizeThemeCustomization,
    DEFAULT_THEME_CUSTOMIZATION,
} from './theme-customization';
import { applyFastTypographyAndTypoFixes } from './local-text-rules';
import { fixKeyboardLayout } from './keyboard-layout';
import { dispatchValueEvents, replaceSelectedText, setNativeValue } from './text-replacement';
import { shouldUseAutomaticTextFeatures } from './live-proofread-privacy';
import type { ThemeCustomization } from './types';
import { logger } from './logger';

const contentRuntime = globalThis as typeof globalThis & { __lexisyncContentInitialized?: boolean };
if (!contentRuntime.__lexisyncContentInitialized) {
    contentRuntime.__lexisyncContentInitialized = true;

    // До загрузки настроек ничего не показываем: это исключает короткое появление
    // интерфейса на сайтах, которые пользователь уже отключил.
    let extensionEnabledOnSite = false;
    let adaptiveSuggestionsInitialized = false;
    const ensureAdaptiveSuggestions = async () => {
        if (adaptiveSuggestionsInitialized) return;
        adaptiveSuggestionsInitialized = true;
        try {
            await ensureOptionalContentFeature('adaptive');
        } catch (error) {
            adaptiveSuggestionsInitialized = false;
            logger.error(t('adaptiveLoadFailed', 'Не удалось загрузить персональные подсказки.'), error);
        }
    };
    let liveProofreadInitialized = false;
    const ensureLiveProofread = async () => {
        if (liveProofreadInitialized) return;
        liveProofreadInitialized = true;
        try {
            await ensureOptionalContentFeature('liveProofread');
        } catch (error) {
            liveProofreadInitialized = false;
            logger.error(t('liveProofLoadFailed', 'Не удалось загрузить автоматическую проверку.'), error);
        }
    };
    const ensureEnabledOptionalFeatures = async (): Promise<void> => {
        if (!extensionEnabledOnSite) return;
        const stored = await chrome.storage.local.get({
            adaptiveSuggestionsEnabled: false,
            liveProofreadEnabled: false,
        });
        if (stored.adaptiveSuggestionsEnabled === true) void ensureAdaptiveSuggestions();
        if (stored.liveProofreadEnabled === true) void ensureLiveProofread();
    };

    let currentQuickActionBubbleEnabled = true;
    let isPopupPinned = false;

    void chrome.storage.local
        .get({
            blockedSites: [],
            adaptiveSuggestionsEnabled: false,
            liveProofreadEnabled: false,
            quickActionBubbleEnabled: true,
        })
        .then((stored) => {
            currentQuickActionBubbleEnabled = stored.quickActionBubbleEnabled !== false;
            extensionEnabledOnSite = !isSiteDisabled(location.hostname, normalizeDisabledSites(stored.blockedSites));
            if (!extensionEnabledOnSite) return;
            if (stored.adaptiveSuggestionsEnabled === true) void ensureAdaptiveSuggestions();
            if (stored.liveProofreadEnabled === true) void ensureLiveProofread();
        });
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.quickActionBubbleEnabled !== undefined) {
            currentQuickActionBubbleEnabled = changes.quickActionBubbleEnabled.newValue !== false;
        }
        if (areaName === 'local' && extensionEnabledOnSite && changes.adaptiveSuggestionsEnabled?.newValue === true) {
            void ensureAdaptiveSuggestions();
        }
        if (areaName === 'local' && extensionEnabledOnSite && changes.liveProofreadEnabled?.newValue === true) {
            void ensureLiveProofread();
        }
        if (areaName === 'local' && changes.blockedSites) {
            extensionEnabledOnSite = !isSiteDisabled(
                location.hostname,
                normalizeDisabledSites(changes.blockedSites.newValue),
            );
            if (!extensionEnabledOnSite) {
                cancelPendingSelectionMenu();
                closePopup();
            } else {
                void ensureEnabledOptionalFeatures();
            }
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

    function isSelectionInsidePopup(): boolean {
        const selection = window.getSelection();
        return Boolean(selection?.anchorNode && popupShadow && selection.anchorNode.getRootNode() === popupShadow);
    }

    function scheduleSelectionMenu(delay = 50, useSelectionCoords = false): void {
        cancelPendingSelectionMenu();
        pendingSelectionMenuTimer = setTimeout(() => {
            pendingSelectionMenuTimer = null;
            const selection = captureSelection();
            // Не открываем вторую панель поверх меню или результата, а также после отключения сайта.
            if (!shouldShowSelectionMenu(extensionEnabledOnSite, Boolean(popupUI), selection.text)) return;
            currentSelection = selection;
            const coords = getSelectionCoords();
            const posX = useSelectionCoords ? coords.x : lastMouseX || coords.x;
            const posY = useSelectionCoords ? coords.y : lastMouseY || coords.y;

            if (currentQuickActionBubbleEnabled) {
                showQuickBubble(posX, posY, menuContext, () => showToolbarMenu(posX, posY, coords.top), coords.top);
            } else {
                showToolbarMenu(posX, posY, coords.top);
            }
        }, delay);
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'lexisyncPing') {
            sendResponse({ ok: true });
            return;
        }
        if (request.action === 'setSiteEnabled') {
            extensionEnabledOnSite = request.enabled === true;
            if (!extensionEnabledOnSite) {
                cancelPendingSelectionMenu();
                closePopup();
            } else {
                void ensureEnabledOptionalFeatures();
            }
            sendResponse({ ok: true });
            return;
        }
        if (!extensionEnabledOnSite) return;
        if (request.action === 'showToast' && typeof request.message === 'string') {
            showToast(request.message);
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
            cancelPendingSelectionMenu();
            saveSelectionState(request.text);
            const x = lastMouseX || window.innerWidth / 2;
            const y = lastMouseY || window.innerHeight / 2;
            showAIMenu(x, y, y);
            handleActionClick(request.mode);
        }

        if (
            request.action === 'quickFixInPlace' ||
            (request.action === 'hotkeyTriggered' && request.mode === 'quick_fix_inplace')
        ) {
            cancelPendingSelectionMenu();
            let text = getSelectedText();
            const selection = captureSelection();
            if (!text && selection.isInput && selection.activeElement) {
                text = selection.activeElement.value;
                selection.start = 0;
                selection.end = text.length;
            }
            if (text && text.trim().length > 0) {
                const fixed = applyFastTypographyAndTypoFixes(text);
                const resultText = fixed.changed ? fixed.text : fixKeyboardLayout(text);
                if (resultText !== text) {
                    replaceSelectedText(selection, resultText);
                    showToast(t('quickFixDone', '✨ Исправлено на месте (0 мс)'));
                } else {
                    showToast(t('quickFixNoChanges', 'Ошибок не найдено'));
                }
            }
            return;
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
                    showAIMenu(coords.x, coords.y, coords.top);
                    handleActionClick(request.mode);
                }
            })();
            // Убрали return true, чтобы не было ошибки в консоли!
        }

        if (request.action === 'historyReplay') {
            cancelPendingSelectionMenu();
            void (async () => {
                saveSelectionState(typeof request.text === 'string' ? request.text : '');
                const coords = getSelectionCoords();
                showAIMenu(coords.x, coords.y, coords.top);
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
            if (popupUI && !isPopupEvent(e) && !isPopupPinned) {
                closePopup();
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
    let cachedSnippets: TextSnippet[] = [...DEFAULT_TEXT_SNIPPETS];

    document.addEventListener('selectionchange', () => {
        if (!extensionEnabledOnSite || isDragging || isManuallyPositioned || isSelectionInsidePopup()) return;
        scheduleSelectionMenu(80, true);
    });

    document.addEventListener('dblclick', (e: MouseEvent) => {
        if (!extensionEnabledOnSite || !e.altKey) return;
        const selectionText = window.getSelection()?.toString().trim();
        if (!selectionText || selectionText.length === 0 || selectionText.length > 200) return;
        saveSelectionState(selectionText);
        showAIMenu(e.clientX, e.clientY, e.clientY);
        handleActionClick('translate');
    });

    document.addEventListener(
        'keydown',
        async (e: KeyboardEvent) => {
            if (!extensionEnabledOnSite) return;
            if (isPopupEvent(e)) return;

            if ((e.key === 'Tab' || e.key === ' ') && !e.ctrlKey && !e.altKey && !e.metaKey) {
                const target = e.target;
                if (
                    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
                    !target.disabled &&
                    !target.readOnly
                ) {
                    const inputType = target instanceof HTMLInputElement ? target.type : null;
                    const fieldIdentity = [target.name, target.id, target.getAttribute('aria-label') || ''].join(' ');
                    if (shouldUseAutomaticTextFeatures(inputType, target.autocomplete, fieldIdentity)) {
                        const expansion = getTextSnippetExpansion(
                            target.value,
                            target.selectionStart ?? target.value.length,
                            cachedSnippets,
                        );
                        if (expansion) {
                            e.preventDefault();
                            setNativeValue(target, expansion.nextValue);
                            target.setSelectionRange(expansion.nextCursor, expansion.nextCursor);
                            dispatchValueEvents(target);
                            return;
                        }
                    }
                }
            }

            const isSelectAll =
                (e.ctrlKey || e.metaKey) &&
                (e.code === 'KeyA' || e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'ф');
            if (isSelectAll) {
                // Use the shared cancellable timer so a hotkey pressed immediately
                // after Ctrl+A can cancel the toolbar before starting the request.
                scheduleSelectionMenu(50, true);
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
                        showAIMenu(coords.x, coords.y, coords.top);
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
            textSnippets: DEFAULT_TEXT_SNIPPETS,
        },
        (res) => {
            if (res.selectedTheme) currentTheme = res.selectedTheme as string;
            currentVisualStyle = normalizeAppearanceStyle(res.visualStyle);
            currentThemeCustomization = normalizeThemeCustomization(res.themeCustomization);
            if (res.searchEngine) currentSearchEngine = res.searchEngine as string;
            currentInterfaceScale = normalizeInterfaceScale(res.interfaceScale);
            cachedSnippets = normalizeTextSnippets(res.textSnippets);
        },
    );

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            if (changes.textSnippets) {
                cachedSnippets = normalizeTextSnippets(changes.textSnippets.newValue);
            }
            if (changes.selectedTheme) {
                currentTheme = changes.selectedTheme.newValue as string;
                if (popupUI) applyThemeToPopup(popupUI);
            }
            if (changes.visualStyle) {
                currentVisualStyle = normalizeAppearanceStyle(changes.visualStyle.newValue);
                if (popupUI) applyAppearanceStyle(popupUI, currentVisualStyle);
            }
            if (changes.themeCustomization) {
                currentThemeCustomization = normalizeThemeCustomization(changes.themeCustomization.newValue);
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
    let lastAnchorTop: number = 0;

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

        const stopEventLeak = (e: Event) => {
            e.stopPropagation();
        };
        for (const evt of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
            popupHost.addEventListener(evt, stopEventLeak, false);
        }

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

        for (const evt of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
            popup.addEventListener(evt, stopEventLeak, false);
        }

        popupShadow.appendChild(popup);
        getPopupContainer().appendChild(popupHost);
        return popup;
    }

    function showToast(message: string): void {
        closePopup(true, false);
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
        // Элемент за пределами настоящего top-layer dialog должен находиться у
        // корня документа. Иначе transform на пользовательской модалке (например,
        // в Telegram Web) меняет систему координат position:fixed и уводит окно.
        const findTopLayerDialog = (element: Element | null): HTMLDialogElement | null => {
            const dialog = element?.closest('dialog');
            if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return null;
            try {
                return dialog.matches(':modal') ? dialog : null;
            } catch {
                return null;
            }
        };
        const activeDialog = findTopLayerDialog(document.activeElement);
        if (activeDialog) return activeDialog;
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            let node: Node | null = sel.anchorNode;
            if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
            if (node instanceof Element) {
                const selectionDialog = findTopLayerDialog(node);
                if (selectionDialog) return selectionDialog;
            }
        }
        return document.documentElement;
    }

    function saveSelectionState(fallbackText?: string): void {
        currentSelection = captureSelection(fallbackText);
    }

    function getSelectionCoords(): SelectionCoords {
        return readSelectionCoords(lastMouseX, lastMouseY);
    }

    const menuContext: ContentMenuContext = {
        openPopup: (x, y, top) => {
            // При переходе между панелью выделения, меню и результатом не оставляем
            // старый host в DOM: иначе на короткое время появляются одинаковые id.
            closePopup(true, false);
            injectStyles();
            lastAnchorX = x;
            lastAnchorY = y;
            lastAnchorTop = typeof top === 'number' ? top : y;
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

    function showToolbarMenu(x: number, y: number, top?: number): void {
        showContentToolbar(x, y, menuContext, top);
    }

    function showAIMenu(x: number, y: number, top?: number): void {
        showContentAiMenu(x, y, menuContext, top);
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
        isPinned: () => isPopupPinned,
        setPinned: (pinned: boolean) => {
            isPopupPinned = pinned;
        },
    };

    function handleActionClick(mode: RequestMode): void {
        handleContentAction(mode, requestContext);
    }

    function executeRequest(mode: RequestMode, customCommand?: CustomCommand): void {
        void executeContentRequest(mode, customCommand, requestContext);
    }

    function adjustPopupPosition(): void {
        if (!popupUI || isManuallyPositioned) return;
        const rect = popupUI.getBoundingClientRect();
        const position = calculatePopupPosition({
            anchorX: lastAnchorX,
            anchorY: lastAnchorY,
            anchorTop: lastAnchorTop || lastAnchorY,
            popupWidth: rect.width,
            popupHeight: rect.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
        });
        popupUI.style.setProperty('left', `${position.x}px`, 'important');
        popupUI.style.setProperty('top', `${position.y}px`, 'important');
        popupUI.style.setProperty('visibility', 'visible', 'important');
        popupUI.style.setProperty('opacity', '1', 'important');
    }

    function closePopup(removeImmediately = false, restoreFocus = true): void {
        isPopupPinned = false;
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
            unmountResultDialogFrame(el);
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            if (removeImmediately) host?.remove();
            else setTimeout(() => host?.remove(), 150);
            if (restoreFocus) {
                previousFocus?.focus({ preventScroll: true });
                previousFocus = null;
            }
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
        lastAnchorTop = Number(detail.rect.top || 0);
        closePopup(true);
        injectStyles();
        popupUI = createPopupElement();
        applyThemeToPopup(popupUI);
        popupUI.style.cssText =
            'position:fixed!important;left:0px;top:0px;visibility:hidden;opacity:0;background:var(--bg-primary);z-index:2147483647!important;font-family:system-ui,sans-serif;font-size:13px;color:var(--text-primary);';
        executeRequest('ocr');
    });
}
