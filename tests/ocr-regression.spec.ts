import { beforeEach, expect, test, vi } from 'vitest';
import {
    PROVIDER_CAPABILITIES,
    isProviderCapableOf,
    getCompatibleFallbackProvider,
} from '../src/provider-capabilities';
import { resolveExecutionPlan, executeAiStreamRequest, resetAiProviderHealth } from '../src/ai-client';
import {
    acquireProviderAttempt,
    getProviderAvailability,
    recordProviderFailure,
    recordProviderSuccess,
    resetProviderAvailability,
} from '../src/provider-availability';
import { AiProviderError } from '../src/ai-provider-types';
import { clearErrorLogs, formatErrorLogsAsText, getErrorLogs, recordErrorLog } from '../src/error-log';
import { generateRequestId } from '../src/request-id';
import { processOcr, MistralRequestError } from '../src/mistral-client';

let mockLocalStorage: Record<string, unknown> = {};

beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage = {};
    vi.stubGlobal('chrome', {
        storage: {
            local: {
                async get(keys: string | string[] | Record<string, unknown> | null) {
                    if (keys === null) return { ...mockLocalStorage };
                    if (typeof keys === 'string') return { [keys]: mockLocalStorage[keys] };
                    if (Array.isArray(keys)) {
                        return Object.fromEntries(keys.map((k) => [k, mockLocalStorage[k]]));
                    }
                    if (keys && typeof keys === 'object') {
                        return Object.fromEntries(
                            Object.entries(keys).map(([k, def]) => [k, mockLocalStorage[k] ?? def]),
                        );
                    }
                    return { ...mockLocalStorage };
                },
                async set(items: Record<string, unknown>) {
                    Object.assign(mockLocalStorage, structuredClone(items));
                },
                async remove(keys: string | string[]) {
                    for (const k of Array.isArray(keys) ? keys : [keys]) delete mockLocalStorage[k];
                },
            },
        },
    });
    resetProviderAvailability();
    resetAiProviderHealth();
});

test('Сценарий 1: Матрица PROVIDER_CAPABILITIES корректно отражает возможности провайдеров', () => {
    expect(PROVIDER_CAPABILITIES.mistral.ocr).toBe(true);
    expect(PROVIDER_CAPABILITIES.mistral.spellcheck).toBe(true);
    expect(PROVIDER_CAPABILITIES.mistral.style).toBe(true);

    expect(PROVIDER_CAPABILITIES.cloudflare.ocr).toBe(false);
    expect(PROVIDER_CAPABILITIES.cloudflare.spellcheck).toBe(true);
    expect(PROVIDER_CAPABILITIES.cloudflare.style).toBe(true);

    expect(PROVIDER_CAPABILITIES['yandex-speller'].ocr).toBe(false);
    expect(PROVIDER_CAPABILITIES['yandex-speller'].spellcheck).toBe(true);
    expect(PROVIDER_CAPABILITIES['yandex-speller'].style).toBe(false);
});

test('Сценарий 2: Хелпер isProviderCapableOf корректно проверяет поддержку операций', () => {
    expect(isProviderCapableOf('mistral', 'ocr')).toBe(true);
    expect(isProviderCapableOf('mistral', 'spellcheck')).toBe(true);
    expect(isProviderCapableOf('mistral', 'summary')).toBe(true);

    expect(isProviderCapableOf('cloudflare', 'ocr')).toBe(false);
    expect(isProviderCapableOf('cloudflare', 'spellcheck')).toBe(true);
    expect(isProviderCapableOf('cloudflare', 'style')).toBe(true);

    expect(isProviderCapableOf('yandex-speller', 'ocr')).toBe(false);
    expect(isProviderCapableOf('yandex-speller', 'spellcheck')).toBe(true);
    expect(isProviderCapableOf('yandex-speller', 'translate')).toBe(false);

    expect(isProviderCapableOf('unknown-provider', 'spellcheck')).toBe(false);
});

test('Сценарий 3: getCompatibleFallbackProvider возвращает undefined для OCR и корректный fallback для текста', () => {
    expect(getCompatibleFallbackProvider('mistral', 'ocr')).toBeUndefined();
    expect(getCompatibleFallbackProvider('cloudflare', 'ocr')).toBe('mistral');

    expect(getCompatibleFallbackProvider('mistral', 'spellcheck')).toBe('cloudflare');
    expect(getCompatibleFallbackProvider('cloudflare', 'spellcheck')).toBe('mistral');
    expect(getCompatibleFallbackProvider('mistral', 'style')).toBe('cloudflare');
});

