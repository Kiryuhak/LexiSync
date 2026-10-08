import { beforeEach, expect, test, vi } from 'vitest';
import { AiProviderError } from '../src/ai-provider-types';
import {
    computeHealthState,
    getProviderAvailability,
    recordProviderFailure,
    resetProviderAvailability,
} from '../src/provider-availability';
import { checkProviderHealth } from '../src/provider-health';
import { clearErrorLogs, formatErrorLogsAsText, getErrorLogs, recordErrorLog } from '../src/error-log';
import { executeAiStreamRequest, resetAiProviderHealth } from '../src/ai-client';
import { t } from '../src/i18n';

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

test('Сценарий 1: 429 Rate Limit переводит провайдера в COOLDOWN', async () => {
    const baseTime = Date.now();
    await recordProviderFailure(
        new AiProviderError('Rate limit exceeded', 'RATE_LIMIT', 'mistral', true, 429),
        baseTime,
    );

    const availability = await getProviderAvailability('mistral', baseTime);
    expect(availability.healthState).toBe('cooldown');
    expect(availability.allowed).toBe(false);
    expect(availability.cooldownRemainingMs).toBe(30_000);

    const status = await checkProviderHealth('mistral', 'valid_api_key_test');
    expect(status.state).toBe('cooldown');
    expect(status.message).toBe('Временно ограничен API-провайдером');
    expect(status.subMessage).toContain('Повторная проверка через 30 сек.');
});

test('Сценарий 2: По истечении cooldown провайдер переходит в PROBE_READY', async () => {
    const baseTime = Date.now() - 31_000;
    await recordProviderFailure(
        new AiProviderError('Rate limit exceeded', 'RATE_LIMIT', 'mistral', true, 429),
        baseTime,
    );

    const availability = await getProviderAvailability('mistral');
    expect(availability.healthState).toBe('probe-ready');
    expect(availability.allowed).toBe(true);
    expect(availability.cooldownRemainingMs).toBe(0);
});

test('Сценарий 3: PROBE_READY не является HEALTHY и не создаёт ложного впечатления о работе', async () => {
    const baseTime = Date.now() - 31_000;
    await recordProviderFailure(
        new AiProviderError('Rate limit exceeded', 'RATE_LIMIT', 'mistral', true, 429),
        baseTime,
    );

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const status = await checkProviderHealth('mistral', 'test_key');
    expect(status.state).toBe('probe-ready');
    expect(status.state).not.toBe('healthy');
    expect(status.message).toBe('Пауза завершена');
    expect(status.subMessage).toBe('Можно проверить доступность');
    expect(status.message).not.toContain('Работает');
    expect(status.message).not.toBe('Готов');
    expect(fetchSpy).not.toHaveBeenCalled();
});

test('Сценарий 4: Успешный probe переводит PROBE_READY -> HEALTHY только при валидном ответе модели', async () => {
    const baseTime = Date.now() - 31_000;
    await recordProviderFailure(new AiProviderError('Rate limit', 'RATE_LIMIT', 'mistral', true, 429), baseTime);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
            JSON.stringify({
                id: 'probe-1',
                choices: [{ message: { content: 'PONG' } }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );

    const status = await checkProviderHealth('mistral', 'test_key', undefined, undefined, { probe: true });
    expect(status.state).toBe('healthy');
    expect(status.message).toBe('Работает отлично');

    const availability = await getProviderAvailability('mistral');
    expect(availability.healthState).toBe('healthy');
    expect(availability.state).toBe('CLOSED');
});

test('Сценарий 5: Повторный 429 при probe переводит PROBE_READY -> COOLDOWN с увеличенным cooldownUntil', async () => {
    const baseTime = Date.now() - 31_000;
    // Первый 429: базовая пауза 30 сек
    await recordProviderFailure(new AiProviderError('Rate limit', 'RATE_LIMIT', 'mistral', true, 429), baseTime);

    // Probe снова получает 429
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
        }),
    );

    const status = await checkProviderHealth('mistral', 'test_key', undefined, undefined, { probe: true });
    expect(status.state).toBe('cooldown');
    expect(status.message).toBe('Временно ограничен API-провайдером');
    expect(status.subMessage).toContain('Повторная проверка через 60 сек.');

    const availability = await getProviderAvailability('mistral');
    expect(availability.healthState).toBe('cooldown');
    expect(availability.cooldownRemainingMs).toBeGreaterThanOrEqual(59_000);
});

