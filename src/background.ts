import type { AiMode, RequestMode, StyleProfile } from './types';
import { t } from './i18n';
import { migrateSettings } from './settings-migrations';
import { buildMessages } from './prompt-builder';
import { fixKeyboardLayout } from './keyboard-layout';
import { recordRequest } from './usage-stats';
import { initializeSettingsSync, restoreSyncedSettings } from './settings-transfer';

interface MistralRequest {
    action: 'callMistral' | 'cancelMistral';
    text?: string;
    context?: string;
    mode?: RequestMode;
    targetLang?: string;
    pageTitle?: string;
    pageUrl?: string;
    imageUrl?: string;
    allowPageContext?: boolean;
    customPrompt?: string;
}

const API_BASE_URL = 'https://api.mistral.ai/v1';
const REQUEST_TIMEOUT_MS = 45_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function createSettingsFingerprint(value: unknown): string {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

const initializationPromise = restoreSyncedSettings().then(migrateSettings);
initializeSettingsSync();

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void chrome.storage.local.set({ onboardingCompleted: false });
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: 'spellcheck', title: `${t('fixErrors', 'Исправить ошибки')} (Alt+R)`, contexts: ['selection'] });
        chrome.contextMenus.create({ id: 'style', title: `${t('rewriteText', 'Переписать текст')} (Alt+Y)`, contexts: ['selection'] });
        chrome.contextMenus.create({ id: 'emoji', title: `${t('addEmoji', 'Подобрать эмодзи')} (Alt+T)`, contexts: ['selection'] });
        chrome.contextMenus.create({ id: 'layout', title: t('fixLayout', 'Исправить раскладку'), contexts: ['selection'] });
        chrome.contextMenus.create({ id: 'translate', title: t('translate', 'Перевести'), contexts: ['selection'] });
        chrome.contextMenus.create({ id: 'ocr', title: '📸 Распознать текст (Alt+S)', contexts: ['page', 'image', 'selection'] });
    });
});

function sendOcrCommand(tabId: number, windowId?: number): void {
    const handleCapture = (dataUrl?: string) => {
        if (chrome.runtime.lastError || !dataUrl) {
            console.error('Ошибка захвата экрана:', chrome.runtime.lastError);
            return;
        }
        chrome.tabs.sendMessage(tabId, { action: 'startOcrMode', screenshotUrl: dataUrl });
    };

    if (typeof windowId === 'number') {
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, handleCapture);
    } else {
        chrome.tabs.captureVisibleTab({ format: 'png' }, handleCapture);
    }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === 'ocr') {
        sendOcrCommand(tab.id, tab.windowId);
        return;
    }
    chrome.tabs.sendMessage(tab.id, {
        action: 'contextMenuClicked',
        mode: info.menuItemId,
        text: info.selectionText || '',
    });
});

chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.id) return;
        if (command === 'ocr') {
            sendOcrCommand(tab.id, tab.windowId);
            return;
        }
        chrome.tabs.sendMessage(tab.id, { action: 'hotkeyTriggered', mode: command });
    });
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'openHistory') {
        chrome.tabs.create({ url: chrome.runtime.getURL('lexisync-history.html') });
    } else if (request.action === 'openOptionsPage') {
        chrome.runtime.openOptionsPage();
    } else if (request.action === 'getRuntimeSettings') {
        void initializationPromise.then(() => chrome.storage.local.get({
            mistralApiKey: '', sendPageContext: false, contextDisabledSites: [], aiMode: 'quality',
            selectedTone: 'business', glossary: [], styleProfiles: [], activeStyleProfileId: '',
        }))
            .then((settings) => sendResponse({
                hasApiKey: typeof settings.mistralApiKey === 'string' && settings.mistralApiKey.trim().length > 0,
                sendPageContext: settings.sendPageContext === true,
                contextDisabledSites: settings.contextDisabledSites,
                cacheFingerprint: createSettingsFingerprint({
                    aiMode: settings.aiMode,
                    selectedTone: settings.selectedTone,
                    glossary: settings.glossary,
                    activeStyleProfileId: settings.activeStyleProfileId,
                    styleProfiles: settings.styleProfiles,
                }),
            }));
        return true;
    } else if (request.action === 'replayHistoryItem') {
        void chrome.tabs.query({ currentWindow: true }).then(async (tabs) => {
            const target = tabs
                .filter((tab) => tab.id && /^https?:/.test(tab.url || ''))
                .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
            if (!target?.id) {
                sendResponse({ ok: false, error: 'Не найдена открытая веб-страница.' });
                return;
            }
            await chrome.tabs.update(target.id, { active: true });
            await chrome.tabs.sendMessage(target.id, {
                action: 'historyReplay',
                mode: request.item?.mode,
                text: request.item?.original,
                customName: request.item?.customName,
            });
            sendResponse({ ok: true });
        }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return true;
    }
});

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException(t('requestCancelled', 'Запрос отменён.'), 'AbortError'));
        }, { once: true });
    });
}

async function fetchWithRetry(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const response = await fetch(url, { ...init, signal });
            if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts - 1) return response;

            const retryAfterSeconds = Number(response.headers.get('Retry-After'));
            const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
                ? retryAfterSeconds * 1000
                : 750 * 2 ** attempt;
            await wait(Math.min(delayMs, 10_000), signal);
        } catch (error) {
            if (signal.aborted) throw error;
            lastError = error;
            if (attempt === maxAttempts - 1) throw error;
            await wait(750 * 2 ** attempt, signal);
        }
    }

    throw lastError instanceof Error ? lastError : new Error(t('requestFailed', 'Не удалось выполнить запрос.'));
}

function getApiError(status: number, details: string): string {
    if (status === 401) return t('invalidApiKey', 'Неверный API-ключ. Проверьте настройки.');
    if (status === 429) return t('mistralRateLimit', 'Превышен лимит запросов Mistral. Попробуйте немного позже.');
    if (status >= 500) return t('mistralUnavailable', 'Сервис Mistral временно недоступен. Попробуйте ещё раз.');
    return `${t('mistralApiError', 'Ошибка Mistral API')} (${status}): ${details.slice(0, 300)}`;
}

async function processOcr(msg: MistralRequest, apiKey: string, signal: AbortSignal): Promise<string> {
    if (!msg.imageUrl) throw new Error(t('imageMissing', 'Изображение для распознавания не получено.'));

    const response = await fetchWithRetry(`${API_BASE_URL}/ocr`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'mistral-ocr-latest',
            document: { type: 'image_url', image_url: msg.imageUrl },
            include_image_base64: false,
        }),
    }, signal);

    if (!response.ok) throw new Error(getApiError(response.status, await response.text()));
    const result = await response.json() as { pages?: Array<{ markdown?: string }> };
    const text = result.pages?.map((page) => page.markdown || '').filter(Boolean).join('\n\n').trim();
    if (!text) throw new Error(t('ocrNoText', 'Mistral OCR не обнаружил текст в выбранной области.'));
    return text;
}

