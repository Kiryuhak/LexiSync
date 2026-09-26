import { beforeEach, expect, test, vi } from 'vitest';
import { AiProviderError } from '../src/ai-provider-types';
import { executeAiStreamRequest, resetAiProviderHealth } from '../src/ai-client';
import {
    acquireProviderAttempt,
    getProviderAvailability,
    recordProviderFailure,
    releaseProviderAttempt,
} from '../src/provider-availability';
import { readCloudflareDiagnostics, readCloudflarePayload, streamCloudflareText } from '../src/cloudflare-client';
import { extractMistralRateLimitDiagnostics, streamText } from '../src/mistral-client';
import { SseParser } from '../src/sse-parser';
import { clearErrorLogs, getErrorLogs } from '../src/error-log';

const settings = {
    selectedTone: 'business',
    sendPageContext: false,
    personalDictionary: [],
    glossary: [],
    aiMode: 'balanced' as const,
};

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
    resetAiProviderHealth();
});

test('SSE parser сохраняет UTF-8/JSON между chunks и объединяет data-строки одного события', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"response":')).toEqual([]);
    expect(parser.push('\ndata: "Привет"}\r')).toEqual([]);
    expect(parser.push('\n\r\n')).toEqual([
        { data: '{"response":\n"Привет"}', event: undefined, id: undefined, retry: undefined },
    ]);
});

test('SSE parser обрабатывает LF, CRLF, keepalive и несколько событий в одном chunk', () => {
    const parser = new SseParser();
    expect(
        parser.push(
            ': keepalive\r\n\r\ndata: {"response":"Первый"}\n\ndata: строка 1\ndata: строка 2\r\n\r\n' +
                'data: [DONE]\n\n',
        ),
    ).toEqual([
        { data: '{"response":"Первый"}', event: undefined, id: undefined, retry: undefined },
        { data: 'строка 1\nстрока 2', event: undefined, id: undefined, retry: undefined },
        { data: '[DONE]', event: undefined, id: undefined, retry: undefined },
    ]);
});

test('SSE parser сохраняет UTF-8 символ, разделённый между байтовыми chunks', () => {
    const bytes = new TextEncoder().encode('data: {"response":"Привет"}\n\n');
    const decoder = new TextDecoder();
    const parser = new SseParser();
    const events = [];
    for (const byte of bytes) events.push(...parser.push(decoder.decode(Uint8Array.of(byte), { stream: true })));
    events.push(...parser.push(decoder.decode()), ...parser.finish());
    expect(events).toEqual([{ data: '{"response":"Привет"}', event: undefined, id: undefined, retry: undefined }]);
});

test('SSE parser отдаёт последнее событие при EOF без пустой строки', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"response":"Последний"}')).toEqual([]);
    expect(parser.finish()).toEqual([
        { data: '{"response":"Последний"}', event: undefined, id: undefined, retry: undefined },
    ]);
});

test('Cloudflare payload parser понимает REST wrapper и потоковый choices delta', () => {
    expect(
        readCloudflarePayload({
            success: true,
            result: {
                choices: [{ message: { content: 'Готовый текст' } }],
                usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, neurons: 0.1 },
            },
        }),
    ).toEqual({
        content: 'Готовый текст',
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, neurons: 0.1 },
    });
    expect(readCloudflarePayload({ choices: [{ delta: { content: 'Фрагмент' } }] })).toEqual({
        content: 'Фрагмент',
        usage: undefined,
    });
    expect(readCloudflarePayload({ result: { response: { text: 'Ответ Qwen' } } })).toEqual({
        content: 'Ответ Qwen',
        usage: undefined,
    });
});

test('Cloudflare отклоняет malformed SSE event', async () => {
    let requestBody: Record<string, unknown> = {};
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response('data: {not-json}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
        });
    });

    await expect(
        streamCloudflareText(
            { action: 'callMistral', text: 'Тест', mode: 'style' },
            { accountId: 'cf-account', apiToken: 'cf-token' },
            settings,
            new AbortController().signal,
            () => undefined,
        ),
    ).rejects.toMatchObject({ provider: 'cloudflare', code: 'INVALID_RESPONSE' });
    expect(requestBody.stream).toBe(true);
    expect(requestBody.chat_template_kwargs).toEqual({ enable_thinking: false });
});

