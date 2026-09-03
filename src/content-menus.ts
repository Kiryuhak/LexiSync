import { ICONS } from './icons';
import { t } from './i18n';
import { setIcon } from './dom-rendering';
import type { CustomCommand, RequestMode } from './types';
import { copyText } from './clipboard';
import { logger } from './logger';
import { buildSearchUrl, resolveSearchText } from './search-url';

export interface ContentMenuContext {
    openPopup: (x: number, y: number, top?: number) => HTMLElement;
    getPopup: () => HTMLElement | null;
    getSelectionText: () => string;
    getSearchEngine: () => string;
    getPopupElementById: <T extends HTMLElement>(id: string) => T | null;
    closePopup: () => void;
    adjustPopupPosition: () => void;
    handleAction: (mode: RequestMode) => void;
    executeCustom: (command: CustomCommand) => void;
    getPinnedToolbarActions?: () => RequestMode[];
}

let lastUsedAction: RequestMode | null = null;

export function getLastUsedAction(): RequestMode | null {
    return lastUsedAction;
}

export function setLastUsedAction(mode: RequestMode): void {
    lastUsedAction = mode;
}

function setupToolbarKeyboardNavigation(container: HTMLElement, onClose: () => void): void {
    container.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
        }
        const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
        if (buttons.length === 0) return;
        const digit = parseInt(event.key, 10);
        if (!isNaN(digit) && digit >= 1 && digit <= 9) {
            const targetBtn = buttons[digit - 1];
            if (targetBtn) {
                event.preventDefault();
                event.stopPropagation();
                targetBtn.click();
                return;
            }
        }
        const root = container.getRootNode();
        const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
        const currentIndex = buttons.indexOf(active as HTMLButtonElement);
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % buttons.length : 0;
            buttons[nextIndex].focus();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            const prevIndex = currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
            buttons[prevIndex].focus();
        } else if (event.key === 'Home') {
            event.preventDefault();
            buttons[0].focus();
        } else if (event.key === 'End') {
            event.preventDefault();
            buttons[buttons.length - 1].focus();
        }
    });
}

function setupMenuKeyboardNavigation(container: HTMLElement, onClose: () => void): void {
    container.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
        }
        const items = Array.from(
            container.querySelectorAll<HTMLButtonElement>('button.lexisync-menu-button:not([disabled])'),
        );
        if (items.length === 0) return;
        const digit = parseInt(event.key, 10);
        if (!isNaN(digit) && digit >= 1 && digit <= 9) {
            const targetItem = items[digit - 1];
            if (targetItem) {
                event.preventDefault();
                event.stopPropagation();
                targetItem.click();
                return;
            }
        }
        const root = container.getRootNode();
        const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
        const currentIndex = items.indexOf(active as HTMLButtonElement);
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % items.length : 0;
            items[nextIndex].focus();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
            items[prevIndex].focus();
        } else if (event.key === 'Home') {
            event.preventDefault();
            items[0].focus();
        } else if (event.key === 'End') {
            event.preventDefault();
            items[items.length - 1].focus();
        }
    });
}

function createMenuButton(
    icon: string,
    text: string,
    onClick: () => void,
    shortcut?: string,
    mode?: RequestMode,
): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lexisync-menu-button';
    button.setAttribute('role', 'menuitem');
    if (mode) button.dataset.lexisyncMode = mode;

    const main = document.createElement('div');
    main.className = 'lexisync-menu-button-main';
    const iconWrap = document.createElement('span');
    iconWrap.className = 'lexisync-menu-icon';
    iconWrap.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    setIcon(iconWrap, icon);
    const label = document.createElement('span');
    label.className = 'lexisync-menu-button-text';
    label.textContent = text;
    main.append(iconWrap, label);
    button.appendChild(main);

    if (shortcut) {
        const shortcutLabel = document.createElement('span');
        shortcutLabel.className = 'lexisync-shortcut';
        shortcutLabel.textContent = shortcut;
        button.appendChild(shortcutLabel);
    }

    button.style.cssText = `width: 100%; padding: 8px 12px; cursor: pointer; transition: background 0.15s; display: flex; align-items: center; justify-content: space-between; gap: 8px; border-radius: 8px; color: var(--text-primary); background: transparent; border: none;`;
    button.onpointerdown = (event) => event.stopPropagation();
    button.onmousedown = (event) => event.stopPropagation();
    button.onmouseover = () => (button.style.backgroundColor = 'var(--hover-bg)');
    button.onmouseout = () => (button.style.backgroundColor = 'transparent');
    button.onclick = (event) => {
        event.stopPropagation();
        onClick();
    };
    return button;
}

