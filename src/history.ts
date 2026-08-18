import { clearHistory, deleteHistoryItem, getHistory, setHistoryItemFavorite } from './history-store';
import type { HistoryItem, RequestMode } from './types';
import { localizeDocument, t } from './i18n';
import { upsertCustomCommand } from './settings-store';
import { applyAppearanceStyle } from './appearance-style';
import { copyText } from './clipboard';
import { sortHistoryItems, type HistorySortOption } from './history-sort';

const MODE_NAMES: Record<RequestMode, string> = {
    spellcheck: t('modeSpellcheck', 'Ошибки'),
    style: t('modeStyle', 'Стиль'),
    emoji: t('modeEmoji', 'Эмодзи'),
    layout: t('modeLayout', 'Раскладка'),
    translate: t('modeTranslate', 'Перевод'),
    summary: t('summaryShort', 'Выжимка'),
    reply: t('modeReply', 'Ответ'),
    explain: t('modeExplain', 'Объяснить'),
    format: t('modeFormat', 'Формат'),
    ocr: 'OCR',
    custom: t('commands', 'Команда'),
};

const historyList = document.getElementById('historyList');
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement | null;
const searchInput = document.getElementById('historySearch') as HTMLInputElement | null;
const modeFilter = document.getElementById('modeFilter') as HTMLSelectElement | null;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement | null;
const favoriteFilter = document.getElementById('favoriteFilter') as HTMLButtonElement | null;
const sortFilter = document.getElementById('historySort') as HTMLSelectElement | null;
const resetFilterBtn = document.getElementById('resetFilterBtn') as HTMLButtonElement | null;
const historyStatus = document.getElementById('historyStatus');
let history: HistoryItem[] = [];
let favoritesOnly = false;

type HistoryStatusKind = 'success' | 'error';

class UserFacingHistoryError extends Error {}

function showHistoryStatus(message: string, kind: HistoryStatusKind): void {
    if (!historyStatus) return;
    historyStatus.textContent = message;
    historyStatus.dataset.kind = kind;
}

function getHistoryErrorMessage(error: unknown): string {
    return error instanceof UserFacingHistoryError
        ? error.message
        : t('historyActionFailed', 'Не удалось выполнить действие с историей. Попробуйте ещё раз.');
}

async function runHistoryAction(
    button: HTMLButtonElement,
    action: () => void | Promise<void>,
    successMessage: string,
): Promise<void> {
    if (button.dataset.busy === 'true') return;
    if (historyStatus) {
        historyStatus.textContent = '';
        delete historyStatus.dataset.kind;
    }
    button.dataset.busy = 'true';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
        await action();
        showHistoryStatus(successMessage, 'success');
    } catch (error) {
        showHistoryStatus(getHistoryErrorMessage(error), 'error');
    } finally {
        delete button.dataset.busy;
        button.disabled = false;
        button.removeAttribute('aria-busy');
    }
}

function createButton(
    text: string,
    className: string,
    action: () => void | Promise<void>,
    successMessage: string,
): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    button.addEventListener('click', () => void runHistoryAction(button, action, successMessage));
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
    const nextFavorite = item.favorite !== true;
    actions.append(
        createButton(
            item.favorite
                ? `★ ${t('removeFavorite', 'Убрать из избранного')}`
                : `☆ ${t('addFavorite', 'Добавить в избранное')}`,
            'secondary-btn',
            async () => {
                await setHistoryItemFavorite(item.id, nextFavorite);
                item.favorite = nextFavorite;
                renderHistory();
            },
            nextFavorite
                ? t('historyFavoriteAdded', 'Добавлено в избранное.')
                : t('historyFavoriteRemoved', 'Удалено из избранного.'),
        ),
        createButton(
            t('copyResult', 'Копировать результат'),
            'secondary-btn',
            async () => {
                await copyText(item.result);
            },
            t('historyResultCopied', 'Результат скопирован.'),
        ),
        createButton(
            t('runAgain', 'Повторить на странице'),
            'secondary-btn',
            async () => {
                const response = await chrome.runtime.sendMessage({ action: 'replayHistoryItem', item });
                if (response?.ok !== true) {
                    const missingPageMessage = t('historyReplayPageMissing', 'Не найдена открытая веб-страница.');
                    if (response?.error === missingPageMessage) throw new UserFacingHistoryError(missingPageMessage);
                    throw new Error('HISTORY_REPLAY_FAILED');
                }
            },
            t('historyReplayStarted', 'Команда отправлена на открытую страницу.'),
        ),
        createButton(
            t('saveAsCommand', 'Сохранить как команду'),
            'secondary-btn',
            async () => {
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
                    summary: t(
                        'historyPromptSummary',
                        'Сделай структурированную и ёмкую выжимку текста (TL;DR) с ключевыми тезисами.',
                    ),
                    reply: t(
                        'historyPromptReply',
                        'Сформулируй готовый к отправке вежливый и конструктивный ответ на это сообщение.',
                    ),
                    explain: t(
                        'historyPromptExplain',
                        'Объясни смысл этого текста или термина простыми словами с наглядными примерами.',
                    ),
                    format: t(
                        'historyPromptFormat',
                        'Очисти текст от лишних переносов и оформи его в аккуратный структурированный вид.',
                    ),
                    ocr: t('historyPromptOcr', 'Приведи распознанный текст в аккуратный читаемый вид.'),
                    custom: `${t('historyPromptCustom', 'Обработай текст по аналогии с этим результатом:')} ${item.result.slice(0, 500)}`,
                };
                await upsertCustomCommand({
                    id: crypto.randomUUID(),
                    name: (item.customName || MODE_NAMES[item.mode]).slice(0, 40),
                    prompt: promptByMode[item.mode].slice(0, 2000),
                });
            },
            t('historyCommandSaved', 'Команда сохранена в настройках.'),
        ),
        createButton(
            t('delete', 'Удалить'),
            'delete-btn',
            async () => {
                await deleteHistoryItem(item.id);
                history = history.filter((entry) => entry.id !== item.id);
                renderHistory();
            },
            t('historyItemDeleted', 'Запись удалена.'),
        ),
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
    const filtered = history.filter((item) => {
        const matchesMode = mode === 'all' || item.mode === mode;
        const matchesQuery = !query || `${item.original}\n${item.result}`.toLocaleLowerCase(locale).includes(query);
        return matchesMode && matchesQuery && (!favoritesOnly || item.favorite === true);
    });
    const sort = sortFilter?.value as HistorySortOption;
    return sortHistoryItems(filtered, sort === 'oldest' || sort === 'favorites' ? sort : 'newest');
}

