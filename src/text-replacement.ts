import type { SelectionData } from './types';
import { logger } from './logger';

export const SELECTION_CHANGED_ERROR = 'SELECTION_CHANGED';

export class SelectionChangedError extends Error {
    constructor() {
        super(SELECTION_CHANGED_ERROR);
        this.name = 'SelectionChangedError';
    }
}

function maxOffset(node: Node): number {
    return node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length;
}

function resolveCurrentRange(selection: SelectionData): Range {
    const snapshot = selection.rangeSnapshot;
    if (!snapshot) {
        if (!selection.range || selection.range.toString() !== selection.text) throw new SelectionChangedError();
        return selection.range.cloneRange();
    }
    const { startContainer, startOffset, endContainer, endOffset, expectedText } = snapshot;
    if (
        !startContainer.isConnected ||
        !endContainer.isConnected ||
        startContainer.getRootNode() !== endContainer.getRootNode() ||
        startOffset < 0 ||
        endOffset < 0 ||
        startOffset > maxOffset(startContainer) ||
        endOffset > maxOffset(endContainer)
    ) {
        throw new SelectionChangedError();
    }
    try {
        const range = document.createRange();
        range.setStart(startContainer, startOffset);
        range.setEnd(endContainer, endOffset);
        if (range.toString() !== expectedText) throw new SelectionChangedError();
        return range;
    } catch (error) {
        if (error instanceof SelectionChangedError) throw error;
        throw new SelectionChangedError();
    }
}

export function validateSelectionTarget(selection: SelectionData): boolean {
    try {
        if (selection.isInput) {
            const { activeElement, start, end } = selection;
            if (!activeElement || start === null || end === null || start < 0 || end < start) return false;
            const value = activeElement.value;
            if (end > value.length || value.slice(start, end) !== selection.text) return false;
            return selection.inputValueSnapshot === undefined || value === selection.inputValueSnapshot;
        }
        resolveCurrentRange(selection);
        return true;
    } catch {
        return false;
    }
}

function assertInputSnapshot(selection: SelectionData): asserts selection is SelectionData & {
    activeElement: HTMLInputElement | HTMLTextAreaElement;
    start: number;
    end: number;
} {
    if (
        !validateSelectionTarget(selection) ||
        !selection.activeElement ||
        selection.start === null ||
        selection.end === null
    )
        throw new SelectionChangedError();
}

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
    const { isInput, activeElement, range } = selection;
    try {
        if (isInput && activeElement) {
            assertInputSnapshot(selection);
            const oldValue = activeElement.value;
            const oldStart = selection.start;
            const oldEnd = selection.end;
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
            const currentRange = resolveCurrentRange(selection);
            const browserSelection = window.getSelection();
            browserSelection?.removeAllRanges();
            browserSelection?.addRange(currentRange);
            document.execCommand('insertText', false, newText);
            const undoFn = () => document.execCommand('undo');
            return undoFn;
        }
    } catch (error) {
        if (error instanceof SelectionChangedError) throw error;
        logger.error('Ошибка при вставке текста:', error);
    }
    return null;
}

export function appendBelowSelectedText(selection: SelectionData, newText: string): (() => void) | null {
    const { isInput, activeElement, range } = selection;
    try {
        if (isInput && activeElement) {
            assertInputSnapshot(selection);
            const oldValue = activeElement.value;
            const oldStart = selection.start;
            const oldEnd = selection.end;
            const prefixNewline = oldEnd > 0 && !oldValue.slice(0, oldEnd).endsWith('\n') ? '\n' : '';
            const textToInsert = prefixNewline + newText;
            const nextValue = oldValue.slice(0, oldEnd) + textToInsert + oldValue.slice(oldEnd);
            setNativeValue(activeElement, nextValue);
            activeElement.selectionStart = activeElement.selectionEnd = oldEnd + textToInsert.length;
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
            const cloneRange = resolveCurrentRange(selection);
            cloneRange.collapse(false);
            const browserSelection = window.getSelection();
            browserSelection?.removeAllRanges();
            browserSelection?.addRange(cloneRange);
            document.execCommand('insertText', false, '\n' + newText);
            const undoFn = () => document.execCommand('undo');
            return undoFn;
        }
    } catch (error) {
        if (error instanceof SelectionChangedError) throw error;
        logger.error('Ошибка при вставке текста ниже:', error);
    }
    return null;
}
