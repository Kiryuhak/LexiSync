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

export async function copyRichText(html: string, plainFallback: string): Promise<void> {
    try {
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
            const blobHtml = new Blob([html], { type: 'text/html' });
            const blobText = new Blob([plainFallback], { type: 'text/plain' });
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': blobHtml,
                    'text/plain': blobText,
                }),
            ]);
            return;
        }
    } catch {
        // Fallback to text copy
    }

    await copyText(plainFallback);
}

export async function copySingleLine(text: string): Promise<void> {
    const singleLine = text.replace(/\s+/g, ' ').trim();
    await copyText(singleLine);
}
