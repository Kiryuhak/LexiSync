function copyWithLegacyApi(text: string): boolean {
    if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') return false;

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.append(textarea);
    textarea.select();
    try {
        return document.execCommand('copy');
    } finally {
        textarea.remove();
    }
}

export async function copyText(text: string): Promise<void> {
    try {
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        if (clipboard?.writeText) {
            await clipboard.writeText(text);
            return;
        }
    } catch {
        // На страницах с ограничениями Clipboard API используем запасной механизм ниже.
    }

    if (copyWithLegacyApi(text)) return;
    throw new Error('CLIPBOARD_UNAVAILABLE');
}