export function showToolbarMenu(x: number, y: number, context: ContentMenuContext, top?: number): void {
    const currentSearchEngine = context.getSearchEngine();
    const currentSelectionText = context.getSelectionText();
    const currentSearchText = resolveSearchText(currentSelectionText, window.getSelection()?.toString());
    const popupUI = context.openPopup(x, y, top);
    popupUI.dataset.surface = 'toolbar';
    popupUI.setAttribute('role', 'toolbar');
    popupUI.setAttribute('aria-label', t('actionToolbar', 'Действия с выделенным текстом'));

    popupUI.addEventListener('mousedown', (e) => e.stopPropagation());
    popupUI.addEventListener('mouseup', (e) => e.stopPropagation());
    popupUI.addEventListener('click', (e) => e.stopPropagation());
    setupToolbarKeyboardNavigation(popupUI, () => context.closePopup());

    popupUI.style.cssText = `position: fixed !important; left: 0px; top: 0px; visibility: hidden; opacity: 0; background: var(--bg-primary); z-index: 2147483647 !important; font-family: system-ui, sans-serif; font-size: 13px; color: var(--text-primary); display: flex; align-items: center; padding: 4px; gap: 2px; box-sizing: border-box;`;

    const createBtn = (
        icon: string,
        text: string,
        title: string,
        onClick: (e: MouseEvent, btn: HTMLButtonElement) => void,
        action?: string,
    ) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lexisync-toolbar-button';
        if (action) btn.dataset.lexisyncAction = action;
        const iconWrap = document.createElement('span');
        iconWrap.style.cssText =
            'display:flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;color:var(--text-secondary);overflow:visible;';
        setIcon(iconWrap, icon);
        btn.appendChild(iconWrap);
        if (text) {
            const label = document.createElement('span');
            label.style.cssText = 'margin-left:6px;font-weight:500;';
            label.textContent = text;
            btn.appendChild(label);
        }
        btn.title = title;
        btn.style.cssText = `padding: 6px 8px; cursor: pointer; border-radius: 8px; display: flex; align-items: center; transition: background 0.15s; color: var(--text-primary); background: transparent; border: none; box-sizing: border-box; line-height: 1;`;
        btn.onpointerdown = (e) => e.stopPropagation();
        btn.onmousedown = (e) => e.stopPropagation();
        btn.onmouseover = () => (btn.style.backgroundColor = 'var(--hover-bg)');
        btn.onmouseout = () => (btn.style.backgroundColor = 'transparent');
        btn.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            onClick(e, btn);
        };
        return btn;
    };

    const divider = () => {
        const d = document.createElement('div');
        d.className = 'lexisync-toolbar-divider';
        d.style.cssText = `width: 1px; height: 16px; background: var(--border-color); margin: 0 2px;`;
        return d;
    };

    let searchIcon = ICONS.google;
    let searchTitle = t('searchGoogle', 'Искать в Google');
    if (currentSearchEngine === 'yandex') {
        searchIcon = ICONS.yandex;
        searchTitle = t('searchYandex', 'Искать в Яндексе');
    } else if (currentSearchEngine === 'duckduckgo') {
        searchIcon = ICONS.duckduckgo;
        searchTitle = t('searchDuckDuckGo', 'Искать в DuckDuckGo');
    }

    popupUI.appendChild(
        createBtn(
            searchIcon,
            '',
            searchTitle,
            () => {
                window.open(buildSearchUrl(currentSearchEngine, currentSearchText), '_blank', 'noopener');
                context.closePopup();
            },
            'search',
        ),
    );
    popupUI.appendChild(divider());
    const copyStatus = document.createElement('span');
    copyStatus.setAttribute('role', 'status');
    copyStatus.setAttribute('aria-live', 'polite');
    copyStatus.hidden = true;
    copyStatus.style.cssText =
        'max-width:150px;padding:5px 7px;color:var(--error-color);font-size:10px;font-weight:600;line-height:1.25;';
    popupUI.appendChild(
        createBtn(
            ICONS.edit,
            t('editText', 'Редактировать'),
            t('textFunctions', 'Функции текста'),
            () => {
                showAIMenu(x, y, context, top);
            },
            'edit',
        ),
    );

    const ACTION_INFOS: Partial<Record<RequestMode, { icon: string; title: string }>> = {
        spellcheck: { icon: ICONS.spell, title: t('fixErrors', 'Исправить ошибки') },
        style: { icon: ICONS.style, title: t('rewriteText', 'Переписать текст') },
        emoji: { icon: ICONS.emoji, title: t('addEmoji', 'Подобрать эмодзи') },
        translate: { icon: ICONS.translate, title: t('translate', 'Перевести') },
        summary: { icon: ICONS.summary, title: t('summaryTitle', 'Выжимка') },
        tone: { icon: ICONS.tone, title: t('toneTitle', 'Тональность и вежливость') },
        continue: { icon: ICONS.continueText, title: t('continueTitle', 'Дописать за меня') },
        notes_to_doc: { icon: ICONS.notesToDoc, title: t('notesToDocTitle', 'Заметки в текст') },
        headline: { icon: ICONS.headline, title: t('headlineTitle', 'Подобрать заголовки') },
        reply: { icon: ICONS.reply, title: t('replyTitle', 'Ответить на сообщение') },
        explain: { icon: ICONS.lightbulb, title: t('explainTitle', 'Объяснить простыми словами') },
        format: { icon: ICONS.cleanFormat, title: t('formatTitle', 'Очистить и форматировать') },
        layout: { icon: ICONS.keyboard, title: t('fixLayout', 'Исправить раскладку') },
    };

    // Для длинных текстов (>300 символов или >40 слов) предлагаем быструю кнопку выжимки
    const isLongText = currentSelectionText.length > 300 || currentSelectionText.trim().split(/\s+/).length >= 40;
    if (isLongText) {
        popupUI.appendChild(divider());
        popupUI.appendChild(
            createBtn(
                ICONS.summary,
                t('summaryShort', 'Выжимка'),
                t('summaryTitle', 'Выжимка'),
                () => {
                    setLastUsedAction('summary');
                    context.handleAction('summary');
                },
                'summary',
            ),
        );
    }

    const quickAction = lastUsedAction ? ACTION_INFOS[lastUsedAction] : undefined;
    if (quickAction && lastUsedAction) {
        const actionToRun = lastUsedAction;
        popupUI.appendChild(divider());
        popupUI.appendChild(
            createBtn(
                quickAction.icon,
                '',
                `${t('runAgain', 'Повторить')}: ${quickAction.title}`,
                () => {
                    setLastUsedAction(actionToRun);
                    context.handleAction(actionToRun);
                },
                'quick-rerun',
            ),
        );
    }

    const pinnedActions = context.getPinnedToolbarActions?.() || [];
    for (const actionKey of pinnedActions) {
        const info = ACTION_INFOS[actionKey];
        if (info && actionKey !== lastUsedAction) {
            popupUI.appendChild(divider());
            popupUI.appendChild(
                createBtn(
                    info.icon,
                    '',
                    info.title,
                    () => {
                        setLastUsedAction(actionKey);
                        context.handleAction(actionKey);
                    },
                    `pinned-${actionKey}`,
                ),
            );
        }
    }

    popupUI.appendChild(divider());
    popupUI.appendChild(
        createBtn(ICONS.copy, '', t('copy', 'Копировать'), (_event, btn) => {
            btn.disabled = true;
            void copyText(currentSelectionText)
                .then(() => {
                    const iconWrap = document.createElement('span');
                    iconWrap.style.cssText =
                        'display:flex;align-items:center;justify-content:center;width:16px;height:16px;';
                    setIcon(iconWrap, ICONS.check);
                    btn.replaceChildren(iconWrap);
                    btn.setAttribute('aria-label', t('copied', 'Текст скопирован!'));
                    setTimeout(() => context.closePopup(), 1000);
                })
                .catch(() => {
                    btn.disabled = false;
                    btn.setAttribute('aria-label', t('copyFailed', 'Не удалось скопировать текст'));
                    btn.title = t('copyFailed', 'Не удалось скопировать текст');
                    copyStatus.textContent = t('copyFailed', 'Не удалось скопировать текст');
                    copyStatus.hidden = false;
                    context.adjustPopupPosition();
                });
        }),
    );
    popupUI.appendChild(copyStatus);
    popupUI.appendChild(divider());

    popupUI.appendChild(
        createBtn(
            ICONS.dots,
            '',
            t('moreOptions', 'Ещё опции'),
            () => {
                showMoreMenu(x, y, context, top);
            },
            'more',
        ),
    );
    popupUI.appendChild(divider());
    popupUI.appendChild(
        createBtn(ICONS.closeColored, '', t('closePanel', 'Закрыть панель'), () => context.closePopup()),
    );

    context.adjustPopupPosition();
}

