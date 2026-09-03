import { ICONS } from './icons';
import { getCachedText, getCacheHash, setCachedText } from './ai-cache';
import { t } from './i18n';
import { addHistoryItem, updateHistoryItemResult } from './history-store';
import { isSiteDisabled, normalizeDisabledSites, shouldStoreOnCurrentPage } from './privacy';
import { normalizeSpellcheckResult, renderSpellcheckDiffFragment } from './spellcheck';
import type { CustomCommand, HistoryItem, RequestMode, SelectionData, StreamResponse } from './types';
import { recordCacheHit } from './usage-stats';
import { createSvgIcon, renderMarkdown, setIcon } from './dom-rendering';
import { cleanMarkdownArtifacts, stripSummaryPrefix } from './markdown';
import { REQUEST_CACHE_VERSION, serializeCacheSource } from './request-cache';
import { createPortDisconnectGuard, createRequestLifecycle, type PortDisconnectGuard } from './request-lifecycle';
import { createBatchedUiUpdater, type BatchedUiUpdater } from './content-stream-renderer';
import { activateDialogKeyboard } from './content-dialog-accessibility';
import { normalizeResultDisplayMode, shouldUseCompactResult } from './result-display-mode';
import { createSpellcheckUi } from './content-spellcheck-ui';
import { renderPrimaryResultActions } from './content-result-actions';
import { formatRequestDuration } from './request-duration';
import { mountResultDialogFrame } from './result-dialog-view';
import { createLanguagePicker } from './content-language-picker';
import { formatTextStats, calculateDetailedStats } from './text-stats';
import { estimateTokens } from './budget';
import { logger } from './logger';
import {
    cycleCase,
    toSentenceCase,
    toLowerCase,
    toUpperCase,
    toTitleCase,
    toCamelCase,
    toSnakeCase,
} from './case-converter';
import { cleanText } from './text-cleaner';

export interface ContentRequestContext {
    getPopup: () => HTMLElement | null;
    getSelection: () => SelectionData;
    getTargetLanguage: () => string;
    setTargetLanguage: (language: string) => void;
    getLanguageName: (code: string) => string;
    getPopupElementById: <T extends HTMLElement>(id: string) => T | null;
    adjustPopupPosition: () => void;
    closePopup: () => void;
    startDragging: (offsetX: number, offsetY: number) => void;
    registerRequestCleanup: (cleanup: () => void) => void;
    isPinned?: () => boolean;
    setPinned?: (pinned: boolean) => void;
}

interface RequestExecutionOptions {
    bypassCache?: boolean;
}

export function handleActionClick(mode: RequestMode, context: ContentRequestContext): void {
    if (mode === 'translate') {
        const text = context.getSelection().text || '';
        const ruCount = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
        const enCount = (text.match(/[a-zA-Z]/g) || []).length;
        const targetLanguage =
            ruCount > 0 && ruCount >= enCount ? context.getLanguageName('en') : context.getLanguageName('ru');
        context.setTargetLanguage(targetLanguage);
    }
    void executeRequest(mode, undefined, context);
}

