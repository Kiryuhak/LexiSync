const REGISTERED_SCRIPT_ID = 'lexisync-enabled-sites';
const INJECT_SCRIPT_FILE = 'inject.js';

export function getOriginPattern(urlValue: string): string | null {
    try {
        const url = new URL(urlValue);
        return ['http:', 'https:'].includes(url.protocol) ? `${url.origin}/*` : null;
    } catch {
        return null;
    }
}

async function grantedWebOrigins(): Promise<string[]> {
    const permissions = await chrome.permissions.getAll();
    return [...new Set((permissions.origins || []).filter((origin) => /^https?:\/\//.test(origin) && !origin.includes('api.mistral.ai/')))].sort();
}

export async function syncRegisteredSiteScripts(): Promise<void> {
    const matches = await grantedWebOrigins();
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [REGISTERED_SCRIPT_ID] });
    if (!matches.length) {
        if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [REGISTERED_SCRIPT_ID] });
        return;
    }
    const definition: chrome.scripting.RegisteredContentScript = {
        id: REGISTERED_SCRIPT_ID,
        matches,
        js: [INJECT_SCRIPT_FILE],
        runAt: 'document_idle',
        allFrames: true,
        matchOriginAsFallback: true,
        persistAcrossSessions: true,
    };
    if (registered.length) await chrome.scripting.updateContentScripts([definition]);
    else await chrome.scripting.registerContentScripts([definition]);
}

async function contentScriptIsReady(tabId: number, frameId?: number): Promise<boolean> {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'lexisyncPing' }, frameId === undefined ? undefined : { frameId });
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
    void syncRegisteredSiteScripts().catch((error) => console.error('Не удалось восстановить доступ LexiSync к сайтам:', error));
    chrome.permissions.onAdded.addListener(() => void syncRegisteredSiteScripts());
    chrome.permissions.onRemoved.addListener(() => void syncRegisteredSiteScripts());
}
