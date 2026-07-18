export function t(key: string, fallback: string, substitutions?: string | string[]): string {
    try {
        return chrome.i18n.getMessage(key, substitutions) || fallback;
    } catch {
        return fallback;
    }
}

export function localizeDocument(root: ParentNode = document): void {
    if (root === document) document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0] || 'en';
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
        const key = element.dataset.i18n;
        if (key) element.textContent = t(key, element.textContent || '');
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((element) => {
        const key = element.dataset.i18nPlaceholder;
        if (key && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
            element.placeholder = t(key, element.placeholder);
        }
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((element) => {
        const key = element.dataset.i18nTitle;
        if (key) element.title = t(key, element.title);
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((element) => {
        const key = element.dataset.i18nAriaLabel;
        if (key) element.setAttribute('aria-label', t(key, element.getAttribute('aria-label') || ''));
    });
}
