import { logger } from './logger';

const REGISTERED_SCRIPT_ID = 'lexisync-enabled-sites';
const INJECT_SCRIPT_FILE = 'inject.js';
const OPTIONAL_SCRIPT_FILES = {
    adaptive: 'adaptive.js',
    liveProofread: 'live-proofread.js',
    ocr: 'ocr.js',
} as const;
let scriptSyncQueue: Promise<void> = Promise.resolve();
const injectionQueues = new Map<string, Promise<void>>();

export type FrameAccessErrorCode =
    | 'NO_HOST_PERMISSION'
    | 'FRAME_NOT_ACCESSIBLE'
    | 'FRAME_NOT_FOUND'
    | 'SCRIPT_INJECTION_FAILED'
    | 'SHORTCUT_NOT_DELIVERED'
    | 'NO_SELECTION';

export function classifyFrameAccessError(error: unknown): {
    errorCode: FrameAccessErrorCode;
    rawMessage: string;
} {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const lower = rawMessage.toLowerCase();

    if (
        lower.includes('missing host permission') ||
        lower.includes('extension manifest must request permissions') ||
        lower.includes('cannot access contents of the page') ||
        lower.includes('access denied') ||
        lower.includes('permission denied')
    ) {
        return { errorCode: 'NO_HOST_PERMISSION', rawMessage };
    }

    if (
        lower.includes('frame was not found') ||
        lower.includes('frame with id') ||
        lower.includes('no frame with id') ||
        lower.includes('target frame')
    ) {
        return { errorCode: 'FRAME_NOT_FOUND', rawMessage };
    }

    if (
        lower.includes('sandboxed') ||
        lower.includes('about:blank') ||
        lower.includes('restricted') ||
        lower.includes('chrome://') ||
        lower.includes('about:')
    ) {
        return { errorCode: 'FRAME_NOT_ACCESSIBLE', rawMessage };
    }

    if (lower.includes('content_script_not_ready') || lower.includes('receiving end does not exist')) {
        return { errorCode: 'SCRIPT_INJECTION_FAILED', rawMessage };
    }

    return { errorCode: 'FRAME_NOT_ACCESSIBLE', rawMessage };
}

export function getBrowserType(): 'firefox' | 'chromium' {
    if (typeof navigator !== 'undefined' && /Firefox/i.test(navigator.userAgent)) {
        return 'firefox';
    }
    return 'chromium';
}

interface CommandFrameState {
    hasFocus: boolean;
    hasEditableFocus: boolean;
    activeElementIsFrame: boolean;
    selectionLength: number;
}

export interface TopFrameInspection {
    hasFocus: boolean;
    hasEditableFocus: boolean;
    activeElementIsFrame: boolean;
    activeFrameSrc?: string;
    activeFrameIsSandboxed?: boolean;
    selectionLength: number;
}

export function inspectTopFrameForCommand(): TopFrameInspection {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLIFrameElement) {
        let activeFrameSrc = '';
        try {
            activeFrameSrc = activeElement.src || activeElement.getAttribute('src') || '';
        } catch {
            // ignore
        }
        const activeFrameIsSandboxed = activeElement.hasAttribute('sandbox');
        return {
            hasFocus: document.hasFocus(),
            hasEditableFocus: false,
            activeElementIsFrame: true,
            activeFrameSrc,
            activeFrameIsSandboxed,
            selectionLength: 0,
        };
    }

    let editableSelectionLength = 0;
    const hasEditableFocus =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable);
    if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
        try {
            const start = activeElement.selectionStart ?? 0;
            const end = activeElement.selectionEnd ?? start;
            editableSelectionLength = activeElement.value.slice(start, end).trim().length;
        } catch {
            // Некоторые типы input не предоставляют позиции выделения.
        }
    }
    const documentSelectionLength = window.getSelection()?.toString().trim().length ?? 0;
    return {
        hasFocus: document.hasFocus(),
        hasEditableFocus,
        activeElementIsFrame: false,
        selectionLength: Math.max(editableSelectionLength, documentSelectionLength),
    };
}

function inspectCommandFrame(): CommandFrameState {
    const activeElement = document.activeElement;
    let editableSelectionLength = 0;
    const hasEditableFocus =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable);
    if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
        try {
            const start = activeElement.selectionStart ?? 0;
            const end = activeElement.selectionEnd ?? start;
            editableSelectionLength = activeElement.value.slice(start, end).trim().length;
        } catch {
            // Некоторые типы input не предоставляют позиции выделения.
        }
    }
    const documentSelectionLength = window.getSelection()?.toString().trim().length ?? 0;
    return {
        hasFocus: document.hasFocus(),
        hasEditableFocus,
        activeElementIsFrame: activeElement instanceof HTMLIFrameElement,
        selectionLength: Math.max(editableSelectionLength, documentSelectionLength),
    };
}