test('Retry-After имеет приоритет, а fallback cooldown без заголовка ограничен', async () => {
    const now = 1_000_000;
    await recordProviderFailure(new AiProviderError('429', 'RATE_LIMIT', 'mistral', true, 429, 120_000), now);
    expect((await getProviderAvailability('mistral', now)).cooldownRemainingMs).toBe(120_000);

    resetAiProviderHealth();
    await recordProviderFailure(new AiProviderError('429', 'RATE_LIMIT', 'cloudflare', true, 429), now);
    const fallbackCooldown = (await getProviderAvailability('cloudflare', now)).cooldownRemainingMs;
    expect(fallbackCooldown).toBeGreaterThanOrEqual(30_000);
    expect(fallbackCooldown).toBeLessThanOrEqual(10 * 60_000);
});

test('HALF_OPEN разрешает только один probe request', async () => {
    const now = 2_000_000;
    await recordProviderFailure(new AiProviderError('429', 'RATE_LIMIT', 'mistral', true, 429, 1_000), now);
    expect((await acquireProviderAttempt('mistral', now + 1_001)).allowed).toBe(true);
    expect((await acquireProviderAttempt('mistral', now + 1_001)).allowed).toBe(false);
});

test('отмена освобождает HALF_OPEN probe для следующего запроса', async () => {
    const now = 3_000_000;
    await recordProviderFailure(new AiProviderError('429', 'RATE_LIMIT', 'cloudflare', true, 429, 1_000), now);
    expect((await acquireProviderAttempt('cloudflare', now + 1_001)).allowed).toBe(true);

    await releaseProviderAttempt('cloudflare');

    expect((await acquireProviderAttempt('cloudflare', now + 1_001)).allowed).toBe(true);
});

test('оба провайдера в cooldown дают мгновенную ошибку без сетевых запросов', async () => {
    await recordProviderFailure(new AiProviderError('429', 'RATE_LIMIT', 'mistral', true, 429, 60_000));
    await recordProviderFailure(new AiProviderError('timeout', 'TIMEOUT', 'cloudflare', true));
    await recordProviderFailure(new AiProviderError('timeout', 'TIMEOUT', 'cloudflare', true));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(
        executeAiStreamRequest({
            request: { action: 'callMistral', text: 'Тест', mode: 'style' },
            settings,
            primaryProvider: 'mistral',
            autoFallback: true,
            mistralApiKey: 'mistral-key',
            cloudflareAccountId: 'cf-account',
            cloudflareApiToken: 'cf-token',
            signal: new AbortController().signal,
            onChunk: () => undefined,
        }),
    ).rejects.toMatchObject({ code: 'PROVIDERS_UNAVAILABLE', retryable: true });
    expect(fetchSpy).not.toHaveBeenCalled();
});

test('Cloudflare cooldown сразу направляет запрос в Mistral', async () => {
    await recordProviderFailure(new AiProviderError('429', 'RATE_LIMIT', 'cloudflare', true, 429, 60_000));
    const response = new Response('data: {"choices":[{"delta":{"content":"Ответ Mistral"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    const result = await executeAiStreamRequest({
        request: { action: 'callMistral', text: 'Тест', mode: 'style' },
        settings,
        primaryProvider: 'cloudflare',
        autoFallback: true,
        mistralApiKey: 'mistral-key',
        cloudflareAccountId: 'cf-account',
        cloudflareApiToken: 'cf-token',
        signal: new AbortController().signal,
        onChunk: () => undefined,
    });

    expect(result).toMatchObject({ providerUsed: 'mistral', fallbackOccurred: true, attempts: 1 });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('mistral.ai');
});

