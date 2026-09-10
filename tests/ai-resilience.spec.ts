import { beforeEach, expect, test, vi } from 'vitest';
import { AiProviderError } from '../src/ai-provider-types';
import { executeAiStreamRequest, resetAiProviderHealth } from '../src/ai-client';
import {
    acquireProviderAttempt,
    getProviderAvailability,
    recordProviderFailure,
    releaseProviderAttempt,
} from '../src/provider-availability';
import { streamCloudflareText } from '../src/cloudflare-client';
import { streamText } from '../src/mistral-client';
import { SseParser } from '../src/sse-parser';

const settings = {
    selectedTone: 'business',
    sendPageContext: false,
    personalDictionary: [],
    glossary: [],
    aiMode: 'balanced' as const,
};

beforeEach(() => {
    vi.restoreAllMocks();
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
            [
                'data: {"response":"Исправленный текст"}',
                '',
                'data: {"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15,"neurons":0.42}}',
                '',
                'data: [DONE]',
                '',
            ].join('\n'),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
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
    expect(response.usage).toEqual({ promptTokens: 12, completionTokens: 3, totalTokens: 15, neurons: 0.42 });
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
