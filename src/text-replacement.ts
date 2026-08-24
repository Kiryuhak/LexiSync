import type { SelectionData } from './types';
import { copyText } from './clipboard';
import { logger } from './logger';

export function dispatchValueEvents(element: HTMLInputElement | HTMLTextAreaElement): void {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    try {
        const win = typeof window !== 'undefined' ? window : (globalThis as typeof window);
        const proto =
            element.tagName === 'INPUT' ? win?.HTMLInputElement?.prototype : win?.HTMLTextAreaElement?.prototype;
        const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
        if (setter) {
            setter.call(element, value);
            return;
        }
    } catch {
        // fallback
    }
    element.value = value;
}

export function replaceSelectedText(selection: SelectionData, newText: string): (() => void) | null {
    const { isInput, activeElement, start, end, range } = selection;
    try {
        if (isInput && activeElement) {
            const oldValue = activeElement.value;
            const oldStart = start ?? 0;
            const oldEnd = end ?? oldStart;
            const nextValue = oldValue.slice(0, oldStart) + newText + oldValue.slice(oldEnd);
            setNativeValue(activeElement, nextValue);
            activeElement.selectionStart = activeElement.selectionEnd = oldStart + newText.length;
            dispatchValueEvents(activeElement);
            activeElement.focus();

            const undoFn = () => {
                setNativeValue(activeElement, oldValue);
                activeElement.selectionStart = oldStart;
                activeElement.selectionEnd = oldEnd;
                dispatchValueEvents(activeElement);
                activeElement.focus();
            };
            return undoFn;
        }

        if (range) {
            const browserSelection = window.getSelection();
            browserSelection?.removeAllRanges();
            browserSelection?.addRange(range);
            document.execCommand('insertText', false, newText);
            const undoFn = () => document.execCommand('undo');
            return undoFn;
        }
    } catch (error) {
        logger.error('Ошибка при вставке текста:', error);
        void copyText(newText).catch(() => undefined);
    }
    return null;
}
