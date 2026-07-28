import { normalizeDisabledSites, isSiteDisabled } from './privacy';
import { getWordCorrections, renderSpellcheckDiffFragment, resolveCorrections } from './spellcheck';
import { startTextRequest, type CancellableTextRequest } from './stream-request-client';
import { dispatchValueEvents, setNativeValue } from './text-replacement';

const ALLOWED_INPUT_TYPES = new Set(['text', 'search', 'email', 'url']);

function isSafeEditor(value: EventTarget | null): value is HTMLInputElement | HTMLTextAreaElement {
    if (!(value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement)) return false;
    if (value instanceof HTMLInputElement && !ALLOWED_INPUT_TYPES.has(value.type)) return false;
    if (value.readOnly || value.disabled || value.closest('[data-lexisync-ignore]')) return false;
    const autocomplete = value.autocomplete.toLowerCase();
    return !/(?:password|cc-|one-time-code)/.test(autocomplete);
}

export function startLiveProofread(): () => void {
    let enabled = false;
    let delay = 900;
    let timer = 0;
    let host: HTMLElement | null = null;
    let requestVersion = 0;
    let activeRequest: CancellableTextRequest | null = null;
    let disabledSites: string[] = [];

    const close = () => {
        host?.remove();
        host = null;
    };

    const showSuggestion = (editor: HTMLInputElement | HTMLTextAreaElement, original: string, corrected: string) => {
        close();
        const corrections = getWordCorrections(original, corrected);
        if (!corrections.length || editor.value !== original) return;
        const rejected = new Set<number>();
        host = document.createElement('div');
        host.dataset.lexisyncLiveProof = '';
        host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;';
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
            .card{width:min(340px,calc(100vw - 24px));padding:10px;border:1px solid #dfe5df;border-radius:14px;background:#fff;color:#202523;box-shadow:0 12px 34px #17211b2b;font:13px/1.45 system-ui,sans-serif}
            .head,.actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.head strong{color:#176b3a}.preview{max-height:110px;overflow:auto;margin:9px 0;padding:9px;border-radius:9px;background:#f7faf7;white-space:pre-wrap}.preview mark{padding:1px 2px;border-radius:4px;color:#176b3a;background:#d9f8e5;cursor:pointer}.preview mark:focus{outline:2px solid #247a47}
            button{padding:7px 10px;border:0;border-radius:8px;font:inherit;cursor:pointer}.apply{color:#fff;background:#247a47}.close,.exclude{color:#58615b;background:#eef2ef}.note{display:grid;gap:2px;color:#58615b;font-size:11px}
        `;
        const card = document.createElement('div');
        card.className = 'card';
        const head = document.createElement('div');
        head.className = 'head';
        const title = document.createElement('strong');
        title.textContent = `Найдено исправлений: ${corrections.length}`;
        const dismiss = document.createElement('button');
        dismiss.className = 'close';
        dismiss.type = 'button';
        dismiss.textContent = '×';
        dismiss.setAttribute('aria-label', 'Закрыть');
        dismiss.onclick = close;
        head.append(title, dismiss);
        const preview = document.createElement('div');
        preview.className = 'preview';
        const renderPreview = () => {
            preview.replaceChildren(renderSpellcheckDiffFragment(original, corrected, rejected, { corrections }));
            for (const mark of preview.querySelectorAll<HTMLElement>('mark[data-token-index]')) {
                const tokenIndex = Number(mark.dataset.tokenIndex);
                mark.tabIndex = 0;
                mark.setAttribute('role', 'button');
                mark.setAttribute('aria-label', 'Отклонить это исправление');
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
        noteText.textContent = 'Нажмите на зелёное, чтобы отклонить';
        const exclude = document.createElement('button');
        exclude.className = 'exclude';
        exclude.type = 'button';
        exclude.textContent = 'Не проверять сайт';
        exclude.onclick = () => {
            disabledSites = [...new Set([...disabledSites, location.hostname])].sort();
            void chrome.storage.local.set({ liveProofreadDisabledSites: disabledSites });
            close();
        };
        note.append(noteText, exclude);
        const apply = document.createElement('button');
        apply.className = 'apply';
        apply.type = 'button';
        apply.textContent = 'Применить';
        apply.onclick = () => {
            if (editor.value !== original) return close();
            const resolved = resolveCorrections(corrected, corrections, rejected);
            setNativeValue(editor, resolved);
            dispatchValueEvents(editor);
            close();
        };
        actions.append(note, apply);
        card.append(head, preview, actions);
        shadow.append(style, card);
        document.documentElement.append(host);
        const rect = editor.getBoundingClientRect();
        const left = Math.min(Math.max(12, rect.left), window.innerWidth - 352);
        const top = rect.bottom + 8 + 180 < window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - 180);
        host.style.left = `${left}px`;
        host.style.top = `${top}px`;
    };

    const onInput = (event: Event) => {
        if (!enabled || !isSafeEditor(event.target)) return;
        if (isSiteDisabled(location.hostname, disabledSites)) return;
        const editor = event.target;
        const original = editor.value;
        window.clearTimeout(timer);
        activeRequest?.cancel();
        activeRequest = null;
        close();
        if (original.trim().length < 12 || original.length > 5000) return;
        const version = ++requestVersion;
        timer = window.setTimeout(async () => {
            try {
                const request = startTextRequest({
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
                activeRequest = null;
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
            activeRequest?.cancel();
            activeRequest = null;
            close();
        }
    };
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: chrome.storage.AreaName) => {
        if (
            areaName === 'local' &&
            (changes.liveProofreadEnabled || changes.liveProofreadDelay || changes.liveProofreadDisabledSites)
        )
            void updateSettings();
    };
    const onPageHide = () => activeRequest?.cancel();
    void updateSettings();
    document.addEventListener('input', onInput, true);
    window.addEventListener('pagehide', onPageHide);
    chrome.storage.onChanged.addListener(onStorage);
    return () => {
        document.removeEventListener('input', onInput, true);
        chrome.storage.onChanged.removeListener(onStorage);
        window.removeEventListener('pagehide', onPageHide);
        window.clearTimeout(timer);
        activeRequest?.cancel();
        close();
    };
}
