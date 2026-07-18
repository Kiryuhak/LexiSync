import { clearHistory, deleteHistoryItem, getHistory } from './history-store';
import type { HistoryItem, RequestMode } from './types';
import { t } from './i18n';

const MODE_NAMES: Record<RequestMode, string> = {
    spellcheck: 'Ошибки',
    style: 'Стиль',
    emoji: 'Эмодзи',
    layout: 'Раскладка',
    translate: 'Перевод',
    ocr: 'OCR',
    custom: t('commands', 'Команда'),
};

const historyList = document.getElementById('historyList');
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement | null;
const searchInput = document.getElementById('historySearch') as HTMLInputElement | null;
const modeFilter = document.getElementById('modeFilter') as HTMLSelectElement | null;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement | null;
let history: HistoryItem[] = [];

function createButton(text: string, className: string, action: () => void | Promise<void>): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    button.addEventListener('click', () => void action());
    return button;
}

function createTextBlock(labelText: string, value: string, result = false): HTMLElement {
    const block = document.createElement('div');
    block.className = 'text-block';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = labelText;
    const content = document.createElement('div');
    content.className = result ? 'content result' : 'content';
    content.textContent = value;
    block.append(label, content);
    return block;
}

function createHistoryCard(item: HistoryItem): HTMLElement {
    const card = document.createElement('article');
    card.className = 'history-card';
    const header = document.createElement('div');
    header.className = 'history-header';
    const badge = document.createElement('span');
    badge.className = 'mode-badge';
    badge.textContent = item.customName || MODE_NAMES[item.mode] || item.mode;
    const date = document.createElement('span');
    date.textContent = new Date(item.date).toLocaleString('ru-RU');
    header.append(badge, date);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.append(
        createButton('Копировать результат', 'secondary-btn', async () => {
            await navigator.clipboard.writeText(item.result);
        }),
        createButton('Удалить', 'delete-btn', async () => {
            await deleteHistoryItem(item.id);
            history = history.filter((entry) => entry.id !== item.id);
            renderHistory();
        }),
    );

    card.append(
        header,
        createTextBlock('Оригинал', item.original),
        createTextBlock('Результат ИИ', item.result, true),
        actions,
    );
    return card;
}

function getFilteredHistory(): HistoryItem[] {
    const query = searchInput?.value.trim().toLocaleLowerCase('ru-RU') || '';
    const mode = modeFilter?.value || 'all';
    return history.filter((item) => {
        const matchesMode = mode === 'all' || item.mode === mode;
        const matchesQuery = !query || `${item.original}\n${item.result}`.toLocaleLowerCase('ru-RU').includes(query);
        return matchesMode && matchesQuery;
    });
}

function renderHistory(): void {
    if (!historyList) return;
    historyList.replaceChildren();
    const filtered = getFilteredHistory();
    clearBtn?.classList.toggle('hidden', history.length === 0);
    exportBtn?.classList.toggle('hidden', history.length === 0);

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = history.length === 0
            ? 'История пуста. Успешные результаты появятся здесь.'
            : 'По вашему запросу ничего не найдено.';
        historyList.appendChild(empty);
        return;
    }
    historyList.append(...filtered.map(createHistoryCard));
}

async function initialize(): Promise<void> {
    history = await getHistory();
    renderHistory();
}

searchInput?.addEventListener('input', renderHistory);
modeFilter?.addEventListener('change', renderHistory);
clearBtn?.addEventListener('click', async () => {
    if (!confirm('Удалить всю историю запросов? Это действие нельзя отменить.')) return;
    await clearHistory();
    history = [];
    renderHistory();
});
exportBtn?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `lexisync-history-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
});

document.addEventListener('DOMContentLoaded', () => void initialize());
