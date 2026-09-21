import { isSiteDisabled, normalizeDisabledSites } from './privacy';
import { shouldAutoProofreadField } from './live-proofread-privacy';

type EditableElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function isSafeEditor(value: EventTarget | null): value is EditableElement {
    if (!value || !(value instanceof HTMLElement)) return false;
    const isInput = value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement;
    const isContentEditable = value.isContentEditable || value.getAttribute('contenteditable') === 'true';
    if (!isInput && !isContentEditable) return false;
    const inputType = value instanceof HTMLInputElement ? value.type : null;
    const autocomplete = isInput ? value.autocomplete : '';
    const identity = [
        value.getAttribute('name'),
        value.id,
        value.getAttribute('aria-label'),
        value.getAttribute('aria-labelledby'),
        isInput ? value.placeholder : value.getAttribute('placeholder'),
        value.title,
        value.className,
    ]
        .filter(Boolean)
        .join(' ');
    if (!shouldAutoProofreadField(inputType, autocomplete, identity)) return false;
    if (isInput && (value.readOnly || value.disabled)) return false;
    return !value.closest('[data-lexisync-ignore]');
}

function enableNativeSpellcheck(editor: EditableElement): void {
    editor.spellcheck = true;
    editor.setAttribute('spellcheck', 'true');
}

/**
 * Включает только встроенную проверку браузера. События ввода никогда не
 * запускают Яндекс.Спеллер или AI: облачные запросы требуют явной команды.
 */
export function startLiveProofread(): () => void {
    let enabled = false;
    let disabledSites: string[] = [];
    let blockedSites: string[] = [];

    const isAllowed = () =>
        enabled &&
        !isSiteDisabled(location.hostname, blockedSites) &&
        !isSiteDisabled(location.hostname, disabledSites);

    const enableForTarget = (target: EventTarget | null) => {
        if (isAllowed() && isSafeEditor(target)) enableNativeSpellcheck(target);
    };

    const updateSettings = async () => {
        const stored = await chrome.storage.local.get({
            liveProofreadEnabled: false,
            liveProofreadDisabledSites: [],
            blockedSites: [],
        });
        enabled = stored.liveProofreadEnabled === true;
        disabledSites = normalizeDisabledSites(stored.liveProofreadDisabledSites);
        blockedSites = normalizeDisabledSites(stored.blockedSites);
    };

    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: chrome.storage.AreaName) => {
        if (
            areaName === 'local' &&
            (changes.liveProofreadEnabled || changes.liveProofreadDisabledSites || changes.blockedSites)
        ) {
            void updateSettings();
        }
    };

    const onFocusIn = (event: FocusEvent) => enableForTarget(event.target);
    const onInput = (event: Event) => enableForTarget(event.target);
    void updateSettings();
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('input', onInput, true);
    chrome.storage.onChanged.addListener(onStorage);
    return () => {
        document.removeEventListener('focusin', onFocusIn, true);
        document.removeEventListener('input', onInput, true);
        chrome.storage.onChanged.removeListener(onStorage);
    };
}
