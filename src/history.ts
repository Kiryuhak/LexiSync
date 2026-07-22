import { clearHistory, deleteHistoryItem, getHistory, setHistoryItemFavorite } from './history-store';
import type { CustomCommand, HistoryItem, RequestMode } from './types';
import { localizeDocument, t } from './i18n';

const MODE_NAMES: Record<RequestMode, string> = {
    spellcheck: t('modeSpellcheck', 'Ошибки'),
    style: t('modeStyle', 'Стиль'),
    emoji: t('modeEmoji', 'Эмодзи'),
    layout: t('modeLayout', 'Раскладка'),
    translate: t('modeTranslate', 'Перевод'),
    ocr: 'OCR',
    custom: t('commands', 'Команда'),
};

const historyList = document.getElementById('historyList');
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement | null;
const searchInput = document.getElementById('historySearch') as HTMLInputElement | null;
const modeFilter = document.getElementById('modeFilter') as HTMLSelectElement | null;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement | null;
const favoriteFilter = document.getElementById('favoriteFilter') as HTMLButtonElement | null;
let history: HistoryItem[] = [];
let favoritesOnly = false;

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
    card.classList.toggle('is-favorite', item.favorite === true);
    const header = document.createElement('div');
    header.className = 'history-header';
    const badge = document.createElement('span');
    badge.className = 'mode-badge';
    badge.textContent = item.customName || MODE_NAMES[item.mode] || item.mode;
    const date = document.createElement('span');
    date.textContent = new Date(item.date).toLocaleString(chrome.i18n.getUILanguage());
    header.append(badge, date);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.append(
        createButton(
            item.favorite
                ? `★ ${t('removeFavorite', 'Убрать из избранного')}`
                : `☆ ${t('addFavorite', 'Добавить в избранное')}`,
            'secondary-btn',
            async () => {
                item.favorite = !item.favorite;
                await setHistoryItemFavorite(item.id, item.favorite);
                renderHistory();
            },
        ),
        createButton(t('copyResult', 'Копировать результат'), 'secondary-btn', async () => {
            await navigator.clipboard.writeText(item.result);
        }),
        createButton(t('runAgain', 'Повторить на странице'), 'secondary-btn', async () => {
            await chrome.runtime.sendMessage({ action: 'replayHistoryItem', item });
        }),
        createButton(t('saveAsCommand', 'Сохранить как команду'), 'secondary-btn', async () => {
            const stored = await chrome.storage.local.get({ customCommands: [] });
            const commands = Array.isArray(stored.customCommands) ? (stored.customCommands as CustomCommand[]) : [];
            if (commands.length >= 8) return;
            const promptByMode: Record<RequestMode, string> = {
                spellcheck: t(
                    'historyPromptSpellcheck',
                    'Исправь орфографические, грамматические и пунктуационные ошибки, сохранив формулировки.',
                ),
                style: `${t('historyPromptStyle', 'Перепиши текст в стиле этого примера результата:')} ${item.result.slice(0, 500)}`,
                emoji: t('historyPromptEmoji', 'Добавь подходящие по смыслу эмодзи, не перегружая текст.'),
                layout: t('historyPromptLayout', 'Исправь текст, набранный в неправильной раскладке.'),
                translate: t(
                    'historyPromptTranslate',
                    'Переведи текст, сохранив смысл, терминологию и форматирование.',
                ),
                ocr: t('historyPromptOcr', 'Приведи распознанный текст в аккуратный читаемый вид.'),
                custom: `${t('historyPromptCustom', 'Обработай текст по аналогии с этим результатом:')} ${item.result.slice(0, 500)}`,
            };
            commands.push({
                id: crypto.randomUUID(),
                name: (item.customName || MODE_NAMES[item.mode]).slice(0, 40),
                prompt: promptByMode[item.mode].slice(0, 2000),
            });
            await chrome.storage.local.set({ customCommands: commands });
        }),
        createButton(t('delete', 'Удалить'), 'delete-btn', async () => {
            await deleteHistoryItem(item.id);
            history = history.filter((entry) => entry.id !== item.id);
            renderHistory();
        }),
    );

    card.append(
        header,
        createTextBlock(t('original', 'Оригинал'), item.original),
        createTextBlock(t('aiResult', 'Результат AI'), item.result, true),
        actions,
    );
    return card;
}

function getFilteredHistory(): HistoryItem[] {
    const locale = chrome.i18n.getUILanguage();
    const query = searchInput?.value.trim().toLocaleLowerCase(locale) || '';
    const mode = modeFilter?.value || 'all';
    return history.filter((item) => {
        const matchesMode = mode === 'all' || item.mode === mode;
        const matchesQuery = !query || `${item.original}\n${item.result}`.toLocaleLowerCase(locale).includes(query);
        return matchesMode && matchesQuery && (!favoritesOnly || item.favorite === true);
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
        empty.textContent =
            history.length === 0
                ? t('historyEmpty', 'История пуста. Успешные результаты появятся здесь.')
                : t('historyNoMatches', 'По вашему запросу ничего не найдено.');
        historyList.appendChild(empty);
        return;
    }
    historyList.append(...filtered.map(createHistoryCard));
}

async function initialize(): Promise<void> {
    localizeDocument();
    const theme = await chrome.storage.local.get({ selectedTheme: 'auto' });
    const dark =
        theme.selectedTheme === 'dark' ||
        (theme.selectedTheme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.toggleAttribute('data-theme', dark);
    history = await getHistory();
    renderHistory();
}

searchInput?.addEventListener('input', renderHistory);
modeFilter?.addEventListener('change', renderHistory);
favoriteFilter?.addEventListener('click', () => {
    favoritesOnly = !favoritesOnly;
    favoriteFilter.setAttribute('aria-pressed', String(favoritesOnly));
    renderHistory();
});
clearBtn?.addEventListener('click', async () => {
    if (!confirm(t('confirmClearHistory', 'Удалить всю историю запросов? Это действие нельзя отменить.'))) return;
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