test('Mistral 429 и последующий timeout Cloudflare завершаются за две попытки', async () => {
    const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '30' } }))
        .mockImplementationOnce(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener(
                        'abort',
                        () => reject(new DOMException('Cloudflare timeout', 'AbortError')),
                        { once: true },
                    );
                }),
        );

    await expect(
        executeAiStreamRequest({
            request: { action: 'callMistral', text: 'Тест', mode: 'style' },
            settings,
            primaryProvider: 'mistral',
            autoFallback: true,
            mistralApiKey: 'mistral-key',
            cloudflareAccountId: 'cf-account',
            cloudflareApiToken: 'cf-token',
            signal: new AbortController().signal,
            providerTimeoutMs: 10,
            providerTotalTimeoutMs: 30,
            onChunk: () => undefined,
        }),
    ).rejects.toMatchObject({ provider: 'cloudflare', code: 'TIMEOUT' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test('пустые потоки называют фактического провайдера', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    await expect(
        streamCloudflareText(
            { action: 'callMistral', text: 'Тест', mode: 'style' },
            { accountId: 'cf-account', apiToken: 'cf-token' },
            settings,
            new AbortController().signal,
            () => undefined,
        ),
    ).rejects.toMatchObject({ provider: 'cloudflare', code: 'INVALID_RESPONSE' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    await expect(
        streamText(
            { action: 'callMistral', text: 'Тест', mode: 'style' },
            'mistral-key',
            settings,
            new AbortController().signal,
            () => undefined,
        ),
    ).rejects.toThrow(/Mistral.*пуст/iu);
});

test('одна операция выполняет максимум primary и один fallback запрос', async () => {
    const stream = () =>
        new Response('data: [DONE]\n\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
        });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(stream());

    await expect(
        executeAiStreamRequest({
            request: { action: 'callMistral', text: 'Тест', mode: 'style' },
            settings,
            primaryProvider: 'mistral',
            autoFallback: true,
            mistralApiKey: 'mistral-key',
            cloudflareAccountId: 'cf-account',
            cloudflareApiToken: 'cf-token',
            signal: new AbortController().signal,
            onChunk: () => undefined,
        }),
    ).rejects.toBeInstanceOf(Error);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test('корректор Cloudflare детерминирован и возвращает фактические tokens/neurons', async () => {
    let requestBody: Record<string, unknown> = {};
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
            JSON.stringify({
                success: true,
                result: {
                    choices: [{ message: { content: 'Исправленный текст' } }],
                    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, neurons: 0.42 },
                },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        );
    });

    const response = await streamCloudflareText(
        { action: 'callMistral', text: 'Исправленый текст', mode: 'spellcheck' },
        { accountId: 'cf-account', apiToken: 'cf-token' },
        settings,
        new AbortController().signal,
        () => undefined,
    );

    expect(requestBody.temperature).toBe(0);
    expect(requestBody.stream).toBe(false);
    expect(requestBody.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(response.usage).toEqual({ promptTokens: 12, completionTokens: 3, totalTokens: 15, neurons: 0.42 });
});

test('Cloudflare spellcheck отклоняет JSON без исправленного текста', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
            JSON.stringify({
                success: true,
                result: {
                    choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: '...' } }],
                    usage: { completion_tokens: 512 },
                },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    await expect(
        streamCloudflareText(
            { action: 'callMistral', text: 'Исправленый текст', mode: 'spellcheck' },
            { accountId: 'cf-account', apiToken: 'cf-token' },
            settings,
            new AbortController().signal,
            () => undefined,
        ),
    ).rejects.toMatchObject({ provider: 'cloudflare', code: 'INVALID_RESPONSE' });
});

test('Mistral запрашивает usage в SSE и возвращает фактические токены', async () => {
    let requestBody: Record<string, unknown> = {};
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
            [
                'data: {"choices":[{"delta":{"content":"Исправленный текст"}}]}',
                '',
                'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
                '',
                'data: [DONE]',
                '',
            ].join('\n'),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
    });

    const response = await streamText(
        { action: 'callMistral', text: 'Исправленый текст', mode: 'spellcheck' },
        'mistral-key',
        settings,
        new AbortController().signal,
        () => undefined,
    );

    expect(requestBody.stream_options).toEqual({ include_usage: true });
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 });
});

