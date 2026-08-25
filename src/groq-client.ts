import { t } from './i18n';
import { unmaskPii } from './pii-masker';
import { buildPromptPayload } from './prompt-builder';
import type { MistralRequest, MistralSettings } from './mistral-client';
import { parseRetryAfterMs } from './mistral-client';
import { AiProviderError } from './ai-provider-types';

export const GROQ_API_BASE_URL = 'https://api.groq.com/openai/v1';
export const GROQ_DEFAULT_MODEL = 'qwen/qwen3.6-27b';

const RETRYABLE_SERVER_STATUSES = new Set([500, 502, 503, 504]);

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

async function fetchGroqWithRetry(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await fetch(url, { ...init, signal });
            // 429 сразу передаётся общему слою: он запомнит Retry-After и выберет резервный сервис.
            if (!RETRYABLE_SERVER_STATUSES.has(response.status) || attempt === 1) return response;
            const delayMs = parseRetryAfterMs(response.headers.get('Retry-After')) ?? 500 * 2 ** attempt;
            await response.body?.cancel();
            await wait(Math.min(delayMs, 5000), signal);
        } catch (error) {
            if (signal.aborted) throw error;
            lastError = error;
            if (attempt === 1) throw error;
            await wait(500 * 2 ** attempt, signal);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(t('requestFailed', 'Не удалось выполнить запрос.'));
}

export function classifyGroqError(
    status: number,
    retryAfterHeader?: string | null,
): { message: string; error: AiProviderError } {
    if (status === 401 || status === 403) {
        const msg = t('groqApiKeyInvalid', 'API-ключ Groq недействителен. Проверьте ключ в настройках.');
        return { message: msg, error: new AiProviderError(msg, 'AUTH_ERROR', 'groq', false, status) };
    }
    if (status === 429) {
        const msg = t('groqRateLimit', 'Превышен лимит запросов Groq. Попробуйте немного позже.');
        return {
            message: msg,
            error: new AiProviderError(
                msg,
                'RATE_LIMIT',
                'groq',
                true,
                status,
                parseRetryAfterMs(retryAfterHeader ?? null) ?? undefined,
            ),
        };
    }
    if (status >= 500) {
        const msg = t('groqUnavailable', 'Сервис Groq временно недоступен. Попробуйте ещё раз.');
        return { message: msg, error: new AiProviderError(msg, 'SERVER_ERROR', 'groq', true, status) };
    }
    const msg = `${t('groqApiError', 'Ошибка Groq API')} (${status}).`;
    return { message: msg, error: new AiProviderError(msg, 'UNKNOWN_ERROR', 'groq', false, status) };
}

export function formatGroqError(error: unknown): string {
    if (error instanceof AiProviderError) return error.message;
    if (error instanceof Error) {
        if (error.name === 'AbortError') return error.message;
        const msg = error.message;
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || error instanceof TypeError) {
            return t(
                'groqNetworkFailed',
                'Не удалось подключиться к сервису Groq. Проверьте интернет и повторите попытку.',
            );
        }
        return msg;
    }
    return t('unknownNetworkError', 'Неизвестная ошибка сети.');
}

export async function validateGroqApiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
    const trimmed = apiKey.trim();
    if (!trimmed) {
        return { ok: false, message: t('tutorialGroqKeyRequired', 'Сначала вставьте API-ключ Groq.') };
    }
    try {
        const response = await fetch(`${GROQ_API_BASE_URL}/models`, {
            headers: { Authorization: `Bearer ${trimmed}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return { ok: false, message: classifyGroqError(response.status).message };
        const payload = (await response.json()) as { data?: Array<{ id?: string }> };
        const modelAvailable = payload.data?.some((model) => model.id === GROQ_DEFAULT_MODEL) === true;
        if (!modelAvailable) {
            return {
                ok: false,
                message: t(
                    'groqModelUnavailable',
                    'Ключ работает, но модель Qwen 3.6 27B пока недоступна для этого аккаунта Groq.',
                ),
            };
        }
        return { ok: true, message: t('groqApiKeyValid', 'API-ключ Groq проверен и готов к работе.') };
    } catch (error) {
        return { ok: false, message: formatGroqError(error) };
    }
}

export function readGroqSsePayload(line: string): string | null {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith('data:')) return null;
    const payload = trimmed.slice(5).trimStart();
    if (!payload || payload === '[DONE]') return null;
    try {
        const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> } }>;
        };
        if (!parsed || !Array.isArray(parsed.choices) || parsed.choices.length === 0) return null;
        const content = parsed.choices[0]?.delta?.content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) return content.map((part) => part.text || '').join('');
    } catch {
        return null;
    }
    return null;
}

export async function streamGroqText(
    msg: MistralRequest,
    apiKey: string,
    settings: MistralSettings,
    signal: AbortSignal,
    onChunk: (text: string) => void,
): Promise<void> {
    const prompt = buildPromptPayload(msg, settings);
    const shouldRestorePii = Object.keys(prompt.piiMaskMap).length > 0;
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
        throw new AiProviderError(
            t('groqApiKeyMissing', 'API-ключ Groq не настроен.'),
            'AUTH_ERROR',
            'groq',
            false,
            401,
        );
    }

    let response: Response;
    try {
        response = await fetchGroqWithRetry(
            `${GROQ_API_BASE_URL}/chat/completions`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${trimmedKey}`,
                },
                body: JSON.stringify({
                    model: GROQ_DEFAULT_MODEL,
                    messages: prompt.messages,
                    stream: true,
                    temperature: 0.1,
                    max_completion_tokens: 2048,
                    reasoning_effort: 'none',
                }),
            },
            signal,
        );
    } catch (error) {
        if (signal.aborted) throw error;
        throw new AiProviderError(
            formatGroqError(error),
            error instanceof DOMException && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
            'groq',
            true,
        );
    }

    if (!response.ok) {
        throw classifyGroqError(response.status, response.headers.get('Retry-After')).error;
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new AiProviderError(
            t('groqEmptyStream', 'Groq вернул пустой поток данных.'),
            'INVALID_RESPONSE',
            'groq',
            true,
        );
    }

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
        const content = readGroqSsePayload(line);
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
            if (!receivedContent) {
                throw new AiProviderError(
                    t('groqEmptyStream', 'Groq вернул пустой поток данных.'),
                    'INVALID_RESPONSE',
                    'groq',
                    true,
                );
            }
            emitCompletedContent();
            await reader.cancel();
            return;
        }
    }

    buffer += decoder.decode();
    if (buffer && processLine(buffer)) {
        if (!receivedContent) {
            throw new AiProviderError(
                t('groqEmptyStream', 'Groq вернул пустой поток данных.'),
                'INVALID_RESPONSE',
                'groq',
                true,
            );
        }
        emitCompletedContent();
        await reader.cancel();
        return;
    }

    if (!receivedContent) {
        throw new AiProviderError(
            t('groqEmptyStream', 'Groq вернул пустой поток данных.'),
            'INVALID_RESPONSE',
            'groq',
            true,
        );
    }
    throw new AiProviderError(
        t('groqIncompleteStream', 'Ответ Groq прервался до завершения. Повторите запрос.'),
        'INVALID_RESPONSE',
        'groq',
        true,
    );
}
