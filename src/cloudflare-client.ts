import { t } from './i18n';
import { unmaskPii } from './pii-masker';
import { buildPromptPayload } from './prompt-builder';
import type { MistralRequest, MistralSettings } from './mistral-client';
import { parseRetryAfterMs } from './mistral-client';
import { AiProviderError, type AIResponse, type CloudflareCredentials } from './ai-provider-types';
import { getAiOutputTokenLimit } from './ai-output-budget';
import { AI_CONFIG, normalizeCloudflareModel } from './ai-models-config';
import { validateAiOutput } from './ai-sanity-check';
import { SseParser, type SseEvent } from './sse-parser';

export const CLOUDFLARE_API_BASE_URL = AI_CONFIG.cloudflare.baseUrl;
export const CLOUDFLARE_DEFAULT_MODEL = AI_CONFIG.cloudflare.defaultModel;

export interface CloudflareUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    neurons?: number;
}

export function classifyCloudflareError(
    status: number,
    retryAfterHeader?: string | null,
): { message: string; error: AiProviderError } {
    if (status === 401 || status === 403) {
        const msg = t('cloudflareAuthError', 'Проверьте Cloudflare API Token.');
        return { message: msg, error: new AiProviderError(msg, 'AUTH_ERROR', 'cloudflare', false, status) };
    }
    if (status === 404) {
        const msg = t('cloudflareAccountError', 'Проверьте Cloudflare Account ID.');
        return { message: msg, error: new AiProviderError(msg, 'ACCOUNT_ERROR', 'cloudflare', false, status) };
    }
    if (status === 429) {
        const msg = t(
            'cloudflareRateLimit',
            'Cloudflare Workers AI временно ограничил запросы или исчерпал доступную квоту. Попробуйте позже.',
        );
        return {
            message: msg,
            error: new AiProviderError(
                msg,
                'RATE_LIMIT',
                'cloudflare',
                true,
                status,
                parseRetryAfterMs(retryAfterHeader ?? null) ?? undefined,
            ),
        };
    }
    if (status >= 500) {
        const msg = t('cloudflareServerError', 'Ошибка сервера Cloudflare Workers AI.');
        return { message: msg, error: new AiProviderError(msg, 'SERVER_ERROR', 'cloudflare', true, status) };
    }
    if (status === 400) {
        const msg = t('cloudflareInvalidRequest', 'Неверный запрос к Cloudflare Workers AI.');
        return { message: msg, error: new AiProviderError(msg, 'INVALID_REQUEST', 'cloudflare', false, status) };
    }
    const msg = `${t('cloudflareApiError', 'Ошибка Cloudflare Workers AI')} (${status}).`;
    return { message: msg, error: new AiProviderError(msg, 'UNKNOWN_ERROR', 'cloudflare', false, status) };
}

export function formatCloudflareError(error: unknown): string {
    if (error instanceof AiProviderError) return error.message;
    if (error instanceof Error) {
        if (error.name === 'AbortError') return error.message;
        const msg = error.message;
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || error instanceof TypeError) {
            return t('cloudflareNetworkError', 'Не удалось подключиться к Cloudflare Workers AI.');
        }
        return msg;
    }
    return t('unknownNetworkError', 'Неизвестная ошибка сети.');
}

export function readCloudflareSsePayload(line: string): { content: string; usage?: CloudflareUsage; done?: boolean } {
    const trimmed = line.trim();
    if (trimmed === 'data: [DONE]') {
        return { content: '', done: true };
    }
    if (!trimmed.startsWith('data:')) {
        return { content: '' };
    }
    const raw = trimmed.replace(/^data:\s*/, '').trim();
    if (!raw) return { content: '' };

    try {
        const parsed = JSON.parse(raw) as {
            response?: string;
            result?: { response?: string; usage?: CloudflareUsage };
            choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> } }>;
            usage?: CloudflareUsage;
        };
        const deltaContent = parsed.choices?.[0]?.delta?.content;
        const choiceContent =
            typeof deltaContent === 'string'
                ? deltaContent
                : Array.isArray(deltaContent)
                  ? deltaContent.map((part) => part.text || '').join('')
                  : '';
        const content = parsed.response ?? parsed.result?.response ?? choiceContent;
        const usage = parsed.usage ?? parsed.result?.usage;
        return { content, usage };
    } catch {
        return { content: '' };
    }
}

/**
 * Валидирует учетные данные Cloudflare: Account ID и API Token.
 * Выполняет тестовый запрос к Cloudflare Workers AI и возвращает задержку (latency).
 */