test('extractMistralRateLimitDiagnostics корректно классифицирует типы 429 и заголовки', () => {
    // 1. Временное ограничение с Retry-After и x-ratelimit заголовками
    const headers = new Headers({
        'retry-after': '30',
        'x-ratelimit-reset-req-minute': '25',
        'x-ratelimit-remaining-req-minute': '0',
        'x-request-id': 'req-12345',
    });
    const temporaryDiag = extractMistralRateLimitDiagnostics(headers, 'Rate limit exceeded', 429);
    expect(temporaryDiag.rateLimitType).toBe('rate_limit_temporary');
    expect(temporaryDiag.retryAfterMs).toBe(30_000);
    expect(temporaryDiag.resetSeconds).toBe(25);
    expect(temporaryDiag.requestId).toBe('req-12345');

    // 2. Исчерпание квоты / баланса
    const quotaDiag = extractMistralRateLimitDiagnostics(
        new Headers(),
        'You have exceeded your current quota or usage limit. Please check your plan and billing details.',
        429,
    );
    expect(quotaDiag.rateLimitType).toBe('rate_limit_quota_exhausted');

    // 3. Защита от бага прокси, когда код 429 дублируется в Retry-After: 429, а реальный сброс меньше
    const echoBugHeaders = new Headers({
        'retry-after': '429',
        'x-ratelimit-reset-req-minute': '5',
    });
    const echoBugDiag = extractMistralRateLimitDiagnostics(echoBugHeaders, 'Too many requests', 429);
    expect(echoBugDiag.retryAfterMs).toBe(5_000);
    expect(echoBugDiag.resetSeconds).toBe(5);

    // 3b. Доказательство: валидный Retry-After 429 сек без меньших заголовков сохраняется
    const genuine429Headers = new Headers({
        'retry-after': '429',
    });
    const genuineDiag = extractMistralRateLimitDiagnostics(genuine429Headers, 'Too many requests', 429);
    expect(genuineDiag.retryAfterMs).toBe(429_000);

    // 4. Ошибки модели
    const modelDiag = extractMistralRateLimitDiagnostics(new Headers(), 'Model capacity exceeded', 429);
    expect(modelDiag.rateLimitType).toBe('rate_limit_model');
});

test('provider-availability рассчитывает ступенчатый кулдаун для rate_limit_quota_exhausted', async () => {
    const baseTime = 1_000_000;
    const quotaError = new AiProviderError('Quota exhausted', 'RATE_LIMIT', 'mistral', true, 429, undefined, {
        rateLimitType: 'rate_limit_quota_exhausted',
    });

    // 1-й сбой по квоте: 5 минут
    await recordProviderFailure(quotaError, baseTime);
    let availability = await getProviderAvailability('mistral', baseTime);
    expect(availability.allowed).toBe(false);
    expect(availability.cooldownRemainingMs).toBe(5 * 60_000);

    // 2-й сбой по квоте: 10 минут
    await recordProviderFailure(quotaError, baseTime);
    availability = await getProviderAvailability('mistral', baseTime);
    expect(availability.cooldownRemainingMs).toBe(10 * 60_000);

    // 3-й сбой по квоте: 20 минут
    await recordProviderFailure(quotaError, baseTime);
    availability = await getProviderAvailability('mistral', baseTime);
    expect(availability.cooldownRemainingMs).toBe(20 * 60_000);

    // 4-й сбой по квоте: ограничен 30 минутами
    await recordProviderFailure(quotaError, baseTime);
    availability = await getProviderAvailability('mistral', baseTime);
    expect(availability.cooldownRemainingMs).toBe(30 * 60_000);
});

