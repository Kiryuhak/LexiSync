import { logger } from './logger';

const REGISTERED_SCRIPT_ID = 'lexisync-enabled-sites';
const INJECT_SCRIPT_FILE = 'inject.js';
const OPTIONAL_SCRIPT_FILES = {
    adaptive: 'adaptive.js',
    liveProofread: 'live-proofread.js',
    ocr: 'ocr.js',
} as const;
let scriptSyncQueue: Promise<void> = Promise.resolve();
const tabInjectionQueues = new Map<number, Promise<void>>();

interface CommandFrameState {
    hasFocus: boolean;
    hasEditableFocus: boolean;
    activeElementIsFrame: boolean;
    selectionLength: number;
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

export async function findCommandTargetFrame(tabId: number): Promise<number | undefined> {
    try {
        const frames = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            func: inspectCommandFrame,
        });
        return frames
            .filter((frame): frame is typeof frame & { result: CommandFrameState } => Boolean(frame.result))
            .sort(
                (left, right) =>
                    getCommandFrameScore(right.frameId, right.result) - getCommandFrameScore(left.frameId, left.result),
            )[0]?.frameId;
    } catch {
        // На служебной или защищённой странице сохраняем прежнюю отправку в основной фрейм.
        return undefined;
    }
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
    const previous = tabInjectionQueues.get(tabId) ?? Promise.resolve();
    const injection = previous
        .catch(() => undefined)
        .then(async () => {
            if (await contentScriptIsReady(tabId, frameId)) return;
            await chrome.scripting.executeScript({
                target: frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] },
                files: [INJECT_SCRIPT_FILE],
            });
            if (!(await contentScriptIsReady(tabId, frameId))) throw new Error('CONTENT_SCRIPT_NOT_READY');
        });
    tabInjectionQueues.set(tabId, injection);
    try {
        await injection;
    } finally {
        if (tabInjectionQueues.get(tabId) === injection) tabInjectionQueues.delete(tabId);
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
