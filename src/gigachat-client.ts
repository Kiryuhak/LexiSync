import { t } from './i18n';
import { unmaskPii } from './pii-masker';
import { buildPromptPayload } from './prompt-builder';
import type { MistralRequest, MistralSettings } from './mistral-client';
import { parseRetryAfterMs, readSsePayload } from './mistral-client';
import { AiProviderError, type AIResponse } from './ai-provider-types';
import { recordErrorLog } from './error-log';
import { getAiOutputTokenLimit } from './ai-output-budget';
import { AI_CONFIG } from './ai-models-config';
import { getGigaChatAccessToken, invalidateGigaChatToken, validateGigaChatAuthKey } from './gigachat-token-manager';

export const GIGACHAT_API_BASE_URL = AI_CONFIG.gigachat.baseUrl;
export const GIGACHAT_DEFAULT_MODEL = AI_CONFIG.gigachat.defaultModel;

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

export function classifyGigaChatError(
    status: number,
    retryAfterHeader?: string | null,
): { message: string; error: AiProviderError } {
    if (status === 401 || status === 403) {
        const msg = t(
            'gigachatAuthKeyInvalid',
            'Authorization Key GigaChat недействителен. Проверьте ключ в настройках.',
        );
        return { message: msg, error: new AiProviderError(msg, 'AUTH_ERROR', 'gigachat', false, status) };
    }
    if (status === 429) {
        const msg = t('gigachatRateLimit', 'Превышен лимит запросов GigaChat. Попробуйте немного позже.');
        return {
            message: msg,
            error: new AiProviderError(
                msg,
                'RATE_LIMIT',
                'gigachat',
                true,
                status,
                parseRetryAfterMs(retryAfterHeader ?? null) ?? undefined,
            ),
        };
    }
    if (status >= 500) {
        const msg = t('gigachatUnavailable', 'Сервис GigaChat временно недоступен. Попробуйте ещё раз.');
        return { message: msg, error: new AiProviderError(msg, 'SERVER_ERROR', 'gigachat', true, status) };
    }
    const msg = `${t('gigachatApiError', 'Ошибка GigaChat API')} (${status}).`;
    return { message: msg, error: new AiProviderError(msg, 'UNKNOWN_ERROR', 'gigachat', false, status) };
}

export function formatGigaChatError(error: unknown): string {
    if (error instanceof AiProviderError) return error.message;
    if (error instanceof Error) {
        if (error.name === 'AbortError') return error.message;
        const msg = error.message;
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || error instanceof TypeError) {
            return t(
                'gigachatNetworkFailed',
                'Не удалось подключиться к сервису GigaChat. Проверьте интернет и повторите попытку.',
            );
        }
        return msg;
    }
    return t('unknownNetworkError', 'Неизвестная ошибка сети.');
}

/**
 * Выполняет потоковый запрос к GigaChat API с автоматическим получением токена
 * и однократным retry при получении 401 (сброс кэша токена).
 */