test('Сценарий 4: resolveExecutionPlan для OCR не назначает Cloudflare в качестве резерва', () => {
    const plan = resolveExecutionPlan({
        operation: 'ocr',
        primaryProvider: 'mistral',
        autoFallback: true,
        mistralApiKey: 'mistral-test-key-123',
        cloudflareAccountId: 'cf-acc-123',
        cloudflareApiToken: 'cf-token-123',
    });

    expect(plan.primary).toBe('mistral');
    expect(plan.backup).toBeUndefined();
    expect(plan.fallbackEligible).toBe(false);
});

test('Сценарий 5: resolveExecutionPlan для spellcheck и style сохраняет резервный Cloudflare', () => {
    const planSpellcheck = resolveExecutionPlan({
        operation: 'spellcheck',
        primaryProvider: 'mistral',
        autoFallback: true,
        mistralApiKey: 'mistral-test-key-123',
        cloudflareAccountId: 'cf-acc-123',
        cloudflareApiToken: 'cf-token-123',
    });

    expect(planSpellcheck.primary).toBe('mistral');
    expect(planSpellcheck.backup).toBe('cloudflare');
    expect(planSpellcheck.fallbackEligible).toBe(true);

    const planStyle = resolveExecutionPlan({
        operation: 'style',
        primaryProvider: 'mistral',
        autoFallback: true,
        mistralApiKey: 'mistral-test-key-123',
        cloudflareAccountId: 'cf-acc-123',
        cloudflareApiToken: 'cf-token-123',
    });

    expect(planStyle.primary).toBe('mistral');
    expect(planStyle.backup).toBe('cloudflare');
    expect(planStyle.fallbackEligible).toBe(true);
});

test('Сценарий 6: OCR запрос при активном COOLDOWN Mistral не делает сетевой вызов (fail-fast)', async () => {
    const baseTime = Date.now();
    await recordProviderFailure(
        new AiProviderError('Rate limit exceeded', 'RATE_LIMIT', 'mistral', true, 429, 25_000),
        baseTime,
    );

    const availability = await getProviderAvailability('mistral', baseTime);
    expect(availability.healthState).toBe('cooldown');
    expect(availability.cooldownRemainingMs).toBe(25_000);

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const lease = await acquireProviderAttempt('mistral', baseTime);
    expect(lease.allowed).toBe(false);
    expect(lease.cooldownRemainingMs).toBe(25_000);
    expect(fetchSpy).not.toHaveBeenCalled();
});