export function executeRequest(
    mode: RequestMode,
    customCommand: CustomCommand | undefined,
    context: ContentRequestContext,
    options: RequestExecutionOptions = {},
): void {
    const popupUI = context.getPopup();
    if (!popupUI) return;
    const currentSelection = context.getSelection();
    let currentTargetLang = context.getTargetLanguage();
    const { getLanguageName, adjustPopupPosition, closePopup, registerRequestCleanup } = context;
    const originalText = currentSelection.text;
    let streamPort: chrome.runtime.Port | null = null;
    let streamDisconnectGuard: PortDisconnectGuard | null = null;
    let streamUiUpdater: BatchedUiUpdater | null = null;
    let deactivateDialogKeyboard: (() => void) | null = null;
    let popupResizeObserver: ResizeObserver | null = null;

    function disconnectStreamPort(): void {
        const port = streamPort;
        streamPort = null;
        streamDisconnectGuard?.expectDisconnect();
        streamDisconnectGuard = null;
        try {
            port?.disconnect();
        } catch {
            // Порт уже мог закрыться вместе с фоновым процессом.
        }
    }

    const lifecycle = createRequestLifecycle(() => {
        streamUiUpdater?.cancel();
        deactivateDialogKeyboard?.();
        popupResizeObserver?.disconnect();
        popupResizeObserver = null;
        disconnectStreamPort();
    });
    registerRequestCleanup(() => lifecycle.dispose());

    popupUI.dataset.surface = 'result';
    delete popupUI.dataset.compactResult;
    popupUI.setAttribute('role', 'dialog');
    popupUI.setAttribute('aria-modal', 'true');
    popupUI.setAttribute('aria-label', t('resultDialog', 'Результат обработки текста'));
    popupUI.style.width = 'min(360px, calc(100vw - 24px))';
    popupUI.style.boxSizing = 'border-box';
    popupUI.style.padding = '0';
    popupUI.style.display = 'block';
    if (typeof ResizeObserver !== 'undefined') {
        popupResizeObserver = new ResizeObserver(() => {
            if (!lifecycle.disposed) adjustPopupPosition();
        });
        popupResizeObserver.observe(popupUI);
    }

    let headerLabel = '';
    let headerIcon = '';
    let headerEmoji = '';
    if (mode === 'spellcheck') headerLabel = t('spellcheckDone', 'Ошибки исправлены');
    else if (mode === 'style') {
        headerIcon = ICONS.style;
        headerLabel = t('styleChanged', 'Стиль изменён');
    } else if (mode === 'emoji') {
        headerIcon = ICONS.emoji;
        headerLabel = t('emojiVariants', 'Варианты с эмодзи');
    } else if (mode === 'layout') {
        headerIcon = ICONS.keyboard;
        headerLabel = t('layoutFixed', 'Раскладка исправлена');
    } else if (mode === 'translate') headerLabel = t('translation', 'Перевод');
    else if (mode === 'summary') {
        headerIcon = ICONS.summary;
        headerLabel = t('summaryTitle', 'Выжимка');
    } else if (mode === 'reply') {
        headerIcon = ICONS.reply;
        headerLabel = t('modeReplyFull', 'Ответ на сообщение');
    } else if (mode === 'explain') {
        headerIcon = ICONS.lightbulb;
        headerLabel = t('modeExplainFull', 'Объяснение простыми словами');
    } else if (mode === 'format') {
        headerIcon = ICONS.cleanFormat;
        headerLabel = t('modeFormatFull', 'Очистка и форматирование');
    } else if (mode === 'case_convert') {
        headerIcon = ICONS.caseConvert;
        headerLabel = t('caseConvertTitle', 'Смена регистра');
    } else if (mode === 'text_clean') {
        headerIcon = ICONS.textClean;
        headerLabel = t('textCleanTitle', 'Очистка текста');
    } else if (mode === 'ocr') {
        headerEmoji = '📸';
        headerLabel = t('ocrResult', 'Распознанный текст');
    } else if (mode === 'custom') {
        headerIcon = ICONS.style;
        headerLabel = customCommand?.name || t('myCommand', 'Моя команда');
    }

    const {
        header,
        headerTitle: headerTitleWrapper,
        headerControl: loaderOrClose,
        content: contentPane,
        compactDetails: compactCorrectionDetails,
        corrections: correctionsContainer,
        tools: resultTools,
        actions: actionsContainer,
        status: actionStatus,
    } = mountResultDialogFrame(popupUI);

    header.onmousedown = (e) => {
        const target = e.target as HTMLElement;
        if (
            target.closest('button') ||
            target.closest('svg') ||
            target.closest('div[style*="cursor: pointer"]') ||
            target.closest('#lexisync-lang-label')
        )
            return;
        header.style.cursor = 'grabbing';
        const rect = popupUI.getBoundingClientRect();
        context.startDragging(e.clientX - rect.left, e.clientY - rect.top);
        e.preventDefault();
    };

    if (mode === 'translate') {
        headerTitleWrapper.style.pointerEvents = 'auto';
        const langWrap = createLanguagePicker({
            currentLanguage: currentTargetLang,
            getLanguageName,
            onLanguageChange: (lang) => {
                currentTargetLang = lang;
                context.setTargetLanguage(lang);
                startStream();
            },
        });
        headerTitleWrapper.appendChild(langWrap);
    } else {
        if (headerIcon) headerTitleWrapper.appendChild(createSvgIcon(headerIcon));
        if (headerEmoji) headerTitleWrapper.appendChild(document.createTextNode(headerEmoji));
        headerTitleWrapper.appendChild(document.createTextNode(headerLabel));
    }

    if (originalText.length > 4000) {
        const tokenCount = estimateTokens(originalText);
        const tokenBadge = document.createElement('span');
        tokenBadge.className = 'lexisync-token-badge';
        tokenBadge.style.cssText =
            'font-size:10px;padding:2px 6px;border-radius:6px;background:var(--primary-soft);color:var(--primary-strong);margin-left:8px;font-weight:600;white-space:nowrap;';
        tokenBadge.textContent = `~${tokenCount} tok`;
        tokenBadge.title = `${originalText.length} симв. (~${tokenCount} токенов)`;
        headerTitleWrapper.appendChild(tokenBadge);
    }

    let requestTimerInterval: number | null = null;
    let requestStartTime = performance.now();

    function stopRequestTimer(): void {
        if (requestTimerInterval !== null) {
            window.clearInterval(requestTimerInterval);
            requestTimerInterval = null;
        }
    }

    function createTimerBadge(): HTMLElement {
        const timerBadge = document.createElement('span');
        timerBadge.className = 'lexisync-request-timer';
        timerBadge.setAttribute('role', 'timer');
        timerBadge.setAttribute('aria-live', 'off');
        timerBadge.textContent = '⏱️ 0.0s';
        return timerBadge;
    }

    loaderOrClose.appendChild(createTimerBadge());
    adjustPopupPosition();
    deactivateDialogKeyboard = activateDialogKeyboard(popupUI, closePopup, () => {
        const primaryBtn = actionsContainer.querySelector<HTMLButtonElement>('.lexisync-result-button--primary');
        if (primaryBtn && !primaryBtn.disabled) {
            primaryBtn.click();
            lifecycle.setTimeout(() => closePopup(), 700);
        }
    });

    let activeProvider: 'mistral' | 'groq' | null = mode === 'ocr' ? 'mistral' : null;

    function createProviderBadge(provider: 'mistral' | 'groq', isFallback = false): HTMLElement {
        const badge = document.createElement('span');
        badge.className = `lexisync-provider-badge lexisync-provider-${provider}`;
        const dot = document.createElement('span');
        dot.className = `lexisync-provider-dot ${isFallback ? 'dot-degraded' : 'dot-healthy'}`;
        badge.appendChild(dot);
        const text = document.createElement('span');
        if (provider === 'groq') {
            text.textContent = '⚡ Groq';
            badge.title = isFallback ? 'Groq (резервный) • Qwen 3.6 27B' : 'Groq • Qwen 3.6 27B';
        } else {
            text.textContent = '✦ Mistral';
            badge.title = isFallback ? 'Mistral (резервный) • Mistral AI' : 'Mistral AI';
        }
        badge.appendChild(text);
        return badge;
    }

    let fullResult = '';
    let compactResultMode = false;
    let comparisonOriginalVisible = false;
    let editedResultSnapshot = '';
    let usePageContext = false;
    let storageAllowed = false;
    let cacheSettingsFingerprint = 'default';
    let savedHistoryId: number | null = null;
    let requestStartedAt: number | null = null;
    const spellcheckUi = createSpellcheckUi({
        contentPane,
        correctionsContainer,
        compactDetails: compactCorrectionDetails,
        isCompact: () => compactResultMode,
        adjustPosition: adjustPopupPosition,
        onResultChange: (result) => {
            if (storageAllowed && savedHistoryId !== null) void updateHistoryItemResult(savedHistoryId, result);
        },
    });

    streamUiUpdater = createBatchedUiUpdater(() => {
        if (lifecycle.disposed) return;
        let display = cleanMarkdownArtifacts(fullResult);
        if (mode === 'summary') display = stripSummaryPrefix(display);
        if (compactResultMode) contentPane.textContent = display;
        else renderMarkdown(contentPane, display);
        contentPane.setAttribute('aria-live', 'polite');
        contentPane.scrollTop = contentPane.scrollHeight;
        adjustPopupPosition();
    });

    function applyCompactResultLayout(): void {
        const currentPopup = context.getPopup();
        if (currentPopup) {
            currentPopup.dataset.compactResult = 'true';
            currentPopup.style.width = 'min(360px, calc(100vw - 24px))';
            currentPopup.style.boxSizing = 'border-box';
        }
        correctionsContainer.replaceChildren();
        correctionsContainer.hidden = true;
        correctionsContainer.style.display = 'none';
        resultTools.replaceChildren();
        resultTools.hidden = true;
        resultTools.style.display = 'none';
    }

    function getCacheSource(): string {
        return serializeCacheSource({
            text: currentSelection.text,
            context: usePageContext ? currentSelection.context : '',
            pageTitle: usePageContext ? document.title : '',
            pageOrigin: usePageContext ? location.origin : '',
            customPrompt: customCommand?.prompt || '',
        });
    }

    function getEffectiveResult(): string {
        if (comparisonOriginalVisible && editedResultSnapshot) return editedResultSnapshot;
        if (contentPane.contentEditable === 'true') return contentPane.innerText.trim();
        let base = cleanMarkdownArtifacts(fullResult);
        if (mode === 'summary') base = stripSummaryPrefix(base);
        return mode === 'spellcheck' ? spellcheckUi.getResult(base) : base;
    }

    function showActionStatus(message: string, isError = false): void {
        actionStatus.textContent = message;
        actionStatus.dataset.error = String(isError);
        actionStatus.dataset.compactAnnouncement = String(compactResultMode && !isError);
        actionStatus.hidden = false;
        adjustPopupPosition();
        lifecycle.setTimeout(() => {
            actionStatus.hidden = true;
            delete actionStatus.dataset.compactAnnouncement;
            adjustPopupPosition();
        }, 2500);
    }

    function showRequestError(message: string, retryable = false): void {
        streamUiUpdater?.cancel();
        const errorContainer = document.createElement('div');
        errorContainer.className = 'lexisync-error-box';
        errorContainer.style.cssText = 'padding: 8px 0; color: var(--error-color);';

        const errorText = document.createElement('div');
        errorText.style.cssText = 'margin-bottom: 10px; line-height: 1.45; font-size: 13px;';
        errorText.textContent = `${t('errorPrefix', 'Ошибка:')} ${message}`;
        errorContainer.appendChild(errorText);

        if (retryable) {
            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.id = 'retryRequestBtn';
            retryButton.style.cssText =
                'background: var(--primary); color: #ffffff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500;';
            retryButton.textContent = t('retryRequest', 'Повторить попытку');
            retryButton.onclick = () => {
                if (lifecycle.disposed) return;
                contentPane.replaceChildren();
                contentPane.style.color = '';
                startStream();
            };
            errorContainer.appendChild(retryButton);
        }

        contentPane.style.color = '';
        contentPane.replaceChildren(errorContainer);
        finishStream(false);
    }

    contentPane.addEventListener('input', () => {
        if (storageAllowed && savedHistoryId !== null && contentPane.contentEditable === 'true') {
            void updateHistoryItemResult(savedHistoryId, getEffectiveResult());
        }
    });

    function renderLoadingControl(): void {
        stopRequestTimer();
        loaderOrClose.replaceChildren();
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; align-items:center; gap:6px;';

        const timerBadge = createTimerBadge();
        requestStartTime = performance.now();
        requestTimerInterval = window.setInterval(() => {
            if (lifecycle.disposed) {
                stopRequestTimer();
                return;
            }
            const elapsed = (performance.now() - requestStartTime) / 1000;
            timerBadge.textContent = `⏱️ ${elapsed.toFixed(1)}s`;
        }, 100);

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'lexisync-cancel-button';
        cancelBtn.title = t('cancelRequest', 'Отменить запрос');
        cancelBtn.setAttribute('aria-label', t('cancelRequest', 'Отменить запрос'));
        setIcon(cancelBtn, ICONS.closeStandard);
        cancelBtn.style.cssText =
            'display:flex; align-items:center; justify-content:center; padding:4px; border:0; border-radius:6px; background:transparent; color:var(--text-secondary); cursor:pointer;';
        cancelBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            stopRequestTimer();
            cancelBtn.disabled = true;
            contentPane.textContent = t('cancelling', 'Отменяем запрос…');
            if (!streamPort) {
                showRequestError(
                    t('requestConnectionLost', 'Соединение с обработчиком запроса прервано. Повторите попытку.'),
                    true,
                );
                return;
            }
            try {
                streamPort.postMessage({ action: 'cancelMistral' });
            } catch {
                showRequestError(t('reloadPage', 'Пожалуйста, обновите страницу (F5).'));
            }
        };
        wrapper.append(timerBadge, cancelBtn);
        loaderOrClose.appendChild(wrapper);
    }

    function startStream() {
        if (lifecycle.disposed) return;
        streamUiUpdater?.cancel();
        disconnectStreamPort();
        fullResult = '';
        comparisonOriginalVisible = false;
        editedResultSnapshot = '';
        contentPane.contentEditable = 'false';
        contentPane.removeAttribute('contenteditable');
        resultTools.style.display = 'none';
        const skeleton = document.createElement('div');
        skeleton.className = 'lexisync-skeleton';
        skeleton.setAttribute('role', 'status');
        skeleton.setAttribute('aria-label', t('processing', 'LexiSync обрабатывает текст'));
        for (let index = 0; index < 3; index++) {
            const line = document.createElement('span');
            line.className = 'lexisync-skeleton-line';
            skeleton.appendChild(line);
        }
        contentPane.replaceChildren(skeleton);
        if (mode === 'case_convert') {
            fullResult = cycleCase(originalText);
            if (compactResultMode) contentPane.textContent = fullResult;
            else renderMarkdown(contentPane, fullResult);
            finishStream(true);
            showActionStatus(t('doneLocal', '✓ Выполнено локально'));
            return;
        }

        if (mode === 'text_clean') {
            fullResult = cleanText(originalText);
            if (compactResultMode) contentPane.textContent = fullResult;
            else renderMarkdown(contentPane, fullResult);
            finishStream(true);
            showActionStatus(t('doneLocal', '✓ Выполнено локально'));
            return;
        }

        contentPane.style.color = '';
        actionsContainer.style.display = 'none';
        renderLoadingControl();

        if (!navigator.onLine && mode !== 'layout') {
            contentPane.textContent = t(
                'offlineError',
                'Нет подключения к интернету. Проверьте сеть и попробуйте снова.',
            );
            contentPane.style.color = 'var(--error-color)';
            finishStream(false);
            return;
        }

        if (currentSelection.text.length > 3000) {
            contentPane.textContent = t(
                'textTooLong',
                'Текст слишком длинный. Выделите не более 3000 символов за раз.',
            );
            contentPane.style.color = 'var(--error-color)';
            finishStream(false);
            return;
        }

        if (!chrome.runtime || !chrome.runtime.connect) {
            showRequestError(t('reloadPage', 'Пожалуйста, обновите страницу (F5).'));
            return;
        }

        let requestPort: chrome.runtime.Port;
        try {
            requestPort = chrome.runtime.connect({ name: 'mistralStream' });
        } catch {
            showRequestError(t('reloadPage', 'Пожалуйста, обновите страницу (F5).'));
            return;
        }
        streamPort = requestPort;
        const disconnectGuard = createPortDisconnectGuard(() => {
            if (lifecycle.disposed || streamPort !== requestPort) return;
            streamPort = null;
            streamDisconnectGuard = null;
            requestStartedAt = null;
            const runtimeError = chrome.runtime.lastError?.message || '';
            const extensionContextInvalidated = /extension context invalidated/iu.test(runtimeError);
            showRequestError(
                extensionContextInvalidated
                    ? t('reloadPage', 'Пожалуйста, обновите страницу (F5).')
                    : t('requestConnectionLost', 'Соединение с обработчиком запроса прервано. Повторите попытку.'),
                !extensionContextInvalidated,
            );
        });
        streamDisconnectGuard = disconnectGuard;
        requestPort.onDisconnect.addListener(() => disconnectGuard.handleDisconnect());
        requestStartedAt = performance.now();
        try {
            requestPort.postMessage({
                action: 'callMistral',
                text: currentSelection.text,
                context: currentSelection.context,
                mode: mode,
                targetLang: currentTargetLang,
                pageTitle: document.title,
                pageUrl: window.location.hostname,
                allowPageContext: usePageContext,
                customPrompt: customCommand?.prompt,
                imageUrl: currentSelection.imageUrl, // 🔥 НОВОЕ
            });
        } catch (error) {
            const extensionContextInvalidated =
                error instanceof Error && /extension context invalidated/iu.test(error.message);
            showRequestError(
                extensionContextInvalidated
                    ? t('reloadPage', 'Пожалуйста, обновите страницу (F5).')
                    : t('requestConnectionLost', 'Соединение с обработчиком запроса прервано. Повторите попытку.'),
                !extensionContextInvalidated,
            );
            return;
        }
        requestPort.onMessage.addListener((response: StreamResponse) => {
            if (lifecycle.disposed) return;
            if (response.status === 'chunk') {
                fullResult += response.text;
                streamUiUpdater?.request();
            } else if (response.status === 'reset') {
                fullResult = '';
                contentPane.replaceChildren();
                streamUiUpdater?.request();
            } else if (response.status === 'done') {
                if (response.provider) {
                    activeProvider = response.provider;
                }
                streamUiUpdater?.cancel();
                fullResult = cleanMarkdownArtifacts(fullResult);
                if (mode === 'summary') {
                    fullResult = stripSummaryPrefix(fullResult);
                }
                if (mode === 'spellcheck') {
                    fullResult = normalizeSpellcheckResult(fullResult);
                    spellcheckUi.setResult(currentSelection.text, fullResult);
                } else if (compactResultMode) {
                    contentPane.textContent = fullResult;
                } else {
                    renderMarkdown(contentPane, fullResult);
                }
                contentPane.removeAttribute('aria-live');
                finishStream(true, Boolean(response.fallbackNotification));
                if (requestStartedAt !== null) {
                    const duration = formatRequestDuration(performance.now() - requestStartedAt);
                    requestStartedAt = null;
                    const stats = formatTextStats(originalText, fullResult, {
                        words: t('statsWords', 'слов'),
                        chars: t('statsChars', 'симв.'),
                        minShort: t('statsMinutesShort', 'мин'),
                    });
                    const durationText = t('requestCompletedIn', 'Ready in $1 s').replace('$1', duration);
                    const baseStatus = stats ? `${durationText} • ${stats}` : durationText;
                    showActionStatus(
                        response.fallbackNotification
                            ? `⚡ ${response.fallbackNotification} • ${durationText}`
                            : baseStatus,
                    );
                    const detailed = calculateDetailedStats(fullResult);
                    const readabilityText =
                        detailed.readabilityLevel === 'easy'
                            ? t('readabilityEasy', 'Легко читается')
                            : detailed.readabilityLevel === 'medium'
                              ? t('readabilityMedium', 'Оптимально')
                              : t('readabilityHard', 'Сложный текст');
                    actionStatus.title = `${t('charsNoSpaces', 'Символов без пробелов')}: ${detailed.charsNoSpaces} | ${t('sentences', 'Предложений')}: ${detailed.sentences} | ${t('readabilityScore', 'Читаемость')}: ${detailed.readabilityScore}/100 (${readabilityText})`;
                }

                const historyItem: HistoryItem = {
                    id: Date.now(),
                    mode,
                    original: currentSelection.text,
                    result: getEffectiveResult(),
                    date: new Date().toISOString(),
                    customName: customCommand?.name,
                };

                if (storageAllowed) {
                    const baseCacheMode =
                        mode === 'translate'
                            ? mode + currentTargetLang
                            : mode === 'custom'
                              ? `custom:${customCommand?.id || 'unknown'}`
                              : mode;
                    const cacheModeKey = `v${REQUEST_CACHE_VERSION}:${baseCacheMode}:${cacheSettingsFingerprint}`;
                    void getCacheHash(cacheModeKey, getCacheSource())
                        .then((cacheKey) => setCachedText(cacheKey, fullResult))
                        .catch((error) => logger.error('Ошибка сохранения кэша:', error));
                    void addHistoryItem(historyItem)
                        .then(() => {
                            savedHistoryId = historyItem.id;
                        })
                        .catch((error) => logger.error('Ошибка сохранения истории:', error));
                }
            } else if (response.status === 'error') {
                requestStartedAt = null;
                const errorMessage =
                    typeof response.error === 'string' ? response.error : t('unknownError', 'Неизвестная ошибка.');
                showRequestError(errorMessage, response.retryable === true);
            } else if (response.status === 'cancelled') {
                requestStartedAt = null;
                streamUiUpdater?.cancel();
                contentPane.textContent = t('requestCancelled', 'Запрос отменён.');
                contentPane.style.color = 'var(--text-secondary)';
                finishStream(false);
            }
        });
    }

    function finishStream(success = true, isFallback = false) {
        stopRequestTimer();
        disconnectStreamPort();
        loaderOrClose.replaceChildren();
        if (activeProvider) {
            loaderOrClose.appendChild(createProviderBadge(activeProvider, isFallback));
        }

        const pinBtn = document.createElement('button');
        pinBtn.type = 'button';
        pinBtn.className = 'lexisync-pin-button';
        pinBtn.id = 'lexisyncPinBtn';
        const updatePinVisual = () => {
            const isPinned = context.isPinned?.() || false;
            pinBtn.setAttribute('aria-pressed', String(isPinned));
            pinBtn.title = isPinned
                ? t('unpinPanel', 'Открепить окно')
                : t('pinPanel', 'Закрепить окно на экране (не закрывать при клике мимо)');
            if (isPinned) {
                pinBtn.style.color = 'var(--accent, #6366F1)';
                pinBtn.style.background = 'rgba(99, 102, 241, 0.15)';
            } else {
                pinBtn.style.color = 'var(--text-secondary)';
                pinBtn.style.background = 'transparent';
            }
        };
        setIcon(pinBtn, ICONS.pin);
        pinBtn.style.cssText =
            'cursor: pointer; display: flex; align-items: center; padding: 6px; border-radius: 8px; transition: background 0.15s, color 0.15s; border: none; margin-right: 2px;';
        pinBtn.onmouseover = () => {
            if (!context.isPinned?.()) pinBtn.style.background = 'var(--hover-bg)';
        };
        pinBtn.onmouseout = () => {
            if (!context.isPinned?.()) pinBtn.style.background = 'transparent';
        };
        pinBtn.onclick = (e) => {
            e.stopPropagation();
            const next = !(context.isPinned?.() || false);
            context.setPinned?.(next);
            updatePinVisual();
        };
        updatePinVisual();
        loaderOrClose.appendChild(pinBtn);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'lexisync-close-button';
        closeBtn.setAttribute('aria-label', t('closePanel', 'Закрыть панель'));
        setIcon(closeBtn, ICONS.closeStandard);
        closeBtn.style.cssText =
            'cursor: pointer; display: flex; align-items: center; margin-right: -4px; padding: 6px; border-radius: 8px; color: var(--text-secondary); transition: background 0.15s;';
        closeBtn.onmouseover = () => (closeBtn.style.background = 'var(--hover-bg)');
        closeBtn.onmouseout = () => (closeBtn.style.background = 'transparent');
        closeBtn.onclick = closePopup;
        loaderOrClose.appendChild(closeBtn);

        if (success && fullResult.trim().length > 0) {
            if (!compactResultMode && mode !== 'spellcheck') {
                contentPane.contentEditable = 'true';
                contentPane.setAttribute('aria-label', t('editableResult', 'Результат можно редактировать'));
                resultTools.style.display = 'flex';
                editedResultSnapshot = getEffectiveResult();
                const createTool = (label: string, action: () => void): HTMLButtonElement => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'lexisync-tool-chip';
                    button.textContent = label;
                    button.onclick = action;
                    return button;
                };
                const tools: HTMLButtonElement[] = [];
                if (mode !== 'ocr') {
                    let compareState: 'result' | 'diff' | 'original' = 'result';
                    const compareButton = createTool(t('compareChanges', 'Сравнить'), () => {
                        if (compareState === 'result') {
                            editedResultSnapshot = getEffectiveResult();
                            contentPane.contentEditable = 'false';
                            contentPane.replaceChildren(
                                renderSpellcheckDiffFragment(originalText, editedResultSnapshot),
                            );
                            compareButton.textContent = t('showOriginal', 'Оригинал');
                            compareState = 'diff';
                        } else if (compareState === 'diff') {
                            contentPane.replaceChildren();
                            contentPane.textContent = originalText;
                            contentPane.contentEditable = 'false';
                            compareButton.textContent = t('showResult', 'Результат');
                            compareState = 'original';
                        } else {
                            contentPane.replaceChildren();
                            renderMarkdown(contentPane, editedResultSnapshot);
                            contentPane.contentEditable = 'true';
                            compareButton.textContent = t('compareChanges', 'Сравнить');
                            compareState = 'result';
                        }
                    });
                    tools.push(compareButton);

                    let isSplitView = false;
                    const splitButton = createTool(t('splitView', 'Сплит'), () => {
                        isSplitView = !isSplitView;
                        if (isSplitView) {
                            editedResultSnapshot = getEffectiveResult();
                            contentPane.contentEditable = 'false';
                            contentPane.replaceChildren();

                            const splitContainer = document.createElement('div');
                            splitContainer.className = 'lexisync-split-container';

                            const leftPane = document.createElement('div');
                            leftPane.className = 'lexisync-split-pane';
                            const leftTitle = document.createElement('div');
                            leftTitle.className = 'lexisync-split-title';
                            leftTitle.textContent = t('originalText', 'Оригинал');
                            const leftContent = document.createElement('div');
                            leftContent.className = 'lexisync-split-content';
                            leftContent.textContent = originalText;
                            leftPane.append(leftTitle, leftContent);

                            const rightPane = document.createElement('div');
                            rightPane.className = 'lexisync-split-pane';
                            const rightTitle = document.createElement('div');
                            rightTitle.className = 'lexisync-split-title';
                            rightTitle.textContent = t('resultText', 'Результат');
                            const rightContent = document.createElement('div');
                            rightContent.className = 'lexisync-split-content';
                            rightContent.contentEditable = 'true';
                            rightContent.textContent = editedResultSnapshot;
                            rightContent.oninput = () => {
                                editedResultSnapshot = rightContent.textContent || '';
                            };
                            rightPane.append(rightTitle, rightContent);

                            // Синхронная прокрутка
                            let syncing = false;
                            leftPane.onscroll = () => {
                                if (syncing) return;
                                syncing = true;
                                const ratio = leftPane.scrollTop / (leftPane.scrollHeight - leftPane.clientHeight || 1);
                                rightPane.scrollTop = ratio * (rightPane.scrollHeight - rightPane.clientHeight);
                                syncing = false;
                            };
                            rightPane.onscroll = () => {
                                if (syncing) return;
                                syncing = true;
                                const ratio =
                                    rightPane.scrollTop / (rightPane.scrollHeight - rightPane.clientHeight || 1);
                                leftPane.scrollTop = ratio * (leftPane.scrollHeight - leftPane.clientHeight);
                                syncing = false;
                            };

                            splitContainer.append(leftPane, rightPane);
                            contentPane.appendChild(splitContainer);
                            splitButton.textContent = t('standardView', 'Обычно');
                            splitButton.style.background = 'var(--accent, #6366f1)';
                            splitButton.style.color = '#ffffff';
                        } else {
                            contentPane.replaceChildren();
                            renderMarkdown(contentPane, editedResultSnapshot);
                            contentPane.contentEditable = 'true';
                            splitButton.textContent = t('splitView', 'Сплит');
                            splitButton.style.background = '';
                            splitButton.style.color = '';
                        }
                    });
                    tools.push(splitButton);

                    let findReplaceBar: HTMLElement | null = null;
                    const findReplaceButton = createTool(t('findAndReplace', '🔍 Поиск'), () => {
                        if (findReplaceBar) {
                            findReplaceBar.remove();
                            findReplaceBar = null;
                            findReplaceButton.style.background = '';
                            findReplaceButton.style.color = '';
                            return;
                        }
                        findReplaceBar = document.createElement('div');
                        findReplaceBar.className = 'lexisync-find-replace-bar';

                        const findInput = document.createElement('input');
                        findInput.className = 'lexisync-find-input';
                        findInput.placeholder = t('findPlaceholder', 'Найти...');

                        const replaceInput = document.createElement('input');
                        replaceInput.className = 'lexisync-find-input';
                        replaceInput.placeholder = t('replacePlaceholder', 'Заменить на...');

                        const countLabel = document.createElement('span');
                        countLabel.className = 'lexisync-find-count';

                        const updateMatchCount = () => {
                            const query = findInput.value;
                            if (!query) {
                                countLabel.textContent = '';
                                return;
                            }
                            const text = getEffectiveResult();
                            const matches = (
                                text.match(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []
                            ).length;
                            countLabel.textContent = `${matches} совп.`;
                        };
                        findInput.oninput = updateMatchCount;

                        const replaceBtn = document.createElement('button');
                        replaceBtn.type = 'button';
                        replaceBtn.className = 'lexisync-find-btn';
                        replaceBtn.textContent = t('replaceOne', 'Заменить');
                        replaceBtn.onclick = () => {
                            const query = findInput.value;
                            if (!query) return;
                            const text = getEffectiveResult();
                            const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                            const next = text.replace(regex, replaceInput.value);
                            editedResultSnapshot = next;
                            contentPane.replaceChildren();
                            renderMarkdown(contentPane, next);
                            contentPane.contentEditable = 'true';
                            updateMatchCount();
                        };

                        const replaceAllBtn = document.createElement('button');
                        replaceAllBtn.type = 'button';
                        replaceAllBtn.className = 'lexisync-find-btn';
                        replaceAllBtn.textContent = t('replaceAll', 'Все');
                        replaceAllBtn.onclick = () => {
                            const query = findInput.value;
                            if (!query) return;
                            const text = getEffectiveResult();
                            const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                            const next = text.replace(regex, replaceInput.value);
                            editedResultSnapshot = next;
                            contentPane.replaceChildren();
                            renderMarkdown(contentPane, next);
                            contentPane.contentEditable = 'true';
                            updateMatchCount();
                        };

                        const closeFindBtn = document.createElement('button');
                        closeFindBtn.type = 'button';
                        closeFindBtn.className = 'lexisync-find-btn';
                        closeFindBtn.textContent = '✕';
                        closeFindBtn.title = t('close', 'Закрыть');
                        closeFindBtn.onclick = () => {
                            findReplaceBar?.remove();
                            findReplaceBar = null;
                            findReplaceButton.style.background = '';
                            findReplaceButton.style.color = '';
                        };

                        findReplaceBar.append(
                            findInput,
                            replaceInput,
                            replaceBtn,
                            replaceAllBtn,
                            countLabel,
                            closeFindBtn,
                        );
                        contentPane.parentElement?.insertBefore(findReplaceBar, contentPane);
                        findReplaceButton.style.background = 'var(--accent, #6366f1)';
                        findReplaceButton.style.color = '#ffffff';
                        findInput.focus();
                    });
                    tools.push(findReplaceButton);
                }
                const refine = (name: string, prompt: string) => {
                    const source = getEffectiveResult();
                    currentSelection.text = source;
                    currentSelection.context = source;
                    void executeRequest('custom', { id: `refine-${name}`, name, prompt }, context);
                };
                if (mode === 'reply') {
                    tools.push(
                        createTool(
                            t('repeat', 'Повторить'),
                            () => void executeRequest(mode, customCommand, context, { bypassCache: true }),
                        ),
                        createTool(t('chipAgree', 'Согласиться'), () =>
                            refine(
                                t('chipAgree', 'Согласиться'),
                                t('refineAgreePrompt', 'Перепиши ответ в тоне согласия, готовности и подтверждения.'),
                            ),
                        ),
                        createTool(t('chipDecline', 'Отказать'), () =>
                            refine(
                                t('chipDecline', 'Отказать'),
                                t(
                                    'refineDeclinePrompt',
                                    'Перепиши ответ в тоне вежливого, тактичного и аргументированного отказа.',
                                ),
                            ),
                        ),
                        createTool(t('chipClarify', 'Уточнить'), () =>
                            refine(
                                t('chipClarify', 'Уточнить'),
                                t(
                                    'refineClarifyPrompt',
                                    'Перепиши ответ с вежливым уточнением ключевых деталей, требований или сроков.',
                                ),
                            ),
                        ),
                        createTool(t('chipAlternative', 'Альтернатива'), () =>
                            refine(
                                t('chipAlternative', 'Альтернатива'),
                                t(
                                    'refineAlternativePrompt',
                                    'Перепиши ответ с предложением удобной альтернативы или другого решения/времени.',
                                ),
                            ),
                        ),
                        createTool(t('shorter', 'Короче'), () =>
                            refine(
                                t('refineShortName', 'Сделать короче'),
                                t('presetShortPrompt', 'Сократи текст, сохранив ключевые факты и исходный смысл.'),
                            ),
                        ),
                    );
                } else if (mode === 'explain') {
                    tools.push(
                        createTool(
                            t('repeat', 'Повторить'),
                            () => void executeRequest(mode, customCommand, context, { bypassCache: true }),
                        ),
                        createTool(t('chipSimpler', 'Ещё проще'), () =>
                            refine(
                                t('chipSimpler', 'Ещё проще'),
                                t(
                                    'refineSimplerPrompt',
                                    'Объясни ещё более простыми словами, на понятных бытовых примерах без терминов.',
                                ),
                            ),
                        ),
                        createTool(t('chipExamples', 'С примерами'), () =>
                            refine(
                                t('chipExamples', 'С примерами'),
                                t(
                                    'refineExamplesPrompt',
                                    'Добавь наглядные практические примеры использования из реальной жизни.',
                                ),
                            ),
                        ),
                        createTool(t('shorter', 'Короче'), () =>
                            refine(
                                t('refineShortName', 'Сделать короче'),
                                t('presetShortPrompt', 'Сократи текст, сохранив ключевые факты и исходный смысл.'),
                            ),
                        ),
                    );
                } else if (mode === 'case_convert') {
                    tools.push(
                        createTool(t('caseSentence', 'В предложениях'), () => {
                            fullResult = toSentenceCase(originalText);
                            contentPane.textContent = fullResult;
                            editedResultSnapshot = fullResult;
                        }),
                        createTool(t('caseLower', 'строчные'), () => {
                            fullResult = toLowerCase(originalText);
                            contentPane.textContent = fullResult;
                            editedResultSnapshot = fullResult;
                        }),
                        createTool(t('caseUpper', 'ЗАГЛАВНЫЕ'), () => {
                            fullResult = toUpperCase(originalText);
                            contentPane.textContent = fullResult;
                            editedResultSnapshot = fullResult;
                        }),
                        createTool(t('caseTitle', 'С Заглавной'), () => {
                            fullResult = toTitleCase(originalText);
                            contentPane.textContent = fullResult;
                            editedResultSnapshot = fullResult;
                        }),
                        createTool('camelCase', () => {
                            fullResult = toCamelCase(originalText);
                            contentPane.textContent = fullResult;
                            editedResultSnapshot = fullResult;
                        }),
                        createTool('snake_case', () => {
                            fullResult = toSnakeCase(originalText);
                            contentPane.textContent = fullResult;
                            editedResultSnapshot = fullResult;
                        }),
                    );
                } else if (mode === 'text_clean') {
                    tools.push(
                        createTool(t('cleanAll', 'Всё'), () => {
                            fullResult = cleanText(originalText);
                            contentPane.textContent = fullResult;
                            editedResultSnapshot = fullResult;
                        }),
                        createTool(t('cleanSpaces', 'Только пробелы'), () => {
                            fullResult = cleanText(originalText, { typography: false, fixLineBreaks: false });
                            contentPane.textContent = fullResult;
                            editedResultSnapshot = fullResult;
                        }),
                        createTool(t('cleanTypography', 'Типографика'), () => {
                            fullResult = cleanText(originalText, { collapseSpaces: false, fixLineBreaks: false });
                            contentPane.textContent = fullResult;
                            editedResultSnapshot = fullResult;
                        }),
                    );
                } else {
                    tools.push(
                        createTool(
                            t('repeat', 'Повторить'),
                            () => void executeRequest(mode, customCommand, context, { bypassCache: true }),
                        ),
                        createTool(t('chipPolite', 'Вежливее'), () =>
                            refine(
                                t('chipPolite', 'Вежливее'),
                                t(
                                    'refinePolitePrompt',
                                    'Перепиши текст в максимально вежливом, тактичном и доброжелательном тоне.',
                                ),
                            ),
                        ),
                        createTool(t('moreFormal', 'Формальнее'), () =>
                            refine(
                                t('refineFormalName', 'Сделать формальнее'),
                                t('refineFormalPrompt', 'Перепиши текст в более формальном и профессиональном стиле.'),
                            ),
                        ),
                        createTool(t('shorter', 'Короче'), () =>
                            refine(
                                t('refineShortName', 'Сделать короче'),
                                t('presetShortPrompt', 'Сократи текст, сохранив ключевые факты и исходный смысл.'),
                            ),
                        ),
                        createTool(t('chipSimple', 'Проще'), () =>
                            refine(
                                t('chipSimple', 'Проще'),
                                t(
                                    'refineSimplePrompt',
                                    'Перепиши текст простым и понятным языком, убрав сложные обороты и канцеляризмы.',
                                ),
                            ),
                        ),
                        createTool(t('longer', 'Подробнее'), () =>
                            refine(
                                t('refineLongName', 'Сделать подробнее'),
                                t(
                                    'refineLongPrompt',
                                    'Раскрой текст подробнее, добавив полезные пояснения без лишней воды.',
                                ),
                            ),
                        ),
                    );
                }
                resultTools.replaceChildren(...tools);
            }
            renderPrimaryResultActions({
                mode,
                selection: currentSelection,
                actionsContainer,
                headerTitle: headerTitleWrapper,
                getResult: getEffectiveResult,
                showStatus: showActionStatus,
                setTimeout: (callback, delay) => lifecycle.setTimeout(callback, delay),
            });
        }
        adjustPopupPosition();
    }

    async function checkCacheAndRun() {
        const runtimeSettings = await chrome.runtime.sendMessage({ action: 'getRuntimeSettings' });
        const res = runtimeSettings as {
            ok?: boolean;
            error?: unknown;
            hasApiKey?: boolean;
            sendPageContext?: boolean;
            contextDisabledSites?: unknown;
            cacheFingerprint?: string;
            resultDisplayMode?: unknown;
            compactResultMode?: boolean;
        };
        if (res.ok === false)
            throw new Error(typeof res.error === 'string' ? res.error : 'RUNTIME_SETTINGS_UNAVAILABLE');
        if (lifecycle.disposed) return;
        compactResultMode = shouldUseCompactResult(
            normalizeResultDisplayMode(res.resultDisplayMode, res.compactResultMode),
            mode,
        );
        if (compactResultMode) applyCompactResultLayout();
        usePageContext =
            res.sendPageContext === true &&
            !isSiteDisabled(location.hostname, normalizeDisabledSites(res.contextDisabledSites));
        cacheSettingsFingerprint = res.cacheFingerprint || 'default';
        storageAllowed = await shouldStoreOnCurrentPage();
        if (!res.hasApiKey && mode !== 'layout') {
            const emptyState = document.createElement('div');
            emptyState.style.cssText = 'text-align:center;padding:24px 16px;';
            const keyIcon = document.createElement('span');
            keyIcon.style.cssText = 'font-size:32px;display:block;margin-bottom:12px;';
            keyIcon.textContent = '🔑';
            const title = document.createElement('div');
            title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:8px;';
            title.textContent = t('apiKeyMissing', 'API-ключ не настроен');
            const countdown = document.createElement('div');
            countdown.style.cssText = 'color:var(--text-secondary);margin-bottom:16px;font-size:13px;';
            const timerSpan = document.createElement('span');
            timerSpan.id = 'redirectTimer';
            timerSpan.style.cssText = 'font-weight:bold;color:var(--primary);';
            timerSpan.textContent = '3';
            countdown.append(
                document.createTextNode(`${t('openingSettings', 'Открываем настройки через')} `),
                timerSpan,
                document.createTextNode('…'),
            );
            const openButton = document.createElement('button');
            openButton.id = 'openSettingsBtn';
            openButton.type = 'button';
            openButton.style.cssText =
                'background:var(--primary);color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:500;';
            openButton.textContent = t('openSettingsNow', 'Открыть сейчас');
            emptyState.append(keyIcon, title, countdown, openButton);
            contentPane.replaceChildren(emptyState);

            let timeLeft = 3;
            const interval = lifecycle.setInterval(() => {
                timeLeft--;
                if (timerSpan) timerSpan.textContent = timeLeft.toString();
                if (timeLeft <= 0) {
                    lifecycle.clearInterval(interval);
                    chrome.runtime.sendMessage({ action: 'openOptionsPage' });
                    closePopup();
                }
            }, 1000);

            openButton.addEventListener('click', () => {
                lifecycle.clearInterval(interval);
                chrome.runtime.sendMessage({ action: 'openOptionsPage' });
                closePopup();
            });
            return;
        }

        if (mode === 'ocr') {
            startStream();
            return;
        }

        const baseCacheMode =
            mode === 'translate'
                ? mode + currentTargetLang
                : mode === 'custom'
                  ? `custom:${customCommand?.id || 'unknown'}`
                  : mode;
        const cacheModeKey = `v${REQUEST_CACHE_VERSION}:${baseCacheMode}:${cacheSettingsFingerprint}`;
        const cacheKey = await getCacheHash(cacheModeKey, getCacheSource());
        if (lifecycle.disposed) return;
        const cachedResult = storageAllowed && !options.bypassCache ? await getCachedText(cacheKey) : null;
        if (lifecycle.disposed) return;
        if (cachedResult) {
            void recordCacheHit();
            const cleanedCached = cleanMarkdownArtifacts(cachedResult);
            if (mode === 'summary') {
                fullResult = stripSummaryPrefix(cleanedCached);
            } else if (mode === 'spellcheck') {
                fullResult = normalizeSpellcheckResult(cleanedCached);
            } else {
                fullResult = cleanedCached;
            }
            if (mode === 'spellcheck') {
                spellcheckUi.setResult(currentSelection.text, fullResult);
            } else if (compactResultMode) {
                contentPane.textContent = fullResult;
            } else {
                renderMarkdown(contentPane, fullResult);
            }
            finishStream(true);
            showActionStatus(t('resultFromCache', 'Result loaded from the local cache.'));
        } else {
            startStream();
        }
    }

    void checkCacheAndRun().catch((error) => {
        if (lifecycle.disposed) return;
        const message = error instanceof Error ? error.message : t('unknownError', 'Неизвестная ошибка.');
        showRequestError(message);
    });
}
