import { normalizeDisabledSites, isSiteDisabled } from './privacy';
import { getWordCorrections, renderSpellcheckDiffFragment, resolveCorrections } from './spellcheck';
import { startTextRequest, type CancellableTextRequest } from './stream-request-client';
import { dispatchValueEvents, setNativeValue } from './text-replacement';
import { t } from './i18n';
import { shouldAutoProofreadField } from './live-proofread-privacy';
import { calculatePopupPosition } from './popup-position';
import { normalizeAppearanceStyle, applyAppearanceStyle, type AppearanceStyle } from './appearance-style';
import {
    normalizeThemeCustomization,
    applyThemeCustomization,
    DEFAULT_THEME_CUSTOMIZATION,
} from './theme-customization';
import type { ThemeCustomization } from './types';

type EditableElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function isSafeEditor(value: EventTarget | null): value is EditableElement {
    if (!value || !(value instanceof HTMLElement)) return false;
    const isInput = value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement;
    const isContentEditable = value.isContentEditable || value.getAttribute('contenteditable') === 'true';
    if (!isInput && !isContentEditable) return false;

    const inputType = value instanceof HTMLInputElement ? value.type : null;
    const autocomplete =
        value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement ? value.autocomplete : '';
    const placeholder =
        value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement
            ? value.placeholder
            : value.getAttribute('placeholder') || '';
    const fieldIdentity = [
        value.getAttribute('name'),
        value.id,
        value.getAttribute('aria-label'),
        value.getAttribute('aria-labelledby'),
        placeholder,
        value.title,
        value.className,
    ]
        .filter(Boolean)
        .join(' ');
    if (!shouldAutoProofreadField(inputType, autocomplete, fieldIdentity)) return false;
    if (
        (value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement) &&
        (value.readOnly || value.disabled)
    )
        return false;
    if (value.closest('[data-lexisync-ignore]')) return false;
    return true;
}

function getEditorText(editor: EditableElement): string {
    if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
        return editor.value;
    }
    return editor.innerText || editor.textContent || '';
}

function setEditorText(editor: EditableElement, text: string): void {
    if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
        setNativeValue(editor, text);
        dispatchValueEvents(editor);
        return;
    }
    editor.focus();
    const selection = window.getSelection();
    let handled = false;
    if (selection) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
        try {
            handled = document.execCommand('insertText', false, text);
        } catch {
            handled = false;
        }
    }
    if (!handled) {
        editor.innerText = text;
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
}

function enableNativeSpellcheck(editor: EditableElement): void {
    if (editor.getAttribute('spellcheck') !== 'true') {
        editor.spellcheck = true;
        editor.setAttribute('spellcheck', 'true');
    }
}

