import type { StyleProfile } from './types';
import { t } from './i18n';
import { migrateSettings } from './settings-migrations';
import { fixKeyboardLayout } from './keyboard-layout';
import { applyUsageMutation, type UsageMutation } from './usage-stats';
import { applyHistoryMutation, type HistoryMutation } from './history-store';
import {
    applyCacheMutation,
    cleanupExpiredAiCacheLocally,
    getCacheHash,
    getCachedText,
    type CacheMutation,
} from './ai-cache';
import { applyAdaptiveMutation, type AdaptiveMutation } from './adaptive-model-store';
import { createSettingsFingerprint } from './request-cache';
import { applySettingsMutation, type SettingsMutation } from './settings-store';
import { initializeSettingsSync, restoreSyncedSettings } from './settings-transfer';
import {
    formatMistralError,
    isRetryableMistralError,
    processOcr,
    streamText,
    type MistralRequest,
} from './mistral-client';
import { validateMistralRequest } from './request-validation';
import { resolveStyleProfile } from './site-profiles';
import {
    ensureContentScript,
    findCommandTargetFrame,
    injectOptionalContentFeature,
    initializeSiteAccess,
    sendToTabWithInjection,
    syncRegisteredSiteScripts,
} from './site-access';
import { getPrivacySettings, isSiteDisabled, normalizeDisabledSites } from './privacy';
import { DEFAULT_BUDGET_SETTINGS, estimateTokens } from './budget';
import { finalizeBudgetReservation, reserveBudgetIfActive } from './budget-reservations';
import { getStoredApiKey, migrateApiKeyToSecretStore, setStoredApiKey } from './secret-store';
import { logger } from './logger';
import { isRuntimeSettingKey, pickRuntimeSettings, RUNTIME_SETTING_KEYS } from './runtime-settings-cache';
import { isExtensionAllowedForUrl } from './site-runtime-access';

const REQUEST_TIMEOUT_MS = 45_000;

async function canStoreForSender(sender: chrome.runtime.MessageSender): Promise<boolean> {
    const sourceUrl = sender.tab?.url || sender.url || '';
    if (!/^https?:/i.test(sourceUrl)) return true;
    if (sender.tab?.incognito) return false;
    const settings = await getPrivacySettings();
    try {
        return settings.historyEnabled && !isSiteDisabled(new URL(sourceUrl).hostname, settings.disabledSites);
    } catch {
        return false;
    }
}

async function canMutateAdaptiveForSender(sender: chrome.runtime.MessageSender): Promise<boolean> {
    const sourceUrl = sender.tab?.url || sender.url || '';
    if (!/^https?:/i.test(sourceUrl)) return true;
    if (sender.tab?.incognito) return false;
    try {
        const hostname = new URL(sourceUrl).hostname;
        const stored = await chrome.storage.local.get({ blockedSites: [], adaptiveDisabledSites: [] });
        return (
            !isSiteDisabled(hostname, normalizeDisabledSites(stored.blockedSites)) &&
            !isSiteDisabled(hostname, normalizeDisabledSites(stored.adaptiveDisabledSites))
        );
    } catch {
        return false;
    }
}

async function canUseExtensionForSender(sender: chrome.runtime.MessageSender): Promise<boolean> {
    const sourceUrl = sender.tab?.url || sender.url || '';
    if (!/^https?:/i.test(sourceUrl)) return true;
    const stored = await chrome.storage.local.get({ blockedSites: [] });
    return isExtensionAllowedForUrl(sourceUrl, stored.blockedSites);
}

const initializationPromise = restoreSyncedSettings()
    .then(migrateSettings)
    .then(migrateApiKeyToSecretStore)
    .then(() => cleanupExpiredAiCacheLocally())
    .catch((error) => {
        logger.error('Background initialization error:', error);
    });
initializeSettingsSync();
initializeSiteAccess();

