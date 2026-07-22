import type { StyleProfile } from './types';
import { t } from './i18n';
import { migrateSettings } from './settings-migrations';
import { fixKeyboardLayout } from './keyboard-layout';
import { applyUsageMutation, type UsageMutation } from './usage-stats';
import { applyHistoryMutation, type HistoryMutation } from './history-store';
import { applyCacheMutation, type CacheMutation } from './ai-cache';
import { applyAdaptiveMutation, type AdaptiveMutation } from './adaptive-model-store';
import { createSettingsFingerprint } from './request-cache';
import { initializeSettingsSync, restoreSyncedSettings } from './settings-transfer';
import { processOcr, streamText, type MistralRequest } from './mistral-client';
import { resolveStyleProfile } from './site-profiles';
import {
    ensureContentScript,
    initializeSiteAccess,
    sendToTabWithInjection,
    syncRegisteredSiteScripts,
} from './site-access';
import { getPrivacySettings, isSiteDisabled } from './privacy';

const REQUEST_TIMEOUT_MS = 45_000;

async function canStoreForSender(sender: chrome.runtime.MessageSender): Promise<boolean> {
    const sourceUrl = sender.tab?.url || sender.url || '';
    if (!/^https?:/i.test(sourceUrl)) return true;
    if (sender.tab?.incognito) return false;
    const settings = await getPrivacySettings();
    return settings.historyEnabled && !isSiteDisabled(new URL(sourceUrl).hostname, settings.disabledSites);
}

const initializationPromise = restoreSyncedSettings().then(migrateSettings);
initializeSettingsSync();
initializeSiteAccess();

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void chrome.storage.local.set({ onboardingCompleted: false });
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'spellcheck',
            title: `${t('fixErrors', 'Исправить ошибки')} (Alt+R)`,
            contexts: ['selection'],
        });
        chrome.contextMenus.create({
            id: 'style',
            title: `${t('rewriteText', 'Переписать текст')} (Alt+Y)`,
            contexts: ['selection'],
        });
        chrome.contextMenus.create({
            id: 'emoji',
            title: `${t('addEmoji', 'Подобрать эмодзи')} (Alt+T)`,
            contexts: ['selection'],
        });
        chrome.contextMenus.create({
            id: 'layout',
            title: t('fixLayout', 'Исправить раскладку'),
            contexts: ['selection'],
        });
        chrome.contextMenus.create({ id: 'translate', title: t('translate', 'Перевести'), contexts: ['selection'] });
        chrome.contextMenus.create({
            id: 'ocr',
            title: '📸 Распознать текст (Alt+S)',
            contexts: ['page', 'image', 'selection'],
        });
    });
});

async function sendOcrCommand(tabId: number, windowId?: number): Promise<void> {
    try {
        await ensureContentScript(tabId);
    } catch (error) {
        console.error('Не удалось запустить LexiSync на вкладке:', error);
        return;
    }
    const handleCapture = (dataUrl?: string) => {
        if (chrome.runtime.lastError || !dataUrl) {
            console.error('Ошибка захвата экрана:', chrome.runtime.lastError);
            return;
        }
        chrome.tabs.sendMessage(tabId, { action: 'startOcrMode', screenshotUrl: dataUrl });
    };

    if (typeof windowId === 'number') {
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, handleCapture);
    } else {
        chrome.tabs.captureVisibleTab({ format: 'png' }, handleCapture);
    }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === 'ocr') {
        void sendOcrCommand(tab.id, tab.windowId);
        return;
    }
    void sendToTabWithInjection(
        tab.id,
        {
            action: 'contextMenuClicked',
            mode: info.menuItemId,
            text: info.selectionText || '',
        },
        info.frameId,
    ).catch((error) => console.error('Не удалось выполнить команду LexiSync:', error));
});

chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.id) return;
        if (command === 'ocr') {
            void sendOcrCommand(tab.id, tab.windowId);
            return;
        }
        void sendToTabWithInjection(tab.id, { action: 'hotkeyTriggered', mode: command }).catch((error) =>
            console.error('Не удалось выполнить горячую клавишу LexiSync:', error),
        );
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'requestOcrCapture' && sender.tab?.id) {
        void sendOcrCommand(sender.tab.id, sender.tab.windowId);
    } else if (request.action === 'openHistory') {
        chrome.tabs.create({ url: chrome.runtime.getURL('lexisync-history.html') });
    } else if (request.action === 'openOptionsPage') {
        chrome.runtime.openOptionsPage();
    } else if (request.action === 'getRuntimeSettings') {
        void initializationPromise
            .then(() =>
                chrome.storage.local.get({
                    mistralApiKey: '',
                    sendPageContext: false,
                    contextDisabledSites: [],
                    aiMode: 'quality',
                    selectedTone: 'business',
                    personalDictionary: [],
                    glossary: [],
                    styleProfiles: [],
                    activeStyleProfileId: '',
                }),
            )
            .then((settings) => {
                const profiles = Array.isArray(settings.styleProfiles)
                    ? (settings.styleProfiles as StyleProfile[])
                    : [];
                const profile = resolveStyleProfile(
                    profiles,
                    String(settings.activeStyleProfileId || ''),
                    sender.tab?.url || sender.url,
                );
                sendResponse({
                    hasApiKey: typeof settings.mistralApiKey === 'string' && settings.mistralApiKey.trim().length > 0,
                    sendPageContext: settings.sendPageContext === true,
                    contextDisabledSites: settings.contextDisabledSites,
                    activeStyleProfileName: profile?.name || '',
                    cacheFingerprint: createSettingsFingerprint({
                        aiMode: settings.aiMode,
                        selectedTone: settings.selectedTone,
                        personalDictionary: settings.personalDictionary,
                        glossary: settings.glossary,
                        activeStyleProfile: profile,
                    }),
                });
            });
        return true;
    } else if (request.action === 'storageMutation') {
        const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
        const needsPrivacyCheck = request.domain === 'history' || request.domain === 'cache';
        const mutation = (needsPrivacyCheck ? canStoreForSender(sender) : Promise.resolve(true)).then((allowed) => {
            if (!allowed) return;
            if (request.domain === 'history') return applyHistoryMutation(request.mutation as HistoryMutation, payload);
            if (request.domain === 'usage') return applyUsageMutation(request.mutation as UsageMutation, payload);
            if (request.domain === 'cache') return applyCacheMutation(request.mutation as CacheMutation, payload);
            if (request.domain === 'adaptive')
                return applyAdaptiveMutation(request.mutation as AdaptiveMutation, payload);
            throw new Error('UNKNOWN_STORAGE_DOMAIN');
        });
        void mutation
            .then(() => sendResponse({ ok: true }))
            .catch((error) =>
                sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
        return true;
    } else if (request.action === 'siteAccessChanged' && typeof request.tabId === 'number') {
        void syncRegisteredSiteScripts()
            .then(async () => {
                if (request.enabled) {
                    await ensureContentScript(request.tabId);
                    await chrome.tabs.sendMessage(request.tabId, { action: 'setSiteEnabled', enabled: true });
                } else {
                    try {
                        await chrome.tabs.sendMessage(request.tabId, { action: 'setSiteEnabled', enabled: false });
                    } catch {
                        // На вкладке могло не быть внедрённого сценария.
                    }
                }
                sendResponse({ ok: true });
            })
            .catch((error) =>
                sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
        return true;
    } else if (request.action === 'replayHistoryItem') {
        void chrome.tabs
            .query({ currentWindow: true })
            .then(async (tabs) => {
                const target = tabs
                    .filter((tab) => tab.id && /^https?:/.test(tab.url || ''))
                    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
                if (!target?.id) {
                    sendResponse({ ok: false, error: 'Не найдена открытая веб-страница.' });
                    return;
                }
                await chrome.tabs.update(target.id, { active: true });
                await sendToTabWithInjection(target.id, {
                    action: 'historyReplay',
                    mode: request.item?.mode,
                    text: request.item?.original,
                    customName: request.item?.customName,
                });
                sendResponse({ ok: true });
            })
            .catch((error) =>
                sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
        return true;
    }
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'mistralStream') return;

    let controller: AbortController | null = null;
    let cancelledByUser = false;

    port.onDisconnect.addListener(() => controller?.abort());
    port.onMessage.addListener(async (msg: MistralRequest) => {
        if (msg.action === 'cancelMistral') {
            cancelledByUser = true;
            controller?.abort();
            return;
        }
        if (msg.action !== 'callMistral') return;

        controller?.abort();
        controller = new AbortController();
        cancelledByUser = false;
        const timeout = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
        const startedAt = Date.now();
        let completedSuccessfully = false;

        try {
            await initializationPromise;
            const settings = await chrome.storage.local.get({
                mistralApiKey: '',
                selectedTone: 'business',
                sendPageContext: false,
                personalDictionary: [],
                glossary: [],
                styleProfiles: [],
                activeStyleProfileId: '',
                aiMode: 'quality',
            });
            if (!msg.mode) throw new Error(t('modeMissing', 'Режим обработки не указан.'));
            if (msg.mode === 'layout') {
                const result = fixKeyboardLayout(msg.text || '');
                port.postMessage({ status: 'chunk', text: result });
                port.postMessage({ status: 'done' });
                completedSuccessfully = true;
                return;
            }
            const apiKey = settings.mistralApiKey as string;
            if (!apiKey) throw new Error(t('apiKeyMissing', 'API-ключ не настроен'));

            const styleProfiles = Array.isArray(settings.styleProfiles)
                ? (settings.styleProfiles as StyleProfile[])
                : [];
            const activeStyleProfile = resolveStyleProfile(
                styleProfiles,
                String(settings.activeStyleProfileId || ''),
                port.sender?.tab?.url || port.sender?.url || msg.pageUrl,
            );

            if (msg.mode === 'ocr') {
                const text = await processOcr(msg, apiKey, controller.signal);
                port.postMessage({ status: 'chunk', text });
            } else {
                await streamText(
                    msg,
                    apiKey,
                    {
                        selectedTone: settings.selectedTone as string,
                        sendPageContext: settings.sendPageContext === true && msg.allowPageContext !== false,
                        personalDictionary: Array.isArray(settings.personalDictionary)
                            ? settings.personalDictionary.map(String)
                            : [],
                        glossary: Array.isArray(settings.glossary) ? settings.glossary.map(String) : [],
                        activeStyleProfile,
                        aiMode: settings.aiMode === 'fast' ? 'fast' : 'quality',
                    },
                    controller.signal,
                    (text) => port.postMessage({ status: 'chunk', text }),
                );
            }
            port.postMessage({ status: 'done' });
            completedSuccessfully = true;
        } catch (error) {
            const isAbort = error instanceof DOMException && error.name === 'AbortError';
            if (isAbort) {
                port.postMessage({
                    status: cancelledByUser ? 'cancelled' : 'error',
                    error: cancelledByUser
                        ? t('requestCancelled', 'Запрос отменён.')
                        : t('requestTimeout', 'Превышено время ожидания ответа (45 секунд).'),
                });
            } else {
                const message =
                    error instanceof Error ? error.message : t('unknownNetworkError', 'Неизвестная ошибка сети.');
                port.postMessage({ status: 'error', error: message });
            }
        } finally {
            clearTimeout(timeout);
            if (msg.mode)
                void applyUsageMutation('request', {
                    mode: msg.mode,
                    latencyMs: Date.now() - startedAt,
                    success: completedSuccessfully,
                });
        }
    });
});