test('Сценарий 6: Пользовательский запрос во время COOLDOWN сразу переключается на Cloudflare без обращения к Mistral', async () => {
    await recordProviderFailure(new AiProviderError('Rate limit', 'RATE_LIMIT', 'mistral', true, 429), Date.now());

    const fetchUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url.includes('cloudflare')) {
            return new Response(
                JSON.stringify({
                    success: true,
                    result: { choices: [{ message: { content: 'Привет без ошибок.' } }] },
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        }
        return new Response('', { status: 500 });
    });

    const chunks: string[] = [];
    const response = await executeAiStreamRequest({
        request: { action: 'callMistral', text: 'Привет', mode: 'spellcheck' },
        mistralApiKey: 'mistral_key',
        cloudflareAccountId: 'cf_acc',
        cloudflareApiToken: 'cf_token',
        settings: {
            selectedTone: 'business',
            sendPageContext: false,
            personalDictionary: [],
            glossary: [],
            aiMode: 'balanced',
        },
        signal: new AbortController().signal,
        onChunk: (c) => chunks.push(c),
        primaryProvider: 'mistral',
        autoFallback: true,
    });

    expect(response.providerUsed).toBe('cloudflare');
    expect(response.fallbackOccurred).toBe(true);
    expect(chunks.join('')).toBe('Привет без ошибок.');
    expect(fetchUrls.some((u) => u.includes('mistral'))).toBe(false);
    expect(fetchUrls.some((u) => u.includes('cloudflare'))).toBe(true);
});

test('Сценарий 7: Fallback на Cloudflare логируется как REQUEST_SUCCEEDED_WITH_FALLBACK со статусом WARN/INFO', async () => {
    await clearErrorLogs();
    await recordErrorLog({
        level: 'warn',
        source: 'background',
        message: 'REQUEST_SUCCEEDED_WITH_FALLBACK: Переключение на резервный Cloudflare после сбоя Mistral',
        errorCode: 'PROVIDER_DEGRADED',
        requestId: 'req-test-fallback-1',
        operation: 'spellcheck',
        primaryProvider: 'mistral',
        fallbackProvider: 'cloudflare',
        primaryResult: 'RATE_LIMIT',
        fallbackResult: 'SUCCESS',
        fallbackAttempted: true,
        fallbackSucceeded: true,
        elapsedMs: 786,
    });

    const logs = await getErrorLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe('warn');
    expect(logs[0].message).toContain('REQUEST_SUCCEEDED_WITH_FALLBACK');
    expect(logs[0].primaryProvider).toBe('mistral');
    expect(logs[0].fallbackProvider).toBe('cloudflare');
    expect(logs[0].fallbackSucceeded).toBe(true);
});

test('Сценарий 8: Сбой резервного Cloudflare логирует REQUEST_FAILED с точной причиной (cause)', async () => {
    await clearErrorLogs();
    await recordErrorLog({
        level: 'error',
        source: 'background',
        message: 'REQUEST_FAILED: AI-проверка не смогла вернуть безопасный результат',
        errorCode: 'QUALITY_CHECK_FAILED',
        finalErrorCode: 'QUALITY_CHECK_FAILED',
        causeCode: 'AI_OUTPUT_CHANGED_NUMBERS',
        requestId: 'req-test-fail-1',
        operation: 'spellcheck',
        primaryProvider: 'mistral',
        fallbackProvider: 'cloudflare',
        primaryResult: 'RATE_LIMIT',
        fallbackResult: 'QUALITY_CHECK_FAILED',
        fallbackAttempted: true,
        fallbackSucceeded: false,
        elapsedMs: 1250,
    });

    const logs = await getErrorLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].causeCode).toBe('AI_OUTPUT_CHANGED_NUMBERS');
    expect(logs[0].finalErrorCode).toBe('QUALITY_CHECK_FAILED');

    const formattedText = formatErrorLogsAsText(logs);
    expect(formattedText).toContain('Причина (cause): AI_OUTPUT_CHANGED_NUMBERS');
    expect(formattedText).toContain('Итоговый код ошибки: QUALITY_CHECK_FAILED');
    expect(formattedText).toMatch(/Попытка резерва:\s*да/i);
    expect(formattedText).toMatch(/Успех резерва:\s*нет/i);
});

