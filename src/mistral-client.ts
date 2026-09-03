import { t } from './i18n';
import { unmaskPii } from './pii-masker';
import { buildPromptPayload } from './prompt-builder';
import { recordErrorLog } from './error-log';
import type { AiMode, RequestMode, StyleProfile } from './types';
import { getAiOutputTokenLimit } from './ai-output-budget';

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
    replyIntent?: 'agree' | 'decline' | 'clarify' | 'alternative';
    rawMessages?: Array<{ role: 'system' | 'user'; content: string }>;
}

export interface MistralSettings {
    selectedTone: string;
    sendPageContext: boolean;
    personalDictionary: string[];
    glossary: string[];
    activeStyleProfile?: StyleProfile;
    aiMode: AiMode;
    enablePiiMasking?: boolean;
}

const API_BASE_URL = 'https://api.mistral.ai/v1';
const RETRYABLE_SERVER_STATUSES = new Set([500, 502, 503, 504]);

export class MistralRequestError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean,
        readonly status?: number,
        readonly retryAfterMs?: number,
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
            // При 429 резервный провайдер полезнее ожидания и повторного расхода квоты.
            if (!RETRYABLE_SERVER_STATUSES.has(response.status) || attempt === 2) return response;
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

function readProviderErrorMessage(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';
    const record = payload as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message.slice(0, 500);
    if (typeof record.detail === 'string') return record.detail.slice(0, 500);
    if (record.error && typeof record.error === 'object') {
        const nestedMessage = (record.error as Record<string, unknown>).message;
        if (typeof nestedMessage === 'string') return nestedMessage.slice(0, 500);
    }
    return '';
}

async function readResponseErrorMessage(response: Response): Promise<string> {
    try {
        const text = await response.text();
        if (!text) return '';
        try {
            return readProviderErrorMessage(JSON.parse(text));
        } catch {
            return text.slice(0, 500);
        }
    } catch {
        return '';
    }
}

export function getApiError(status: number, providerMessage = ''): string {
    if ((status === 401 || status === 403) && /\bexpired\b|ист[её]к/iu.test(providerMessage))
        return t(
            'mistralApiKeyExpired',
            'Срок действия API-ключа Mistral истёк. Сохраните новый ключ в настройках LexiSync.',
        );
    if (status === 401) return t('apiKeyInvalid', 'API-ключ недействителен или был отозван. Проверьте ключ.');
    if (status === 402)
        return t(
            'mistralBillingRequired',
            'Для Mistral API не активирован биллинг. Проверьте способ оплаты в Mistral AI Studio.',
        );
    if (status === 403)
        return t(
            'mistralAccessForbidden',
            'Mistral распознал ключ, но запретил доступ. Проверьте рабочее пространство, права и биллинг.',
        );
    if (status === 429) return t('mistralRateLimit', 'Превышен лимит запросов Mistral. Попробуйте немного позже.');
    if (status >= 500) return t('mistralUnavailable', 'Сервис Mistral временно недоступен. Попробуйте ещё раз.');
    return `${t('mistralApiError', 'Ошибка Mistral API')} (${status}).`;
}

async function createApiError(response: Response): Promise<MistralRequestError> {
    const providerMessage = await readResponseErrorMessage(response);
    const retryAfterHeader = response.headers?.get('Retry-After');
    return new MistralRequestError(
        getApiError(response.status, providerMessage),
        response.status === 429 || RETRYABLE_SERVER_STATUSES.has(response.status),
        response.status,
        response.status === 429 ? (parseRetryAfterMs(retryAfterHeader ?? null) ?? undefined) : undefined,
    );
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
        const providerMsg = await readResponseErrorMessage(response);
        const userMsg = getApiError(response.status, providerMsg);
        void recordErrorLog({
            level: 'error',
            source: 'mistral-client',
            provider: 'mistral',
            status: response.status,
            message: `Проверка API-ключа Mistral завершилась с ошибкой: ${userMsg}`,
            knownKeys: [trimmed],
        });
        return { ok: false, message: userMsg };
    } catch (error) {
        const formatted = formatMistralError(error);
        void recordErrorLog({
            level: 'error',
            source: 'mistral-client',
            provider: 'mistral',
            message: `Сбой при проверке API-ключа Mistral: ${formatted}`,
            knownKeys: [trimmed],
        });
        return { ok: false, message: formatted };
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
    if (!response.ok) throw await createApiError(response);
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
    const prompt = buildPromptPayload(msg, settings);
    const shouldRestorePii = Object.keys(prompt.piiMaskMap).length > 0;
    const requestInit: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
            model: 'mistral-small-latest',
            messages: prompt.messages,
            stream: true,
            max_tokens: getAiOutputTokenLimit(msg.mode, settings.aiMode, msg.text, msg.rawMessages),
        }),
    };
    const requestCompletion = () => fetchWithRetry(`${API_BASE_URL}/chat/completions`, requestInit, signal);
    let response = await requestCompletion();

    // У нового ключа иногда раньше начинает работать /models, чем потоковый endpoint.
    // На ошибке авторизации перепроверяем тот же ключ и выполняем только один повтор.
    if (response.status === 401 || response.status === 403) {
        const validation = await validateApiKey(apiKey);
        if (validation.ok && !signal.aborted) {
            await response.body?.cancel();
            await wait(300, signal);
            response = await requestCompletion();
        }
    }
    if (!response.ok) throw await createApiError(response);
    const reader = response.body?.getReader();
    if (!reader) throw new MistralRequestError(t('emptyStream', 'Mistral вернул пустой поток данных.'), true);

    const decoder = new TextDecoder();
    let buffer = '';
    let bufferedMaskedContent = '';
    let receivedContent = false;
    const emitCompletedContent = () => {
        if (shouldRestorePii && bufferedMaskedContent) {
            onChunk(unmaskPii(bufferedMaskedContent, prompt.piiMaskMap));
            bufferedMaskedContent = '';
        }
    };
    const processLine = (line: string): boolean => {
        if (line.trim() === 'data: [DONE]') return true;
        const content = readSsePayload(line);
        if (content) {
            receivedContent = true;
            if (shouldRestorePii) bufferedMaskedContent += content;
            else onChunk(content);
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
            emitCompletedContent();
            await reader.cancel();
            return;
        }
    }
    buffer += decoder.decode();
    if (buffer && processLine(buffer)) {
        if (!receivedContent)
            throw new MistralRequestError(t('emptyStream', 'Mistral вернул пустой поток данных.'), true);
        emitCompletedContent();
        await reader.cancel();
        return;
    }
    if (!receivedContent) throw new MistralRequestError(t('emptyStream', 'Mistral вернул пустой поток данных.'), true);
    throw new MistralRequestError(
        t('incompleteStream', 'Ответ Mistral прервался до завершения. Повторите запрос.'),
        true,
    );
}