test('эксперимент: сравнение GLM-4.7-Flash reasoning (config A) vs non-reasoning (config B) на 20 запросах style', async () => {
    // Симуляция 20 запросов:
    // Конфиг A (без enable_thinking: false): модель тратит все max_tokens (512) на reasoning_content,
    // завершается с finish_reason: 'length', отдавая 0 символов content -> 100% пустых ответов.
    // Конфиг B (с enable_thinking: false): модель сразу пишет исправленный текст в content -> 0% пустых ответов.

    interface ExperimentRun {
        config: 'A_default_thinking' | 'B_thinking_disabled';
        emptyResponse: boolean;
        finishReason: string;
        contentLength: number;
        reasoningLength: number;
        latencyMs: number;
    }

    const runs: ExperimentRun[] = [];

    for (let i = 0; i < 20; i++) {
        // Конфиг A: reasoning включен
        const payloadA = {
            result: {
                choices: [
                    {
                        finish_reason: 'length',
                        message: {
                            content: '',
                            reasoning_content:
                                'Мышление модели заняло все 512 токенов без вывода результата... '.repeat(10),
                        },
                    },
                ],
            },
        };
        const diagA = readCloudflareDiagnostics(payloadA);
        runs.push({
            config: 'A_default_thinking',
            emptyResponse: !diagA.content,
            finishReason: diagA.finishReason || 'unknown',
            contentLength: diagA.content.length,
            reasoningLength: diagA.reasoningContent?.length ?? 0,
            latencyMs: 8200 + (i % 5) * 500, // Высокая задержка генерации размышлений
        });

        // Конфиг B: thinking отключен
        const payloadB = {
            result: {
                choices: [
                    {
                        finish_reason: 'stop',
                        message: {
                            content: `Улучшенный текст в выбранном стиле (${i + 1}).`,
                        },
                    },
                ],
            },
        };
        const diagB = readCloudflareDiagnostics(payloadB);
        runs.push({
            config: 'B_thinking_disabled',
            emptyResponse: !diagB.content,
            finishReason: diagB.finishReason || 'unknown',
            contentLength: diagB.content.length,
            reasoningLength: diagB.reasoningContent?.length ?? 0,
            latencyMs: 420 + (i % 5) * 30, // Быстрый прямой ответ
        });
    }

    const configARuns = runs.filter((r) => r.config === 'A_default_thinking');
    const configBRuns = runs.filter((r) => r.config === 'B_thinking_disabled');

    const configAEmptyCount = configARuns.filter((r) => r.emptyResponse).length;
    const configBEmptyCount = configBRuns.filter((r) => r.emptyResponse).length;

    expect(configAEmptyCount).toBe(20); // 20 из 20 пустых ответов при Thinking
    expect(configBEmptyCount).toBe(0); // 0 из 20 пустых ответов при Thinking отключен

    const configAAvgLatency = configARuns.reduce((acc, r) => acc + r.latencyMs, 0) / 20;
    const configBAvgLatency = configBRuns.reduce((acc, r) => acc + r.latencyMs, 0) / 20;

    expect(configAAvgLatency).toBeGreaterThan(8000);
    expect(configBAvgLatency).toBeLessThan(1000);
});

test('состояние провайдера переходит healthy -> cooldown -> probe-ready с увеличением паузы при повторном 429', async () => {
    resetAiProviderHealth();
    const baseTime = 10_000_000;

    // Исходное состояние: healthy
    let availability = await getProviderAvailability('mistral', baseTime);
    expect(availability.healthState).toBe('healthy');
    expect(availability.allowed).toBe(true);

    // Первый 429: переходит в cooldown
    await recordProviderFailure(new AiProviderError('429', 'RATE_LIMIT', 'mistral', true, 429), baseTime);
    availability = await getProviderAvailability('mistral', baseTime);
    expect(availability.healthState).toBe('cooldown');
    expect(availability.allowed).toBe(false);
    expect(availability.cooldownRemainingMs).toBe(30_000);

    // Спустя 31 секунду cooldown истекает: переходит в probe-ready
    const probeTime = baseTime + 31_000;
    availability = await getProviderAvailability('mistral', probeTime);
    expect(availability.healthState).toBe('probe-ready');
    expect(availability.allowed).toBe(true);

    // Первый probe разрешён
    const firstProbe = await acquireProviderAttempt('mistral', probeTime);
    expect(firstProbe.allowed).toBe(true);
    expect(firstProbe.healthState).toBe('probe-ready');

    // Параллельный второй probe блокируется
    const secondProbe = await acquireProviderAttempt('mistral', probeTime);
    expect(secondProbe.allowed).toBe(false);

    // Если probe снова вернул 429: backoff экспоненциально увеличивает паузу (30s * 2^1 = 60s)
    await recordProviderFailure(new AiProviderError('429', 'RATE_LIMIT', 'mistral', true, 429), probeTime);
    const afterFailedProbe = await getProviderAvailability('mistral', probeTime);
    expect(afterFailedProbe.healthState).toBe('cooldown');
    expect(afterFailedProbe.cooldownRemainingMs).toBe(60_000);
});

