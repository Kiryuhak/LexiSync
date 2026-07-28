import { browser } from 'wxt/browser';
import type { HistoryItem, RequestMode } from './types';

export interface HistoryResult {
    mode: RequestMode;
    original: string;
    result: string;
    customName?: string;
}

export async function addSidepanelHistory(item: HistoryResult): Promise<void> {
    await browser.runtime.sendMessage({
        action: 'storageMutation',
        domain: 'history',
        mutation: 'add',
        payload: {
            item: {
                ...item,
                id: Date.now(),
                date: new Date().toISOString(),
            },
        },
    });
}

export async function renderSidepanelHistory(list: HTMLElement, onSelect: (item: HistoryItem) => void): Promise<void> {
    const stored = await browser.storage.local.get({ aiHistory: [] });
    const items = (Array.isArray(stored.aiHistory) ? (stored.aiHistory as HistoryItem[]) : [])
        .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || b.id - a.id)
        .slice(0, 6);
    if (!items.length) {
        const empty = document.createElement('span');
        empty.className = 'hint';
        empty.textContent = 'Здесь появятся последние результаты.';
        list.replaceChildren(empty);
        return;
    }
    list.replaceChildren(
        ...items.map((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'history-item';
            const title = document.createElement('strong');
            title.textContent = `${item.favorite ? '★ ' : ''}${item.customName || item.mode}`;
            const preview = document.createElement('span');
            preview.textContent = item.result;
            button.append(title, preview);
            button.onclick = () => onSelect(item);
            return button;
        }),
    );
}