function getCommandFrameScore(frameId: number, state: CommandFrameState): number {
    return (
        (state.hasFocus && !state.activeElementIsFrame ? 1000 : 0) +
        (state.hasEditableFocus ? 500 : 0) +
        (state.selectionLength > 0 ? 200 : 0) +
        (frameId === 0 ? 0 : 1)
    );
}

export interface CommandTargetResult {
    frameId?: number;
    frameOrigin?: string;
    error?: FrameAccessErrorCode;
}

export async function resolveCommandTarget(tabId: number): Promise<CommandTargetResult> {
    try {
        const frames = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            func: inspectCommandFrame,
        });
        const best = frames
            .filter((frame): frame is typeof frame & { result: CommandFrameState } => Boolean(frame.result))
            .sort(
                (left, right) =>
                    getCommandFrameScore(right.frameId, right.result) - getCommandFrameScore(left.frameId, left.result),
            )[0];
        if (best) {
            return { frameId: best.frameId };
        }
    } catch (allFramesError) {
        // allFrames: true failed (например, Missing host permission for the tab or frames из-за стороннего фрейма).
        // Безопасно инспектируем основной фрейм (0), чтобы определить фокус.
        try {
            const topResults = await chrome.scripting.executeScript({
                target: { tabId, frameIds: [0] },
                func: inspectTopFrameForCommand,
            });
            const topState = topResults[0]?.result;
            if (topState?.activeElementIsFrame) {
                const frameSrc = topState.activeFrameSrc || '';
                const frameOrigin = getOriginPattern(frameSrc);
                if (topState.activeFrameIsSandboxed) {
                    return { error: 'FRAME_NOT_ACCESSIBLE', frameOrigin: frameOrigin ?? undefined };
                }
                return {
                    error: 'NO_HOST_PERMISSION',
                    frameOrigin: frameOrigin ?? undefined,
                };
            }
            if (topState?.hasEditableFocus || (topState && topState.selectionLength > 0)) {
                return { frameId: 0 };
            }
        } catch {
            return { error: 'FRAME_NOT_ACCESSIBLE' };
        }

        const classified = classifyFrameAccessError(allFramesError);
        return { error: classified.errorCode };
    }

    return { frameId: 0 };
}

export async function findCommandTargetFrame(tabId: number): Promise<number | undefined> {
    const res = await resolveCommandTarget(tabId);
    return res.frameId;
}

export const ALL_WEB_ORIGINS = ['http://*/*', 'https://*/*'];

export async function hasAllSitesAccess(): Promise<boolean> {
    try {
        return await chrome.permissions.contains({ origins: ALL_WEB_ORIGINS });
    } catch {
        return false;
    }
}

export async function requestAllSitesAccess(): Promise<boolean> {
    try {
        return await chrome.permissions.request({ origins: ALL_WEB_ORIGINS });
    } catch {
        return false;
    }
}

export async function removeAllSitesAccess(): Promise<boolean> {
    try {
        return await chrome.permissions.remove({ origins: ALL_WEB_ORIGINS });
    } catch {
        return false;
    }
}

export async function detectTabFrameOrigins(tabId: number): Promise<string[]> {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId, allFrames: false },
            func: () => {
                const origins = new Set<string>();
                const iframes = Array.from(document.querySelectorAll('iframe'));
                for (const frame of iframes) {
                    try {
                        const src = frame.src || frame.getAttribute('src');
                        if (src && /^https?:\/\//i.test(src)) {
                            const parsed = new URL(src);
                            if (['http:', 'https:'].includes(parsed.protocol) && parsed.origin !== location.origin) {
                                origins.add(`${parsed.origin}/*`);
                            }
                        }
                    } catch {
                        // ignore malformed iframe sources
                    }
                }
                return Array.from(origins);
            },
        });
        return results[0]?.result || [];
    } catch {
        return [];
    }
}

export function getOriginPattern(urlValue: string): string | null {
    try {
        const url = new URL(urlValue);
        return ['http:', 'https:'].includes(url.protocol) ? `${url.origin}/*` : null;
    } catch {
        return null;
    }
}

export async function syncRegisteredSiteScripts(): Promise<void> {
    const sync = scriptSyncQueue.then(syncRegisteredSiteScriptsLocally, syncRegisteredSiteScriptsLocally);
    scriptSyncQueue = sync.catch(() => undefined);
    return sync;
}