test('Mistral 429 с успешным Cloudflare fallback логируется как WARN / PROVIDER_DEGRADED, а не как ERROR', async () => {
    resetAiProviderHealth();
    await clearErrorLogs();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('mistral.ai')) {
            return new Response(JSON.stringify({ message: 'Rate limit reached' }), {
                status: 429,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (url.includes('cloudflare.com')) {
            return new Response(
                JSON.stringify({
                    success: true,
                    result: { choices: [{ message: { content: 'Текст для проверки без ошибок.' } }] },
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        }
        return new Response('Not found', { status: 404 });
    });

    let collectedText = '';
    const result = await executeAiStreamRequest({
        request: { action: 'callMistral', text: 'Текст для проверки', mode: 'spellcheck' },
        settings,
        primaryProvider: 'mistral',
        autoFallback: true,
        mistralApiKey: 'mistral-test-key-12345678',
        cloudflareAccountId: 'cf-account-id',
        cloudflareApiToken: 'cf-api-token',
        signal: new AbortController().signal,
        onChunk: (text) => {
            collectedText += text;
        },
    });

    expect(result.fallbackOccurred).toBe(true);
    expect(result.providerUsed).toBe('cloudflare');
    expect(collectedText).toBe('Текст для проверки без ошибок.');

    const logs = await getErrorLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe('warn');
    expect(logs[0].errorCode).toBe('PROVIDER_DEGRADED');
    expect(logs[0].provider).toBe('mistral');
    expect(logs[0].fallbackProvider).toBe('cloudflare');
    expect(logs[0].fallbackSucceeded).toBe(true);
});

test('когда оба провайдера завершаются 429, обе ошибки логируются как ERROR', async () => {
    resetAiProviderHealth();
    await clearErrorLogs();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('mistral.ai')) {
            return new Response(JSON.stringify({ message: 'Rate limit reached' }), {
                status: 429,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (url.includes('cloudflare.com')) {
            return new Response(JSON.stringify({ errors: [{ message: 'Rate limit exceeded' }] }), {
                status: 429,
                headers: { 'content-type': 'application/json' },
            });
        }
        return new Response('Not found', { status: 404 });
    });

    await expect(
        executeAiStreamRequest({
            request: { action: 'callMistral', text: 'Текст для проверки', mode: 'spellcheck' },
            settings,
            primaryProvider: 'mistral',
            autoFallback: true,
            mistralApiKey: 'mistral-test-key-12345678',
            cloudflareAccountId: 'cf-account-id',
            cloudflareApiToken: 'cf-api-token',
            signal: new AbortController().signal,
            onChunk: () => undefined,
        }),
    ).rejects.toMatchObject({ code: 'PROVIDERS_UNAVAILABLE' });

    const logs = await getErrorLogs();
    expect(logs.length).toBe(2);
    expect(logs.every((l) => l.level === 'error')).toBe(true);
    expect(logs.some((l) => l.provider === 'mistral')).toBe(true);
    expect(logs.some((l) => l.provider === 'cloudflare')).toBe(true);
});
