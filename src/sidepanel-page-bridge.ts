import { browser } from 'wxt/browser';

async function getActiveTabId(): Promise<number> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Активная вкладка не найдена.');
    return tab.id;
}

export async function readPageSelection(): Promise<string> {
    const tabId = await getActiveTabId();
    const [result] = await browser.scripting.executeScript({
        target: { tabId },
        func: () => {
            const active = document.activeElement;
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
                return active.value.slice(active.selectionStart || 0, active.selectionEnd || 0);
            }
            return window.getSelection()?.toString() || '';
        },
    });
    const text = String(result?.result || '');
    if (!text) throw new Error('На странице нет выделенного текста.');
    return text;
}

export async function applyResultToPage(text: string): Promise<void> {
    if (!text) throw new Error('Нет текста для замены.');
    const tabId = await getActiveTabId();
    const response = await browser.runtime.sendMessage({ action: 'sidepanelApplyResult', tabId, text });
    if (response?.ok !== true) {
        throw new Error(response?.error || 'Сначала поставьте курсор или выделите текст на странице.');
    }
}

export async function undoResultOnPage(): Promise<void> {
    const tabId = await getActiveTabId();
    const response = await browser.runtime.sendMessage({ action: 'sidepanelUndoResult', tabId });
    if (response?.ok !== true) throw new Error(response?.error || 'Нет замены, которую можно отменить.');
}
