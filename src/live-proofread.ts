import { getWordCorrections, renderSpellcheckDiffFragment } from './spellcheck';
import type { StreamResponse } from './types';

const ALLOWED_INPUT_TYPES = new Set(['text', 'search', 'email', 'url']);

function isSafeEditor(value: EventTarget | null): value is HTMLInputElement | HTMLTextAreaElement {
    if (!(value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement)) return false;
    if (value instanceof HTMLInputElement && !ALLOWED_INPUT_TYPES.has(value.type)) return false;
    if (value.readOnly || value.disabled || value.closest('[data-lexisync-ignore]')) return false;
    const autocomplete = value.autocomplete.toLowerCase();
    return !/(?:password|cc-|one-time-code)/.test(autocomplete);
}

function requestProofread(text: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'mistralStream' });
        let result = '';
        port.onMessage.addListener((message: StreamResponse) => {
            if (message.status === 'chunk') result += message.text || '';
            if (message.status === 'done') {
                port.disconnect();
                resolve(result.trim());
            } else if (message.status === 'error' || message.status === 'cancelled') {
                port.disconnect();
                reject(new Error(message.error || 'Не удалось проверить текст.'));
            }
        });
        port.postMessage({ action: 'callMistral', mode: 'spellcheck', text, allowPageContext: false });
    });
}

export function startLiveProofread(): () => void {
    let enabled = false;
    let delay = 900;
    let timer = 0;
    let host: HTMLElement | null = null;
    let requestVersion = 0;

    const close = () => {
        host?.remove();
        host = null;
    };

    const showSuggestion = (editor: HTMLInputElement | HTMLTextAreaElement, original: string, corrected: string) => {
        close();
        const corrections = getWordCorrections(original, corrected);
        if (!corrections.length || editor.value !== original) return;
        host = document.createElement('div');
        host.dataset.lexisyncLiveProof = '';
        host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;';
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
            .card{width:min(340px,calc(100vw - 24px));padding:10px;border:1px solid #dfe5df;border-radius:14px;background:#fff;color:#202523;box-shadow:0 12px 34px #17211b2b;font:13px/1.45 system-ui,sans-serif}
            .head,.actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.head strong{color:#176b3a}.preview{max-height:110px;overflow:auto;margin:9px 0;padding:9px;border-radius:9px;background:#f7faf7;white-space:pre-wrap}.preview mark{padding:1px 2px;border-radius:4px;color:#176b3a;background:#d9f8e5}
            button{padding:7px 10px;border:0;border-radius:8px;font:inherit;cursor:pointer}.apply{color:#fff;background:#247a47}.close{color:#58615b;background:#eef2ef}
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
        preview.append(renderSpellcheckDiffFragment(original, corrected, new Set(), { corrections }));
        const actions = document.createElement('div');
        actions.className = 'actions';
        const note = document.createElement('span');
        note.textContent = 'Изменения выделены зелёным';
        const apply = document.createElement('button');
        apply.className = 'apply';
        apply.type = 'button';
        apply.textContent = 'Применить';
        apply.onclick = () => {
            if (editor.value !== original) return close();
            editor.value = corrected;
            editor.dispatchEvent(
                new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: corrected }),
            );
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
        const editor = event.target;
        const original = editor.value;
        window.clearTimeout(timer);
        close();
        if (original.trim().length < 12 || original.length > 5000) return;
        const version = ++requestVersion;
        timer = window.setTimeout(async () => {
            try {
                const corrected = await requestProofread(original);
                if (version === requestVersion) showSuggestion(editor, original, corrected);
            } catch {
                // Фоновая проверка не должна мешать вводу.
            }
        }, delay);
    };

    const updateSettings = async () => {
        const stored = await chrome.storage.local.get({ liveProofreadEnabled: false, liveProofreadDelay: 900 });
        enabled = stored.liveProofreadEnabled === true;
        delay = [600, 900, 1500, 2500].includes(Number(stored.liveProofreadDelay))
            ? Number(stored.liveProofreadDelay)
            : 900;
        if (!enabled) close();
    };
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: chrome.storage.AreaName) => {
        if (areaName === 'local' && (changes.liveProofreadEnabled || changes.liveProofreadDelay)) void updateSettings();
    };
    void updateSettings();
    document.addEventListener('input', onInput, true);
    chrome.storage.onChanged.addListener(onStorage);
    return () => {
        document.removeEventListener('input', onInput, true);
        chrome.storage.onChanged.removeListener(onStorage);
        window.clearTimeout(timer);
        close();
    };
}
