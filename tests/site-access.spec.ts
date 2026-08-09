import { beforeEach, expect, test, vi } from 'vitest';
import {
    ensureContentScript,
    injectOptionalContentFeature,
    sendToTabWithInjection,
    syncRegisteredSiteScripts,
} from '../src/site-access';

let ready = false;
const executeScript = vi.fn(async () => {
    await Promise.resolve();
    ready = true;
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
    await injectOptionalContentFeature(7, undefined, 'adaptive');
    expect(executeScript).toHaveBeenLastCalledWith({ target: { tabId: 7, frameIds: [0] }, files: ['adaptive.js'] });
});
