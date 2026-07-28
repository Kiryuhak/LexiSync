import { ICONS } from './icons';
import { t } from './i18n';
import { setIcon } from './dom-rendering';
import type { CustomCommand, RequestMode } from './types';
import { copyText } from './clipboard';

export interface ContentMenuContext {
    openPopup: (x: number, y: number) => HTMLElement;
    getPopup: () => HTMLElement | null;
    getSelectionText: () => string;
    getSearchEngine: () => string;
    getPopupElementById: <T extends HTMLElement>(id: string) => T | null;
    closePopup: () => void;
    adjustPopupPosition: () => void;
    handleAction: (mode: RequestMode) => void;
    executeCustom: (command: CustomCommand) => void;
}

export function showToolbarMenu(x: number, y: number, context: ContentMenuContext): void {
    const popupUI = context.openPopup(x, y);
    const currentSearchEngine = context.getSearchEngine();
    const currentSelectionText = context.getSelectionText();
    popupUI.dataset.surface = 'toolbar';
    popupUI.setAttribute('role', 'toolbar');
    popupUI.setAttribute('aria-label', t('actionToolbar', 'Действия с выделенным текстом'));

    popupUI.addEventListener('mousedown', (e) => e.stopPropagation());
    popupUI.addEventListener('mouseup', (e) => e.stopPropagation());
    popupUI.addEventListener('click', (e) => e.stopPropagation());

    popupUI.style.cssText = `position: fixed !important; left: -9999px; top: -9999px; background: var(--bg-primary); z-index: 2147483647 !important; font-family: system-ui, sans-serif; font-size: 13px; color: var(--text-primary); display: flex; align-items: center; padding: 4px; gap: 2px;`;

    const createBtn = (
        icon: string,
        text: string,
        title: string,
        onClick: (e: MouseEvent, btn: HTMLButtonElement) => void,
    ) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lexisync-toolbar-button';
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
        btn.onmousedown = (e) => e.preventDefault();
        btn.onmouseover = () => (btn.style.backgroundColor = 'var(--hover-bg)');
        btn.onmouseout = () => (btn.style.backgroundColor = 'transparent');
        btn.onclick = (e: MouseEvent) => {
            e.preventDefault();
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
    let searchUrl = 'https://www.google.com/search?q=';
    let searchTitle = t('searchGoogle', 'Искать в Google');
    if (currentSearchEngine === 'yandex') {
        searchIcon = ICONS.yandex;
        searchUrl = 'https://yandex.ru/search/?text=';
        searchTitle = t('searchYandex', 'Искать в Яндексе');
    } else if (currentSearchEngine === 'duckduckgo') {
        searchIcon = ICONS.duckduckgo;
        searchUrl = 'https://duckduckgo.com/?q=';
        searchTitle = t('searchDuckDuckGo', 'Искать в DuckDuckGo');
    }

    popupUI.appendChild(
        createBtn(searchIcon, '', searchTitle, () => {
            window.open(searchUrl + encodeURIComponent(currentSelectionText), '_blank');
            context.closePopup();
        }),
    );
    popupUI.appendChild(divider());
    const copyStatus = document.createElement('span');
    copyStatus.setAttribute('role', 'status');
    copyStatus.setAttribute('aria-live', 'polite');
    copyStatus.hidden = true;
    copyStatus.style.cssText =
        'max-width:150px;padding:5px 7px;color:#b42318;font-size:10px;font-weight:600;line-height:1.25;';
    popupUI.appendChild(
        createBtn(ICONS.edit, t('editText', 'Редактировать'), t('textFunctions', 'Функции текста'), () => {
            showAIMenu(x, y, context);
        }),
    );
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

    const moreWrap = document.createElement('div');
    moreWrap.id = 'lexisync-more-btn-wrap';
    moreWrap.style.cssText = 'position: relative; display: flex; align-items: center;';

    const moreBtn = createBtn(ICONS.dots, '', t('moreOptions', 'Ещё опции'), () => {
        const dropdown = context.getPopupElementById<HTMLElement>('lexisync-more-dropdown');
        if (dropdown) {
            if (dropdown.style.display === 'flex') dropdown.style.display = 'none';
            else {
                dropdown.style.display = 'flex';
                const rect = dropdown.getBoundingClientRect();
                if (rect.bottom > window.innerHeight - 10) {
                    dropdown.style.top = 'auto';
                    dropdown.style.bottom = '100%';
                    dropdown.style.marginTop = '0';
                    dropdown.style.marginBottom = '8px';
                } else {
                    dropdown.style.top = '100%';
                    dropdown.style.bottom = 'auto';
                    dropdown.style.marginTop = '8px';
                    dropdown.style.marginBottom = '0';
                }
            }
        }
    });
    moreWrap.appendChild(moreBtn);

    const moreDropdown = document.createElement('div');
    moreDropdown.id = 'lexisync-more-dropdown';
    moreDropdown.className = 'lexisync-dropdown';
    moreDropdown.style.cssText = `display: none; position: absolute; top: 100%; right: 0; margin-top: 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 16px 32px rgba(0,0,0,0.15); width: max-content; min-width: 120px; z-index: 9999; padding: 8px 0; flex-direction: column; overflow: hidden;`;

    const createDropdownItem = (icon: string, text: string, onClick: () => void) => {
        const item = document.createElement('div');
        item.className = 'lexisync-dropdown-item';
        const iconWrap = document.createElement('span');
        iconWrap.style.cssText =
            'display:flex;align-items:center;justify-content:center;margin-right:12px;width:16px;height:16px;flex-shrink:0;';
        setIcon(iconWrap, icon);
        const label = document.createElement('span');
        label.style.fontWeight = '500';
        label.textContent = text;
        item.append(iconWrap, label);
        item.style.cssText = `padding: 10px 14px; font-size: 13px; cursor: pointer; display: flex; align-items: center; color: var(--text-primary); transition: background 0.15s; white-space: nowrap;`;
        item.onmousedown = (e) => e.preventDefault();
        item.onmouseover = () => (item.style.backgroundColor = 'var(--hover-bg)');
        item.onmouseout = () => (item.style.backgroundColor = 'transparent');
        item.onclick = (e) => {
            e.stopPropagation();
            moreDropdown.style.display = 'none';
            onClick();
        };
        return item;
    };

    moreDropdown.appendChild(
        createDropdownItem(ICONS.translate, t('translate', 'Перевести'), () => context.handleAction('translate')),
    );
    moreDropdown.appendChild(
        createDropdownItem(ICONS.keyboard, t('fixLayout', 'Исправить раскладку'), () => context.handleAction('layout')),
    );
    moreDropdown.appendChild(
        createDropdownItem(ICONS.history, t('history', 'История'), () => {
            chrome.runtime.sendMessage({ action: 'openHistory' });
            context.closePopup();
        }),
    );

    moreWrap.appendChild(moreDropdown);
    popupUI.appendChild(moreWrap);
    popupUI.appendChild(divider());
    popupUI.appendChild(
        createBtn(ICONS.closeColored, '', t('closePanel', 'Закрыть панель'), () => context.closePopup()),
    );

    context.adjustPopupPosition();
}

export function showAIMenu(x: number, y: number, context: ContentMenuContext): void {
    const popupUI = context.openPopup(x, y);
    popupUI.dataset.surface = 'menu';
    popupUI.setAttribute('role', 'menu');
    popupUI.setAttribute('aria-label', t('aiMenu', 'AI-инструменты'));
    const menuPopup = popupUI;

    popupUI.addEventListener('mousedown', (e) => e.stopPropagation());
    popupUI.addEventListener('mouseup', (e) => e.stopPropagation());
    popupUI.addEventListener('click', (e) => e.stopPropagation());

    popupUI.style.cssText = `position: fixed !important; left: -9999px; top: -9999px; background: var(--bg-primary); z-index: 2147483647 !important; font-family: system-ui, sans-serif; font-size: 13px; color: var(--text-primary); width: 250px; padding: 7px;`;

    const menuLabel = document.createElement('div');
    menuLabel.className = 'lexisync-menu-label';
    menuLabel.textContent = t('aiTools', 'AI-инструменты');
    popupUI.appendChild(menuLabel);

    const createMenuBtn = (icon: string, text: string, onClick: () => void, shortcut?: string) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lexisync-menu-button';
        btn.setAttribute('role', 'menuitem');
        const main = document.createElement('div');
        main.style.cssText = 'display:flex;align-items:center;';
        const iconWrap = document.createElement('span');
        iconWrap.className = 'lexisync-menu-icon';
        iconWrap.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        setIcon(iconWrap, icon);
        const label = document.createElement('span');
        label.style.fontWeight = '600';
        label.textContent = text;
        main.append(iconWrap, label);
        btn.appendChild(main);
        if (shortcut) {
            const shortcutLabel = document.createElement('span');
            shortcutLabel.className = 'lexisync-shortcut';
            shortcutLabel.textContent = shortcut;
            btn.appendChild(shortcutLabel);
        }
        btn.style.cssText = `width: 100%; padding: 8px 12px; cursor: pointer; transition: background 0.15s; display: flex; align-items: center; justify-content: space-between; border-radius: 8px; color: var(--text-primary); background: transparent; border: none;`;
        btn.onmousedown = (e) => e.preventDefault();
        btn.onmouseover = () => (btn.style.backgroundColor = 'var(--hover-bg)');
        btn.onmouseout = () => (btn.style.backgroundColor = 'transparent');
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        };
        return btn;
    };

    popupUI.appendChild(
        createMenuBtn(
            ICONS.spell,
            t('fixErrors', 'Исправить ошибки'),
            () => context.handleAction('spellcheck'),
            'Alt+R',
        ),
    );
    popupUI.appendChild(
        createMenuBtn(ICONS.style, t('rewriteText', 'Переписать текст'), () => context.handleAction('style'), 'Alt+Y'),
    );
    popupUI.appendChild(
        createMenuBtn(ICONS.emoji, t('addEmoji', 'Подобрать эмодзи'), () => context.handleAction('emoji'), 'Alt+T'),
    );

    void chrome.storage.local.get({ customCommands: [] }).then((stored) => {
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
    });

    context.adjustPopupPosition();
}