let settingsCache: Record<string, unknown> = {};
const cacheReady = initializationPromise
    .then(() => chrome.storage.local.get([...RUNTIME_SETTING_KEYS]))
    .then((all) => {
        settingsCache = pickRuntimeSettings(all || {});
    })
    .catch((error) => {
        logger.error('Failed to pre-cache settings in service worker:', error);
        settingsCache = {};
    });

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        for (const [key, { newValue }] of Object.entries(changes)) {
            if (!isRuntimeSettingKey(key)) continue;
            if (newValue === undefined) delete settingsCache[key];
            else settingsCache[key] = newValue;
        }
    }
});

export async function getCachedSettings(keys: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
        await cacheReady;
    } catch {
        // Fallback to direct read if cache failed
        try {
            return await chrome.storage.local.get(keys);
        } catch {
            return { ...keys };
        }
    }
    const result: Record<string, unknown> = {};
    const directKeys: string[] = [];
    for (const key of Object.keys(keys)) {
        if (isRuntimeSettingKey(key)) result[key] = settingsCache[key] !== undefined ? settingsCache[key] : keys[key];
        else directKeys.push(key);
    }
    if (directKeys.length) {
        try {
            const stored = await chrome.storage.local.get(directKeys);
            for (const key of directKeys) result[key] = stored[key] !== undefined ? stored[key] : keys[key];
        } catch {
            for (const key of directKeys) result[key] = keys[key];
        }
    }
    return result;
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        void chrome.storage.local
            .set({ onboardingCompleted: false })
            .then(() => chrome.runtime.openOptionsPage())
            .catch(() => undefined);
    }
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
            id: 'summary',
            title: `📑 ${t('summaryTitle', 'Выжимка')}`,
            contexts: ['selection'],
        });
        chrome.contextMenus.create({
            id: 'ocr',
            title: `📸 ${t('recognizeText', 'Распознать текст')} (Alt+S)`,
            contexts: ['page', 'image', 'selection'],
        });
    });
});

async function sendOcrCommand(tabId: number, windowId?: number): Promise<void> {
    try {
        await ensureContentScript(tabId);
    } catch (error) {
        logger.error('Не удалось запустить LexiSync на вкладке:', error);
        return;
    }
    const handleCapture = (dataUrl?: string) => {
        if (chrome.runtime.lastError || !dataUrl) {
            logger.error('Ошибка захвата экрана:', chrome.runtime.lastError);
            return;
        }
        void chrome.tabs
            .sendMessage(tabId, { action: 'startOcrMode', screenshotUrl: dataUrl })
            .catch((error) => logger.error('Не удалось открыть OCR на вкладке:', error));
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
    ).catch((error) => logger.error('Не удалось выполнить команду LexiSync:', error));
});