export async function validateCloudflareCredentials(
    credentials: CloudflareCredentials,
    model: string = CLOUDFLARE_DEFAULT_MODEL,
    signal?: AbortSignal,
): Promise<{ ok: boolean; message: string; latencyMs?: number; model?: string; status?: number; errorCode?: string }> {
    const accountId = (credentials.accountId || '').trim();
    const apiToken = (credentials.apiToken || '').trim();

    if (!accountId) {
        return { ok: false, message: t('cloudflareEmptyAccountId', 'Введите Cloudflare Account ID.') };
    }
    if (!apiToken) {
        return { ok: false, message: t('cloudflareEmptyToken', 'Введите Cloudflare Workers AI API Token.') };
    }

    const start = Date.now();
    const resolvedModel = normalizeCloudflareModel(model);
    const url = `${CLOUDFLARE_API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/ai/run/${resolvedModel}`;

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), 12_000);
    const combinedSignal = signal
        ? AbortSignal.any
            ? AbortSignal.any([signal, controller.signal])
            : controller.signal
        : controller.signal;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'Ping' }],
                max_tokens: 1,
            }),
            signal: combinedSignal,
        });

        clearTimeout(timeoutTimer);
        const latencyMs = Date.now() - start;

        if (response.ok) {
            return {
                ok: true,
                message: t('serverStatusHealthy', 'Работает отлично'),
                latencyMs,
                model: resolvedModel,
            };
        }

        const { message, error } = classifyCloudflareError(response.status, response.headers?.get('Retry-After'));
        return { ok: false, message, latencyMs, status: response.status, errorCode: error.code };
    } catch (err) {
        clearTimeout(timeoutTimer);
        if (controller.signal.aborted && !signal?.aborted) {
            return {
                ok: false,
                message: t('cloudflareTimeout', 'Cloudflare Workers AI не ответил вовремя.'),
                errorCode: 'TIMEOUT',
            };
        }
        return { ok: false, message: formatCloudflareError(err), errorCode: 'NETWORK_ERROR' };
    }
}

export const testCloudflareConnection = validateCloudflareCredentials;

/**
 * Выполняет потоковый запрос к Cloudflare Workers AI с обработкой SSE,
 * маскированием PII, измерением токенов/нейронов и обработкой ошибок.
 */