export function startLiveProofread(): () => void {
    let enabled = false;
    let delay = 900;
    let timer = 0;
    let host: HTMLElement | null = null;
    let requestVersion = 0;
    let activeRequest: CancellableTextRequest | null = null;
    let disabledSites: string[] = [];
    let dismissListeners: (() => void) | null = null;
    let currentTheme = 'auto';
    let currentVisualStyle: AppearanceStyle = 'liquid-glass';
    let currentThemeCustomization: ThemeCustomization = { ...DEFAULT_THEME_CUSTOMIZATION };
    const ignoredInputEvents = new WeakSet<HTMLElement>();

    const close = () => {
        dismissListeners?.();
        dismissListeners = null;
        host?.remove();
        host = null;
    };

    const cancelPendingProofread = () => {
        window.clearTimeout(timer);
        timer = 0;
        requestVersion++;
        activeRequest?.cancel();
        activeRequest = null;
        close();
    };

    const showSuggestion = (editor: EditableElement, original: string, corrected: string) => {
        close();
        const corrections = getWordCorrections(original, corrected);
        if (!corrections.length || getEditorText(editor) !== original) return;
        const rejected = new Set<number>();
        host = document.createElement('div');
        host.dataset.lexisyncLiveProof = '';
        host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;';
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
            :host { all: initial; }
            .card {
                --bg-primary: rgba(248, 250, 255, 0.88);
                --bg-solid: #f8faff;
                --bg-elevated: rgba(248, 250, 255, 0.98);
                --bg-secondary: rgba(255, 255, 255, 0.75);
                --text-primary: #1c2438;
                --text-secondary: #69738d;
                --primary: #6d5ce7;
                --primary-strong: #5947d2;
                --primary-soft: rgba(109, 92, 231, 0.12);
                --cyan-soft: rgba(31, 174, 190, 0.12);
                --border-color: rgba(255, 255, 255, 0.8);
                --inner-border: rgba(83, 91, 126, 0.14);
                --hover-bg: rgba(255, 255, 255, 0.9);
                --shadow-color: rgba(41, 43, 77, 0.22);
                --lexisync-radius: 18px;
                box-sizing: border-box;
                width: min(390px, calc(100vw - 24px));
                padding: 13px 15px;
                border: 1px solid var(--border-color);
                border-radius: var(--lexisync-radius, 18px);
                background: var(--bg-primary);
                color: var(--text-primary);
                box-shadow: 0 20px 52px var(--shadow-color), 0 3px 10px rgba(38, 40, 72, 0.08);
                backdrop-filter: blur(24px) saturate(160%);
                -webkit-backdrop-filter: blur(24px) saturate(160%);
                font: 13px/1.45 system-ui, -apple-system, sans-serif;
                animation: lexiSyncFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
            @keyframes lexiSyncFadeIn {
                from { opacity: 0; transform: translateY(6px) scale(0.98); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .card[data-theme="dark"] {
                --bg-primary: rgba(27, 30, 49, 0.9);
                --bg-solid: #1b1e31;
                --bg-elevated: rgba(27, 30, 49, 0.98);
                --bg-secondary: rgba(49, 54, 82, 0.75);
                --text-primary: #f5f6fc;
                --text-secondary: #abb4ce;
                --primary: #b7a8ff;
                --primary-strong: #9c89ff;
                --primary-soft: rgba(183, 168, 255, 0.16);
                --border-color: rgba(255, 255, 255, 0.16);
                --inner-border: rgba(255, 255, 255, 0.1);
                --hover-bg: rgba(64, 70, 104, 0.9);
                --shadow-color: rgba(0, 0, 0, 0.55);
            }
            .card[data-ui-style="magicos-11"] {
                --bg-primary: rgba(246, 250, 255, 0.68);
                --bg-solid: #f4f8ff;
                --bg-elevated: rgba(255, 255, 255, 0.88);
                --bg-secondary: rgba(235, 242, 255, 0.72);
                --text-primary: #19233b;
                --text-secondary: #5b6881;
                --primary: #4267f5;
                --primary-strong: #624fe5;
                --primary-soft: rgba(72, 108, 246, 0.16);
                --border-color: rgba(255, 255, 255, 0.9);
                --inner-border: rgba(78, 103, 161, 0.16);
                --hover-bg: rgba(255, 255, 255, 0.85);
                --shadow-color: rgba(31, 56, 118, 0.28);
                --lexisync-radius: 28px;
                border-radius: 28px;
                box-shadow: 0 26px 68px var(--shadow-color), 0 4px 14px rgba(38, 54, 96, 0.14);
                backdrop-filter: blur(32px) saturate(185%);
                -webkit-backdrop-filter: blur(32px) saturate(185%);
            }
            .card[data-ui-style="magicos-11"][data-theme="dark"] {
                --bg-primary: rgba(25, 34, 57, 0.78);
                --bg-solid: #192239;
                --bg-elevated: rgba(47, 59, 91, 0.82);
                --bg-secondary: rgba(58, 72, 108, 0.7);
                --text-primary: #f6f8ff;
                --text-secondary: #bac5dc;
                --primary: #a6baff;
                --primary-strong: #b29cff;
                --primary-soft: rgba(145, 171, 255, 0.22);
                --border-color: rgba(255, 255, 255, 0.22);
                --inner-border: rgba(255, 255, 255, 0.12);
                --hover-bg: rgba(80, 96, 140, 0.75);
                --shadow-color: rgba(0, 0, 0, 0.58);
            }
            .card[data-ui-style="material-3"] {
                --bg-primary: #ffffff;
                --bg-solid: #ffffff;
                --bg-elevated: #f7f8fa;
                --bg-secondary: #f1f3f6;
                --text-primary: #1d1b20;
                --text-secondary: #49454f;
                --primary: #6750a4;
                --primary-strong: #4f378b;
                --primary-soft: #eee9ff;
                --border-color: #c8cdd4;
                --inner-border: #d9dde3;
                --hover-bg: #e9edf2;
                --shadow-color: rgba(29, 35, 43, 0.2);
                border-radius: 28px;
                backdrop-filter: none;
                -webkit-backdrop-filter: none;
            }
            .card[data-ui-style="material-3"][data-theme="dark"] {
                --bg-primary: #1d2024;
                --bg-solid: #1d2024;
                --bg-elevated: #272b30;
                --bg-secondary: #272b30;
                --text-primary: #f2f4f7;
                --text-secondary: #c5cad1;
                --primary: #c7b8ff;
                --primary-strong: #ad99ff;
                --primary-soft: #493b78;
                --border-color: #454b54;
                --inner-border: #3b4149;
                --hover-bg: #31363c;
                --shadow-color: rgba(0, 0, 0, 0.55);
            }
            .head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 6px;
            }
            .head strong {
                color: var(--primary-strong, var(--primary, #4267f5));
                font-size: 13px;
                font-weight: 600;
            }
            .preview {
                max-height: 120px;
                overflow-y: auto;
                margin: 8px 0 12px;
                padding: 10px 12px;
                border-radius: calc(var(--lexisync-radius, 18px) * 0.55);
                background: var(--bg-secondary);
                border: 1px solid var(--inner-border);
                color: var(--text-primary);
                white-space: pre-wrap;
                word-break: break-word;
                line-height: 1.55;
                font-size: 13px;
            }
            .preview mark {
                display: inline;
                padding: 2px 5px;
                margin: 0 1px;
                border-radius: 5px;
                color: var(--primary-strong, var(--primary, #4267f5));
                background: var(--primary-soft, rgba(66, 103, 245, 0.16));
                font-weight: 600;
                cursor: pointer;
                text-decoration: none;
                transition: background 0.15s;
            }
            .preview mark:hover {
                filter: brightness(0.92);
            }
            .preview mark:focus {
                outline: 2px solid var(--primary);
            }
            button {
                border: 0;
                font: inherit;
                cursor: pointer;
            }
            .close {
                width: 24px;
                height: 24px;
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--text-secondary);
                background: var(--bg-secondary);
                border: 1px solid var(--inner-border);
                font-size: 14px;
                line-height: 1;
                transition: background 0.15s, color 0.15s;
            }
            .close:hover {
                background: var(--hover-bg);
                color: var(--text-primary);
            }
            .actions {
                display: flex;
                align-items: flex-end;
                justify-content: space-between;
                gap: 12px;
            }
            .note {
                display: flex;
                flex-direction: column;
                gap: 3px;
                min-width: 0;
            }
            .note-text {
                font-size: 11px;
                color: var(--text-secondary);
                line-height: 1.25;
            }
            .exclude {
                align-self: flex-start;
                padding: 2px 6px;
                border-radius: 6px;
                background: transparent;
                color: var(--text-secondary);
                font-size: 11px;
                text-decoration: underline;
                text-underline-offset: 2px;
                transition: color 0.15s, background 0.15s;
            }
            .exclude:hover {
                color: var(--text-primary);
                background: var(--hover-bg);
            }
            .apply {
                color: #ffffff;
                background: var(--primary, #4267f5);
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-weight: 600;
                font-size: 13px;
                padding: 8px 14px;
                border-radius: calc(var(--lexisync-radius, 18px) * 0.55);
                flex-shrink: 0;
                box-shadow: 0 3px 10px rgba(0, 0, 0, 0.15);
                transition: transform 0.1s, filter 0.15s;
            }
            .apply:hover {
                filter: brightness(1.08);
            }
            .apply:active {
                transform: scale(0.97);
            }
            .apply kbd {
                font-size: 10px;
                opacity: 0.9;
                padding: 1px 5px;
                border-radius: 4px;
                background: rgba(255, 255, 255, 0.28);
                font-family: inherit;
            }
        `;
        const card = document.createElement('div');
        card.className = 'card';
        applyAppearanceStyle(card, currentVisualStyle);
        applyThemeCustomization(card, currentThemeCustomization);
        const isDark =
            currentTheme === 'dark' ||
            (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (isDark) card.setAttribute('data-theme', 'dark');

        const head = document.createElement('div');
        head.className = 'head';
        const title = document.createElement('strong');
        title.textContent = `${t('liveProofCorrectionsFound', 'Найдено исправлений:')} ${corrections.length}`;
        const dismiss = document.createElement('button');
        dismiss.className = 'close';
        dismiss.type = 'button';
        dismiss.textContent = '×';
        dismiss.setAttribute('aria-label', t('closePanel', 'Закрыть панель'));
        dismiss.onclick = close;
        head.append(title, dismiss);
        const preview = document.createElement('div');
        preview.className = 'preview';
        const renderPreview = () => {
            preview.replaceChildren(
                renderSpellcheckDiffFragment(original, corrected, rejected, {
                    corrections,
                    showDeletionMarkers: false,
                }),
            );
            for (const mark of preview.querySelectorAll<HTMLElement>('mark[data-token-index]')) {
                const tokenIndex = Number(mark.dataset.tokenIndex);
                mark.tabIndex = 0;
                mark.setAttribute('role', 'button');
                mark.setAttribute('aria-label', t('keepOriginal', 'Оставить исходное слово'));
                const toggle = () => {
                    rejected.add(tokenIndex);
                    renderPreview();
                };
                mark.onclick = toggle;
                mark.onkeydown = (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggle();
                    }
                };
            }
        };
        renderPreview();
        const actions = document.createElement('div');
        actions.className = 'actions';
        const note = document.createElement('div');
        note.className = 'note';
        const noteText = document.createElement('span');
        noteText.className = 'note-text';
        noteText.textContent = t('liveProofDismissHint', 'Нажмите на зелёное, чтобы отклонить');
        const exclude = document.createElement('button');
        exclude.className = 'exclude';
        exclude.type = 'button';
        exclude.textContent = t('liveProofExcludeSite', 'Не проверять сайт');
        exclude.onclick = () => {
            disabledSites = [...new Set([...disabledSites, location.hostname])].sort();
            void chrome.storage.local.set({ liveProofreadDisabledSites: disabledSites });
            close();
        };
        note.append(noteText, exclude);
        const apply = document.createElement('button');
        apply.className = 'apply';
        apply.type = 'button';
        const applyText = document.createTextNode(t('applyResult', 'Применить') + ' ');
        const kbd = document.createElement('kbd');
        kbd.textContent = 'Ctrl+↵';
        apply.append(applyText, kbd);
        apply.onclick = () => {
            if (getEditorText(editor) !== original) return close();
            const resolved = resolveCorrections(corrected, corrections, rejected);
            ignoredInputEvents.add(editor);
            setEditorText(editor, resolved);
            close();
        };
        actions.append(note, apply);
        card.append(head, preview, actions);
        shadow.append(style, card);
        document.documentElement.append(host);
        const editorRect = editor.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const position = calculatePopupPosition({
            anchorX: editorRect.left,
            anchorY: editorRect.bottom,
            anchorTop: editorRect.top,
            popupWidth: cardRect.width,
            popupHeight: cardRect.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            gap: 8,
            margin: 12,
        });
        host.style.left = `${position.x}px`;
        host.style.top = `${position.y}px`;

        const currentHost = host;
        const onPointerDown = (event: PointerEvent) => {
            if (currentHost && !event.composedPath().includes(currentHost)) {
                close();
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                close();
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                apply.click();
                return;
            }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        dismissListeners = () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    };

    const onFocusIn = (event: FocusEvent) => {
        if (isSafeEditor(event.target)) {
            enableNativeSpellcheck(event.target);
        }
    };

    const onInput = (event: Event) => {
        if (event.target instanceof HTMLElement) {
            if (ignoredInputEvents.delete(event.target)) return;
        }
        if (!isSafeEditor(event.target)) return;
        enableNativeSpellcheck(event.target);
        if (!enabled) return;
        if (isSiteDisabled(location.hostname, disabledSites)) return;
        const editor = event.target;
        const original = getEditorText(editor);
        cancelPendingProofread();
        if (original.trim().length < 4 || original.length > 5000) return;
        const version = requestVersion;
        timer = window.setTimeout(async () => {
            timer = 0;
            let request: CancellableTextRequest | null = null;
            try {
                request = startTextRequest({
                    mode: 'spellcheck',
                    text: original,
                    allowPageContext: false,
                });
                activeRequest = request;
                const corrected = await request.promise;
                if (version === requestVersion) showSuggestion(editor, original, corrected);
            } catch (error) {
                if (!(error instanceof DOMException && error.name === 'AbortError')) {
                    // Фоновая проверка не должна мешать вводу.
                }
            } finally {
                if (activeRequest === request) activeRequest = null;
            }
        }, delay);
    };

    const updateSettings = async () => {
        const stored = await chrome.storage.local.get({
            liveProofreadEnabled: false,
            liveProofreadDelay: 900,
            liveProofreadDisabledSites: [],
            selectedTheme: 'auto',
            visualStyle: 'liquid-glass',
            themeCustomization: DEFAULT_THEME_CUSTOMIZATION,
        });
        enabled = stored.liveProofreadEnabled === true;
        disabledSites = normalizeDisabledSites(stored.liveProofreadDisabledSites);
        delay = [600, 900, 1500, 2500].includes(Number(stored.liveProofreadDelay))
            ? Number(stored.liveProofreadDelay)
            : 900;
        if (stored.selectedTheme) currentTheme = String(stored.selectedTheme);
        currentVisualStyle = normalizeAppearanceStyle(stored.visualStyle);
        currentThemeCustomization = normalizeThemeCustomization(stored.themeCustomization);
        if (!enabled || isSiteDisabled(location.hostname, disabledSites)) {
            cancelPendingProofread();
        }
    };
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: chrome.storage.AreaName) => {
        if (areaName === 'local') {
            if (changes.selectedTheme) currentTheme = String(changes.selectedTheme.newValue || 'auto');
            if (changes.visualStyle) currentVisualStyle = normalizeAppearanceStyle(changes.visualStyle.newValue);
            if (changes.themeCustomization)
                currentThemeCustomization = normalizeThemeCustomization(changes.themeCustomization.newValue);
            if (changes.liveProofreadEnabled || changes.liveProofreadDelay || changes.liveProofreadDisabledSites) {
                void updateSettings();
            }
        }
    };
    const onPageHide = cancelPendingProofread;
    void updateSettings();
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('input', onInput, true);
    window.addEventListener('pagehide', onPageHide);
    chrome.storage.onChanged.addListener(onStorage);
    return () => {
        document.removeEventListener('focusin', onFocusIn, true);
        document.removeEventListener('input', onInput, true);
        chrome.storage.onChanged.removeListener(onStorage);
        window.removeEventListener('pagehide', onPageHide);
        cancelPendingProofread();
    };
}