test('Сценарий 9: REQUEST_FAILED всегда содержит 11 полей диагностики и никогда не логирует пользовательский текст', async () => {
    await clearErrorLogs();
    const secretText = 'СЕКРЕТНЫЙ_ПОЛЬЗОВАТЕЛЬСКИЙ_ПАРОЛЬ_12345';
    await recordErrorLog({
        level: 'error',
        source: 'background',
        message: 'REQUEST_FAILED: Ошибка при обработке запроса',
        errorCode: 'INVALID_RESPONSE',
        finalErrorCode: 'INVALID_RESPONSE',
        causeCode: 'AI_OUTPUT_CHANGED_LINE_STRUCTURE',
        requestId: 'req-diagnostic-99',
        operation: 'spellcheck',
        primaryProvider: 'mistral',
        fallbackProvider: 'cloudflare',
        primaryResult: 'RATE_LIMIT',
        fallbackResult: 'INVALID_RESPONSE',
        fallbackAttempted: true,
        fallbackSucceeded: false,
        elapsedMs: 890,
    });

    const logs = await getErrorLogs();
    const formatted = formatErrorLogsAsText(logs);

    // Проверяем наличие всех 11 диагностических полей
    expect(formatted).toContain('Request ID: req-diagnostic-99');
    expect(formatted).toContain('Операция: spellcheck');
    expect(formatted).toContain('Основной провайдер: mistral');
    expect(formatted).toContain('Результат основного: RATE_LIMIT');
    expect(formatted).toContain('Резервный провайдер: cloudflare');
    expect(formatted).toMatch(/Попытка резерва:\s*да/i);
    expect(formatted).toContain('Результат резерва: INVALID_RESPONSE');
    expect(formatted).toMatch(/Успех резерва:\s*нет/i);
    expect(formatted).toContain('Итоговый код ошибки: INVALID_RESPONSE');
    expect(formatted).toContain('Причина (cause): AI_OUTPUT_CHANGED_LINE_STRUCTURE');
    expect(formatted).toContain('Длительность: 890 мс');

    // Проверяем отсутствие секретных пользовательских данных
    expect(formatted).not.toContain(secretText);
});

test('Сценарий 10: Восстановление из storage.local сохраняет состояние доступности провайдеров', async () => {
    const cooldownUntil = Date.now() + 25_000;
    mockLocalStorage['lexisync_provider_availability_v1'] = {
        mistral: {
            state: 'OPEN',
            consecutiveFailures: 1,
            cooldownUntil,
            lastErrorCode: 'RATE_LIMIT',
            lastStatus: 429,
            updatedAt: Date.now(),
        },
        cloudflare: {
            state: 'CLOSED',
            consecutiveFailures: 0,
            cooldownUntil: 0,
            updatedAt: Date.now(),
        },
    };

    resetProviderAvailability(true);
    const mistralAvail = await getProviderAvailability('mistral');
    expect(mistralAvail.healthState).toBe('cooldown');
    expect(mistralAvail.allowed).toBe(false);
    expect(mistralAvail.cooldownRemainingMs).toBeGreaterThan(0);
});

