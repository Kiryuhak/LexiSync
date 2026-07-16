import type { RequestMode } from './types';

interface MistralRequest {
    action: 'callMistral' | 'cancelMistral';
    text?: string;
    context?: string;
    mode?: RequestMode;
    targetLang?: string;
    pageTitle?: string;
    pageUrl?: string;
    imageUrl?: string;
}

interface ChatMessage {
    role: 'system' | 'user';
    content: string;
}

const API_BASE_URL = 'https://api.mistral.ai/v1';
const REQUEST_TIMEOUT_MS = 45_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: 'spellcheck', title: 'Исправить ошибки (Alt+R)', contexts: ['selection'] });
        chrome.contextMenus.create({ id: 'style', title: 'Переписать текст (Alt+Y)', contexts: ['selection'] });
        chrome.contextMenus.create({ id: 'emoji', title: 'Подобрать эмодзи (Alt+T)', contexts: ['selection'] });
        chrome.contextMenus.create({ id: 'layout', title: 'Исправить раскладку', contexts: ['selection'] });
        chrome.contextMenus.create({ id: 'translate', title: 'Перевести', contexts: ['selection'] });
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

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'openHistory') {
        chrome.tabs.create({ url: chrome.runtime.getURL('lexisync-history.html') });
    } else if (request.action === 'openOptionsPage') {
        chrome.runtime.openOptionsPage();
    }
});

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Запрос отменён', 'AbortError'));
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

    throw lastError instanceof Error ? lastError : new Error('Не удалось выполнить запрос.');
}

function getApiError(status: number, details: string): string {
    if (status === 401) return 'Неверный API-ключ. Проверьте настройки.';
    if (status === 429) return 'Превышен лимит запросов Mistral. Попробуйте немного позже.';
    if (status >= 500) return 'Сервис Mistral временно недоступен. Попробуйте ещё раз.';
    return `Ошибка Mistral API (${status}): ${details.slice(0, 300)}`;
}

function buildMessages(msg: MistralRequest, selectedTone: string, sendPageContext: boolean, personalDictionary: string[]): ChatMessage[] {
    let systemPrompt = 'Ты умный ассистент по работе с текстом. Верни только обработанный текст без приветствий, объяснений, кавычек, блоков кода и HTML-тегов.';

    if (sendPageContext && (msg.pageUrl || msg.pageTitle)) {
        systemPrompt += `\nПользователь работает на сайте «${msg.pageUrl || 'неизвестный сайт'}», заголовок страницы: «${msg.pageTitle || 'без заголовка'}».`;
    }

    if (msg.mode === 'spellcheck') {
        systemPrompt += ' Исправь только орфографические, грамматические и пунктуационные ошибки. Сохрани исходный стиль и формулировки. Верни цельный исправленный текст без Markdown и отметок изменений.';
        if (personalDictionary.length > 0) {
            systemPrompt += ` Не исправляй слова из личного словаря пользователя: ${personalDictionary.slice(0, 200).join(', ')}.`;
        }
    } else if (msg.mode === 'style') {
        const toneMap: Record<string, string> = {
            business: 'в строгом, деловом и профессиональном стиле',
            friendly: 'в дружелюбном, открытом и разговорном стиле',
            persuasive: 'в убедительном и продающем стиле',
            creative: 'в креативном стиле с яркими метафорами',
        };
        systemPrompt += ` Перепиши текст ${toneMap[selectedTone] || toneMap.business}, сделав его естественнее. Изменённые фразы оборачивай в двойные звёздочки.`;
    } else if (msg.mode === 'emoji') {
        systemPrompt += ' Добавь подходящие по смыслу эмодзи, сохранив естественность текста и не перегружая его.';
    } else if (msg.mode === 'layout') {
        systemPrompt += " Исправь текст, набранный в неправильной раскладке, например 'ghbdtn' → 'привет'. Исправленные слова оборачивай в двойные звёздочки.";
    } else if (msg.mode === 'translate') {
        systemPrompt += ` Переведи текст на ${msg.targetLang || chrome.i18n.getUILanguage() || 'русский'} язык.`;
    }

    const context = sendPageContext ? (msg.context || '').replace(/\s+/g, ' ').trim().slice(0, 2000) : '';
    const userContent = context
        ? `Контекст вокруг выделения: ${context}\n\nВыделенный текст: ${msg.text || ''}`
        : `Текст для обработки: ${msg.text || ''}`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
    ];
}

async function processOcr(msg: MistralRequest, apiKey: string, signal: AbortSignal): Promise<string> {
    if (!msg.imageUrl) throw new Error('Изображение для распознавания не получено.');

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
    if (!text) throw new Error('Mistral OCR не обнаружил текст в выбранной области.');
    return text;
}

async function streamText(
    msg: MistralRequest,
    apiKey: string,
    selectedTone: string,
    sendPageContext: boolean,
    personalDictionary: string[],
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
            model: 'mistral-large-latest',
            messages: buildMessages(msg, selectedTone, sendPageContext, personalDictionary),
            stream: true,
        }),
    }, signal);

    if (!response.ok) throw new Error(getApiError(response.status, await response.text()));
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Mistral вернул пустой поток данных.');

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

        try {
            const settings = await chrome.storage.local.get({
                mistralApiKey: '',
                selectedTone: 'business',
                sendPageContext: false,
                personalDictionary: [],
            });
            const apiKey = settings.mistralApiKey as string;
            if (!apiKey) throw new Error('API-ключ не настроен.');

            if (msg.mode === 'ocr') {
                const text = await processOcr(msg, apiKey, controller.signal);
                port.postMessage({ status: 'chunk', text });
            } else {
                await streamText(
                    msg,
                    apiKey,
                    settings.selectedTone as string,
                    settings.sendPageContext === true,
                    Array.isArray(settings.personalDictionary) ? settings.personalDictionary.map(String) : [],
                    controller.signal,
                    (text) => port.postMessage({ status: 'chunk', text }),
                );
            }
            port.postMessage({ status: 'done' });
        } catch (error) {
            const isAbort = error instanceof DOMException && error.name === 'AbortError';
            if (isAbort) {
                port.postMessage({
                    status: cancelledByUser ? 'cancelled' : 'error',
                    error: cancelledByUser ? 'Запрос отменён.' : 'Превышено время ожидания ответа (45 секунд).',
                });
            } else {
                const message = error instanceof Error ? error.message : 'Неизвестная ошибка сети.';
                port.postMessage({ status: 'error', error: message });
            }
        } finally {
            clearTimeout(timeout);
        }
    });
});
