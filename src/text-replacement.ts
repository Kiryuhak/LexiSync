import type { SelectionData } from './types';

function dispatchValueEvents(element: HTMLInputElement | HTMLTextAreaElement): void {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const prototype =
        element.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
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

            return () => {
                setNativeValue(activeElement, oldValue);
                activeElement.selectionStart = oldStart;
                activeElement.selectionEnd = oldEnd;
                dispatchValueEvents(activeElement);
                activeElement.focus();
            };
        }

        if (range) {
            const browserSelection = window.getSelection();
            browserSelection?.removeAllRanges();
            browserSelection?.addRange(range);
            document.execCommand('insertText', false, newText);
            return () => document.execCommand('undo');
        }
    } catch (error) {
        console.error('Ошибка при вставке текста:', error);
        void navigator.clipboard.writeText(newText);
    }
    return null;
}