export function showMoreMenu(x: number, y: number, context: ContentMenuContext, top?: number): void {
    const currentSelectionText = context.getSelectionText();
    const hasCyrillic = /[\p{sc=Cyrillic}]/u.test(currentSelectionText);
    const hasLatin = /[a-zA-Z]/u.test(currentSelectionText);
    let translateBadge = '';
    if (hasLatin && !hasCyrillic) translateBadge = 'EN➔RU';
    else if (hasCyrillic && !hasLatin) translateBadge = 'RU➔EN';

    const popupUI = context.openPopup(x, y, top);
    popupUI.dataset.surface = 'menu';
    popupUI.setAttribute('role', 'menu');
    popupUI.setAttribute('aria-label', t('moreToolsTitle', 'Дополнительные инструменты'));

    popupUI.addEventListener('mousedown', (e) => e.stopPropagation());
    popupUI.addEventListener('mouseup', (e) => e.stopPropagation());
    popupUI.addEventListener('click', (e) => e.stopPropagation());
    setupMenuKeyboardNavigation(popupUI, () => context.closePopup());

    popupUI.style.cssText = `position: fixed !important; left: 0px; top: 0px; visibility: hidden; opacity: 0; background: var(--bg-elevated); z-index: 2147483647 !important; font-family: system-ui, sans-serif; font-size: 13px; color: var(--text-primary); width: 250px; max-height: min(480px, calc(100vh - 32px)); overflow-y: auto; overflow-x: hidden; padding: 7px; box-sizing: border-box;`;

    const menuLabel = document.createElement('div');
    menuLabel.className = 'lexisync-menu-label';
    menuLabel.textContent = t('moreToolsTitle', 'Дополнительные инструменты');
    popupUI.appendChild(menuLabel);

    const createMenuBtn = createMenuButton;

    const translateTitle = translateBadge
        ? `${t('translate', 'Перевести')} (${translateBadge})`
        : t('translate', 'Перевести');
    popupUI.appendChild(
        createMenuBtn(
            ICONS.translate,
            translateTitle,
            () => {
                setLastUsedAction('translate');
                context.handleAction('translate');
            },
            undefined,
            'translate',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.headline,
            t('headlineTitle', 'Подобрать заголовки'),
            () => {
                setLastUsedAction('headline');
                context.handleAction('headline');
            },
            undefined,
            'headline',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.caseConvert,
            t('caseConvertTitle', 'Сменить регистр'),
            () => {
                setLastUsedAction('case_convert');
                context.handleAction('case_convert');
            },
            undefined,
            'case_convert',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.textClean,
            t('textCleanTitle', 'Очистить текст'),
            () => {
                setLastUsedAction('text_clean');
                context.handleAction('text_clean');
            },
            undefined,
            'text_clean',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.cleanFormat,
            t('formatTitle', 'Очистить и форматировать'),
            () => {
                setLastUsedAction('format');
                context.handleAction('format');
            },
            undefined,
            'format',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.keyboard,
            t('fixLayout', 'Исправить раскладку'),
            () => {
                setLastUsedAction('layout');
                context.handleAction('layout');
            },
            undefined,
            'layout',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(ICONS.history, t('history', 'История'), () => {
            chrome.runtime.sendMessage({ action: 'openHistory' });
            context.closePopup();
        }),
    );
    popupUI.appendChild(
        createMenuBtn(ICONS.settings, t('settings', 'Настройки'), () => {
            chrome.runtime.sendMessage({ action: 'openOptionsPage' });
            context.closePopup();
        }),
    );

    context.adjustPopupPosition();
}

export function showAIMenu(x: number, y: number, context: ContentMenuContext, top?: number): void {
    const popupUI = context.openPopup(x, y, top);
    popupUI.dataset.surface = 'menu';
    popupUI.setAttribute('role', 'menu');
    popupUI.setAttribute('aria-label', t('aiMenu', 'AI-инструменты'));
    const menuPopup = popupUI;

    popupUI.addEventListener('mousedown', (e) => e.stopPropagation());
    popupUI.addEventListener('mouseup', (e) => e.stopPropagation());
    popupUI.addEventListener('click', (e) => e.stopPropagation());
    setupMenuKeyboardNavigation(popupUI, () => context.closePopup());

    popupUI.style.cssText = `position: fixed !important; left: 0px; top: 0px; visibility: hidden; opacity: 0; background: var(--bg-elevated); z-index: 2147483647 !important; font-family: system-ui, sans-serif; font-size: 13px; color: var(--text-primary); width: 250px; max-height: min(480px, calc(100vh - 32px)); overflow-y: auto; overflow-x: hidden; padding: 7px; box-sizing: border-box;`;

    const menuLabel = document.createElement('div');
    menuLabel.className = 'lexisync-menu-label';
    menuLabel.textContent = t('aiTools', 'AI-инструменты');
    popupUI.appendChild(menuLabel);

    const createMenuBtn = createMenuButton;

    popupUI.appendChild(
        createMenuBtn(
            ICONS.spell,
            t('fixErrors', 'Исправить ошибки'),
            () => {
                setLastUsedAction('spellcheck');
                context.handleAction('spellcheck');
            },
            'Alt+R',
            'spellcheck',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.style,
            t('rewriteText', 'Переписать текст'),
            () => {
                setLastUsedAction('style');
                context.handleAction('style');
            },
            'Alt+Y',
            'style',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.emoji,
            t('addEmoji', 'Подобрать эмодзи'),
            () => {
                setLastUsedAction('emoji');
                context.handleAction('emoji');
            },
            'Alt+T',
            'emoji',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.summary,
            t('summaryTitle', 'Выжимка'),
            () => {
                setLastUsedAction('summary');
                context.handleAction('summary');
            },
            undefined,
            'summary',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.reply,
            t('replyTitle', 'Ответить на сообщение'),
            () => {
                setLastUsedAction('reply');
                context.handleAction('reply');
            },
            undefined,
            'reply',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.lightbulb,
            t('explainTitle', 'Объяснить простыми словами'),
            () => {
                setLastUsedAction('explain');
                context.handleAction('explain');
            },
            undefined,
            'explain',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.tone,
            t('toneTitle', 'Тональность и вежливость'),
            () => {
                setLastUsedAction('tone');
                context.handleAction('tone');
            },
            undefined,
            'tone',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.continueText,
            t('continueTitle', 'Дописать за меня'),
            () => {
                setLastUsedAction('continue');
                context.handleAction('continue');
            },
            undefined,
            'continue',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.notesToDoc,
            t('notesToDocTitle', 'Заметки в текст'),
            () => {
                setLastUsedAction('notes_to_doc');
                context.handleAction('notes_to_doc');
            },
            undefined,
            'notes_to_doc',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.headline,
            t('headlineTitle', 'Подобрать заголовки'),
            () => {
                setLastUsedAction('headline');
                context.handleAction('headline');
            },
            undefined,
            'headline',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.caseConvert,
            t('caseConvertTitle', 'Сменить регистр'),
            () => {
                setLastUsedAction('case_convert');
                context.handleAction('case_convert');
            },
            undefined,
            'case_convert',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.textClean,
            t('textCleanTitle', 'Очистить текст'),
            () => {
                setLastUsedAction('text_clean');
                context.handleAction('text_clean');
            },
            undefined,
            'text_clean',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(
            ICONS.cleanFormat,
            t('formatTitle', 'Очистить и форматировать'),
            () => {
                setLastUsedAction('format');
                context.handleAction('format');
            },
            undefined,
            'format',
        ),
    );

    void chrome.storage.local
        .get({ customCommands: [] })
        .then((stored) => {
            if (
                context.getPopup() !== menuPopup ||
                !Array.isArray(stored.customCommands) ||
                stored.customCommands.length === 0
            )
                return;
            const customLabel = document.createElement('div');
            customLabel.className = 'lexisync-menu-label';
            customLabel.textContent = t('myCommands', 'Мои команды');
            menuPopup.appendChild(customLabel);
            for (const command of stored.customCommands.slice(0, 8) as CustomCommand[]) {
                if (!command?.id || !command.name || !command.prompt) continue;
                menuPopup.appendChild(createMenuBtn(ICONS.style, command.name, () => context.executeCustom(command)));
            }
            context.adjustPopupPosition();
        })
        .catch((error) => logger.error('Не удалось загрузить пользовательские команды:', error));

    context.adjustPopupPosition();
}
