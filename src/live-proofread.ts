import { normalizeDisabledSites, isSiteDisabled } from './privacy';
import { getWordCorrections, renderSpellcheckDiffFragment, resolveCorrections } from './spellcheck';
import { startTextRequest, type CancellableTextRequest } from './stream-request-client';
import { dispatchValueEvents, setNativeValue } from './text-replacement';
import { t } from './i18n';
import { shouldAutoProofreadField } from './live-proofread-privacy';
import { calculatePopupPosition } from './popup-position';

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
            .card{box-sizing:border-box;width:min(380px,calc(100vw - 24px));padding:12px 14px;border:1px solid #dfe5df;border-radius:14px;background:#fff;color:#202523;box-shadow:0 12px 34px rgba(23,33,27,0.18);font:13px/1.45 system-ui,sans-serif}
            .head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px}.head strong{color:#176b3a;font-size:13px;font-weight:600}
            .preview{max-height:120px;overflow-y:auto;margin:8px 0 10px;padding:9px 11px;border-radius:9px;background:#f7faf7;white-space:pre-wrap;word-break:break-word;line-height:1.5}.preview mark{display:inline;padding:1px 4px;margin:0 1px;border-radius:4px;color:#176b3a;background:#d9f8e5;font-weight:500;cursor:pointer;text-decoration:none}.preview mark:hover{background:#c3f2d4}.preview mark:focus{outline:2px solid #247a47}
            button{border:0;font:inherit;cursor:pointer}
            .close{width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#58615b;background:#eef2ef;font-size:14px;line-height:1}.close:hover{background:#dfe5e0;color:#202523}
            .actions{display:flex;align-items:center;justify-content:space-between;gap:10px}
            .note{display:flex;flex-direction:column;gap:2px;min-width:0}
            .note-text{font-size:11px;color:#58615b;line-height:1.2}
            .exclude{align-self:flex-start;padding:2px 5px;border-radius:4px;background:transparent;color:#58615b;font-size:11px;text-decoration:underline;text-underline-offset:2px}.exclude:hover{background:#eef2ef;color:#202523}
            .apply{color:#fff;background:#176b3a;display:inline-flex;align-items:center;gap:6px;font-weight:600;padding:7px 12px;border-radius:8px;flex-shrink:0;box-shadow:0 2px 6px rgba(23,107,58,0.2);transition:background 0.15s}.apply:hover{background:#135830}.apply kbd{font-size:10px;opacity:0.9;padding:1px 4px;border-radius:4px;background:rgba(255,255,255,0.25);font-family:inherit}
            @media (prefers-color-scheme: dark){.card{background:#1e2620;color:#d4e0d6;border-color:#3a4a3d;box-shadow:0 12px 34px rgba(0,0,0,0.5)}.head strong{color:#7dd4a0}.preview{background:#252e27}.preview mark{color:#7dd4a0;background:#1a3d28}.preview mark:hover{background:#224f35}.close{color:#a8b8aa;background:#2c3a2f}.close:hover{background:#384a3c;color:#fff}.note-text,.exclude{color:#8a9e8d}.exclude:hover{background:#2c3a2f;color:#d4e0d6}.apply{background:#247a47}.apply:hover{background:#1c663b}}
        `;
        const card = document.createElement('div');
        card.className = 'card';
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
        });
        enabled = stored.liveProofreadEnabled === true;
        disabledSites = normalizeDisabledSites(stored.liveProofreadDisabledSites);
        delay = [600, 900, 1500, 2500].includes(Number(stored.liveProofreadDelay))
            ? Number(stored.liveProofreadDelay)
            : 900;
        if (!enabled || isSiteDisabled(location.hostname, disabledSites)) {
            cancelPendingProofread();
        }
    };
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: chrome.storage.AreaName) => {
        if (
            areaName === 'local' &&
            (changes.liveProofreadEnabled || changes.liveProofreadDelay || changes.liveProofreadDisabledSites)
        )
            void updateSettings();
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