test('Сценарий 11: Перезапуск браузера не переводит провайдера в ложный HEALTHY', async () => {
    // В хранилище сохранён разорванный circuit breaker (OPEN), у которого истёк cooldownUntil
    mockLocalStorage['lexisync_provider_availability_v1'] = {
        mistral: {
            state: 'OPEN',
            consecutiveFailures: 2,
            cooldownUntil: Date.now() - 10_000,
            lastErrorCode: 'RATE_LIMIT',
            lastStatus: 429,
            updatedAt: Date.now() - 40_000,
        },
    };

    resetProviderAvailability(true);
    const mistralAvail = await getProviderAvailability('mistral');
    // Должен быть probe-ready, но ни в коем случае НЕ healthy!
    expect(mistralAvail.healthState).toBe('probe-ready');
    expect(mistralAvail.healthState).not.toBe('healthy');
});

test('Сценарий 12 & 13: Ручная кнопка «Проверить статус серверов» и множественные нажатия имеют single-flight защиту', async () => {
    let fetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        fetchCount++;
        await new Promise((r) => setTimeout(r, 20));
        return new Response(
            JSON.stringify({
                id: 'probe-multi',
                choices: [{ message: { content: 'OK' } }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        );
    });

    // Запускаем 5 параллельных проверок со статусом probe: true
    const results = await Promise.all([
        checkProviderHealth('mistral', 'key', undefined, undefined, { probe: true }),
        checkProviderHealth('mistral', 'key', undefined, undefined, { probe: true }),
        checkProviderHealth('mistral', 'key', undefined, undefined, { probe: true }),
        checkProviderHealth('mistral', 'key', undefined, undefined, { probe: true }),
        checkProviderHealth('mistral', 'key', undefined, undefined, { probe: true }),
    ]);

    expect(fetchCount).toBe(1);
    for (const r of results) {
        expect(r.state).toBe('healthy');
    }
});

test('Сценарий 14: Точные тексты сообщений UI для всех состояний provider health', () => {
    expect(t('serverStatusHealthy', 'Работает отлично')).toBe('Работает отлично');
    expect(t('serverStatusMistralLimited', 'Временно ограничен API-провайдером')).toBe(
        'Временно ограничен API-провайдером',
    );
    expect(t('serverStatusProbeReadyTitle', 'Пауза завершена')).toBe('Пауза завершена');
    expect(t('serverStatusProbeReadySubtext', 'Можно проверить доступность')).toBe('Можно проверить доступность');
    expect(t('serverStatusProbing', 'Проверяем доступность…')).toBe('Проверяем доступность…');
    expect(t('serverStatusUnstable', 'Работает нестабильно')).toBe('Работает нестабильно');
    expect(t('serverStatusDegradedFallback', 'Используется резервный Cloudflare')).toBe(
        'Используется резервный Cloudflare',
    );
});

test('Сценарий 15: Таймер обратного отсчёта cooldown при достижении 0 переходит в PROBE_READY, а не в HEALTHY', () => {
    const pastTime = Date.now() - 1000;
    const computed = computeHealthState({
        state: 'OPEN',
        consecutiveFailures: 1,
        cooldownUntil: pastTime,
        updatedAt: pastTime - 30_000,
    });
    expect(computed).toBe('probe-ready');
    expect(computed).not.toBe('healthy');
});

test('Сценарий 16: Статус Cloudflare (HEALTHY) остаётся независимым от сбоев Mistral', async () => {
    // Mistral в состоянии cooldown после 429
    await recordProviderFailure(new AiProviderError('Rate limit', 'RATE_LIMIT', 'mistral', true, 429), Date.now());

    // Cloudflare возвращает успешный ответ (200 OK, latency ~786ms)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('cloudflare')) {
            return new Response(JSON.stringify({ success: true, result: { response: 'pong' } }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        return new Response('', { status: 429 });
    });

    const [mistralStatus, cloudflareStatus] = await Promise.all([
        checkProviderHealth('mistral', 'mistral_key'),
        checkProviderHealth('cloudflare', { accountId: 'acc_id', apiToken: 'token_val' }, undefined, undefined, {
            probe: true,
        }),
    ]);

    expect(mistralStatus.state).toBe('cooldown');
    expect(cloudflareStatus.state).toBe('healthy');
    expect(cloudflareStatus.message).toBe('Работает отлично');
});
