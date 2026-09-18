import { copyRichText, copyText } from './clipboard';
import { appendIconAndText, setIcon } from './dom-rendering';
import { ICONS } from './icons';
import { t } from './i18n';
import { parseMarkdownToHTML } from './markdown';
import {
    appendBelowSelectedText,
    replaceSelectedText,
    SelectionChangedError,
    validateSelectionTarget,
} from './text-replacement';
import type { RequestMode, SelectionData } from './types';

interface ResultActionsOptions {
    mode: RequestMode;
    selection: SelectionData;
    actionsContainer: HTMLElement;
    headerTitle: HTMLElement;
    getResult: () => string;
    showStatus: (message: string, isError?: boolean) => void;
    setTimeout: (callback: () => void, delay: number) => unknown;
    isCompact?: () => boolean;
    onDismiss?: () => void;
    canCheckAi?: boolean;
    onCheckAi?: () => Promise<void> | void;
}

export function renderPrimaryResultActions(options: ResultActionsOptions): void {
    const { mode, selection, actionsContainer, headerTitle, getResult, showStatus } = options;
    actionsContainer.style.display = 'flex';
    actionsContainer.replaceChildren();

    const isCompact = options.isCompact?.() === true;
    const btnClass = mode === 'translate' || mode === 'layout' ? 'lexisync-translate-btn' : 'lexisync-btn-action';
    const replaceIcon = isCompact
        ? ICONS.check
        : mode === 'translate' || mode === 'layout'
          ? ICONS.replaceCurved
          : ICONS.replace;
    const copyIcon = mode === 'translate' || mode === 'layout' ? ICONS.copyStandard : ICONS.copy;

    const hasReplaceTarget =
        mode !== 'ocr' && Boolean((selection.isInput && selection.activeElement) || selection.range);
    const hasValidReplaceTarget = hasReplaceTarget && validateSelectionTarget(selection);
    const renderCheckAiButton = () => {
        if (!options.canCheckAi || !options.onCheckAi) return;
        const checkAiButton = document.createElement('button');
        checkAiButton.type = 'button';
        checkAiButton.className = `${btnClass} lexisync-result-button lexisync-btn-check-ai`;
        checkAiButton.title = t(
            'checkWithAiHint',
            'Отправить текст в AI для глубокого анализа стиля, пунктуации и сложных ошибок',
        );
        checkAiButton.setAttribute('aria-label', t('checkWithAi', 'Проверить через AI'));
        appendIconAndText(checkAiButton, ICONS.sparkles, t('checkWithAi', 'Проверить через AI'));
        checkAiButton.onpointerdown = (e) => e.stopPropagation();
        checkAiButton.onmousedown = (e) => e.stopPropagation();
        checkAiButton.onclick = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            checkAiButton.disabled = true;
            try {
                await options.onCheckAi?.();
            } finally {
                checkAiButton.disabled = false;
            }
        };
        actionsContainer.appendChild(checkAiButton);
    };

    const selectionChangedMessage = t('selectionChanged', 'Исходное выделение изменилось. Выделите текст повторно.');

    if (hasReplaceTarget) {
        const replaceButton = document.createElement('button');
        replaceButton.type = 'button';
        replaceButton.className = isCompact
            ? `${btnClass} lexisync-result-button lexisync-result-button--primary lexisync-result-button--accept`
            : `${btnClass} lexisync-result-button lexisync-result-button--primary`;
        const replaceText = t('replace', 'Заменить');
        appendIconAndText(replaceButton, replaceIcon, replaceText);
        replaceButton.setAttribute('aria-label', replaceText);
        replaceButton.disabled = !hasValidReplaceTarget;
        if (!hasValidReplaceTarget) replaceButton.title = selectionChangedMessage;

        replaceButton.onpointerdown = (e) => e.stopPropagation();
        replaceButton.onmousedown = (e) => e.stopPropagation();
        replaceButton.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            let undo: (() => void) | null;
            try {
                undo = replaceSelectedText(selection, getResult());
            } catch (error) {
                if (error instanceof SelectionChangedError) {
                    replaceButton.disabled = true;
                    showStatus(selectionChangedMessage, true);
                    return;
                }
                throw error;
            }
            if (undo) {
                appendIconAndText(replaceButton, ICONS.check, t('replaced', 'Заменено!'));
                replaceButton.classList.add('lexisync-result-button--success');
                replaceButton.disabled = true;
                const undoButton = document.createElement('button');
                undoButton.type = 'button';
                undoButton.className = `${btnClass} lexisync-result-button lexisync-undo-button`;
                appendIconAndText(undoButton, ICONS.replaceCurved, t('undoReplacement', 'Отменить замену'));
                undoButton.onpointerdown = (e) => e.stopPropagation();
                undoButton.onmousedown = (e) => e.stopPropagation();
                undoButton.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    undo();
                    undoButton.remove();
                    replaceButton.disabled = false;
                    replaceButton.classList.remove('lexisync-result-button--success');
                    appendIconAndText(replaceButton, replaceIcon, replaceText);
                };
                actionsContainer.appendChild(undoButton);
            } else showStatus(t('replaceFailed', 'Не удалось заменить текст.'), true);
        };
        actionsContainer.appendChild(replaceButton);

        const appendButton = document.createElement('button');
        appendButton.type = 'button';
        appendButton.className = `${btnClass} lexisync-result-button`;
        appendButton.title = t('appendBelowTextHint', 'Вставить результат с новой строки ниже выделенного фрагмента');
        appendIconAndText(appendButton, ICONS.continueText, t('appendBelowText', 'Вставить ниже'));
        appendButton.disabled = !hasValidReplaceTarget;
        if (!hasValidReplaceTarget) appendButton.title = selectionChangedMessage;
        appendButton.onpointerdown = (e) => e.stopPropagation();
        appendButton.onmousedown = (e) => e.stopPropagation();
        appendButton.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            let undo: (() => void) | null;
            try {
                undo = appendBelowSelectedText(selection, getResult());
            } catch (error) {
                if (error instanceof SelectionChangedError) {
                    appendButton.disabled = true;
                    showStatus(selectionChangedMessage, true);
                    return;
                }
                throw error;
            }
            if (undo) {
                appendIconAndText(appendButton, ICONS.check, t('appended', 'Вставлено!'));
                appendButton.classList.add('lexisync-result-button--success');
                appendButton.disabled = true;
                const undoButton = document.createElement('button');
                undoButton.type = 'button';
                undoButton.className = `${btnClass} lexisync-result-button lexisync-undo-button`;
                appendIconAndText(undoButton, ICONS.replaceCurved, t('undoInsertion', 'Отменить вставку'));
                undoButton.onpointerdown = (e) => e.stopPropagation();
                undoButton.onmousedown = (e) => e.stopPropagation();
                undoButton.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    undo();
                    undoButton.remove();
                    appendButton.disabled = false;
                    appendButton.classList.remove('lexisync-result-button--success');
                    appendIconAndText(appendButton, ICONS.continueText, t('appendBelowText', 'Вставить ниже'));
                };
                actionsContainer.appendChild(undoButton);
            } else showStatus(t('appendFailed', 'Не удалось вставить текст.'), true);
        };
        actionsContainer.appendChild(appendButton);

        renderCheckAiButton();

        if (isCompact && options.onDismiss) {
            const dismissButton = document.createElement('button');
            dismissButton.type = 'button';
            dismissButton.className = `${btnClass} lexisync-result-button lexisync-result-button--dismiss`;
            dismissButton.textContent = t('dismissCorrection', 'Отклонить');
            dismissButton.onpointerdown = (e) => e.stopPropagation();
            dismissButton.onmousedown = (e) => e.stopPropagation();
            dismissButton.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                options.onDismiss?.();
            };
            actionsContainer.appendChild(dismissButton);
            return;
        }
    } else {
        renderCheckAiButton();
    }

    if (mode === 'ocr') {
        void copyText(getResult())
            .then(() => {
                const copied = document.createElement('span');
                copied.style.cssText = 'display:flex;align-items:center;gap:8px;color:var(--success-color);';
                appendIconAndText(copied, ICONS.check, t('copied', 'Текст скопирован!'));
                headerTitle.replaceChildren(copied);
            })
            .catch(() => showStatus(t('copyFailed', 'Не удалось скопировать текст'), true));
    }

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    if (hasReplaceTarget) {
        copyButton.className = `${btnClass} lexisync-result-button icon-only`;
        copyButton.setAttribute('aria-label', t('copy', 'Копировать'));
        setIcon(copyButton, copyIcon);
    } else {
        copyButton.className = isCompact
            ? `${btnClass} lexisync-result-button lexisync-result-button--primary lexisync-result-button--accept`
            : `${btnClass} lexisync-result-button lexisync-result-button--primary`;
        appendIconAndText(copyButton, copyIcon, t('copy', 'Копировать'));
    }
    copyButton.onpointerdown = (e) => e.stopPropagation();
    copyButton.onmousedown = (e) => e.stopPropagation();
    copyButton.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyButton.disabled = true;
        try {
            const rawText = getResult();
            const htmlContent = parseMarkdownToHTML(rawText);
            await copyRichText(htmlContent, rawText);
            if (hasReplaceTarget) {
                setIcon(copyButton, ICONS.check);
            } else {
                appendIconAndText(copyButton, ICONS.check, t('copied', 'Текст скопирован!'));
                copyButton.classList.add('lexisync-result-button--success');
            }
            showStatus(t('copied', 'Текст скопирован!'));
            options.setTimeout(() => {
                if (hasReplaceTarget) {
                    setIcon(copyButton, copyIcon);
                } else {
                    copyButton.classList.remove('lexisync-result-button--success');
                    appendIconAndText(copyButton, copyIcon, t('copy', 'Копировать'));
                }
            }, 1500);
        } catch {
            showStatus(t('copyFailed', 'Не удалось скопировать текст'), true);
        } finally {
            copyButton.disabled = false;
        }
    };

    actionsContainer.appendChild(copyButton);

    if (isCompact) {
        if (options.onDismiss) {
            const dismissButton = document.createElement('button');
            dismissButton.type = 'button';
            dismissButton.className = `${btnClass} lexisync-result-button lexisync-result-button--dismiss`;
            dismissButton.textContent = t('dismissCorrection', 'Отклонить');
            dismissButton.onpointerdown = (e) => e.stopPropagation();
            dismissButton.onmousedown = (e) => e.stopPropagation();
            dismissButton.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                options.onDismiss?.();
            };
            actionsContainer.appendChild(dismissButton);
        }
        return;
    }

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.className = `${btnClass} lexisync-result-button icon-only`;
    downloadButton.setAttribute('aria-label', t('downloadResult', 'Скачать в файл (.md)'));
    downloadButton.title = t('downloadResult', 'Скачать в файл (.md)');
    setIcon(downloadButton, ICONS.download);
    downloadButton.onpointerdown = (e) => e.stopPropagation();
    downloadButton.onmousedown = (e) => e.stopPropagation();
    downloadButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = getResult();
        if (!text) return;
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `lexisync-${mode}-${dateStr}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        showStatus(t('fileDownloaded', 'Файл сохранён!'));
    };
    actionsContainer.appendChild(downloadButton);
}
