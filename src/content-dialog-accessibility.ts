const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
    return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
    );
}

export function activateDialogKeyboard(dialog: HTMLElement, close: () => void): () => void {
    dialog.tabIndex = -1;
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = getFocusableElements(dialog);
        if (!focusable.length) {
            event.preventDefault();
            dialog.focus({ preventScroll: true });
            return;
        }
        const root = dialog.getRootNode();
        const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (active === first || active === dialog)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };
    dialog.addEventListener('keydown', onKeyDown);
    queueMicrotask(() => {
        if (dialog.isConnected) dialog.focus({ preventScroll: true });
    });
    return () => dialog.removeEventListener('keydown', onKeyDown);
}
