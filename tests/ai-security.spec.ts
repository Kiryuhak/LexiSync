import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AiProviderError } from '../src/ai-provider-types';
import { executeAiStreamRequest, normalizeAiError, resetAiProviderHealth } from '../src/ai-client';
import { checkProviderHealth } from '../src/provider-health';
import { sanitizeLogMessage } from '../src/error-log';
import { streamCloudflareText, testCloudflareConnection } from '../src/cloudflare-client';
import {
    setStoredCloudflareCredentials,
    getStoredCloudflareCredentials,
    clearAllSecrets,
    setStoredApiKey,
    getStoredApiKey,
} from '../src/secret-store';

vi.mock('wxt/browser', () => {
    let memStore: Record<string, unknown> = {};
    return {
        browser: {
            storage: {
                local: {
                    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
                        if (!keys) return { ...memStore };
                        if (typeof keys === 'string') return { [keys]: memStore[keys] };
                        if (Array.isArray(keys)) {
                            const res: Record<string, unknown> = {};
                            for (const k of keys) res[k] = memStore[k];
                            return res;
                        }
                        return { ...memStore };
                    }),
                    set: vi.fn(async (items: Record<string, unknown>) => {
                        Object.assign(memStore, items);
                    }),
                    remove: vi.fn(async (keys: string | string[]) => {
                        const arr = Array.isArray(keys) ? keys : [keys];
                        for (const k of arr) delete memStore[k];
                    }),
                    clear: vi.fn(async () => {
                        memStore = {};
                    }),
                },
            },
        },
    };
});

const sseResponse = (text = 'Привет от Cloudflare') => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(`data: {"response":"${text}"}\n\ndata: [DONE]\n\n`));
            controller.close();
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
    });
};

beforeEach(async () => {
    resetAiProviderHealth();
    await clearAllSecrets();
});
afterEach(() => vi.restoreAllMocks());

test('Cloudflare клиент отправляет точный endpoint, Bearer токен и JSON payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse());
    const credentials = { accountId: 'acc-1234567890abcdef', apiToken: 'token-secret-xyz' };

    await streamCloudflareText(
        { action: 'callMistral', text: 'Проверка безопасности' },
        credentials,
        {
            selectedTone: 'business',
            sendPageContext: false,
            personalDictionary: [],
            glossary: [],
            aiMode: 'balanced',
        },
        new AbortController().signal,
        () => undefined,
    );

    expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/acc-1234567890abcdef/ai/run/@cf/qwen/qwen2.5-7b-instruct',
        expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
                Authorization: 'Bearer token-secret-xyz',
                'Content-Type': 'application/json',
            }),
        }),
    );
});

test('HTTP 401/403 мапится в AUTH_ERROR и не допускает fallback', () => {
    const err401 = normalizeAiError(Object.assign(new Error('Unauthorized'), { status: 401 }), 'cloudflare');
    expect(err401.code).toBe('AUTH_ERROR');
    expect(err401.isFallbackEligible).toBe(false);

    const err403 = normalizeAiError(Object.assign(new Error('Forbidden'), { status: 403 }), 'cloudflare');
    expect(err403.code).toBe('AUTH_ERROR');
    expect(err403.isFallbackEligible).toBe(false);
});

test('HTTP 404 мапится в ACCOUNT_ERROR и не допускает fallback', () => {
    const err404 = normalizeAiError(Object.assign(new Error('Account not found'), { status: 404 }), 'cloudflare');
    expect(err404.code).toBe('ACCOUNT_ERROR');
    expect(err404.isFallbackEligible).toBe(false);
});

test.each([400, 422])('HTTP %i мапится в INVALID_REQUEST и не допускает fallback', (status) => {
    const err = normalizeAiError(Object.assign(new Error('Bad request'), { status }), 'cloudflare');
    expect(err.code).toBe('INVALID_REQUEST');
    expect(err.isFallbackEligible).toBe(false);
});

test.each([429])('HTTP %i мапится в RATE_LIMIT и допускает fallback', (status) => {
    const err = normalizeAiError(Object.assign(new Error('Rate limited'), { status }), 'cloudflare');
    expect(err.code).toBe('RATE_LIMIT');
    expect(err.isFallbackEligible).toBe(true);
});

test.each([500, 502, 503, 504])('HTTP %i мапится в SERVER_ERROR и допускает fallback', (status) => {
    const err = normalizeAiError(Object.assign(new Error('Server error'), { status }), 'cloudflare');
    expect(err.code).toBe('SERVER_ERROR');
    expect(err.isFallbackEligible).toBe(true);
});

test.each(['INVALID_RESPONSE', 'INVALID_REQUEST', 'AUTH_ERROR', 'ACCOUNT_ERROR'] as const)(
    '%s не допускает fallback',
    (code) => {
        expect(new AiProviderError('test', code, 'cloudflare', true).isFallbackEligible).toBe(false);
    },
);

