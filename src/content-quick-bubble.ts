import { ICONS } from './icons';
import { t } from './i18n';
import { setIcon } from './dom-rendering';
import type { ContentMenuContext } from './content-menus';

export function showQuickBubble(
    x: number,
    y: number,
    context: ContentMenuContext,
    onExpand: () => void,
    top?: number,
): HTMLElement {
    const popupUI = context.openPopup(x, y, top);
    popupUI.dataset.surface = 'quick-bubble';
    popupUI.setAttribute('role', 'button');
    popupUI.setAttribute('aria-label', t('quickActionBubbleAria', 'Открыть меню действий LexiSync'));
    popupUI.tabIndex = 0;

    popupUI.style.cssText = `position: fixed !important; left: 0px; top: 0px; visibility: hidden; opacity: 0; background: var(--bg-primary); z-index: 2147483647 !important; display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; box-shadow: 0 4px 16px rgba(0,0,0,0.25); cursor: pointer; border: 1px solid var(--border-color, rgba(255,255,255,0.15)); transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.18s ease;`;

    const iconWrap = document.createElement('span');
    iconWrap.style.cssText =
        'display:flex;align-items:center;justify-content:center;width:18px;height:18px;color:var(--accent,#6366F1);pointer-events:none;';
    setIcon(iconWrap, ICONS.sparkles);
    popupUI.appendChild(iconWrap);

    popupUI.onpointerdown = (e) => e.stopPropagation();
    popupUI.onmousedown = (e) => e.stopPropagation();
    popupUI.onmouseover = () => {
        popupUI.style.transform = 'scale(1.15)';
        popupUI.style.boxShadow = '0 6px 20px rgba(99,102,241,0.4)';
    };
    popupUI.onmouseout = () => {
        popupUI.style.transform = 'scale(1)';
        popupUI.style.boxShadow = '0 4px 16px rgba(0,0,0,0.25)';
    };

    const triggerExpand = (e: Event) => {
        e.stopPropagation();
        onExpand();
    };

    popupUI.onclick = triggerExpand;
    popupUI.onkeydown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            triggerExpand(e);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            context.closePopup();
        }
    };

    context.adjustPopupPosition();
    return popupUI;
}
