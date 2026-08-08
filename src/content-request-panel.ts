import { ICONS } from './icons';
import { getCachedText, getCacheHash, setCachedText } from './ai-cache';
import { t } from './i18n';
import { addHistoryItem, updateHistoryItemResult } from './history-store';
import { isSiteDisabled, normalizeDisabledSites, shouldStoreOnCurrentPage } from './privacy';
import { normalizeSpellcheckResult } from './spellcheck';
import type { CustomCommand, HistoryItem, RequestMode, SelectionData, StreamResponse } from './types';
import { recordCacheHit } from './usage-stats';
import { createSvgIcon, renderMarkdown, setIcon } from './dom-rendering';
import { REQUEST_CACHE_VERSION, serializeCacheSource } from './request-cache';
import { createRequestLifecycle } from './request-lifecycle';
import { createBatchedUiUpdater, type BatchedUiUpdater } from './content-stream-renderer';
import { activateDialogKeyboard } from './content-dialog-accessibility';
import { normalizeResultDisplayMode, shouldUseCompactResult } from './result-display-mode';
import { createSpellcheckUi } from './content-spellcheck-ui';
import { renderPrimaryResultActions } from './content-result-actions';
import { formatRequestDuration } from './request-duration';
import { mountResultDialogFrame } from './result-dialog-view';

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
    executeRequest(mode, undefined, context);
}