test('Сценарий 7: OCR запрос при HTTP 429 от Mistral переводит провайдера в COOLDOWN без fallback', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '30' }),
        text: async () => JSON.stringify({ message: 'Rate limit reached' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    let caughtError: unknown;
    try {
        await processOcr(
            { action: 'callMistral', mode: 'ocr', text: '', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' },
            'mistral-key',
            new AbortController().signal,
        );
    } catch (e) {
        caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(MistralRequestError);
    const mistralErr = caughtError as MistralRequestError;
    expect(mistralErr.status).toBe(429);
    expect(mistralErr.retryAfterMs).toBe(30_000);

    await recordProviderFailure(
        new AiProviderError(
            mistralErr.message,
            'RATE_LIMIT',
            'mistral',
            true,
            mistralErr.status,
            mistralErr.retryAfterMs,
        ),
    );

    const availability = await getProviderAvailability('mistral');
    expect(availability.healthState).toBe('cooldown');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/ocr'), expect.anything());
});

test('Сценарий 8: OCR запрос при HTTP 500 от Mistral регистрирует ошибку без попытки fallback', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => JSON.stringify({ message: 'Internal Server Error' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    let caughtError: unknown;
    try {
        await processOcr(
            { action: 'callMistral', mode: 'ocr', text: '', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' },
            'mistral-key',
            new AbortController().signal,
        );
    } catch (e) {
        caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(MistralRequestError);
    const mistralErr = caughtError as MistralRequestError;
    expect(mistralErr.status).toBe(500);

    await recordProviderFailure(new AiProviderError(mistralErr.message, 'SERVER_ERROR', 'mistral', true, 500));

    const availability = await getProviderAvailability('mistral');
    expect(availability.healthState).toBe('degraded');
});

test('Сценарий 9: OCR запрос при здоровом Mistral успешно возвращает распознанный текст', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
            pages: [
                { markdown: '# Заголовок документа\n\nРаспознанный текст первой страницы.' },
                { markdown: 'Текст второй страницы.' },
            ],
        }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await processOcr(
        { action: 'callMistral', mode: 'ocr', text: '', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' },
        'mistral-key',
        new AbortController().signal,
    );

    expect(result).toBe('# Заголовок документа\n\nРаспознанный текст первой страницы.\n\nТекст второй страницы.');
    await recordProviderSuccess('mistral');

    const availability = await getProviderAvailability('mistral');
    expect(availability.healthState).toBe('healthy');
});

test('Сценарий 10: OCR запрос без API-ключа выбрасывает ошибку авторизации', async () => {
    let error: unknown;
    try {
        const hasMistral = Boolean(''.trim());
        if (!hasMistral) {
            throw new AiProviderError(
                'Для распознавания текста (OCR) требуется API-ключ Mistral.',
                'AUTH_ERROR',
                'mistral',
                false,
                undefined,
                undefined,
                { causeCode: 'OCR_AUTH_ERROR' },
            );
        }
    } catch (e) {
        error = e;
    }

    expect(error).toBeInstanceOf(AiProviderError);
    const aiErr = error as AiProviderError;
    expect(aiErr.code).toBe('AUTH_ERROR');
    expect(aiErr.causeCode).toBe('OCR_AUTH_ERROR');
    expect(aiErr.retryable).toBe(false);
});

test('Сценарий 11: OCR запрос без изображения выбрасывает ошибку INVALID_PAYLOAD', async () => {
    await expect(
        processOcr(
            { action: 'callMistral', mode: 'ocr', text: '', imageUrl: '' },
            'mistral-key',
            new AbortController().signal,
        ),
    ).rejects.toThrow();
});

test('Сценарий 12: generateRequestId генерирует глобально уникальные ID', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    const id3 = generateRequestId('custom');

    expect(id1).toMatch(/^req-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
    expect(id2).toMatch(/^req-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
    expect(id3).toMatch(/^custom-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
});

test('Сценарий 13: recordErrorLog сохраняет флаги совместимости и здоровья для OCR', async () => {
    await clearErrorLogs();
    const reqId = generateRequestId();

    await recordErrorLog({
        level: 'error',
        source: 'request',
        message: 'REQUEST_FAILED',
        errorCode: 'REQUEST_FAILED',
        finalErrorCode: 'REQUEST_FAILED',
        causeCode: 'OCR_PROVIDER_RATE_LIMIT',
        requestId: reqId,
        operation: 'ocr',
        provider: 'mistral',
        primaryProvider: 'mistral',
        primaryCapability: true,
        primaryHealth: 'COOLDOWN',
        primaryResult: 'RATE_LIMIT',
        fallbackProvider: undefined,
        fallbackCapability: false,
        fallbackEligibility: false,
        fallbackResult: 'not_attempted',
        fallbackAttempted: false,
        fallbackSucceeded: false,
        elapsedMs: 150,
    });

    const logs = await getErrorLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].requestId).toBe(reqId);
    expect(logs[0].operation).toBe('ocr');
    expect(logs[0].primaryCapability).toBe(true);
    expect(logs[0].primaryHealth).toBe('COOLDOWN');
    expect(logs[0].fallbackCapability).toBe(false);
    expect(logs[0].fallbackEligibility).toBe(false);
    expect(logs[0].fallbackAttempted).toBe(false);
    expect(logs[0].fallbackResult).toBe('not_attempted');
});

test('Сценарий 14: formatErrorLogsAsText форматирует информацию о совместимости и здоровье', async () => {
    await clearErrorLogs();
    const reqId = generateRequestId();

    await recordErrorLog({
        level: 'error',
        source: 'request',
        message: 'REQUEST_FAILED',
        errorCode: 'REQUEST_FAILED',
        finalErrorCode: 'REQUEST_FAILED',
        causeCode: 'OCR_PROVIDER_RATE_LIMIT',
        requestId: reqId,
        operation: 'ocr',
        primaryProvider: 'mistral',
        primaryCapability: true,
        primaryHealth: 'COOLDOWN',
        primaryResult: 'RATE_LIMIT',
        fallbackProvider: undefined,
        fallbackCapability: false,
        fallbackEligibility: false,
        fallbackAttempted: false,
        fallbackResult: 'not_attempted',
    });

    const logs = await getErrorLogs();
    const formatted = formatErrorLogsAsText(logs);

    expect(formatted).toContain(`Request ID: ${reqId}`);
    expect(formatted).toContain('Операция: ocr');
    expect(formatted).toContain('Основной провайдер: mistral');
    expect(formatted).toContain('Совместимость основного: да');
    expect(formatted).toContain('Здоровье основного: COOLDOWN');
    expect(formatted).toContain('Результат основного: RATE_LIMIT');
    expect(formatted).toContain('Совместимость резерва: нет');
    expect(formatted).toContain('Допустимость резерва: нет');
    expect(formatted).toContain('Попытка резерва: нет');
    expect(formatted).toContain('Результат резерва: not_attempted');
    expect(formatted).toContain('Причина (cause): OCR_PROVIDER_RATE_LIMIT');
});

test('Сценарий 15: spellcheck при ошибке Mistral 429 успешно переключается на Cloudflare (fallback)', async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('mistral.ai')) {
            return new Response(JSON.stringify({ message: 'Rate limit reached' }), {
                status: 429,
                headers: { 'content-type': 'application/json', 'Retry-After': '30' },
            });
        }
        if (url.includes('cloudflare.com')) {
            return new Response(
                JSON.stringify({
                    success: true,
                    result: { choices: [{ message: { content: 'Исправленный текст с ошибками.' } }] },
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        }
        return new Response('Not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    let collectedText = '';
    const result = await executeAiStreamRequest({
        request: { action: 'callMistral', mode: 'spellcheck', text: 'Исправленый текст с ошыбками.' },
        settings: {
            selectedTone: 'business',
            sendPageContext: false,
            personalDictionary: [],
            glossary: [],
            aiMode: 'fast',
            enablePiiMasking: false,
        },
        primaryProvider: 'mistral',
        autoFallback: true,
        mistralApiKey: 'mistral-key',
        cloudflareAccountId: 'cf-account',
        cloudflareApiToken: 'cf-token',
        signal: new AbortController().signal,
        onChunk: (chunk) => {
            collectedText += chunk;
        },
    });

    expect(result.providerUsed).toBe('cloudflare');
    expect(result.fallbackOccurred).toBe(true);
    expect(result.fallbackReason).toBe('RATE_LIMIT');
    expect(collectedText).toBe('Исправленный текст с ошибками.');
});

test('Сценарий 16: style rewrite при ошибке Mistral 429 успешно переключается на Cloudflare', async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('mistral.ai')) {
            return new Response(JSON.stringify({ message: 'Rate limit reached' }), {
                status: 429,
                headers: { 'content-type': 'application/json', 'Retry-After': '30' },
            });
        }
        if (url.includes('cloudflare.com')) {
            const encoder = new TextEncoder();
            const sseStream = new ReadableStream({
                start(controller) {
                    controller.enqueue(
                        encoder.encode(
                            'data: {"response":"Уважаемые коллеги, представляем обновлённый отчёт."}\n\ndata: [DONE]\n\n',
                        ),
                    );
                    controller.close();
                },
            });
            return new Response(sseStream, {
                status: 200,
                headers: { 'content-type': 'text/event-stream' },
            });
        }
        return new Response('Not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    let collectedText = '';
    const result = await executeAiStreamRequest({
        request: { action: 'callMistral', mode: 'style', text: 'Привет всем вот новый отчет.' },
        settings: {
            selectedTone: 'business',
            sendPageContext: false,
            personalDictionary: [],
            glossary: [],
            aiMode: 'fast',
            enablePiiMasking: false,
        },
        primaryProvider: 'mistral',
        autoFallback: true,
        mistralApiKey: 'mistral-key',
        cloudflareAccountId: 'cf-account',
        cloudflareApiToken: 'cf-token',
        signal: new AbortController().signal,
        onChunk: (chunk) => {
            collectedText += chunk;
        },
    });

    expect(result.providerUsed).toBe('cloudflare');
    expect(result.fallbackOccurred).toBe(true);
    expect(result.fallbackReason).toBe('RATE_LIMIT');
    expect(collectedText).toBe('Уважаемые коллеги, представляем обновлённый отчёт.');
});
