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

export class MistralRequestError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean,
    ) {
        super(message);
        this.name = 'MistralRequestError';
    }
}

export function isRetryableMistralError(error: unknown): boolean {
    if (error instanceof MistralRequestError) return error.retryable;
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    return (
        error instanceof TypeError ||
        (error instanceof Error &&
            (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')))
    );
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | null {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException(t('requestCancelled', 'Запрос отменён.'), 'AbortError'));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
    });
}

async function fetchWithRetry(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, { ...init, signal });
            if (!RETRYABLE_STATUSES.has(response.status) || attempt === 2) return response;
            const delayMs = parseRetryAfterMs(response.headers.get('Retry-After')) ?? 750 * 2 ** attempt;
            await response.body?.cancel();
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

export function formatMistralError(error: unknown): string {
    if (error instanceof Error) {
        if (error.name === 'AbortError') return error.message;
        const msg = error.message;
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || error instanceof TypeError) {
            return t(
                'networkConnectionFailed',
                'Не удалось подключиться к сервису Mistral AI. Проверьте интернет и повторите попытку.',
            );
        }
        return msg;
    }
    return t('unknownNetworkError', 'Неизвестная ошибка сети.');
}

function getApiError(status: number): string {
    if (status === 401 || status === 403)
        return t('apiKeyInvalid', 'API-ключ недействителен или был отозван. Проверьте ключ.');
    if (status === 429) return t('mistralRateLimit', 'Превышен лимит запросов Mistral. Попробуйте немного позже.');
    if (status >= 500) return t('mistralUnavailable', 'Сервис Mistral временно недоступен. Попробуйте ещё раз.');
    return `${t('mistralApiError', 'Ошибка Mistral API')} (${status}).`;
}

function createApiError(status: number): MistralRequestError {
    return new MistralRequestError(getApiError(status), RETRYABLE_STATUSES.has(status));
}

export async function validateApiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
    const trimmed = apiKey.trim();
    if (!trimmed) {
        return { ok: false, message: t('tutorialKeyRequired', 'Сначала вставьте API-ключ.') };
    }
    try {
        const response = await fetch(`${API_BASE_URL}/models`, {
            headers: { Authorization: `Bearer ${trimmed}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
            return { ok: true, message: t('apiKeyValid', 'API-ключ проверен и готов к работе.') };
        }
        return { ok: false, message: getApiError(response.status) };
    } catch (error) {
        return { ok: false, message: formatMistralError(error) };
    }
}

export function readSsePayload(line: string): string | null {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith('data:')) return null;
    const payload = trimmed.slice(5).trimStart();
    if (!payload || payload === '[DONE]') return null;
    try {
        const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> } }>;
        };
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
    const response = await fetchWithRetry(
        `${API_BASE_URL}/ocr`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: 'mistral-ocr-latest',
                document: { type: 'image_url', image_url: msg.imageUrl },
                include_image_base64: false,
            }),
        },
        signal,
    );
    if (!response.ok) throw createApiError(response.status);
    const result = (await response.json()) as { pages?: Array<{ markdown?: string }> };
    const text = result.pages
        ?.map((page) => page.markdown || '')
        .filter(Boolean)
        .join('\n\n')
        .trim();
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
    const response = await fetchWithRetry(
        `${API_BASE_URL}/chat/completions`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: settings.aiMode === 'fast' ? 'mistral-small-latest' : 'mistral-large-latest',
                messages: buildMessages(msg, settings),
                stream: true,
            }),
        },
        signal,
    );
    if (!response.ok) throw createApiError(response.status);
    const reader = response.body?.getReader();
    if (!reader) throw new MistralRequestError(t('emptyStream', 'Mistral вернул пустой поток данных.'), true);

    const decoder = new TextDecoder();
    let buffer = '';
    let receivedContent = false;
    const processLine = (line: string): boolean => {
        if (line.trim() === 'data: [DONE]') return true;
        const content = readSsePayload(line);
        if (content) {
            receivedContent = true;
            onChunk(content);
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
            if (!processLine(line)) continue;
            if (!receivedContent)
                throw new MistralRequestError(t('emptyStream', 'Mistral вернул пустой поток данных.'), true);
            await reader.cancel();
            return;
        }
    }
    buffer += decoder.decode();
    if (buffer && processLine(buffer)) {
        if (!receivedContent)
            throw new MistralRequestError(t('emptyStream', 'Mistral вернул пустой поток данных.'), true);
        await reader.cancel();
        return;
    }
    if (!receivedContent) throw new MistralRequestError(t('emptyStream', 'Mistral вернул пустой поток данных.'), true);
    throw new MistralRequestError(
        t('incompleteStream', 'Ответ Mistral прервался до завершения. Повторите запрос.'),
        true,
    );
}