async function streamText(
    msg: MistralRequest,
    apiKey: string,
    selectedTone: string,
    sendPageContext: boolean,
    personalDictionary: string[],
    glossary: string[],
    activeStyleProfile: StyleProfile | undefined,
    aiMode: AiMode,
    signal: AbortSignal,
    onChunk: (text: string) => void,
): Promise<void> {
    const response = await fetchWithRetry(`${API_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: aiMode === 'fast' ? 'mistral-small-latest' : 'mistral-large-latest',
            messages: buildMessages(msg, {
                selectedTone,
                sendPageContext,
                personalDictionary,
                glossary,
                activeStyleProfile,
            }),
            stream: true,
        }),
    }, signal);

    if (!response.ok) throw new Error(getApiError(response.status, await response.text()));
    const reader = response.body?.getReader();
    if (!reader) throw new Error(t('emptyStream', 'Mistral вернул пустой поток данных.'));

    const decoder = new TextDecoder();
    let buffer = '';
    const processLine = (line: string): boolean => {
        const trimmed = line.trimEnd();
        if (!trimmed.startsWith('data:')) return false;
        const payload = trimmed.slice(5).trimStart();
        if (payload === '[DONE]') return true;
        try {
            const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) onChunk(content);
        } catch (error) {
            console.error('Не удалось разобрать часть ответа Mistral:', error);
        }
        return false;
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (processLine(line)) return;
        }
    }
    buffer += decoder.decode();
    if (buffer) processLine(buffer);
}

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'mistralStream') return;

    let controller: AbortController | null = null;
    let cancelledByUser = false;

    port.onDisconnect.addListener(() => controller?.abort());
    port.onMessage.addListener(async (msg: MistralRequest) => {
        if (msg.action === 'cancelMistral') {
            cancelledByUser = true;
            controller?.abort();
            return;
        }
        if (msg.action !== 'callMistral') return;

        controller?.abort();
        controller = new AbortController();
        cancelledByUser = false;
        const timeout = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
        const startedAt = Date.now();
        let completedSuccessfully = false;

        try {
            await initializationPromise;
            const settings = await chrome.storage.local.get({
                mistralApiKey: '',
                selectedTone: 'business',
                sendPageContext: false,
                personalDictionary: [],
                glossary: [],
                styleProfiles: [],
                activeStyleProfileId: '',
                aiMode: 'quality',
            });
            if (!msg.mode) throw new Error(t('modeMissing', 'Режим обработки не указан.'));
            if (msg.mode === 'layout') {
                const result = fixKeyboardLayout(msg.text || '');
                port.postMessage({ status: 'chunk', text: result });
                port.postMessage({ status: 'done' });
                completedSuccessfully = true;
                return;
            }
            const apiKey = settings.mistralApiKey as string;
            if (!apiKey) throw new Error(t('apiKeyMissing', 'API-ключ не настроен'));

            const styleProfiles = Array.isArray(settings.styleProfiles) ? settings.styleProfiles as StyleProfile[] : [];
            const activeStyleProfile = styleProfiles.find((profile) => profile?.id === settings.activeStyleProfileId);

            if (msg.mode === 'ocr') {
                const text = await processOcr(msg, apiKey, controller.signal);
                port.postMessage({ status: 'chunk', text });
            } else {
                await streamText(
                    msg,
                    apiKey,
                    settings.selectedTone as string,
                    settings.sendPageContext === true && msg.allowPageContext !== false,
                    Array.isArray(settings.personalDictionary) ? settings.personalDictionary.map(String) : [],
                    Array.isArray(settings.glossary) ? settings.glossary.map(String) : [],
                    activeStyleProfile,
                    settings.aiMode === 'fast' ? 'fast' : 'quality',
                    controller.signal,
                    (text) => port.postMessage({ status: 'chunk', text }),
                );
            }
            port.postMessage({ status: 'done' });
            completedSuccessfully = true;
        } catch (error) {
            const isAbort = error instanceof DOMException && error.name === 'AbortError';
            if (isAbort) {
                port.postMessage({
                    status: cancelledByUser ? 'cancelled' : 'error',
                    error: cancelledByUser ? t('requestCancelled', 'Запрос отменён.') : t('requestTimeout', 'Превышено время ожидания ответа (45 секунд).'),
                });
            } else {
                const message = error instanceof Error ? error.message : t('unknownNetworkError', 'Неизвестная ошибка сети.');
                port.postMessage({ status: 'error', error: message });
            }
        } finally {
            clearTimeout(timeout);
            if (msg.mode) void recordRequest(msg.mode, Date.now() - startedAt, completedSuccessfully);
        }
    });
});