chrome.commands.onCommand.addListener((command, commandTab) => {
    void (async () => {
        const tab = commandTab?.id ? commandTab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (!tab?.id) return;
        if (command === 'ocr') {
            await sendOcrCommand(tab.id, tab.windowId);
            return;
        }
        const frameId = await findCommandTargetFrame(tab.id);
        await sendToTabWithInjection(tab.id, { action: 'hotkeyTriggered', mode: command }, frameId);
    })().catch((error) => logger.error('Не удалось выполнить горячую клавишу LexiSync:', error));
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'requestOcrCapture' && sender.tab?.id) {
        void sendOcrCommand(sender.tab.id, sender.tab.windowId);
    } else if (request.action === 'openHistory') {
        chrome.tabs.create({ url: chrome.runtime.getURL('lexisync-history.html') });
    } else if (request.action === 'openOptionsPage') {
        chrome.runtime.openOptionsPage();
    } else if (
        request.action === 'ensureOptionalContentFeature' &&
        sender.tab?.id &&
        (request.feature === 'adaptive' || request.feature === 'liveProofread' || request.feature === 'ocr')
    ) {
        void injectOptionalContentFeature(sender.tab.id, sender.frameId, request.feature)
            .then(() => sendResponse({ ok: true }))
            .catch((error) =>
                sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
        return true;
    } else if (request.action === 'getApiKey' || request.action === 'setApiKey') {
        const trustedSender = Boolean(sender.url?.startsWith(chrome.runtime.getURL('')));
        if (!trustedSender) {
            sendResponse({ ok: false, error: 'UNTRUSTED_SECRET_REQUEST' });
            return;
        }
        const operation =
            request.action === 'getApiKey'
                ? initializationPromise.then(getStoredApiKey).then((value) => ({ value }))
                : initializationPromise
                      .then(() => setStoredApiKey(typeof request.value === 'string' ? request.value : ''))
                      .then(() => ({ value: '' }));
        void operation
            .then((data) => sendResponse({ ok: true, ...data }))
            .catch((error) =>
                sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
        return true;
    } else if (request.action === 'getRuntimeSettings') {
        void initializationPromise
            .then(async () => {
                const [settings, apiKey] = await Promise.all([
                    getCachedSettings({
                        sendPageContext: false,
                        contextDisabledSites: [],
                        aiMode: 'quality',
                        selectedTone: 'business',
                        personalDictionary: [],
                        glossary: [],
                        styleProfiles: [],
                        activeStyleProfileId: '',
                        compactResultMode: null,
                        resultDisplayMode: '',
                    }),
                    getStoredApiKey(),
                ]);
                return { settings, apiKey };
            })
            .then(({ settings, apiKey }) => {
                const profiles = Array.isArray(settings.styleProfiles)
                    ? (settings.styleProfiles as StyleProfile[])
                    : [];
                const profile = resolveStyleProfile(
                    profiles,
                    String(settings.activeStyleProfileId || ''),
                    sender.tab?.url || sender.url,
                );
                sendResponse({
                    ok: true,
                    hasApiKey: apiKey.length > 0,
                    sendPageContext: settings.sendPageContext === true,
                    contextDisabledSites: settings.contextDisabledSites,
                    compactResultMode: settings.compactResultMode === true,
                    resultDisplayMode: ['auto', 'compact', 'detailed'].includes(String(settings.resultDisplayMode))
                        ? settings.resultDisplayMode
                        : settings.compactResultMode === true
                          ? 'compact'
                          : settings.compactResultMode === false
                            ? 'detailed'
                            : 'compact',
                    activeStyleProfileName: profile?.name || '',
                    cacheFingerprint: createSettingsFingerprint({
                        aiMode: settings.aiMode,
                        selectedTone: settings.selectedTone,
                        personalDictionary: settings.personalDictionary,
                        glossary: settings.glossary,
                        activeStyleProfile: profile,
                    }),
                });
            })
            .catch((error) =>
                sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
            );
        return true;
    } else if (request.action === 'storageMutation') {
        const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
        const privacyCheck =
            request.domain === 'history' || request.domain === 'cache'
                ? canStoreForSender(sender)
                : request.domain === 'adaptive'
                  ? canMutateAdaptiveForSender(sender)
                  : Promise.resolve(true);
        const mutation = privacyCheck.then((allowed) => {
            if (!allowed) return;
            if (request.domain === 'history') return applyHistoryMutation(request.mutation as HistoryMutation, payload);
            if (request.domain === 'usage') return applyUsageMutation(request.mutation as UsageMutation, payload);
            if (request.domain === 'cache') return applyCacheMutation(request.mutation as CacheMutation, payload);
            if (request.domain === 'adaptive')
                return applyAdaptiveMutation(request.mutation as AdaptiveMutation, payload);
            if (request.domain === 'settings')
                return applySettingsMutation(request.mutation as SettingsMutation, payload);
            throw new Error('UNKNOWN_STORAGE_DOMAIN');
        });
        void mutation
            .then((data) => sendResponse({ ok: true, data }))
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
                    sendResponse({
                        ok: false,
                        error: t('historyReplayPageMissing', 'Не найдена открытая веб-страница.'),
                    });
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
    return false;
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'mistralStream') return;

    let activeController: AbortController | null = null;
    let activeRequestId = 0;
    let disconnected = false;
    const cancelledControllers = new WeakSet<AbortController>();
    const safePostMessage = (message: object) => {
        if (disconnected) return;
        try {
            port.postMessage(message);
        } catch {
            disconnected = true;
        }
    };

    port.onDisconnect.addListener(() => {
        disconnected = true;
        activeController?.abort();
    });
    port.onMessage.addListener(async (message: unknown) => {
        if (message && typeof message === 'object' && (message as Partial<MistralRequest>).action === 'cancelMistral') {
            if (activeController) {
                cancelledControllers.add(activeController);
                activeController.abort();
            }
            return;
        }
        if (!message || typeof message !== 'object' || (message as Partial<MistralRequest>).action !== 'callMistral')
            return;
        try {
            validateMistralRequest(message);
        } catch (error) {
            safePostMessage({
                status: 'error',
                error: error instanceof Error ? error.message : t('requestInvalid', 'Некорректный запрос.'),
                retryable: false,
            });
            return;
        }
        if (!(await canUseExtensionForSender(port.sender ?? {}))) {
            activeController?.abort();
            safePostMessage({
                status: 'error',
                error: t('siteAccessDisabled', 'LexiSync отключён для этого сайта.'),
                retryable: false,
            });
            return;
        }
        const msg = message;

        activeController?.abort();
        const requestController = new AbortController();
        activeController = requestController;
        const requestId = ++activeRequestId;
        const isCurrentRequest = () => activeRequestId === requestId && !disconnected;
        const timeout = setTimeout(() => requestController.abort(), REQUEST_TIMEOUT_MS);
        const startedAt = Date.now();
        let completedSuccessfully = false;
        let budgetRejected = false;
        let servedFromCache = false;
        let cancelledBeforeReservation = false;
        let budgetReservationId = '';
        const inputTokens = estimateTokens(msg.text || msg.imageUrl || '');
        let outputText = '';

        try {
            await initializationPromise;
            const settings = await getCachedSettings({
                selectedTone: 'business',
                sendPageContext: false,
                personalDictionary: [],
                glossary: [],
                styleProfiles: [],
                activeStyleProfileId: '',
                aiMode: 'quality',
                contextDisabledSites: [],
                ...DEFAULT_BUDGET_SETTINGS,
            });
            if (!msg.mode) throw new Error(t('modeMissing', 'Режим обработки не указан.'));
            if (msg.mode === 'layout') {
                const result = fixKeyboardLayout(msg.text || '');
                if (isCurrentRequest()) {
                    safePostMessage({ status: 'chunk', text: result });
                    safePostMessage({ status: 'done' });
                }
                completedSuccessfully = true;
                return;
            }

            let ocrCacheKey = '';
            let canUseOcrCache = false;
            if (msg.mode === 'ocr') {
                canUseOcrCache = await canStoreForSender(port.sender ?? {});
                if (canUseOcrCache) {
                    ocrCacheKey = await getCacheHash('ocr', msg.imageUrl || '');
                    const cached = await getCachedText(ocrCacheKey);
                    if (cached !== null) {
                        servedFromCache = true;
                        completedSuccessfully = true;
                        try {
                            await applyUsageMutation('cacheHit', {});
                        } catch (error) {
                            logger.error('Не удалось учесть попадание в OCR-кэш:', error);
                        }
                        if (isCurrentRequest()) {
                            safePostMessage({ status: 'chunk', text: cached });
                            safePostMessage({ status: 'done' });
                        }
                        return;
                    }
                }
            }
            const apiKey = await getStoredApiKey();
            if (!apiKey) throw new Error(t('apiKeyMissing', 'API-ключ не настроен'));

            const budgetReservation = await reserveBudgetIfActive(
                {
                    dailyRequestLimit: Math.max(0, Number(settings.dailyRequestLimit) || 0),
                    monthlyTokenLimit: Math.max(0, Number(settings.monthlyTokenLimit) || 0),
                    warnLargeText: settings.warnLargeText !== false,
                    autoFastMode: settings.autoFastMode !== false,
                },
                inputTokens,
                requestController.signal,
            );
            if ('cancelled' in budgetReservation) {
                cancelledBeforeReservation = true;
                throw new DOMException(t('requestCancelled', 'Запрос отменён.'), 'AbortError');
            }
            if (budgetReservation.reason === 'daily') {
                budgetRejected = true;
                throw new Error(t('dailyBudgetReached', 'Достигнут дневной лимит запросов.'));
            }
            if (budgetReservation.reason === 'monthly') {
                budgetRejected = true;
                throw new Error(t('monthlyBudgetReached', 'Достигнут месячный лимит токенов.'));
            }
            budgetReservationId = budgetReservation.id || '';

            const styleProfiles = Array.isArray(settings.styleProfiles)
                ? (settings.styleProfiles as StyleProfile[])
                : [];
            const activeStyleProfile = resolveStyleProfile(
                styleProfiles,
                String(settings.activeStyleProfileId || ''),
                port.sender?.tab?.url || port.sender?.url || msg.pageUrl,
            );
            const senderUrl = port.sender?.tab?.url || port.sender?.url || '';
            let contextAllowedOnSite = true;
            if (/^https?:/i.test(senderUrl)) {
                try {
                    contextAllowedOnSite = !isSiteDisabled(
                        new URL(senderUrl).hostname,
                        normalizeDisabledSites(settings.contextDisabledSites),
                    );
                } catch {
                    contextAllowedOnSite = false;
                }
            }

            if (msg.mode === 'ocr') {
                const text = await processOcr(msg, apiKey, requestController.signal);
                if (isCurrentRequest()) safePostMessage({ status: 'chunk', text });
                outputText = text;
                if (canUseOcrCache) {
                    try {
                        await applyCacheMutation('set', { key: ocrCacheKey, value: text });
                    } catch (error) {
                        logger.error('Не удалось сохранить OCR-кэш:', error);
                    }
                }
            } else {
                await streamText(
                    msg,
                    apiKey,
                    {
                        selectedTone: settings.selectedTone as string,
                        sendPageContext:
                            settings.sendPageContext === true && msg.allowPageContext !== false && contextAllowedOnSite,
                        personalDictionary: Array.isArray(settings.personalDictionary)
                            ? settings.personalDictionary.map(String)
                            : [],
                        glossary: Array.isArray(settings.glossary) ? settings.glossary.map(String) : [],
                        activeStyleProfile,
                        aiMode:
                            settings.aiMode === 'fast' || (settings.autoFastMode !== false && inputTokens > 2500)
                                ? 'fast'
                                : 'quality',
                    },
                    requestController.signal,
                    (text) => {
                        outputText += text;
                        if (isCurrentRequest()) safePostMessage({ status: 'chunk', text });
                    },
                );
            }
            if (isCurrentRequest()) safePostMessage({ status: 'done' });
            completedSuccessfully = true;
        } catch (error) {
            if (!isCurrentRequest()) return;
            const isAbort = error instanceof DOMException && error.name === 'AbortError';
            if (isAbort) {
                const cancelledByUser = cancelledControllers.has(requestController);
                safePostMessage({
                    status: cancelledByUser ? 'cancelled' : 'error',
                    error: cancelledByUser
                        ? t('requestCancelled', 'Запрос отменён.')
                        : t('requestTimeout', 'Превышено время ожидания ответа (45 секунд).'),
                    retryable: !cancelledByUser,
                });
            } else {
                safePostMessage({
                    status: 'error',
                    error: formatMistralError(error),
                    retryable: isRetryableMistralError(error),
                });
            }
        } finally {
            clearTimeout(timeout);
            if (activeController === requestController) activeController = null;
            if (msg.mode && !budgetRejected && !servedFromCache && !cancelledBeforeReservation) {
                const usage = {
                    mode: msg.mode,
                    latencyMs: Date.now() - startedAt,
                    success: completedSuccessfully,
                    inputTokens,
                    outputTokens: estimateTokens(outputText),
                };
                if (budgetReservationId) void finalizeBudgetReservation(budgetReservationId, usage);
                else void applyUsageMutation('request', usage);
            }
        }
    });
});
