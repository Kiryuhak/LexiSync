import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { applyHistoryMutation } from '../src/history-store';
import { applyUsageMutation } from '../src/usage-stats';
import { applySettingsMutation } from '../src/settings-store';
import { applyAdaptiveMutation, flushAdaptiveMutations } from '../src/adaptive-model-store';
import { migrateSettings } from '../src/settings-migrations';
import { enqueueStorageMutation } from '../src/storage-queue';

let storage: Record<string, unknown>;
let storageGetCalls: unknown[];
let storageSetCalls: Record<string, unknown>[];
let beforeStorageGet: ((keys: unknown) => void | Promise<void>) | undefined;

beforeEach(() => {
    storage = {};
    storageGetCalls = [];
    storageSetCalls = [];
    beforeStorageGet = undefined;
    vi.stubGlobal('chrome', {
        storage: {
            local: {
                async get(keys: string | string[] | Record<string, unknown> | null) {
                    await Promise.resolve();
                    storageGetCalls.push(structuredClone(keys));
                    await beforeStorageGet?.(keys);
                    if (keys === null) return { ...storage };
                    if (typeof keys === 'string') return { [keys]: storage[keys] };
                    if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, storage[key]]));
                    return Object.fromEntries(
                        Object.entries(keys).map(([key, fallback]) => [key, storage[key] ?? fallback]),
                    );
                },
                async set(updates: Record<string, unknown>) {
                    await Promise.resolve();
                    storageSetCalls.push(structuredClone(updates));
                    Object.assign(storage, structuredClone(updates));
                },
            },
        },
    });
});

afterEach(async () => {
    await flushAdaptiveMutations();
    vi.useRealTimers();
});

test('не теряет историю при параллельных записях', async () => {
    await Promise.all(
        Array.from({ length: 20 }, (_, id) =>
            applyHistoryMutation('add', {
                item: {
                    id,
                    mode: 'spellcheck',
                    original: `До ${id}`,
                    result: `После ${id}`,
                    date: new Date().toISOString(),
                },
            }),
        ),
    );
    expect(storage.aiHistory).toHaveLength(20);
});

test('не теряет статистику при параллельных запросах', async () => {
    await Promise.all(
        Array.from({ length: 25 }, () =>
            applyUsageMutation('request', {
                mode: 'style',
                latencyMs: 10,
                success: true,
            }),
        ),
    );
    expect(storage.usageStats).toMatchObject({ requests: 25, totalLatencyMs: 250, byMode: { style: 25 } });
});

test('не теряет слова словаря при параллельном добавлении', async () => {
    await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
            applySettingsMutation('addPersonalDictionaryWord', { value: `Слово-${index}` }),
        ),
    );
    expect(storage.personalDictionary).toHaveLength(30);
});

test('атомарно добавляет и удаляет пользовательские команды', async () => {
    await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
            applySettingsMutation('upsertCustomCommand', {
                command: { id: String(index), name: `Команда ${index}`, prompt: `Инструкция ${index}` },
            }),
        ),
    );
    await Promise.all([
        applySettingsMutation('deleteCustomCommand', { id: '2' }),
        applySettingsMutation('deleteCustomCommand', { id: '5' }),
    ]);
    expect(storage.customCommands).toHaveLength(6);
});

test('миграция не читает всё хранилище при актуальной схеме', async () => {
    storage.settingsSchemaVersion = 6;

    await migrateSettings();

    expect(storageGetCalls).toEqual(['settingsSchemaVersion']);
    expect(storageSetCalls).toHaveLength(0);
});

test.each([
    [true, 'compact'],
    [false, 'detailed'],
    [undefined, 'compact'],
] as const)('мигрирует режим результата без изменения прежнего поведения: %s → %s', async (legacy, expected) => {
    storage.settingsSchemaVersion = 5;
    if (legacy !== undefined) storage.compactResultMode = legacy;

    await migrateSettings();

    expect(storage.resultDisplayMode).toBe(expected);
    expect(storage.settingsSchemaVersion).toBe(6);
});

test('не затирает настройку, изменённую параллельно с миграцией', async () => {
    storage.settingsSchemaVersion = 5;
    storage.compactResultMode = false;
    let changed = false;
    beforeStorageGet = (keys) => {
        if (!changed && Array.isArray(keys) && keys.includes('resultDisplayMode')) {
            changed = true;
            storage.resultDisplayMode = 'compact';
        }
    };

    await migrateSettings();

    expect(storage.resultDisplayMode).toBe('compact');
    expect(storage.settingsSchemaVersion).toBe(6);
});

test('пакетирует частые записи адаптивной модели в одно чтение и запись', async () => {
    const operations = Array.from({ length: 20 }, (_, index) =>
        applyAdaptiveMutation('record', { word: 'Пример', previous: `слово${index}`, weight: 1 }),
    );
    await flushAdaptiveMutations();
    await Promise.all(operations);

    const adaptiveGets = storageGetCalls.filter(
        (keys) => keys && typeof keys === 'object' && !Array.isArray(keys) && 'adaptiveLanguageModel' in keys,
    );
    const adaptiveSets = storageSetCalls.filter((updates) => 'adaptiveLanguageModel' in updates);
    expect(adaptiveGets).toHaveLength(1);
    expect(adaptiveSets).toHaveLength(1);
    expect((storage.adaptiveLanguageModel as { words: Record<string, { count: number }> }).words['пример'].count).toBe(
        20,
    );
});

test('сохраняет порядок пакетных записей и очистки адаптивной модели', async () => {
    const beforeClear = applyAdaptiveMutation('record', { word: 'Старое' });
    const clear = applyAdaptiveMutation('clear', {});
    const afterClear = applyAdaptiveMutation('record', { word: 'Новое' });
    await flushAdaptiveMutations();
    await Promise.all([beforeClear, clear, afterClear]);

    const words = (storage.adaptiveLanguageModel as { words: Record<string, unknown> }).words;
    expect(words).not.toHaveProperty('старое');
    expect(words).toHaveProperty('новое');
});

test('очередь адаптивной модели не блокируется общей очередью хранилища', async () => {
    let releaseDefault!: () => void;
    const defaultBlocker = enqueueStorageMutation(
        () =>
            new Promise<void>((resolve) => {
                releaseDefault = resolve;
            }),
    );
    let adaptiveCompleted = false;
    const adaptive = enqueueStorageMutation(async () => {
        adaptiveCompleted = true;
    }, 'adaptive-model-test');

    await adaptive;
    expect(adaptiveCompleted).toBe(true);
    releaseDefault();
    await defaultBlocker;
});

test('атомарно изменяет настройки нескольких сайтов', async () => {
    await Promise.all([
        applySettingsMutation('setSitePreference', {
            preference: 'history',
            hostname: 'first.example.com',
            enabled: false,
        }),
        applySettingsMutation('setSitePreference', {
            preference: 'history',
            hostname: 'second.example.com',
            enabled: false,
        }),
        applySettingsMutation('setSitePreference', {
            preference: 'suggestions',
            hostname: 'first.example.com',
            enabled: true,
        }),
    ]);
    expect(storage.disabledSites).toEqual(['first.example.com', 'second.example.com']);
    expect(storage.adaptiveDisabledSites).toEqual([]);
    expect(storage.adaptiveSuggestionsEnabled).toBe(true);
});

test('отклоняет некорректный hostname настройки сайта', async () => {
    await expect(
        applySettingsMutation('setSitePreference', {
            preference: 'history',
            hostname: 'не адрес',
            enabled: false,
        }),
    ).rejects.toThrow('INVALID_SITE_HOSTNAME');
});