export async function streamGigaChatText(
    msg: MistralRequest,
    authKey: string,
    settings: MistralSettings,
    signal: AbortSignal,
    onChunk: (text: string) => void,
): Promise<AIResponse> {
    const prompt = buildPromptPayload(msg, settings);
    const shouldRestorePii = Object.keys(prompt.piiMaskMap).length > 0;
    const maxTokens = getAiOutputTokenLimit(msg.mode, settings.aiMode, msg.text, msg.rawMessages);

    let fullCollectedText = '';

    const executeAttempt = async (isRetryAfter401: boolean): Promise<Response> => {
        const accessToken = await getGigaChatAccessToken(authKey, signal);
        const url = `${GIGACHAT_API_BASE_URL}/chat/completions`;

        const requestBody = {
            model: GIGACHAT_DEFAULT_MODEL,
            messages: prompt.messages,
            stream: true,
            temperature: 0.3,
            max_tokens: maxTokens,
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(requestBody),
            cache: 'no-store',
            signal,
        });

        // Если получен 401 и это не повторный запрос: сбрасываем токен и пробуем ещё ровно один раз
        if (response.status === 401 && !isRetryAfter401 && !signal.aborted) {
            await response.body?.cancel();
            await invalidateGigaChatToken(accessToken);
            await wait(200, signal);
            return await executeAttempt(true);
        }

        return response;
    };

    let response: Response;
    try {
        response = await executeAttempt(false);
    } catch (err) {
        if (signal.aborted) throw err;
        if (err instanceof AiProviderError) throw err;
        const formatted = formatGigaChatError(err);
        void recordErrorLog({
            level: 'error',
            source: 'gigachat-client',
            provider: 'gigachat',
            message: `Ошибка запроса к GigaChat: ${formatted}`,
        });
        throw new AiProviderError(formatted, 'NETWORK_ERROR', 'gigachat', true);
    }

    if (!response.ok) {
        const { message, error } = classifyGigaChatError(response.status, response.headers?.get('Retry-After'));
        void recordErrorLog({
            level: 'error',
            source: 'gigachat-client',
            provider: 'gigachat',
            status: response.status,
            message: `GigaChat API вернул статус ${response.status}: ${message}`,
        });
        throw error;
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new AiProviderError(
            t('emptyStream', 'GigaChat вернул пустой поток данных.'),
            'INVALID_RESPONSE',
            'gigachat',
            true,
        );
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let bufferedMaskedContent = '';
    let receivedContent = false;

    const emitCompletedContent = () => {
        if (shouldRestorePii && bufferedMaskedContent) {
            const restored = unmaskPii(bufferedMaskedContent, prompt.piiMaskMap);
            fullCollectedText += restored;
            onChunk(restored);
            bufferedMaskedContent = '';
        }
    };

    const processLine = (line: string): boolean => {
        if (line.trim() === 'data: [DONE]') return true;
        const content = readSsePayload(line);
        if (content) {
            receivedContent = true;
            if (shouldRestorePii) {
                bufferedMaskedContent += content;
            } else {
                fullCollectedText += content;
                onChunk(content);
            }
        }
        return false;
    };

    try {
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
                        t('emptyStream', 'GigaChat вернул пустой поток данных.'),
                        'INVALID_RESPONSE',
                        'gigachat',
                        true,
                    );
                }
                emitCompletedContent();
                await reader.cancel();
                return {
                    text: fullCollectedText,
                    provider: 'gigachat',
                    model: GIGACHAT_DEFAULT_MODEL,
                };
            }
        }

        buffer += decoder.decode();
        if (buffer && processLine(buffer)) {
            if (!receivedContent) {
                throw new AiProviderError(
                    t('emptyStream', 'GigaChat вернул пустой поток данных.'),
                    'INVALID_RESPONSE',
                    'gigachat',
                    true,
                );
            }
            emitCompletedContent();
            await reader.cancel();
            return {
                text: fullCollectedText,
                provider: 'gigachat',
                model: GIGACHAT_DEFAULT_MODEL,
            };
        }

        if (!receivedContent) {
            throw new AiProviderError(
                t('emptyStream', 'GigaChat вернул пустой поток данных.'),
                'INVALID_RESPONSE',
                'gigachat',
                true,
            );
        }

        throw new AiProviderError(
            t('incompleteStream', 'Ответ GigaChat прервался до завершения. Повторите запрос.'),
            'INVALID_RESPONSE',
            'gigachat',
            false,
        );
    } catch (err) {
        if (signal.aborted) throw err;
        if (err instanceof AiProviderError) throw err;
        throw new AiProviderError(
            t('incompleteStream', 'Ответ GigaChat прервался до завершения. Повторите запрос.'),
            'NETWORK_ERROR',
            'gigachat',
            true,
        );
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

export const readGigaChatSsePayload = readSsePayload;
export { validateGigaChatAuthKey };
