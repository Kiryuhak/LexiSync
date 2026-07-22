import { beforeEach, expect, test, vi } from 'vitest';
import { applyHistoryMutation } from '../src/history-store';
import { applyUsageMutation } from '../src/usage-stats';

let storage: Record<string, unknown>;

beforeEach(() => {
    storage = {};
    vi.stubGlobal('chrome', {
        storage: {
            local: {
                async get(keys: string[] | Record<string, unknown> | null) {
                    await Promise.resolve();
                    if (keys === null) return { ...storage };
                    if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, storage[key]]));
                    return Object.fromEntries(
                        Object.entries(keys).map(([key, fallback]) => [key, storage[key] ?? fallback]),
                    );
                },
                async set(updates: Record<string, unknown>) {
                    await Promise.resolve();
                    Object.assign(storage, structuredClone(updates));
                },
            },
        },
    });
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
