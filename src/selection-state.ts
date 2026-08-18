import type { SelectionData } from './types';

function isTextInput(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
    if (!element) return false;
    if (typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement) return true;
    if (typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement) return true;
    const tag = (element as HTMLElement).tagName?.toLowerCase?.();
    return tag === 'input' || tag === 'textarea';
}

export function getSelectedText(): string {
    const activeElement = document.activeElement;
    if (isTextInput(activeElement)) {
        try {
            const start = activeElement.selectionStart;
            const end = activeElement.selectionEnd;
            if (start !== null && end !== null) return activeElement.value.substring(start, end);
        } catch {
            // Some input types do not expose selection offsets.
        }
    }
    return window.getSelection()?.toString() || '';
}

export function captureSelection(fallbackText = ''): SelectionData {
    const activeElement = document.activeElement;
    const browserSelection = window.getSelection();
    const result: SelectionData = {
        text: '',
        context: '',
        range: null,
        activeElement: null,
        start: null,
        end: null,
        isInput: false,
    };

    if (isTextInput(activeElement)) {
        result.isInput = true;
        result.activeElement = activeElement;
        try {
            result.start = activeElement.selectionStart;
            result.end = activeElement.selectionEnd;
            result.text = activeElement.value.substring(result.start || 0, result.end || 0);
        } catch {
            // Fall back to the supplied text for unsupported input types.
        }
        if (!result.text) result.text = fallbackText;
        const start = result.start || 0;
        const end = result.end || 0;
        result.context = activeElement.value.substring(
            Math.max(0, start - 1000),
            Math.min(activeElement.value.length, end + 1000),
        );
        return result;
    }

    if (browserSelection?.rangeCount) {
        result.range = browserSelection.getRangeAt(0).cloneRange();
        const container = document.createElement('div');
        container.appendChild(result.range.cloneContents());
        result.text = browserSelection.toString() || container.textContent || '';
    }
    if (!result.text) result.text = fallbackText;
    let blockText = result.text;
    if (browserSelection?.anchorNode) {
        let node = browserSelection.anchorNode.parentElement;
        while (node && window.getComputedStyle(node).display === 'inline') node = node.parentElement;
        if (node) blockText = node.innerText || node.textContent || result.text;
    }
    if (blockText.length > 2000) {
        const index = blockText.indexOf(result.text);
        result.context =
            index >= 0
                ? blockText.substring(
                      Math.max(0, index - 1000),
                      Math.min(blockText.length, index + result.text.length + 1000),
                  )
                : result.text;
    } else {
        result.context = blockText;
    }
    return result;
}

export interface SelectionCoords {
    x: number;
    y: number;
    top?: number;
    bottom?: number;
}

export function getSelectionCoords(fallbackX = 0, fallbackY = 0): SelectionCoords {
    const activeElement = document.activeElement;
    if (isTextInput(activeElement)) {
        const rect = activeElement.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
            return {
                x: fallbackX || Math.max(10, Math.min(window.innerWidth - 120, rect.left + 24)),
                y: fallbackY || Math.max(10, Math.min(window.innerHeight - 60, rect.top + 32)),
                top: rect.top,
                bottom: rect.bottom,
            };
        }
    }
    const selection = window.getSelection();
    if (selection?.rangeCount) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
            return { x: rect.left, y: rect.bottom, top: rect.top, bottom: rect.bottom };
        }
    }
    const x = fallbackX || window.innerWidth / 2;
    const y = fallbackY || window.innerHeight / 2;
    return { x, y, top: y, bottom: y };
}

export function shouldShowSelectionMenu(extensionEnabled: boolean, hasPopup: boolean, text: string): boolean {
    return extensionEnabled && !hasPopup && text.trim().length > 0;
}