export async function streamCloudflareText(
    msg: MistralRequest,
    credentials: CloudflareCredentials,
    settings: MistralSettings,
    signal: AbortSignal,
    onChunk: (text: string) => void,
    selectedModel: string = CLOUDFLARE_DEFAULT_MODEL,
    onActivity?: () => void,
): Promise<AIResponse> {
    const accountId = (credentials.accountId || '').trim();
    const apiToken = (credentials.apiToken || '').trim();

    if (!accountId) {
        throw new AiProviderError(
            t('cloudflareEmptyAccountId', 'Введите Cloudflare Account ID.'),
            'ACCOUNT_ERROR',
            'cloudflare',
            false,
        );
    }
    if (!apiToken) {
        throw new AiProviderError(
            t('cloudflareEmptyToken', 'Введите Cloudflare Workers AI API Token.'),
            'AUTH_ERROR',
            'cloudflare',
            false,
        );
    }

    const prompt = buildPromptPayload(msg, settings);
    const resolvedModel = normalizeCloudflareModel(selectedModel);
    const shouldRestorePii = Object.keys(prompt.piiMaskMap).length > 0;
    const maxTokens = getAiOutputTokenLimit(msg.mode, settings.aiMode, msg.text, msg.rawMessages);
    const temperature = msg.mode === 'spellcheck' ? 0.0 : msg.mode === 'summary' ? 0.2 : 0.3;

    let fullCollectedText = '';
    let usageData: CloudflareUsage | undefined;

    const url = `${CLOUDFLARE_API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/ai/run/${resolvedModel}`;
    const requestBody = {
        messages: prompt.messages,
        stream: true,
        max_tokens: maxTokens,
        temperature,
    };

    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            cache: 'no-store',
            signal,
        });
    } catch (err) {
        if (signal.aborted) throw err;
        const formatted = formatCloudflareError(err);
        throw new AiProviderError(formatted, 'NETWORK_ERROR', 'cloudflare', true);
    }

    if (!response.ok) {
        const { error } = classifyCloudflareError(response.status, response.headers?.get('Retry-After'));
        throw error;
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new AiProviderError(
            t('cloudflareEmptyResponse', 'Cloudflare Workers AI вернул пустой поток данных.'),
            'INVALID_RESPONSE',
            'cloudflare',
            true,
        );
    }

    const decoder = new TextDecoder();
    const parser = new SseParser();
    let bufferedMaskedContent = '';
    let receivedContent = false;
    const deferOutputUntilValidated = msg.mode === 'spellcheck';

    const emitCompletedContent = () => {
        if (shouldRestorePii && bufferedMaskedContent) {
            const restored = unmaskPii(bufferedMaskedContent, prompt.piiMaskMap);
            fullCollectedText += restored;
            if (!deferOutputUntilValidated) onChunk(restored);
            bufferedMaskedContent = '';
        }
    };

    const finalizeCompletedContent = () => {
        emitCompletedContent();
        const sanity = validateAiOutput({
            originalText: msg.text || '',
            correctedText: fullCollectedText,
            mode: msg.mode,
            targetLang: msg.targetLang,
        });
        if (!sanity.valid) {
            throw new AiProviderError(
                `${t('qualityCheckFailed', 'Ответ Cloudflare не прошёл проверку качества.')} (${sanity.reason})`,
                'QUALITY_CHECK_FAILED',
                'cloudflare',
                true,
            );
        }
        fullCollectedText = sanity.cleanedText;
        if (deferOutputUntilValidated) onChunk(sanity.cleanedText);
    };

    const processEvent = (event: SseEvent): boolean => {
        if (event.data.trim() === '[DONE]') return true;
        let parsed: { content: string; usage?: CloudflareUsage };
        try {
            const payload = JSON.parse(event.data) as {
                response?: string;
                result?: { response?: string; usage?: CloudflareUsage };
                choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> } }>;
                usage?: CloudflareUsage;
            };
            const deltaContent = payload.choices?.[0]?.delta?.content;
            const choiceContent =
                typeof deltaContent === 'string'
                    ? deltaContent
                    : Array.isArray(deltaContent)
                      ? deltaContent.map((part) => part.text || '').join('')
                      : '';
            parsed = {
                content: payload.response ?? payload.result?.response ?? choiceContent,
                usage: payload.usage ?? payload.result?.usage,
            };
        } catch {
            throw new AiProviderError(
                t('cloudflareInvalidStream', 'Cloudflare Workers AI вернул повреждённые потоковые данные.'),
                'INVALID_RESPONSE',
                'cloudflare',
                true,
            );
        }
        if (parsed.usage) {
            usageData = { ...usageData, ...parsed.usage };
        }
        if (parsed.content) {
            receivedContent = true;
            if (shouldRestorePii) {
                bufferedMaskedContent += parsed.content;
            } else {
                fullCollectedText += parsed.content;
                if (!deferOutputUntilValidated) onChunk(parsed.content);
            }
        }
        return false;
    };

    const complete = (): AIResponse => {
        if (!receivedContent) {
            throw new AiProviderError(
                t('cloudflareEmptyResponse', 'Cloudflare Workers AI вернул пустой поток данных.'),
                'INVALID_RESPONSE',
                'cloudflare',
                true,
            );
        }
        finalizeCompletedContent();
        return {
            text: fullCollectedText,
            provider: 'cloudflare',
            model: resolvedModel,
            usage: usageData
                ? {
                      promptTokens: usageData.prompt_tokens,
                      completionTokens: usageData.completion_tokens,
                      totalTokens: usageData.total_tokens,
                      neurons: usageData.neurons,
                  }
                : undefined,
        };
    };

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            onActivity?.();
            for (const event of parser.push(decoder.decode(value, { stream: true }))) {
                if (!processEvent(event)) continue;
                const result = complete();
                await reader.cancel();
                return result;
            }
        }

        const finalChunk = decoder.decode();
        const finalEvents = [...parser.push(finalChunk), ...parser.finish()];
        for (const event of finalEvents) {
            if (!processEvent(event)) continue;
            const result = complete();
            await reader.cancel();
            return result;
        }

        // Если поток завершился без явного [DONE], это незавершённый поток
        if (!receivedContent) {
            throw new AiProviderError(
                t('cloudflareEmptyResponse', 'Cloudflare Workers AI вернул пустой поток данных.'),
                'INVALID_RESPONSE',
                'cloudflare',
                true,
            );
        }

        throw new AiProviderError(
            t('cloudflareIncompleteStream', 'Ответ Cloudflare Workers AI прервался до завершения. Повторите запрос.'),
            'INVALID_RESPONSE',
            'cloudflare',
            true,
        );
    } catch (err) {
        if (signal.aborted) throw err;
        if (err instanceof AiProviderError) throw err;
        throw new AiProviderError(
            t('cloudflareIncompleteStream', 'Ответ Cloudflare Workers AI прервался до завершения. Повторите запрос.'),
            'NETWORK_ERROR',
            'cloudflare',
            true,
        );
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