let activeHistoryObserver: IntersectionObserver | null = null;

function renderHistory(): void {
    if (!historyList) return;
    activeHistoryObserver?.disconnect();
    activeHistoryObserver = null;
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

    const BATCH_SIZE = 40;
    const initialBatch = filtered.slice(0, BATCH_SIZE);
    historyList.append(...initialBatch.map(createHistoryCard));

    if (filtered.length > BATCH_SIZE && typeof IntersectionObserver !== 'undefined') {
        let renderedCount = BATCH_SIZE;
        const sentinel = document.createElement('div');
        sentinel.style.height = '10px';
        historyList.appendChild(sentinel);

        activeHistoryObserver = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting && renderedCount < filtered.length) {
                const nextBatch = filtered.slice(renderedCount, renderedCount + BATCH_SIZE);
                renderedCount += nextBatch.length;
                sentinel.before(...nextBatch.map(createHistoryCard));
                if (renderedCount >= filtered.length) {
                    activeHistoryObserver?.disconnect();
                    activeHistoryObserver = null;
                    sentinel.remove();
                }
            }
        });
        activeHistoryObserver.observe(sentinel);
    } else if (filtered.length > BATCH_SIZE) {
        const remainingBatch = filtered.slice(BATCH_SIZE);
        historyList.append(...remainingBatch.map(createHistoryCard));
    }
}

async function initialize(): Promise<void> {
    localizeDocument();
    const theme = await chrome.storage.local.get({ selectedTheme: 'auto', visualStyle: 'liquid-glass' });
    const dark =
        theme.selectedTheme === 'dark' ||
        (theme.selectedTheme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    applyAppearanceStyle(document.documentElement, theme.visualStyle);
    history = await getHistory();
    renderHistory();
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function handleSearchInput(): void {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        searchDebounceTimer = null;
        renderHistory();
    }, 120);
}

searchInput?.addEventListener('input', handleSearchInput);
searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && searchInput.value) {
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = null;
        }
        searchInput.value = '';
        renderHistory();
    }
});
modeFilter?.addEventListener('change', renderHistory);
sortFilter?.addEventListener('change', renderHistory);
favoriteFilter?.addEventListener('click', () => {
    favoritesOnly = !favoritesOnly;
    favoriteFilter.setAttribute('aria-pressed', String(favoritesOnly));
    renderHistory();
});
resetFilterBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    if (modeFilter) modeFilter.value = 'all';
    if (sortFilter) sortFilter.value = 'newest';
    favoritesOnly = false;
    favoriteFilter?.setAttribute('aria-pressed', 'false');
    renderHistory();
});
clearBtn?.addEventListener('click', async () => {
    if (!confirm(t('confirmClearHistory', 'Удалить всю историю запросов? Это действие нельзя отменить.'))) return;
    await runHistoryAction(
        clearBtn,
        async () => {
            await clearHistory();
            history = [];
            renderHistory();
        },
        t('historyCleared', 'История очищена.'),
    );
});
exportBtn?.addEventListener('click', () => {
    void runHistoryAction(
        exportBtn,
        () => {
            const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.href = url;
            link.download = `lexisync-history-${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        },
        t('historyExported', 'Файл истории подготовлен.'),
    );
});

document.addEventListener('DOMContentLoaded', () => {
    void initialize().catch(() => {
        showHistoryStatus(t('historyLoadFailed', 'Не удалось загрузить историю. Перезагрузите страницу.'), 'error');
    });
});