export function executeRequest(
    mode: RequestMode,
    customCommand: CustomCommand | undefined,
    context: ContentRequestContext,
): void {
    const popupUI = context.getPopup();
    if (!popupUI) return;
    const currentSelection = context.getSelection();
    let currentTargetLang = context.getTargetLanguage();
    const { getLanguageName, getPopupElementById, adjustPopupPosition, closePopup, registerRequestCleanup } = context;
    const originalText = currentSelection.text;
    let streamPort: chrome.runtime.Port | null = null;
    let streamUiUpdater: BatchedUiUpdater | null = null;
    let deactivateDialogKeyboard: (() => void) | null = null;
    const lifecycle = createRequestLifecycle(() => {
        streamUiUpdater?.cancel();
        deactivateDialogKeyboard?.();
        streamPort?.disconnect();
        streamPort = null;
    });
    registerRequestCleanup(() => lifecycle.dispose());

    function showRateLimitTimer(seconds: number, retryCallback: () => void, container: HTMLElement | null): void {
        let timeLeft = seconds;
        const render = () => {
            if (!container || !container.isConnected) return false;
            const message = document.createElement('div');
            message.style.cssText =
                'padding:16px;font-weight:500;color:var(--warning-text);display:flex;align-items:center;justify-content:center;gap:10px;background:var(--warning-bg);border-radius:12px;border:1px solid var(--warning-border);margin:4px;';
            const icon = document.createElement('span');
            icon.className = 'lexisync-hourglass';
            setIcon(icon, ICONS.hourglass);
            const copy = document.createElement('span');
            copy.append(
                document.createTextNode(`${t('rateLimitRetry', 'Лимит. Автоповтор через')} `),
                Object.assign(document.createElement('b'), { textContent: String(timeLeft) }),
                document.createTextNode(` ${t('seconds', 'сек…')}`),
            );
            message.append(icon, copy);
            container.replaceChildren(message);
            adjustPopupPosition();
            return true;
        };
        if (!render()) return;
        const interval = lifecycle.setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) {
                lifecycle.clearInterval(interval);
                if (!lifecycle.disposed && container && container.isConnected) retryCallback();
            } else if (!render()) {
                lifecycle.clearInterval(interval);
            }
        }, 1000);
    }

    popupUI.dataset.surface = 'result';
    delete popupUI.dataset.compactResult;
    popupUI.setAttribute('role', 'dialog');
    popupUI.setAttribute('aria-modal', 'true');
    popupUI.setAttribute('aria-label', t('resultDialog', 'Результат обработки текста'));
    popupUI.style.width = 'min(340px, calc(100vw - 24px))';
    popupUI.style.padding = '0';
    popupUI.style.display = 'block';

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
    else if (mode === 'ocr') {
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
        const langWrap = document.createElement('div');
        langWrap.style.cssText =
            'display: flex; align-items: center; position: relative; user-select: none; margin-left: -10px;';
        const langTrigger = document.createElement('button');
        langTrigger.type = 'button';
        langTrigger.setAttribute('aria-haspopup', 'listbox');
        langTrigger.setAttribute('aria-expanded', 'false');
        langTrigger.setAttribute('aria-label', t('selectTranslationLanguage', 'Выбрать язык перевода'));
        langTrigger.style.cssText =
            'display:flex;align-items:center;gap:4px;padding:6px 10px;border:0;border-radius:8px;background:transparent;color:var(--text-primary);font:inherit;font-weight:600;cursor:pointer;';
        const languageLabel = document.createElement('span');
        languageLabel.id = 'lexisync-lang-label';
        languageLabel.textContent = currentTargetLang;
        const chevron = document.createElement('span');
        chevron.style.marginTop = '2px';
        setIcon(chevron, ICONS.chevronDown);
        langTrigger.append(languageLabel, chevron);
        langWrap.append(langTrigger);

        const langDropdown = document.createElement('div');
        langDropdown.className = 'lexisync-scroll';
        langDropdown.setAttribute('role', 'listbox');
        langDropdown.setAttribute('aria-label', t('translationLanguages', 'Языки перевода'));
        langDropdown.style.cssText =
            'display: none; position: absolute; top: 100%; left: -4px; margin-top: 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 12px 24px var(--shadow-color); flex-direction: column; min-width: 140px; z-index: 9999; padding: 8px 0; max-height: 220px; overflow-y: auto; font-weight: normal;';

        const popularLangs = ['en', 'ru', 'de', 'fr', 'es', 'it', 'pl', 'zh', 'tr', 'ja'].map(getLanguageName);

        popularLangs.forEach((lang) => {
            const langItem = document.createElement('button');
            langItem.type = 'button';
            langItem.setAttribute('role', 'option');
            langItem.setAttribute('aria-selected', String(lang === currentTargetLang));
            langItem.textContent = lang;
            langItem.style.cssText =
                'width:100%;padding:10px 16px;border:0;background:transparent;text-align:left;font-size:13px;cursor:pointer;transition:background 0.1s;color:var(--text-primary);';
            if (lang === currentTargetLang) {
                langItem.style.background = 'var(--hover-bg)';
                langItem.style.fontWeight = '600';
            }
            langItem.onmouseover = () => {
                if (lang !== currentTargetLang) langItem.style.background = 'var(--hover-bg)';
            };
            langItem.onmouseout = () => {
                if (lang !== currentTargetLang) langItem.style.background = 'transparent';
            };
            langItem.onclick = (e) => {
                e.stopPropagation();
                langDropdown.style.display = 'none';
                langTrigger.setAttribute('aria-expanded', 'false');
                if (lang !== currentTargetLang) {
                    currentTargetLang = lang;
                    context.setTargetLanguage(lang);
                    const languageLabel = getPopupElementById<HTMLElement>('lexisync-lang-label');
                    if (languageLabel) languageLabel.textContent = lang;
                    if (streamPort) streamPort.disconnect();
                    startStream();
                }
            };
            langDropdown.appendChild(langItem);
        });

        langWrap.appendChild(langDropdown);
        langTrigger.onclick = (e) => {
            e.stopPropagation();
            const open = langDropdown.style.display !== 'flex';
            langDropdown.style.display = open ? 'flex' : 'none';
            langTrigger.setAttribute('aria-expanded', String(open));
            if (open) langDropdown.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
        };
        headerTitleWrapper.appendChild(langWrap);
    } else {
        if (headerIcon) headerTitleWrapper.appendChild(createSvgIcon(headerIcon));
        if (headerEmoji) headerTitleWrapper.appendChild(document.createTextNode(headerEmoji));
        headerTitleWrapper.appendChild(document.createTextNode(headerLabel));
    }

    const initialLoader = document.createElement('div');
    initialLoader.className = 'lexisync-loader';
    loaderOrClose.appendChild(initialLoader);
    adjustPopupPosition();
    deactivateDialogKeyboard = activateDialogKeyboard(popupUI, closePopup);

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
        if (compactResultMode) contentPane.textContent = fullResult;
        else renderMarkdown(contentPane, fullResult);
        contentPane.setAttribute('aria-live', 'polite');
        contentPane.scrollTop = contentPane.scrollHeight;
        adjustPopupPosition();
    });

    function applyCompactResultLayout(): void {
        const currentPopup = context.getPopup();
        if (currentPopup) {
            currentPopup.dataset.compactResult = 'true';
            currentPopup.style.width = 'min(300px, calc(100vw - 24px))';
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
        const clean = fullResult.replace(/\*/g, '');
        return mode === 'spellcheck' ? spellcheckUi.getResult(clean) : clean;
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

    contentPane.addEventListener('input', () => {
        if (storageAllowed && savedHistoryId !== null && contentPane.contentEditable === 'true') {
            void updateHistoryItemResult(savedHistoryId, getEffectiveResult());
        }
    });

    function renderLoadingControl(): void {
        loaderOrClose.replaceChildren();
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; align-items:center; gap:8px;';
        const loader = document.createElement('div');
        loader.className = 'lexisync-loader';
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
            cancelBtn.disabled = true;
            contentPane.textContent = t('cancelling', 'Отменяем запрос…');
            streamPort?.postMessage({ action: 'cancelMistral' });
        };
        wrapper.append(loader, cancelBtn);
        loaderOrClose.appendChild(wrapper);
    }

    function startStream() {
        if (lifecycle.disposed) return;
        streamUiUpdater?.cancel();
        streamPort?.disconnect();
        streamPort = null;
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
            contentPane.textContent = t('reloadPage', 'Пожалуйста, обновите страницу (F5).');
            contentPane.style.color = 'var(--error-color)';
            return;
        }

        streamPort = chrome.runtime.connect({ name: 'mistralStream' });
        requestStartedAt = performance.now();
        streamPort.postMessage({
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
        streamPort.onMessage.addListener((response: StreamResponse) => {
            if (lifecycle.disposed) return;
            if (response.status === 'chunk') {
                fullResult += response.text;
                streamUiUpdater?.request();
            } else if (response.status === 'done') {
                streamUiUpdater?.cancel();
                if (mode === 'spellcheck') {
                    fullResult = normalizeSpellcheckResult(fullResult);
                    spellcheckUi.setResult(currentSelection.text, fullResult);
                } else if (compactResultMode) {
                    contentPane.textContent = fullResult;
                } else {
                    renderMarkdown(contentPane, fullResult);
                }
                contentPane.removeAttribute('aria-live');
                finishStream();
                if (requestStartedAt !== null) {
                    const duration = formatRequestDuration(performance.now() - requestStartedAt);
                    requestStartedAt = null;
                    showActionStatus(t('requestCompletedIn', 'Ready in $1 s').replace('$1', duration));
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
                        .catch((error) => console.error('Ошибка сохранения кэша:', error));
                    void addHistoryItem(historyItem)
                        .then(() => {
                            savedHistoryId = historyItem.id;
                        })
                        .catch((error) => console.error('Ошибка сохранения истории:', error));
                }
            } else if (response.status === 'error') {
                requestStartedAt = null;
                streamUiUpdater?.cancel();
                const errorMessage =
                    typeof response.error === 'string' ? response.error : t('unknownError', 'Неизвестная ошибка.');
                if (
                    errorMessage.toLowerCase().includes('rate limit') ||
                    errorMessage.toLowerCase().includes('лимит') ||
                    errorMessage.includes('429')
                ) {
                    showRateLimitTimer(5, startStream, contentPane);
                } else {
                    contentPane.textContent = `${t('errorPrefix', 'Ошибка:')} ${errorMessage}`;
                    contentPane.style.color = 'var(--error-color)';
                }
                finishStream(false);
            } else if (response.status === 'cancelled') {
                requestStartedAt = null;
                streamUiUpdater?.cancel();
                contentPane.textContent = t('requestCancelled', 'Запрос отменён.');
                contentPane.style.color = 'var(--text-secondary)';
                finishStream(false);
            }
        });
    }

    function finishStream(success = true) {
        streamPort?.disconnect();
        streamPort = null;
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
        loaderOrClose.replaceChildren();
        loaderOrClose.appendChild(closeBtn);

        if (success && fullResult.trim().length > 0) {
            if (!compactResultMode && mode !== 'spellcheck' && mode !== 'ocr') {
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
                const compareButton = createTool(t('beforeAfter', 'До / После'), () => {
                    if (!comparisonOriginalVisible) {
                        editedResultSnapshot = getEffectiveResult();
                        contentPane.contentEditable = 'false';
                        contentPane.textContent = originalText;
                        compareButton.textContent = t('showResult', 'Показать результат');
                    } else {
                        contentPane.textContent = editedResultSnapshot;
                        contentPane.contentEditable = 'true';
                        compareButton.textContent = t('beforeAfter', 'До / После');
                    }
                    comparisonOriginalVisible = !comparisonOriginalVisible;
                });
                const refine = (name: string, prompt: string) => {
                    const source = getEffectiveResult();
                    currentSelection.text = source;
                    currentSelection.context = source;
                    executeRequest('custom', { id: `refine-${name}`, name, prompt }, context);
                };
                resultTools.replaceChildren(
                    compareButton,
                    createTool(t('repeat', 'Повторить'), () => executeRequest(mode, customCommand, context)),
                    createTool(t('shorter', 'Короче'), () =>
                        refine(
                            t('refineShortName', 'Сделать короче'),
                            t('presetShortPrompt', 'Сократи текст, сохранив ключевые факты и исходный смысл.'),
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
                    createTool(t('moreFormal', 'Формальнее'), () =>
                        refine(
                            t('refineFormalName', 'Сделать формальнее'),
                            t('refineFormalPrompt', 'Перепиши текст в более формальном и профессиональном стиле.'),
                        ),
                    ),
                );
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
        const cachedResult = storageAllowed ? await getCachedText(cacheKey) : null;
        if (lifecycle.disposed) return;
        if (cachedResult) {
            void recordCacheHit();
            fullResult = mode === 'spellcheck' ? normalizeSpellcheckResult(cachedResult) : cachedResult;
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
        const errorContainer = document.createElement('div');
        errorContainer.className = 'lexisync-error-box';
        errorContainer.style.cssText = 'padding: 8px 0; color: var(--error-color);';

        const errorText = document.createElement('div');
        errorText.style.cssText = 'margin-bottom: 10px; line-height: 1.45; font-size: 13px;';
        errorText.textContent = `${t('errorPrefix', 'Ошибка:')} ${message}`;

        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.id = 'retryRequestBtn';
        retryBtn.style.cssText =
            'background: var(--primary); color: #ffffff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500;';
        retryBtn.textContent = t('retryRequest', 'Повторить попытку');
        retryBtn.onclick = () => {
            if (lifecycle.disposed) return;
            contentPane.replaceChildren();
            contentPane.style.color = '';
            startStream();
        };

        errorContainer.append(errorText, retryBtn);
        contentPane.replaceChildren(errorContainer);
        finishStream(false);
    });
}
