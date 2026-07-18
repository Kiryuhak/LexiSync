import { isSiteDisabled, normalizeDisabledSites } from './privacy';

interface WordStat {
    count: number;
    lastUsed: number;
    value: string;
}

interface PairStat {
    count: number;
    lastUsed: number;
}

export interface AdaptiveLanguageModel {
    version: 1;
    words: Record<string, WordStat>;
    pairs: Record<string, PairStat>;
}

interface AdaptiveSettings {
    enabled: boolean;
    learn: boolean;
    theme: string;
    interfaceScale: number;
    disabledSites: string[];
    personalDictionary: string[];
}

type EditableElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const MODEL_STORAGE_KEY = 'adaptiveLanguageModel';
const PAIR_SEPARATOR = '\u0001';
const MAX_WORDS = 1600;
const MAX_PAIRS = 2600;
const SAVE_DELAY = 800;

const EMPTY_MODEL: AdaptiveLanguageModel = { version: 1, words: {}, pairs: {} };

let settings: AdaptiveSettings = {
    enabled: false,
    learn: true,
    theme: 'auto',
    interfaceScale: 90,
    disabledSites: [],
    personalDictionary: [],
};
let model: AdaptiveLanguageModel = structuredClone(EMPTY_MODEL);
let suggestionHost: HTMLDivElement | null = null;
let suggestionBar: HTMLDivElement | null = null;
let activeEditable: EditableElement | null = null;
let activePrefix = '';
let activeSuggestions: string[] = [];
let saveTimer: number | null = null;
let initialized = false;
const learnedTail = new WeakMap<EditableElement, string>();

function normalizeScale(value: unknown): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 90;
    return Math.min(110, Math.max(75, Math.round(numericValue / 5) * 5));
}

function parseModel(value: unknown): AdaptiveLanguageModel {
    if (!value || typeof value !== 'object') return structuredClone(EMPTY_MODEL);
    const candidate = value as Partial<AdaptiveLanguageModel>;
    return {
        version: 1,
        words: candidate.words && typeof candidate.words === 'object' ? candidate.words : {},
        pairs: candidate.pairs && typeof candidate.pairs === 'object' ? candidate.pairs : {},
    };
}

function tokenize(text: string): string[] {
    return text.match(/[\p{L}][\p{L}'’\-]{1,31}/gu) || [];
}

function normalizeWord(word: string): string {
    return word.toLocaleLowerCase('ru-RU');
}

function isUsefulWord(word: string): boolean {
    return word.length >= 2 && word.length <= 32 && /^[\p{L}][\p{L}'’\-]+$/u.test(word);
}

function isEditableElement(target: EventTarget | null): target is EditableElement {
    if (!(target instanceof HTMLElement)) return false;
    if (target instanceof HTMLTextAreaElement) return !target.disabled && !target.readOnly;
    if (target instanceof HTMLInputElement) {
        return !target.disabled && !target.readOnly && ['text', 'search'].includes(target.type);
    }
    return target.isContentEditable;
}

function isSensitiveField(target: EditableElement): boolean {
    if (target instanceof HTMLInputElement) {
        if (!['text', 'search'].includes(target.type)) return true;
        const autocomplete = target.autocomplete.toLowerCase();
        if (/password|cc-|one-time-code|transaction|webauthn/.test(autocomplete)) return true;
    }
    const fieldIdentity = `${target.getAttribute('name') || ''} ${target.id} ${target.getAttribute('aria-label') || ''}`.toLowerCase();
    return /password|парол|passwd|credit.?card|bank.?card|cvv|cvc|otp|one.?time|secret|token|пин|pin.?code/.test(fieldIdentity);
}

function isAllowedOnCurrentPage(): boolean {
    return !chrome.extension.inIncognitoContext
        && !isSiteDisabled(location.hostname, settings.disabledSites);
}

function getTextBeforeCaret(target: EditableElement): string {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const caret = target.selectionStart ?? target.value.length;
        return target.value.slice(0, caret);
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !target.contains(selection.anchorNode)) return '';
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(target);
    range.setEnd(selection.anchorNode!, selection.anchorOffset);
    return range.toString();
}

function learnFromContext(target: EditableElement, context: string): void {
    if (!settings.learn || !/[\s.,!?;:…]$/u.test(context)) return;
    const words = tokenize(context);
    const current = words.at(-1);
    if (!current || !isUsefulWord(current)) return;

    const previous = words.at(-2);
    const signature = `${context.length}:${normalizeWord(previous || '')}:${normalizeWord(current)}`;
    if (learnedTail.get(target) === signature) return;
    learnedTail.set(target, signature);

    recordWord(current, previous);
}

function recordWord(word: string, previous?: string, weight = 1): void {
    const normalized = normalizeWord(word);
    if (!isUsefulWord(normalized)) return;
    const now = Date.now();
    const existing = model.words[normalized];
    model.words[normalized] = {
        count: Math.min(9999, (existing?.count || 0) + weight),
        lastUsed: now,
        value: word,
    };

    if (previous && isUsefulWord(previous)) {
        const pairKey = `${normalizeWord(previous)}${PAIR_SEPARATOR}${normalized}`;
        const pair = model.pairs[pairKey];
        model.pairs[pairKey] = {
            count: Math.min(9999, (pair?.count || 0) + weight),
            lastUsed: now,
        };
    }
    pruneModel();
    scheduleSave();
}

function pruneRecord<T extends { count: number; lastUsed: number }>(record: Record<string, T>, limit: number): void {
    const keys = Object.keys(record);
    if (keys.length <= limit) return;
    keys.sort((a, b) => {
        const scoreA = record[a].count * 10 + record[a].lastUsed / 1e12;
        const scoreB = record[b].count * 10 + record[b].lastUsed / 1e12;
        return scoreB - scoreA;
    });
    for (const key of keys.slice(limit)) delete record[key];
}

function pruneModel(): void {
    pruneRecord(model.words, MAX_WORDS);
    pruneRecord(model.pairs, MAX_PAIRS);
}

function scheduleSave(): void {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
        saveTimer = null;
        void chrome.storage.local.set({ [MODEL_STORAGE_KEY]: model });
    }, SAVE_DELAY);
}

