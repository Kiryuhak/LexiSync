import { copyText } from './clipboard';
import { appendIconAndText, setIcon } from './dom-rendering';
import { ICONS } from './icons';
import { t } from './i18n';
import { replaceSelectedText } from './text-replacement';
import type { RequestMode, SelectionData } from './types';

interface ResultActionsOptions {
    mode: RequestMode;
    selection: SelectionData;
    actionsContainer: HTMLElement;
    headerTitle: HTMLElement;
    getResult: () => string;
    showStatus: (message: string, isError?: boolean) => void;
    setTimeout: (callback: () => void, delay: number) => unknown;
}

export function renderPrimaryResultActions(options: ResultActionsOptions): void {
    const { mode, selection, actionsContainer, headerTitle, getResult, showStatus } = options;
    actionsContainer.style.display = 'flex';
    actionsContainer.replaceChildren();

    const btnClass = mode === 'translate' || mode === 'layout' ? 'lexisync-translate-btn' : 'lexisync-btn-action';
    const replaceIcon = mode === 'translate' || mode === 'layout' ? ICONS.replaceCurved : ICONS.replace;
    const copyIcon = mode === 'translate' || mode === 'layout' ? ICONS.copyStandard : ICONS.copy;

    const hasReplaceTarget =
        mode !== 'ocr' && Boolean((selection.isInput && selection.activeElement) || selection.range);

    if (hasReplaceTarget) {
        const replaceButton = document.createElement('button');
        replaceButton.type = 'button';
        replaceButton.className = `${btnClass} lexisync-result-button lexisync-result-button--primary`;
        appendIconAndText(replaceButton, replaceIcon, t('replaceText', 'Заменить текст'));
        replaceButton.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const undo = replaceSelectedText(selection, getResult());
            if (undo) {
                appendIconAndText(replaceButton, ICONS.check, t('replaced', 'Заменено!'));
                replaceButton.classList.add('lexisync-result-button--success');
                replaceButton.disabled = true;
                const undoButton = document.createElement('button');
                undoButton.type = 'button';
                undoButton.className = `${btnClass} lexisync-result-button lexisync-undo-button`;
                appendIconAndText(undoButton, ICONS.replaceCurved, t('undoReplacement', 'Отменить замену'));
                undoButton.onclick = () => {
                    undo();
                    undoButton.remove();
                    replaceButton.disabled = false;
                    replaceButton.classList.remove('lexisync-result-button--success');
                    appendIconAndText(replaceButton, replaceIcon, t('replaceText', 'Заменить текст'));
                };
                actionsContainer.appendChild(undoButton);
            } else {
                showStatus(t('copied', 'Текст скопирован!'));
            }
        };
        actionsContainer.appendChild(replaceButton);
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
        copyButton.className = `${btnClass} lexisync-result-button lexisync-result-button--primary`;
        appendIconAndText(copyButton, copyIcon, t('copy', 'Копировать'));
    }
    copyButton.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyButton.disabled = true;
        try {
            await copyText(getResult());
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
}
