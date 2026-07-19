import { t } from './i18n';
import { buildMessages } from './prompt-builder';
import type { AiMode, RequestMode, StyleProfile } from './types';

export interface MistralRequest {
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

export interface MistralSettings {
    selectedTone: string;
    sendPageContext: boolean;
    personalDictionary: string[];
    glossary: string[];
    activeStyleProfile?: StyleProfile;
    aiMode: AiMode;
}

const API_BASE_URL = 'https://api.mistral.ai/v1';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

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
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, { ...init, signal });
            if (!RETRYABLE_STATUSES.has(response.status) || attempt === 2) return response;
            const retryAfterSeconds = Number(response.headers.get('Retry-After'));
            const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
                ? retryAfterSeconds * 1000
                : 750 * 2 ** attempt;
            await wait(Math.min(delayMs, 10_000), signal);
        } catch (error) {
            if (signal.aborted) throw error;
            lastError = error;
            if (attempt === 2) throw error;
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

export function readSsePayload(line: string): string | null {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith('data:')) return null;
    const payload = trimmed.slice(5).trimStart();
    if (!payload || payload === '[DONE]') return null;
    try {
        const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> } }> };
        const content = parsed.choices?.[0]?.delta?.content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) return content.map((part) => part.text || '').join('');
    } catch {
        return null;
    }
    return null;
}

export async function processOcr(msg: MistralRequest, apiKey: string, signal: AbortSignal): Promise<string> {
    if (!msg.imageUrl) throw new Error(t('imageMissing', 'Изображение для распознавания не получено.'));
    const response = await fetchWithRetry(`${API_BASE_URL}/ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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

export async function streamText(
    msg: MistralRequest,
    apiKey: string,
    settings: MistralSettings,
    signal: AbortSignal,
    onChunk: (text: string) => void,
): Promise<void> {
    const response = await fetchWithRetry(`${API_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: settings.aiMode === 'fast' ? 'mistral-small-latest' : 'mistral-large-latest',
            messages: buildMessages(msg, settings),
            stream: true,
        }),
    }, signal);
    if (!response.ok) throw new Error(getApiError(response.status, await response.text()));
    const reader = response.body?.getReader();
    if (!reader) throw new Error(t('emptyStream', 'Mistral вернул пустой поток данных.'));

    const decoder = new TextDecoder();
    let buffer = '';
    const processLine = (line: string): boolean => {
        if (line.trim() === 'data: [DONE]') return true;
        const content = readSsePayload(line);
        if (content) onChunk(content);
        return false;
    };
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) if (processLine(line)) return;
    }
    buffer += decoder.decode();
    if (buffer) processLine(buffer);
}