function matchCase(candidate: string, prefix: string): string {
    if (prefix && prefix[0] === prefix[0].toLocaleUpperCase('ru-RU')) {
        return candidate[0].toLocaleUpperCase('ru-RU') + candidate.slice(1);
    }
    return candidate;
}

function getSuggestions(context: string): { prefix: string; suggestions: string[] } {
    const prefixMatch = context.match(/[\p{L}'’\-]+$/u);
    const prefix = prefixMatch?.[0] || '';
    const normalizedPrefix = normalizeWord(prefix);
    const beforePrefix = prefix ? context.slice(0, -prefix.length) : context;
    const previous = normalizeWord(tokenize(beforePrefix).at(-1) || '');
    const scores = new Map<string, number>();
    const now = Date.now();

    for (const [word, stat] of Object.entries(model.words)) {
        if (stat.count < 2 || word === normalizedPrefix || (normalizedPrefix && !word.startsWith(normalizedPrefix))) continue;
        const recency = Math.max(0, 14 - (now - stat.lastUsed) / 86_400_000) * 0.08;
        const pair = previous ? model.pairs[`${previous}${PAIR_SEPARATOR}${word}`] : undefined;
        if (!normalizedPrefix && (!pair || pair.count < 2)) continue;
        scores.set(word, Math.log2(stat.count + 1) + (pair ? pair.count * 2.4 : 0) + recency);
    }

    for (const dictionaryWord of settings.personalDictionary) {
        const word = normalizeWord(dictionaryWord);
        if (!isUsefulWord(word) || word === normalizedPrefix || (normalizedPrefix && !word.startsWith(normalizedPrefix))) continue;
        if (!normalizedPrefix) {
            const pair = previous ? model.pairs[`${previous}${PAIR_SEPARATOR}${word}`] : undefined;
            if (!pair || pair.count < 2) continue;
        }
        scores.set(word, Math.max(scores.get(word) || 0, 3.5));
    }

    if (!normalizedPrefix && !previous) return { prefix, suggestions: [] };
    const suggestions = [...scores.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
        .slice(0, 3)
        .map(([word]) => matchCase(model.words[word]?.value || word, prefix));
    return { prefix, suggestions };
}

function ensureSuggestionUi(): void {
    if (suggestionHost && suggestionBar) return;
    suggestionHost = document.createElement('div');
    suggestionHost.id = 'lexisync-adaptive-suggestions-host';
    suggestionHost.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483646!important;pointer-events:none!important;';
    const shadow = suggestionHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
        :host { all: initial; }
        .bar { --bg:rgba(248,250,255,.94); --text:#20283b; --muted:#6e7890; --border:rgba(255,255,255,.82); position:fixed; display:none; align-items:center; gap:5px; max-width:min(420px,calc(100vw - 20px)); padding:5px; color:var(--text); background:var(--bg); border:1px solid var(--border); border-radius:13px; box-shadow:0 14px 36px rgba(36,39,70,.22),inset 0 1px 0 rgba(255,255,255,.5); backdrop-filter:blur(24px) saturate(135%); font:12px/1.2 system-ui,-apple-system,sans-serif; pointer-events:auto; animation:show .16s ease-out; }
        .bar.dark { --bg:rgba(27,30,49,.95); --text:#f5f6fc; --muted:#abb4ce; --border:rgba(255,255,255,.14); box-shadow:0 16px 38px rgba(0,0,0,.44),inset 0 1px 0 rgba(255,255,255,.08); }
        .spark { display:grid; width:25px; height:25px; flex:0 0 auto; place-items:center; color:#fff; background:linear-gradient(135deg,#765ff0,#24b8c6); border-radius:8px; font-size:12px; }
        button { max-width:145px; padding:7px 10px; overflow:hidden; color:var(--text); background:rgba(255,255,255,.42); border:1px solid rgba(93,103,138,.1); border-radius:9px; cursor:pointer; font:600 12px/1 system-ui,-apple-system,sans-serif; text-overflow:ellipsis; white-space:nowrap; }
        .dark button { background:rgba(63,69,103,.58); border-color:rgba(255,255,255,.08); }
        button:hover,button:focus-visible { background:rgba(109,92,231,.14); outline:none; }
        kbd { margin-left:1px; padding:4px 5px; color:var(--muted); border:1px solid currentColor; border-radius:6px; font:600 9px/1 ui-monospace,monospace; opacity:.72; }
        @keyframes show { from { opacity:0; transform:translateY(4px) scale(.98); } }
        @media (prefers-reduced-motion:reduce) { .bar { animation:none; } }
    `;
    suggestionBar = document.createElement('div');
    suggestionBar.className = 'bar';
    suggestionBar.setAttribute('role', 'listbox');
    suggestionBar.setAttribute('aria-label', 'Персональные подсказки LexiSync');
    shadow.append(style, suggestionBar);
    document.documentElement.appendChild(suggestionHost);
}

function useDarkTheme(): boolean {
    return settings.theme === 'dark'
        || (settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function positionSuggestionBar(target: EditableElement): void {
    if (!suggestionBar) return;
    let anchor = target.getBoundingClientRect();
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        const selection = window.getSelection();
        if (selection?.rangeCount) {
            const caretRect = selection.getRangeAt(0).getBoundingClientRect();
            if (caretRect.width || caretRect.height) anchor = caretRect;
        }
    }
    const barRect = suggestionBar.getBoundingClientRect();
    let left = Math.max(10, Math.min(anchor.left, window.innerWidth - barRect.width - 10));
    let top = anchor.bottom + 7;
    if (top + barRect.height > window.innerHeight - 10) top = anchor.top - barRect.height - 7;
    suggestionBar.style.left = `${left}px`;
    suggestionBar.style.top = `${Math.max(10, top)}px`;
}

function hideSuggestions(): void {
    if (suggestionBar) suggestionBar.style.display = 'none';
    activeEditable = null;
    activePrefix = '';
    activeSuggestions = [];
}

function renderSuggestions(target: EditableElement, prefix: string, suggestions: string[]): void {
    if (!suggestions.length) {
        hideSuggestions();
        return;
    }
    ensureSuggestionUi();
    if (!suggestionBar) return;
    activeEditable = target;
    activePrefix = prefix;
    activeSuggestions = suggestions;
    suggestionBar.replaceChildren();
    suggestionBar.className = `bar${useDarkTheme() ? ' dark' : ''}`;
    suggestionBar.style.setProperty('zoom', String(settings.interfaceScale / 100));
    const spark = document.createElement('span');
    spark.className = 'spark';
    spark.textContent = '✦';
    suggestionBar.appendChild(spark);
    suggestions.forEach((suggestion, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'option');
        button.textContent = suggestion;
        button.onmousedown = (event) => event.preventDefault();
        button.onclick = () => acceptSuggestion(index);
        suggestionBar!.appendChild(button);
    });
    const key = document.createElement('kbd');
    key.textContent = 'Tab';
    suggestionBar.appendChild(key);
    suggestionBar.style.display = 'flex';
    requestAnimationFrame(() => positionSuggestionBar(target));
}

function insertIntoContentEditable(target: HTMLElement, insertion: string, prefixLength: number): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (prefixLength > 0 && range.startContainer.nodeType === Node.TEXT_NODE) {
        range.setStart(range.startContainer, Math.max(0, range.startOffset - prefixLength));
    }
    range.deleteContents();
    const textNode = document.createTextNode(insertion);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: insertion }));
}

function acceptSuggestion(index: number): void {
    const target = activeEditable;
    const suggestion = activeSuggestions[index];
    if (!target || !suggestion) return;
    const textBefore = getTextBeforeCaret(target);
    const previous = tokenize(activePrefix ? textBefore.slice(0, -activePrefix.length) : textBefore).at(-1);
    const insertion = `${suggestion}${activePrefix ? '' : ' '}`;

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const caret = target.selectionStart ?? target.value.length;
        target.setRangeText(insertion, Math.max(0, caret - activePrefix.length), caret, 'end');
        target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: insertion }));
    } else {
        insertIntoContentEditable(target, insertion, activePrefix.length);
    }
    recordWord(suggestion, previous, 2);
    hideSuggestions();
}

async function evaluateEditable(target: EditableElement): Promise<void> {
    if (!settings.enabled || !isAllowedOnCurrentPage() || isSensitiveField(target)) {
        hideSuggestions();
        return;
    }
    const context = getTextBeforeCaret(target).slice(-1200);
    learnFromContext(target, context);
    const result = getSuggestions(context);
    renderSuggestions(target, result.prefix, result.suggestions);
}

async function loadState(): Promise<void> {
    const stored = await chrome.storage.local.get({
        adaptiveSuggestionsEnabled: false,
        adaptiveLearningEnabled: true,
        selectedTheme: 'auto',
        interfaceScale: 90,
        disabledSites: [],
        personalDictionary: [],
        [MODEL_STORAGE_KEY]: EMPTY_MODEL,
    });
    settings = {
        enabled: stored.adaptiveSuggestionsEnabled === true,
        learn: stored.adaptiveLearningEnabled !== false,
        theme: String(stored.selectedTheme || 'auto'),
        interfaceScale: normalizeScale(stored.interfaceScale),
        disabledSites: normalizeDisabledSites(stored.disabledSites),
        personalDictionary: Array.isArray(stored.personalDictionary) ? stored.personalDictionary.map(String) : [],
    };
    model = parseModel(stored[MODEL_STORAGE_KEY]);
}

export function initializeAdaptiveSuggestions(): void {
    if (initialized) return;
    initialized = true;
    void loadState();

    document.addEventListener('input', (event) => {
        if (isEditableElement(event.target)) void evaluateEditable(event.target);
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && activeSuggestions.length) {
            hideSuggestions();
        } else if (event.key === 'Tab' && activeSuggestions.length && activeEditable === event.target) {
            event.preventDefault();
            event.stopPropagation();
            acceptSuggestion(0);
        }
    }, true);

    document.addEventListener('focusout', () => window.setTimeout(hideSuggestions, 120), true);
    window.addEventListener('scroll', hideSuggestions, true);
    window.addEventListener('resize', hideSuggestions);

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.adaptiveSuggestionsEnabled) settings.enabled = changes.adaptiveSuggestionsEnabled.newValue === true;
        if (changes.adaptiveLearningEnabled) settings.learn = changes.adaptiveLearningEnabled.newValue !== false;
        if (changes.selectedTheme) settings.theme = String(changes.selectedTheme.newValue || 'auto');
        if (changes.interfaceScale) settings.interfaceScale = normalizeScale(changes.interfaceScale.newValue);
        if (changes.disabledSites) settings.disabledSites = normalizeDisabledSites(changes.disabledSites.newValue);
        if (changes.personalDictionary) settings.personalDictionary = Array.isArray(changes.personalDictionary.newValue) ? changes.personalDictionary.newValue.map(String) : [];
        if (changes[MODEL_STORAGE_KEY]) model = parseModel(changes[MODEL_STORAGE_KEY].newValue);
        if (!settings.enabled) hideSuggestions();
    });
}