test('QUOTA_EXCEEDED допускает fallback', () => {
    expect(new AiProviderError('test', 'QUOTA_EXCEEDED', 'cloudflare', true).isFallbackEligible).toBe(true);
});

test('отсутствующие учетные данные Cloudflare не вызывают fallback и возвращают понятную ошибку', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
        executeAiStreamRequest({
            request: { action: 'callMistral', text: 'test' },
            settings: {
                selectedTone: 'business',
                sendPageContext: false,
                personalDictionary: [],
                glossary: [],
                aiMode: 'balanced',
            },
            primaryProvider: 'cloudflare',
            autoFallback: true,
            mistralApiKey: 'mistral-valid-key',
            cloudflareAccountId: '',
            cloudflareApiToken: '',
            signal: new AbortController().signal,
            onChunk: () => undefined,
        }),
    ).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    expect(fetchSpy).not.toHaveBeenCalled();
});

test('отсутствующий основной ключ Mistral не переключает запрос на Cloudflare', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
        executeAiStreamRequest({
            request: { action: 'callMistral', text: 'test' },
            settings: {
                selectedTone: 'business',
                sendPageContext: false,
                personalDictionary: [],
                glossary: [],
                aiMode: 'balanced',
            },
            primaryProvider: 'mistral',
            autoFallback: true,
            mistralApiKey: '',
            cloudflareAccountId: 'acc',
            cloudflareApiToken: 'token',
            signal: new AbortController().signal,
            onChunk: () => undefined,
        }),
    ).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    expect(fetchSpy).not.toHaveBeenCalled();
});

test('проверка здоровья Cloudflare возвращает degraded при 429 и outage при 503', async () => {
    const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('', { status: 429 }))
        .mockResolvedValueOnce(new Response('', { status: 503 }));

    const health1 = await checkProviderHealth('cloudflare', { accountId: 'acc', apiToken: 'token' });
    expect(health1.state).toBe('degraded');

    const health2 = await checkProviderHealth('cloudflare', { accountId: 'acc', apiToken: 'token' });
    expect(health2.state).toBe('outage');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test('обрыв SSE потока Cloudflare без [DONE] выбрасывает INVALID_RESPONSE и не считается успехом', async () => {
    const encoder = new TextEncoder();
    const incompleteStream = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode('data: {"response":"Неполный ответ"}\n\n'));
            controller.close();
        },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(incompleteStream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
        }),
    );

    await expect(
        streamCloudflareText(
            { action: 'callMistral', text: 'test' },
            { accountId: 'acc', apiToken: 'token' },
            {
                selectedTone: 'business',
                sendPageContext: false,
                personalDictionary: [],
                glossary: [],
                aiMode: 'balanced',
            },
            new AbortController().signal,
            () => undefined,
        ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', isFallbackEligible: false });
});

test('testCloudflareConnection валидирует пустые поля, 200 OK и 401 ошибку', async () => {
    // 1. Пустые поля
    const emptyRes = await testCloudflareConnection({ accountId: '', apiToken: '' });
    expect(emptyRes.ok).toBe(false);

    // 2. 200 OK
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, result: { response: 'pong' } }), { status: 200 }),
    );
    const okRes = await testCloudflareConnection({ accountId: 'acc', apiToken: 'tok' });
    expect(okRes.ok).toBe(true);

    // 3. 401 Unauthorized
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, errors: [{ message: 'Unauthorized' }] }), { status: 401 }),
    );
    const errRes = await testCloudflareConnection({ accountId: 'acc', apiToken: 'bad-tok' });
    expect(errRes.ok).toBe(false);
    expect(errRes.message).toBeDefined();
});

test('журнал ошибок маскирует секретные токены и Bearer заголовки', () => {
    expect(sanitizeLogMessage('Bearer secret-cloudflare-token-12345')).not.toContain('secret-cloudflare-token-12345');
    expect(sanitizeLogMessage('{"apiToken":"super-secret-token"}')).not.toContain('super-secret-token');
    expect(sanitizeLogMessage('Authorization: Bearer my-long-api-token-value')).toContain('[REDACTED_TOKEN]');
});

test('secret-store сохраняет и очищает учетные данные Cloudflare без утечек', async () => {
    await setStoredApiKey('mistral-test-key');
    await setStoredCloudflareCredentials({ accountId: 'my-cf-acc', apiToken: 'my-cf-token' });

    expect(await getStoredApiKey()).toBe('mistral-test-key');
    expect(await getStoredCloudflareCredentials()).toEqual({ accountId: 'my-cf-acc', apiToken: 'my-cf-token' });

    await clearAllSecrets();

    expect(await getStoredApiKey()).toBe('');
    expect(await getStoredCloudflareCredentials()).toEqual({ accountId: '', apiToken: '' });
});
