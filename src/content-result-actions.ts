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

    const replaceButton = document.createElement('button');
    replaceButton.type = 'button';
    replaceButton.className = `${btnClass} lexisync-result-button lexisync-result-button--primary`;
    appendIconAndText(replaceButton, replaceIcon, t('replaceText', 'Заменить текст'));
    replaceButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const undo = replaceSelectedText(selection, getResult());
        appendIconAndText(replaceButton, ICONS.check, t('replaced', 'Заменено!'));
        replaceButton.classList.add('lexisync-result-button--success');
        replaceButton.style.backgroundColor = '#dcfce7';
        replaceButton.style.color = '#166534';
        replaceButton.style.fontWeight = '600';
        if (undo) {
            const undoButton = document.createElement('button');
            undoButton.type = 'button';
            undoButton.className = `${btnClass} lexisync-result-button`;
            undoButton.textContent = t('undoReplacement', 'Отменить замену');
            undoButton.onclick = () => {
                undo();
                undoButton.remove();
                replaceButton.disabled = false;
                replaceButton.classList.remove('lexisync-result-button--success');
                appendIconAndText(replaceButton, replaceIcon, t('replaceText', 'Заменить текст'));
            };
            actionsContainer.appendChild(undoButton);
        }
        replaceButton.disabled = true;
    };

    if (mode === 'ocr') {
        void copyText(getResult())
            .then(() => {
                const copied = document.createElement('span');
                copied.style.cssText = 'display:flex;align-items:center;gap:8px;color:#166534;';
                appendIconAndText(copied, ICONS.check, t('copied', 'Текст скопирован!'));
                headerTitle.replaceChildren(copied);
            })
            .catch(() => showStatus(t('copyFailed', 'Не удалось скопировать текст'), true));
    }

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = `${btnClass} lexisync-result-button icon-only`;
    copyButton.setAttribute('aria-label', t('copy', 'Копировать'));
    setIcon(copyButton, copyIcon);
    copyButton.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyButton.disabled = true;
        try {
            await copyText(getResult());
            setIcon(copyButton, ICONS.check);
            showStatus(t('copied', 'Текст скопирован!'));
            options.setTimeout(() => setIcon(copyButton, copyIcon), 1500);
        } catch {
            showStatus(t('copyFailed', 'Не удалось скопировать текст'), true);
        } finally {
            copyButton.disabled = false;
        }
    };

    actionsContainer.append(replaceButton, copyButton);
}
