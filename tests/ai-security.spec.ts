import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
    getGigaChatAccessToken,
    invalidateGigaChatToken,
    validateGigaChatAuthKey,
} from '../src/gigachat-token-manager';
import { readPrivateRecord } from '../src/extension-db';
import { AiProviderError } from '../src/ai-provider-types';
import { executeAiStreamRequest, normalizeAiError, resetAiProviderHealth } from '../src/ai-client';
import { checkProviderHealth } from '../src/provider-health';
import { sanitizeLogMessage } from '../src/error-log';
import { streamGigaChatText } from '../src/gigachat-client';

vi.mock('wxt/browser', () => ({
    browser: { storage: { local: { get: async () => ({}), set: async () => undefined } } },
}));

const tokenResponse = (token = 'test-token') =>
    new Response(JSON.stringify({ access_token: token, expires_at: Date.now() + 1_800_000 }));

beforeEach(async () => {
    await invalidateGigaChatToken();
    resetAiProviderHealth();
});
afterEach(() => vi.restoreAllMocks());

test('OAuth использует Basic, scope и UUID; сохраняется только в приватной БД', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse());
    expect(await getGigaChatAccessToken(' key-A ')).toBe('test-token');
    expect(fetch).toHaveBeenCalledWith(
        'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
        expect.objectContaining({
            method: 'POST',
            body: 'scope=GIGACHAT_API_PERS',
            headers: expect.objectContaining({
                Authorization: 'Basic key-A',
                RqUID: expect.stringMatching(/^[a-f\d-]{36}$/i),
            }),
        }),
    );
    const cached = await readPrivateRecord<{ accessToken: string; credentialId: string }>(
        'secrets',
        '_gigachat_token_cache',
    );
    expect(cached?.accessToken).toBe('test-token');
    expect(cached?.credentialId).toMatch(/^[a-f\d]{64}$/);
    expect(JSON.stringify(cached)).not.toContain('key-A');
});

test('новый ключ не использует токен предыдущего ключа', async () => {
    const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(tokenResponse('A'))
        .mockResolvedValueOnce(tokenResponse('B'));
    expect(await getGigaChatAccessToken('key-A')).toBe('A');
    expect(await getGigaChatAccessToken('key-B')).toBe('B');
    expect(fetch).toHaveBeenCalledTimes(2);
});

test('проверка несохранённого ключа не заменяет рабочий токен', async () => {
    const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(tokenResponse('A'))
        .mockResolvedValueOnce(tokenResponse('B'));
    await getGigaChatAccessToken('key-A');
    expect((await validateGigaChatAuthKey('key-B')).ok).toBe(true);
    expect(await getGigaChatAccessToken('key-A')).toBe('A');
    expect(fetch).toHaveBeenCalledTimes(2);
});

test('отмена одного ожидающего запроса не отменяет общий OAuth', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    const controller = new AbortController();
    const first = getGigaChatAccessToken('same-key', controller.signal);
    const firstResult = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = getGigaChatAccessToken('same-key');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    await firstResult;
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(false);
    resolve(tokenResponse());
    expect(await second).toBe('test-token');
    expect(fetch).toHaveBeenCalledOnce();
});

test('сброс во время OAuth не позволяет воскресить удалённый токен', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    const pending = getGigaChatAccessToken('old-key');
    const result = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await invalidateGigaChatToken();
    resolve(tokenResponse());
    await result;
    expect(await readPrivateRecord('secrets', '_gigachat_token_cache')).toBeUndefined();
});

test('запоздалый 401 не сбрасывает уже обновлённый токен', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse('new'));
    await getGigaChatAccessToken('key');
    await invalidateGigaChatToken('old');
    expect(await getGigaChatAccessToken('key')).toBe('new');
});

test.each([null, {}, { access_token: 'token' }, { access_token: 'token', expires_at: 'bad' }])(
    'некорректный OAuth payload не допускает fallback: %j',
    async (payload) => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload)));
        await expect(getGigaChatAccessToken('key')).rejects.toMatchObject({
            code: 'INVALID_RESPONSE',
            isFallbackEligible: false,
        });
    },
);

test.each([400, 401, 403, 404, 422])('HTTP %i не допускает fallback даже при misleading message', (status) => {
    const error = Object.assign(new Error('Network rate limit 503'), { status, retryable: true });
    expect(normalizeAiError(error, 'mistral').isFallbackEligible).toBe(false);
});

test.each(['INVALID_RESPONSE', 'INVALID_REQUEST', 'AUTH_ERROR', 'QUOTA_EXCEEDED'] as const)(
    '%s не допускает fallback',
    (code) => {
        expect(new AiProviderError('test', code, 'gigachat', true).isFallbackEligible).toBe(false);
    },
);

test('отсутствующий основной ключ не переключает запрос на резерв', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
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
            gigachatAuthKey: 'key',
            signal: new AbortController().signal,
            onChunk: () => undefined,
        }),
    ).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
});

test('здоровье GigaChat проверяет API, а не только наличие токена', async () => {
    const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(new Response('', { status: 503 }));
    expect((await checkProviderHealth('gigachat', 'key')).state).toBe('outage');
    expect(fetch.mock.calls[1][0]).toBe('https://api.giga.chat/v1/models');
});

test('журнал маскирует Basic и access_token', () => {
    expect(sanitizeLogMessage('Basic c2VjcmV0OmNyZWRlbnRpYWw=')).not.toContain('c2VjcmV0');
    expect(sanitizeLogMessage('{"access_token":"very-secret-token"}')).not.toContain('very-secret-token');
});

test.each([200, 401])('после 401 выполняет ровно одно обновление токена, повторный статус %i', async (status) => {
    const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(tokenResponse('old'))
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(tokenResponse('new'))
        .mockResolvedValueOnce(
            new Response('data: {"choices":[{"delta":{"content":"Ответ"}}]}\n\ndata: [DONE]\n\n', { status }),
        );
    const result = streamGigaChatText(
        { action: 'callMistral', text: 'test' },
        'key',
        { selectedTone: 'business', sendPageContext: false, personalDictionary: [], glossary: [], aiMode: 'balanced' },
        new AbortController().signal,
        () => undefined,
    );
    if (status === 200) await expect(result).resolves.toMatchObject({ text: 'Ответ' });
    else await expect(result).rejects.toMatchObject({ code: 'AUTH_ERROR', status: 401 });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer old' });
    expect(fetch.mock.calls[3][1]?.headers).toMatchObject({ Authorization: 'Bearer new' });
});

test('обрыв GigaChat без DONE не считается успешным ответом', async () => {
    vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"Часть"}}]}\n\n'));
    await expect(
        streamGigaChatText(
            { action: 'callMistral', text: 'test' },
            'key',
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

test('токен восстанавливается из IndexedDB после перезагрузки модуля background', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(tokenResponse());
    await getGigaChatAccessToken('persistent-key');
    vi.resetModules();
    const restarted = await import('../src/gigachat-token-manager');
    expect(await restarted.getGigaChatAccessToken('persistent-key')).toBe('test-token');
    expect(fetch).toHaveBeenCalledOnce();
    await restarted.invalidateGigaChatToken();
});
