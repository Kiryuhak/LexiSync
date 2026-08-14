import { describe, expect, test, vi } from 'vitest';
import {
    compareChromeVersions,
    findAcceptedVersion,
    normalizePrivateKey,
    parseChromeVersion,
    publishChromeExtension,
} from '../scripts/publish-chrome-store.mjs';

const baseOptions = {
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    publisherId: '11111111-2222-3333-4444-555555555555',
    clientEmail: 'publisher@example.iam.gserviceaccount.com',
    privateKey: 'unused-in-tests',
    expectedVersion: '5.2.5',
    zipBuffer: Buffer.from('test-zip'),
    maxAttempts: 3,
    pollAttempts: 2,
    pollDelayMs: 1,
    retryDelayMs: 1,
};

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function createFetchMock(responses: unknown[]) {
    const queue = [...responses];
    return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        if (queue.length === 0) throw new Error('Тест не подготовил следующий ответ fetch');
        const next = queue.shift();
        return next instanceof Response ? next : jsonResponse(next);
    });
}

function createDependencies(responses: unknown[]) {
    return {
        accessToken: 'test-token',
        fetch: createFetchMock(responses),
        wait: vi.fn(async () => undefined),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
}

function published(version = '5.2.4') {
    return {
        publishedItemRevisionStatus: {
            state: 'PUBLISHED',
            distributionChannels: [{ deployPercentage: 100, crxVersion: version }],
        },
    };
}

function pending(version: string) {
    return {
        ...published(),
        submittedItemRevisionStatus: {
            state: 'PENDING_REVIEW',
            distributionChannels: [{ deployPercentage: 100, crxVersion: version }],
        },
    };
}

describe('надёжная публикация Chrome Web Store', () => {
    test('нормализует приватный ключ и сравнивает версии Chrome', () => {
        expect(normalizePrivateKey('  line1\\nline2  ')).toBe('line1\nline2');
        expect(parseChromeVersion('5.2.5')).toEqual([5, 2, 5, 0]);
        expect(compareChromeVersions('5.2.5', '5.2.4')).toBeGreaterThan(0);
        expect(compareChromeVersions('5.2.5', '5.2.5.0')).toBe(0);
        expect(() => parseChromeVersion('5.02.5')).toThrow(/Некорректная версия Chrome/u);
    });

    test('распознаёт подтверждённую версию и требует развёртывание на 100%', () => {
        expect(findAcceptedVersion(pending('5.2.5'), '5.2.5')).toEqual({
            source: 'submitted',
            state: 'PENDING_REVIEW',
            version: '5.2.5',
        });
        expect(findAcceptedVersion(published('5.2.5'), '5.2.5')).toEqual({
            source: 'published',
            state: 'PUBLISHED',
            version: '5.2.5',
        });
        expect(
            findAcceptedVersion(
                {
                    submittedItemRevisionStatus: {
                        state: 'PENDING_REVIEW',
                        distributionChannels: [{ deployPercentage: 10, crxVersion: '5.2.5' }],
                    },
                },
                '5.2.5',
            ),
        ).toBeNull();
    });

    test('не загружает повторно версию, которая уже ожидает проверку', async () => {
        const dependencies = createDependencies([pending('5.2.5')]);

        const result = await publishChromeExtension(baseOptions, dependencies);

        expect(result).toEqual({ source: 'submitted', state: 'PENDING_REVIEW', version: '5.2.5', attempts: 0 });
        expect(dependencies.fetch).toHaveBeenCalledTimes(1);
        expect(dependencies.fetch.mock.calls[0][0]).toMatch(/:fetchStatus$/u);
    });

    test('повторяет временно отменённую публикацию и проверяет конечную версию', async () => {
        const dependencies = createDependencies([
            published(),
            { uploadState: 'SUCCEEDED', crxVersion: '5.2.5' },
            { state: 'CANCELLED' },
            published(),
            { uploadState: 'SUCCEEDED', crxVersion: '5.2.5' },
            { state: 'PENDING_REVIEW' },
            pending('5.2.5'),
        ]);

        const result = await publishChromeExtension(baseOptions, dependencies);

        expect(result).toEqual({ source: 'submitted', state: 'PENDING_REVIEW', version: '5.2.5', attempts: 2 });
        expect(dependencies.wait).toHaveBeenCalledTimes(1);
        const urls = dependencies.fetch.mock.calls.map(([url]) => String(url));
        expect(urls.filter((url) => url.includes('/upload/'))).toHaveLength(2);
        expect(urls.filter((url) => url.endsWith(':publish'))).toHaveLength(2);
    });

    test('отменяет более старую активную заявку перед загрузкой', async () => {
        const dependencies = createDependencies([
            pending('5.2.4'),
            {},
            { uploadState: 'SUCCEEDED', crxVersion: '5.2.5' },
            { state: 'PENDING_REVIEW' },
            pending('5.2.5'),
        ]);

        await expect(publishChromeExtension(baseOptions, dependencies)).resolves.toMatchObject({
            version: '5.2.5',
            state: 'PENDING_REVIEW',
        });
        const urls = dependencies.fetch.mock.calls.map(([url]) => String(url));
        expect(urls.filter((url) => url.endsWith(':cancelSubmission'))).toHaveLength(1);
    });

    test('останавливается при несовпадении версии загруженного ZIP', async () => {
        const dependencies = createDependencies([published(), { uploadState: 'SUCCEEDED', crxVersion: '5.2.4' }]);

        await expect(publishChromeExtension(baseOptions, dependencies)).rejects.toThrow(
            /распознал ZIP как версию 5\.2\.4/u,
        );
        expect(dependencies.wait).not.toHaveBeenCalled();
    });

    test('не перезаписывает более новую заявку в магазине', async () => {
        const dependencies = createDependencies([pending('5.3.0')]);

        await expect(publishChromeExtension(baseOptions, dependencies)).rejects.toThrow(/более новая заявка 5\.3\.0/u);
        expect(dependencies.fetch).toHaveBeenCalledTimes(1);
    });

    test('не считает отложенную ручную публикацию успешным развёртыванием', async () => {
        const dependencies = createDependencies([
            {
                submittedItemRevisionStatus: {
                    state: 'STAGED',
                    distributionChannels: [{ deployPercentage: 100, crxVersion: '5.2.5' }],
                },
                ...published(),
            },
        ]);

        await expect(publishChromeExtension(baseOptions, dependencies)).rejects.toThrow(/отложена для ручной/u);
        expect(dependencies.fetch).toHaveBeenCalledTimes(1);
    });
});
