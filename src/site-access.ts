const REGISTERED_SCRIPT_ID = 'lexisync-enabled-sites';
const INJECT_SCRIPT_FILE = 'inject.js';
let scriptSyncQueue: Promise<void> = Promise.resolve();

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
    if (await contentScriptIsReady(tabId, frameId)) return;
    await chrome.scripting.executeScript({
        target: frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] },
        files: [INJECT_SCRIPT_FILE],
    });
}

export async function sendToTabWithInjection(tabId: number, message: unknown, frameId?: number): Promise<unknown> {
    await ensureContentScript(tabId, frameId);
    return chrome.tabs.sendMessage(tabId, message, frameId === undefined ? undefined : { frameId });
}

export function initializeSiteAccess(): void {
    void syncRegisteredSiteScripts().catch((error) => console.error('Не удалось обновить сценарии LexiSync:', error));
    chrome.permissions.onAdded.addListener(() => {
        void syncRegisteredSiteScripts().catch((error) => console.error('Не удалось добавить доступ LexiSync:', error));
    });
    chrome.permissions.onRemoved.addListener(() => {
        void syncRegisteredSiteScripts().catch((error) => console.error('Не удалось удалить доступ LexiSync:', error));
    });
}