async function syncRegisteredSiteScriptsLocally(): Promise<void> {
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [REGISTERED_SCRIPT_ID] });
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [REGISTERED_SCRIPT_ID] });
    const permissions = await chrome.permissions.getAll();
    const matches = [
        ...new Set(
            (permissions.origins || []).filter((origin) => {
                return /^https?:\/\//.test(origin) && !origin.startsWith('https://api.mistral.ai/');
            }),
        ),
    ];
    if (!matches.length) return;
    await chrome.scripting.registerContentScripts([
        {
            id: REGISTERED_SCRIPT_ID,
            matches,
            js: [INJECT_SCRIPT_FILE],
            allFrames: true,
            matchOriginAsFallback: true,
            persistAcrossSessions: true,
        },
    ]);
}

async function contentScriptIsReady(tabId: number, frameId?: number): Promise<boolean> {
    try {
        const response = await chrome.tabs.sendMessage(
            tabId,
            { action: 'lexisyncPing' },
            frameId === undefined ? undefined : { frameId },
        );
        return response?.ok === true;
    } catch {
        return false;
    }
}

export async function ensureContentScript(tabId: number, frameId?: number): Promise<void> {
    const queueKey = `${tabId}:${frameId ?? 'all'}`;
    const previous = injectionQueues.get(queueKey) ?? Promise.resolve();
    const injection = previous
        .catch(() => undefined)
        .then(async () => {
            if (await contentScriptIsReady(tabId, frameId)) return;
            await chrome.scripting.executeScript({
                target: frameId === undefined ? { tabId, frameIds: [0] } : { tabId, frameIds: [frameId] },
                files: [INJECT_SCRIPT_FILE],
            });
            if (!(await contentScriptIsReady(tabId, frameId))) throw new Error('CONTENT_SCRIPT_NOT_READY');
        });
    injectionQueues.set(queueKey, injection);
    try {
        await injection;
    } finally {
        if (injectionQueues.get(queueKey) === injection) injectionQueues.delete(queueKey);
    }
}

export async function getPendingFramePermission(
    tabId: number,
): Promise<{ frameId: number; frameOrigin: string } | null> {
    try {
        const stored = await chrome.storage.local.get({ pendingFramePermissions: {} });
        const record = (
            stored.pendingFramePermissions as Record<
                number,
                { frameId: number; frameOrigin: string; timestamp: number }
            >
        )?.[tabId];
        if (record && Date.now() - record.timestamp < 300_000) {
            return { frameId: record.frameId, frameOrigin: record.frameOrigin };
        }
        return null;
    } catch {
        return null;
    }
}

export async function storePendingFramePermission(tabId: number, frameId: number, frameOrigin: string): Promise<void> {
    try {
        const stored = await chrome.storage.local.get({ pendingFramePermissions: {} });
        const map = {
            ...(stored.pendingFramePermissions as Record<number, unknown>),
            [tabId]: { frameId, frameOrigin, timestamp: Date.now() },
        };
        await chrome.storage.local.set({ pendingFramePermissions: map });
    } catch {
        // ignore
    }
}

export async function clearPendingFramePermission(tabId: number): Promise<void> {
    try {
        const stored = await chrome.storage.local.get({ pendingFramePermissions: {} });
        const map = { ...(stored.pendingFramePermissions as Record<number, unknown>) };
        delete map[tabId];
        await chrome.storage.local.set({ pendingFramePermissions: map });
    } catch {
        // ignore
    }
}

export async function sendToTabWithInjection(tabId: number, message: unknown, frameId?: number): Promise<unknown> {
    await ensureContentScript(tabId, frameId);
    return chrome.tabs.sendMessage(tabId, message, frameId === undefined ? undefined : { frameId });
}

export async function injectOptionalContentFeature(
    tabId: number,
    frameId: number | undefined,
    feature: keyof typeof OPTIONAL_SCRIPT_FILES,
): Promise<void> {
    await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId ?? 0] },
        files: [OPTIONAL_SCRIPT_FILES[feature]],
    });
}

export function initializeSiteAccess(): void {
    void syncRegisteredSiteScripts().catch((error) => logger.error('Не удалось обновить сценарии LexiSync:', error));
    chrome.permissions.onAdded.addListener(() => {
        void syncRegisteredSiteScripts().catch((error) => logger.error('Не удалось добавить доступ LexiSync:', error));
    });
    chrome.permissions.onRemoved.addListener(() => {
        void syncRegisteredSiteScripts().catch((error) => logger.error('Не удалось удалить доступ LexiSync:', error));
    });
}
