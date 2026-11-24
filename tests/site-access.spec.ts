import { beforeEach, expect, test, vi } from 'vitest';
import {
    ALL_WEB_ORIGINS,
    classifyFrameAccessError,
    clearPendingFramePermission,
    detectTabFrameOrigins,
    ensureContentScript,
    findCommandTargetFrame,
    getBrowserType,
    getPendingFramePermission,
    hasAllSitesAccess,
    injectOptionalContentFeature,
    removeAllSitesAccess,
    requestAllSitesAccess,
    resolveCommandTarget,
    sendToTabWithInjection,
    storePendingFramePermission,
    syncRegisteredSiteScripts,
} from '../src/site-access';
import { recordFrameDiagnosticEvent, sanitizeOrigin } from '../src/error-log';
import { getSelectedText } from '../src/selection-state';

let ready = false;
const executeScript = vi.fn(async (_options?: unknown): Promise<unknown> => {
    await Promise.resolve();
    ready = true;
    return undefined;
});

let storageStore: Record<string, unknown> = {};

beforeEach(() => {
    ready = false;
    storageStore = {};
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
        storage: {
            local: {
                get: vi.fn(async (keys?: unknown) => {
                    if (typeof keys === 'object' && keys !== null) {
                        const result: Record<string, unknown> = {};
                        for (const [k, defVal] of Object.entries(keys as Record<string, unknown>)) {
                            result[k] = storageStore[k] ?? defVal;
                        }
                        return result;
                    }
                    return storageStore;
                }),
                set: vi.fn(async (items: Record<string, unknown>) => {
                    Object.assign(storageStore, items);
                }),
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

test('classifyFrameAccessError точно классифицирует типы ошибок разрешений и фреймов', () => {
    expect(classifyFrameAccessError(new Error('Missing host permission for the tab or frames')).errorCode).toBe(
        'NO_HOST_PERMISSION',
    );
    expect(
        classifyFrameAccessError(
            new Error('Cannot access contents of the page. Extension manifest must request permissions'),
        ).errorCode,
    ).toBe('NO_HOST_PERMISSION');
    expect(classifyFrameAccessError(new Error('The frame was not found.')).errorCode).toBe('FRAME_NOT_FOUND');
    expect(classifyFrameAccessError(new Error('Cannot access a sandboxed iframe')).errorCode).toBe(
        'FRAME_NOT_ACCESSIBLE',
    );
    expect(classifyFrameAccessError(new Error('CONTENT_SCRIPT_NOT_READY')).errorCode).toBe('SCRIPT_INJECTION_FAILED');
});

test('resolveCommandTarget определяет NO_HOST_PERMISSION и origin при фокусе во вложенном стороннем iframe', async () => {
    // 1-й вызов allFrames: true завершается ошибкой Missing host permission
    executeScript.mockRejectedValueOnce(new Error('Missing host permission for the tab or frames'));
    // 2-й вызов target: frameIds: [0] возвращает состояние top-level фрейма с активным iframe
    executeScript.mockResolvedValueOnce([
        {
            frameId: 0,
            result: {
                hasFocus: true,
                hasEditableFocus: false,
                activeElementIsFrame: true,
                activeFrameSrc: 'https://learn.rusau.net/courses/245575/1827675?step=10&token=secret123',
                activeFrameIsSandboxed: false,
                selectionLength: 0,
            },
        },
    ]);

    const resolution = await resolveCommandTarget(101);
    expect(resolution.error).toBe('NO_HOST_PERMISSION');
    expect(resolution.frameOrigin).toBe('https://learn.rusau.net/*');
});

test('resolveCommandTarget возвращает FRAME_NOT_ACCESSIBLE для sandboxed iframe', async () => {
    executeScript.mockRejectedValueOnce(new Error('Missing host permission for the tab or frames'));
    executeScript.mockResolvedValueOnce([
        {
            frameId: 0,
            result: {
                hasFocus: true,
                hasEditableFocus: false,
                activeElementIsFrame: true,
                activeFrameSrc: 'https://sandbox.example.com/embed',
                activeFrameIsSandboxed: true,
                selectionLength: 0,
            },
        },
    ]);

    const resolution = await resolveCommandTarget(102);
    expect(resolution.error).toBe('FRAME_NOT_ACCESSIBLE');
});

test('resolveCommandTarget не ломает основной фрейм, если ошибка вызвана сторонним рекламным фреймом', async () => {
    // allFrames: true падает из-за какого-то третьего фрейма
    executeScript.mockRejectedValueOnce(new Error('Missing host permission for the tab or frames'));
    // Но сам пользователь печатает в textarea верхнего документа!
    executeScript.mockResolvedValueOnce([
        {
            frameId: 0,
            result: {
                hasFocus: true,
                hasEditableFocus: true,
                activeElementIsFrame: false,
                selectionLength: 42,
            },
        },
    ]);

    const resolution = await resolveCommandTarget(103);
    expect(resolution.frameId).toBe(0);
    expect(resolution.error).toBeUndefined();
});

test('сохраняет, извлекает и очищает ожидающее разрешение на фрейм с проверкой времени жизни', async () => {
    await storePendingFramePermission(88, 3, 'https://editor.example.org/*');
    const pending = await getPendingFramePermission(88);
    expect(pending).toEqual({
        frameId: 3,
        frameOrigin: 'https://editor.example.org/*',
    });

    await clearPendingFramePermission(88);
    const cleared = await getPendingFramePermission(88);
    expect(cleared).toBeNull();
});

test('sanitizeOrigin очищает пути, query параметры и токены до безопасного origin pattern', () => {
    expect(sanitizeOrigin('https://learn.rusau.net/courses/245575/1827675?step=10&token=sensitive123#hash')).toBe(
        'https://learn.rusau.net/*',
    );
    expect(sanitizeOrigin('http://localhost:8080/embed/editor')).toBe('http://localhost:8080/*');
    expect(sanitizeOrigin('invalid-url')).toBe('');
});

test('recordFrameDiagnosticEvent регистрирует безопасные метаданные и подавляет быстрые дубликаты', async () => {
    const errorLogs: unknown[] = [];
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ appErrorLogs: errorLogs });

    await recordFrameDiagnosticEvent({
        component: 'shortcut',
        requestId: 'req-1',
        command: 'spellcheck',
        browser: 'firefox',
        source: 'browser-command',
        frameId: 5,
        frameOrigin: 'https://learn.rusau.net/courses/1?token=secret',
        permissionStatus: 'denied',
        stage: 'permission-check',
        errorCode: 'NO_HOST_PERMISSION',
        result: 'needs-user-action',
    });

    expect(chrome.storage.local.set).toHaveBeenCalled();
    const lastSetCall = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    const loggedEntry = lastSetCall?.appErrorLogs?.[0];
    expect(loggedEntry).toBeDefined();
    // Проверяем, что в лог не попал token
    expect(JSON.stringify(loggedEntry)).not.toContain('secret');
    expect(loggedEntry.details?.frameOrigin).toBe('https://learn.rusau.net/*');

    // Быстрый повторный вызов с теми же параметрами подавляется (дедупликация)
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockClear();
    await recordFrameDiagnosticEvent({
        component: 'shortcut',
        requestId: 'req-2',
        command: 'spellcheck',
        browser: 'firefox',
        source: 'browser-command',
        frameId: 5,
        frameOrigin: 'https://learn.rusau.net/courses/1',
        permissionStatus: 'denied',
        stage: 'permission-check',
        errorCode: 'NO_HOST_PERMISSION',
        result: 'needs-user-action',
    });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
});

test('getSelectedText блокирует чтение чувствительных полей password', () => {
    const fakePasswordInput = {
        tagName: 'INPUT',
        type: 'password',
        value: 'MySuperSecretPassword',
        selectionStart: 0,
        selectionEnd: 21,
    };
    vi.stubGlobal('document', {
        activeElement: fakePasswordInput,
    });
    expect(getSelectedText()).toBe('');
});

test('параллельные попытки инъекции в разные фреймы не блокируют друг друга', async () => {
    ready = false;
    let frame3Resolved = false;
    let frame7Resolved = false;

    executeScript.mockImplementation(async (options: unknown) => {
        const opts = options as { target: { frameIds?: number[] } };
        if (opts.target.frameIds?.includes(3)) frame3Resolved = true;
        if (opts.target.frameIds?.includes(7)) frame7Resolved = true;
        ready = true;
        return undefined;
    });

    await Promise.all([ensureContentScript(50, 3), ensureContentScript(50, 7)]);
    expect(frame3Resolved).toBe(true);
    expect(frame7Resolved).toBe(true);
    expect(executeScript).toHaveBeenCalledTimes(2);
});

test('getBrowserType определяет тип браузера корректно', () => {
    expect(['firefox', 'chromium']).toContain(getBrowserType());

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/119.0' });
    expect(getBrowserType()).toBe('firefox');

    vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
    });
    expect(getBrowserType()).toBe('chromium');
});
