import { beforeEach, expect, test, vi } from 'vitest';
import {
    ALL_WEB_ORIGINS,
    detectTabFrameOrigins,
    ensureContentScript,
    findCommandTargetFrame,
    hasAllSitesAccess,
    injectOptionalContentFeature,
    removeAllSitesAccess,
    requestAllSitesAccess,
    sendToTabWithInjection,
    syncRegisteredSiteScripts,
} from '../src/site-access';

let ready = false;
const executeScript = vi.fn(async (): Promise<unknown> => {
    await Promise.resolve();
    ready = true;
    return undefined;
});

beforeEach(() => {
    ready = false;
    executeScript.mockClear();
    const getRegisteredContentScripts = vi.fn().mockResolvedValue([]);
    const unregisterContentScripts = vi.fn().mockResolvedValue(undefined);
    const registerContentScripts = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
        tabs: {
            async sendMessage() {
                if (!ready) throw new Error('Receiving end does not exist');
                return { ok: true };
            },
        },
        scripting: {
            executeScript,
            getRegisteredContentScripts,
            unregisterContentScripts,
            registerContentScripts,
        },
        permissions: {
            async getAll() {
                return { origins: ['https://example.com/*', 'https://api.mistral.ai/*', 'https://example.com/*'] };
            },
            contains: vi.fn().mockResolvedValue(false),
            request: vi.fn().mockResolvedValue(true),
            remove: vi.fn().mockResolvedValue(true),
        },
    });
});

test('объединяет параллельные попытки инъекции в одну', async () => {
    await Promise.all([ensureContentScript(42), ensureContentScript(42), ensureContentScript(42)]);
    expect(executeScript).toHaveBeenCalledOnce();
});

test('обновляет зарегистрированный сценарий только для разрешённых сайтов', async () => {
    const scripting = chrome.scripting as unknown as {
        getRegisteredContentScripts: ReturnType<typeof vi.fn>;
        unregisterContentScripts: ReturnType<typeof vi.fn>;
        registerContentScripts: ReturnType<typeof vi.fn>;
    };
    scripting.getRegisteredContentScripts.mockResolvedValue([{ id: 'lexisync-enabled-sites' }]);

    await syncRegisteredSiteScripts();

    expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['lexisync-enabled-sites'] });
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
        expect.objectContaining({
            id: 'lexisync-enabled-sites',
            matches: ['https://example.com/*'],
            js: ['inject.js'],
            allFrames: true,
        }),
    ]);
});

test('внедряет сценарии в нужный фрейм и передаёт сообщение после проверки', async () => {
    const response = await sendToTabWithInjection(7, { action: 'run' }, 3);

    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7, frameIds: [3] }, files: ['inject.js'] });
    expect(response).toEqual({ ok: true });
    await injectOptionalContentFeature(7, 3, 'ocr');
    await injectOptionalContentFeature(7, 3, 'liveProofread');
    expect(executeScript).toHaveBeenLastCalledWith({
        target: { tabId: 7, frameIds: [3] },
        files: ['live-proofread.js'],
    });
    await injectOptionalContentFeature(7, undefined, 'adaptive');
    expect(executeScript).toHaveBeenLastCalledWith({ target: { tabId: 7, frameIds: [0] }, files: ['adaptive.js'] });
});

test('направляет горячую клавишу во фрейм с активным полем и выделенным текстом', async () => {
    executeScript.mockResolvedValueOnce([
        {
            frameId: 0,
            result: { hasFocus: true, hasEditableFocus: false, activeElementIsFrame: true, selectionLength: 18 },
        },
        {
            frameId: 7,
            result: { hasFocus: true, hasEditableFocus: true, activeElementIsFrame: false, selectionLength: 18 },
        },
        {
            frameId: 9,
            result: { hasFocus: false, hasEditableFocus: false, activeElementIsFrame: false, selectionLength: 0 },
        },
    ]);

    await expect(findCommandTargetFrame(42)).resolves.toBe(7);
    expect(executeScript).toHaveBeenCalledWith({
        target: { tabId: 42, allFrames: true },
        func: expect.any(Function),
    });
});

test('сохраняет отправку в основной фрейм, если проверка фокуса запрещена браузером', async () => {
    executeScript.mockRejectedValueOnce(new Error('Cannot access contents of the page'));

    await expect(findCommandTargetFrame(42)).resolves.toBeUndefined();
});

test('проверяет, запрашивает и удаляет доступ ко всем сайтам', async () => {
    const permissions = chrome.permissions as unknown as {
        contains: ReturnType<typeof vi.fn>;
        request: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
    };

    permissions.contains.mockResolvedValueOnce(true);
    await expect(hasAllSitesAccess()).resolves.toBe(true);
    expect(permissions.contains).toHaveBeenCalledWith({ origins: ALL_WEB_ORIGINS });

    permissions.request.mockResolvedValueOnce(true);
    await expect(requestAllSitesAccess()).resolves.toBe(true);
    expect(permissions.request).toHaveBeenCalledWith({ origins: ALL_WEB_ORIGINS });

    permissions.remove.mockResolvedValueOnce(true);
    await expect(removeAllSitesAccess()).resolves.toBe(true);
    expect(permissions.remove).toHaveBeenCalledWith({ origins: ALL_WEB_ORIGINS });
});

test('обнаруживает происхождение сторонних iframe на вкладке', async () => {
    executeScript.mockResolvedValueOnce([
        {
            result: ['https://qa-homeworks.org/*'],
        },
    ]);

    const origins = await detectTabFrameOrigins(12);
    expect(origins).toEqual(['https://qa-homeworks.org/*']);
    expect(executeScript).toHaveBeenCalledWith({
        target: { tabId: 12, allFrames: false },
        func: expect.any(Function),
    });
});
