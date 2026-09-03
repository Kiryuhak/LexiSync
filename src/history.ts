import {
    clearHistory,
    deleteHistoryItem,
    getHistory,
    setHistoryItemFavorite,
    importHistoryItems,
    updateHistoryItemExplanation,
} from './history-store';
import type { HistoryItem, RequestMode } from './types';
import { localizeDocument, t } from './i18n';
import { upsertCustomCommand } from './settings-store';
import { applyAppearanceStyle } from './appearance-style';
import { copyText } from './clipboard';
import { sortHistoryItems, type HistorySortOption } from './history-sort';
import { formatHistoryAsCsv, formatHistoryAsMarkdown } from './history-export';
import { HISTORY_LIMIT } from './history-store';
import { logger } from './logger';
import { generateGrammarAnalytics } from './grammar-analytics';

const MODE_NAMES: Record<RequestMode, string> = {
    spellcheck: t('modeSpellcheck', 'Ошибки'),
    style: t('modeStyle', 'Стиль'),
    emoji: t('modeEmoji', 'Эмодзи'),
    layout: t('modeLayout', 'Раскладка'),
    translate: t('modeTranslate', 'Перевод'),
    summary: t('summaryShort', 'Выжимка'),
    tone: t('modeTone', 'Тональность'),
    continue: t('modeContinue', 'Дописать'),
    notes_to_doc: t('modeNotesToDoc', 'Заметки в текст'),
    headline: t('modeHeadline', 'Заголовки'),
    case_convert: t('modeCaseConvert', 'Регистр'),
    text_clean: t('modeTextClean', 'Очистка'),
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
const exportFormatSelect = document.getElementById('exportFormatSelect') as HTMLSelectElement | null;
const importBtn = document.getElementById('importBtn') as HTMLButtonElement | null;
const importFileInput = document.getElementById('importFileInput') as HTMLInputElement | null;
const favoriteFilter = document.getElementById('favoriteFilter') as HTMLButtonElement | null;
const sortFilter = document.getElementById('historySort') as HTMLSelectElement | null;
const resetFilterBtn = document.getElementById('resetFilterBtn') as HTMLButtonElement | null;
const historyStatus = document.getElementById('historyStatus');

const tabHistoryList = document.getElementById('tabHistoryList') as HTMLButtonElement | null;
const tabGrammarAnalytics = document.getElementById('tabGrammarAnalytics') as HTMLButtonElement | null;
const historyListView = document.getElementById('historyListView') as HTMLElement | null;
const grammarAnalyticsView = document.getElementById('grammarAnalyticsView') as HTMLElement | null;

const analyticsScoreVal = document.getElementById('analyticsScoreVal');
const analyticsScoreTitle = document.getElementById('analyticsScoreTitle');
const analyticsTotalRequests = document.getElementById('analyticsTotalRequests');
const analyticsTotalFixes = document.getElementById('analyticsTotalFixes');
const analyticsCleanRequests = document.getElementById('analyticsCleanRequests');
const analyticsBreakdownList = document.getElementById('analyticsBreakdownList');
const analyticsRulesGrid = document.getElementById('analyticsRulesGrid');

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

function appendHighlightedText(container: HTMLElement, text: string, query: string): void {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
        container.textContent = text;
        return;
    }
    const lowerText = text.toLowerCase();
    const lowerQuery = trimmedQuery.toLowerCase();
    let startIndex = 0;
    let matchIndex = lowerText.indexOf(lowerQuery, startIndex);

    if (matchIndex === -1) {
        container.textContent = text;
        return;
    }

    container.replaceChildren();
    while (matchIndex !== -1) {
        if (matchIndex > startIndex) {
            container.appendChild(document.createTextNode(text.slice(startIndex, matchIndex)));
        }
        const mark = document.createElement('mark');
        mark.className = 'history-search-match';
        mark.textContent = text.slice(matchIndex, matchIndex + trimmedQuery.length);
        container.appendChild(mark);
        startIndex = matchIndex + trimmedQuery.length;
        matchIndex = lowerText.indexOf(lowerQuery, startIndex);
    }
    if (startIndex < text.length) {
        container.appendChild(document.createTextNode(text.slice(startIndex)));
    }
}

function createTextBlock(labelText: string, value: string, result = false, query = ''): HTMLElement {
    const block = document.createElement('div');
    block.className = 'text-block';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = labelText;
    const content = document.createElement('div');
    content.className = result ? 'content result' : 'content';
    appendHighlightedText(content, value, query);
    block.append(label, content);
    return block;
}

function renderExplanationContent(container: HTMLElement, explanation: string, onHide: () => void): void {
    container.replaceChildren();

    const header = document.createElement('div');
    header.className = 'explanation-header';

    const title = document.createElement('span');
    title.className = 'explanation-title';
    title.textContent = t('explanationTitle', 'Разбор правил и ошибок');

    const actionWrap = document.createElement('div');
    actionWrap.className = 'explanation-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'explanation-btn';
    copyBtn.textContent = t('explanationCopy', 'Копировать');
    copyBtn.addEventListener('click', async () => {
        await copyText(explanation);
        copyBtn.textContent = t('explanationCopied', 'Скопировано!');
        setTimeout(() => {
            copyBtn.textContent = t('explanationCopy', 'Копировать');
        }, 2000);
    });

    const hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'explanation-btn';
    hideBtn.textContent = t('hideExplanation', 'Свернуть');
    hideBtn.addEventListener('click', onHide);

    actionWrap.append(copyBtn, hideBtn);
    header.append(title, actionWrap);

    const body = document.createElement('div');
    body.className = 'explanation-content';
    body.textContent = explanation;

    container.append(header, body);
}

const selectedItemIds = new Set<number>();

function updateBulkBarUI(): void {
    const bulkBar = document.getElementById('historyBulkBar');
    const countEl = document.getElementById('bulkSelectedCount');
    const selectAllCb = document.getElementById('bulkSelectAll') as HTMLInputElement | null;
    if (!bulkBar) return;

    if (selectedItemIds.size === 0) {
        bulkBar.hidden = true;
        if (selectAllCb) selectAllCb.checked = false;
    } else {
        bulkBar.hidden = false;
        if (countEl) countEl.textContent = `${t('bulkSelectedLabel', 'Выбрано')}: ${selectedItemIds.size}`;
        const filtered = getFilteredHistory();
        if (selectAllCb) {
            selectAllCb.checked = filtered.length > 0 && filtered.every((item) => selectedItemIds.has(item.id));
        }
    }
}

function createHistoryCard(item: HistoryItem): HTMLElement {
    const card = document.createElement('article');
    card.className = 'history-card';
    card.classList.toggle('is-favorite', item.favorite === true);
    const header = document.createElement('div');
    header.className = 'history-header';

    const selectCb = document.createElement('input');
    selectCb.type = 'checkbox';
    selectCb.className = 'history-card-select-cb';
    selectCb.dataset.id = String(item.id);
    selectCb.checked = selectedItemIds.has(item.id);
    selectCb.setAttribute('aria-label', t('selectRecord', 'Выбрать запись'));
    selectCb.addEventListener('change', () => {
        if (selectCb.checked) {
            selectedItemIds.add(item.id);
        } else {
            selectedItemIds.delete(item.id);
        }
        updateBulkBarUI();
    });
    header.appendChild(selectCb);

    const badge = document.createElement('span');
    badge.className = 'mode-badge';
    badge.textContent = item.customName || MODE_NAMES[item.mode] || item.mode;
    const date = document.createElement('span');
    date.textContent = new Date(item.date).toLocaleString(chrome.i18n.getUILanguage());
    header.append(badge, date);

    const explanationBlock = document.createElement('div');
    explanationBlock.className = 'explanation-block';
    explanationBlock.id = `history-explanation-${item.id}`;
    explanationBlock.setAttribute('role', 'region');
    explanationBlock.setAttribute('aria-label', t('explanationTitle', 'Разбор правил и ошибок'));
    explanationBlock.hidden = true;

    let isExplanationVisible = false;

    const toggleExplanation = async (btn: HTMLButtonElement) => {
        if (isExplanationVisible) {
            explanationBlock.hidden = true;
            isExplanationVisible = false;
            btn.setAttribute('aria-expanded', 'false');
            return;
        }

        explanationBlock.hidden = false;
        isExplanationVisible = true;
        btn.setAttribute('aria-expanded', 'true');

        if (item.explanation) {
            renderExplanationContent(explanationBlock, item.explanation, () => {
                explanationBlock.hidden = true;
                isExplanationVisible = false;
                btn.setAttribute('aria-expanded', 'false');
            });
            return;
        }

        // Индикатор загрузки при первом запросе разбора
        explanationBlock.replaceChildren();
        const loading = document.createElement('div');
        loading.className = 'explanation-loading';
        loading.setAttribute('role', 'status');
        loading.textContent = t('explanationLoading', 'Анализируем ошибки и правила...');
        explanationBlock.appendChild(loading);

        try {
            btn.disabled = true;
            const response = await chrome.runtime.sendMessage({
                action: 'explainHistoryGrammar',
                original: item.original,
                result: item.result,
                mode: item.mode,
            });

            if (response?.ok === true && typeof response.explanation === 'string' && response.explanation.trim()) {
                const explanationText = response.explanation.trim();
                item.explanation = explanationText;
                void updateHistoryItemExplanation(item.id, explanationText).catch((error) =>
                    logger.error('Не удалось сохранить разбор правил:', error),
                );
                renderExplanationContent(explanationBlock, explanationText, () => {
                    explanationBlock.hidden = true;
                    isExplanationVisible = false;
                    btn.setAttribute('aria-expanded', 'false');
                });
            } else {
                throw new Error(response?.error || t('explanationFailed', 'Не удалось получить разбор правил.'));
            }
        } catch (error) {
            explanationBlock.replaceChildren();
            const errDiv = document.createElement('div');
            errDiv.className = 'explanation-content';
            errDiv.style.color = '#d93025';
            errDiv.textContent =
                error instanceof Error ? error.message : t('explanationFailed', 'Не удалось получить разбор правил.');
            explanationBlock.appendChild(errDiv);
        } finally {
            btn.disabled = false;
        }
    };

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
                    tone: t(
                        'historyPromptTone',
                        'Проанализируй тональность и вежливость текста, предложив более вежливый и конструктивный вариант.',
                    ),
                    continue: t(
                        'historyPromptContinue',
                        'Логично продолжи мысль или предложение, сохраняя контекст и стиль.',
                    ),
                    notes_to_doc: t(
                        'historyPromptNotesToDoc',
                        'Преврати краткие тезисы и заметки в связный, профессионально оформленный текст.',
                    ),
                    headline: t(
                        'historyPromptHeadline',
                        'Предложи 3-5 привлекательных и ёмких вариантов заголовка для текста.',
                    ),
                    case_convert: t('caseConvertTitle', 'Смени регистр текста.'),
                    text_clean: t(
                        'cleanAll',
                        'Очисти текст от мусорных символов, лишних пробелов и оформи типографику.',
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
        (() => {
            const button = createButton(
                t('whySo', '💡 Почему так?'),
                'why-so-btn',
                async () => toggleExplanation(button),
                '',
            );
            button.setAttribute('aria-controls', explanationBlock.id);
            button.setAttribute('aria-expanded', 'false');
            return button;
        })(),
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

    const currentQuery = searchInput?.value.trim() || '';
    card.append(
        header,
        createTextBlock(t('original', 'Оригинал'), item.original, false, currentQuery),
        createTextBlock(t('aiResult', 'Результат AI'), item.result, true, currentQuery),
        explanationBlock,
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

function getDateGroup(dateStr: string): 'today' | 'yesterday' | 'this_week' | 'earlier' {
    const itemDate = new Date(dateStr);
    if (isNaN(itemDate.getTime())) return 'earlier';
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const weekStart = todayStart - 6 * 86400000;
    const t = itemDate.getTime();
    if (t >= todayStart) return 'today';
    if (t >= yesterdayStart) return 'yesterday';
    if (t >= weekStart) return 'this_week';
    return 'earlier';
}

function getGroupLabel(group: 'today' | 'yesterday' | 'this_week' | 'earlier'): string {
    switch (group) {
        case 'today':
            return t('historyGroupToday', 'Сегодня');
        case 'yesterday':
            return t('historyGroupYesterday', 'Вчера');
        case 'this_week':
            return t('historyGroupThisWeek', 'На этой неделе');
        case 'earlier':
            return t('historyGroupEarlier', 'Ранее');
    }
}

function renderHistory(): void {
    if (!historyList) return;
    activeHistoryObserver?.disconnect();
    activeHistoryObserver = null;
    historyList.replaceChildren();
    const filtered = getFilteredHistory();
    clearBtn?.classList.toggle('hidden', history.length === 0);
    exportBtn?.classList.toggle('hidden', history.length === 0);
    updateBulkBarUI();

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

    const isNewestSort = !sortFilter || sortFilter.value === 'newest';
    let lastRenderedGroup = '';

    const appendItemsWithGroups = (items: HistoryItem[], target: HTMLElement) => {
        for (const item of items) {
            if (isNewestSort) {
                const group = getDateGroup(item.date);
                if (group !== lastRenderedGroup) {
                    lastRenderedGroup = group;
                    const groupHeader = document.createElement('div');
                    groupHeader.className = 'history-date-group-header';
                    groupHeader.textContent = getGroupLabel(group);
                    target.appendChild(groupHeader);
                }
            }
            target.appendChild(createHistoryCard(item));
        }
    };

    const BATCH_SIZE = 40;
    const initialBatch = filtered.slice(0, BATCH_SIZE);
    appendItemsWithGroups(initialBatch, historyList);

    if (filtered.length > BATCH_SIZE && typeof IntersectionObserver !== 'undefined') {
        let renderedCount = BATCH_SIZE;
        const sentinel = document.createElement('div');
        sentinel.style.height = '10px';
        historyList.appendChild(sentinel);

        activeHistoryObserver = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting && renderedCount < filtered.length) {
                const nextBatch = filtered.slice(renderedCount, renderedCount + BATCH_SIZE);
                renderedCount += nextBatch.length;
                sentinel.before(
                    ...nextBatch.map((item) => {
                        const frag = document.createDocumentFragment();
                        if (isNewestSort) {
                            const group = getDateGroup(item.date);
                            if (group !== lastRenderedGroup) {
                                lastRenderedGroup = group;
                                const groupHeader = document.createElement('div');
                                groupHeader.className = 'history-date-group-header';
                                groupHeader.textContent = getGroupLabel(group);
                                frag.appendChild(groupHeader);
                            }
                        }
                        frag.appendChild(createHistoryCard(item));
                        return frag;
                    }),
                );
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
        appendItemsWithGroups(remainingBatch, historyList);
    }
}

function renderGrammarAnalytics(): void {
    const report = generateGrammarAnalytics(history);

    if (analyticsScoreVal) analyticsScoreVal.textContent = `${report.literacyScore}%`;
    if (analyticsScoreTitle) {
        if (report.literacyScore >= 90) {
            analyticsScoreTitle.textContent = t('literacyStatusGreat', 'Отличная грамотность текстов');
        } else if (report.literacyScore >= 75) {
            analyticsScoreTitle.textContent = t('literacyStatusGood', 'Хорошая грамотность, есть редкие неточности');
        } else {
            analyticsScoreTitle.textContent = t(
                'literacyStatusNeedsAttention',
                'Рекомендуем уделить внимание правилам',
            );
        }
    }
    if (analyticsTotalRequests) analyticsTotalRequests.textContent = String(report.totalEntries);
    if (analyticsTotalFixes) analyticsTotalFixes.textContent = String(report.totalCorrections);
    if (analyticsCleanRequests) analyticsCleanRequests.textContent = String(report.cleanEntriesCount);

    if (analyticsBreakdownList) {
        analyticsBreakdownList.replaceChildren();
        if (report.totalCorrections === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.style.marginTop = '10px';
            empty.textContent = t(
                'noGrammarErrorsFound',
                'В вашей истории не обнаружено частых ошибок! Отличный результат.',
            );
            analyticsBreakdownList.appendChild(empty);
        } else {
            for (const item of report.categories) {
                if (item.count === 0) continue;
                const row = document.createElement('div');
                row.className = 'breakdown-row';

                const header = document.createElement('div');
                header.className = 'breakdown-header';

                const nameWrap = document.createElement('div');
                nameWrap.className = 'breakdown-name';
                nameWrap.textContent = `${item.category.icon} ${item.category.titleRu}`;

                const countWrap = document.createElement('div');
                countWrap.className = 'breakdown-count';
                countWrap.textContent = `${item.count} (${item.percentage}%)`;

                header.append(nameWrap, countWrap);

                const barWrap = document.createElement('div');
                barWrap.className = 'breakdown-bar-wrap';
                const barFill = document.createElement('div');
                barFill.className = 'breakdown-bar-fill';
                barFill.style.width = `${item.percentage}%`;
                barFill.style.background = item.category.color;
                barWrap.appendChild(barFill);

                row.append(header, barWrap);
                analyticsBreakdownList.appendChild(row);
            }
        }
    }

    const topWordFixesSection = document.getElementById('topWordFixesSection');
    const topWordFixesList = document.getElementById('topWordFixesList');
    if (topWordFixesSection && topWordFixesList) {
        if (report.topWordFixes && report.topWordFixes.length > 0) {
            topWordFixesSection.hidden = false;
            topWordFixesList.replaceChildren();
            for (const fix of report.topWordFixes) {
                const chip = document.createElement('div');
                chip.className = 'top-fix-chip';
                const orig = document.createElement('span');
                orig.className = 'top-fix-orig';
                orig.textContent = fix.original;
                const arrow = document.createElement('span');
                arrow.className = 'top-fix-arrow';
                arrow.textContent = '→';
                const res = document.createElement('span');
                res.className = 'top-fix-res';
                res.textContent = fix.corrected;
                const count = document.createElement('span');
                count.className = 'top-fix-count';
                count.textContent = `×${fix.count}`;
                chip.append(orig, arrow, res, count);
                topWordFixesList.appendChild(chip);
            }
        } else {
            topWordFixesSection.hidden = true;
        }
    }

    if (analyticsRulesGrid) {
        analyticsRulesGrid.replaceChildren();
        for (const rule of report.helpfulRules) {
            const card = document.createElement('div');
            card.className = 'rule-card';

            const cardHeader = document.createElement('div');
            cardHeader.className = 'rule-card-header';
            cardHeader.textContent = `${rule.icon} ${rule.titleRu}`;

            const hint = document.createElement('div');
            hint.className = 'rule-card-hint';
            hint.textContent = rule.ruleHintRu;

            const example = document.createElement('div');
            example.className = 'rule-card-example';
            example.textContent = `💡 Пример: ${rule.exampleRu}`;

            card.append(cardHeader, hint, example);
            analyticsRulesGrid.appendChild(card);
        }
    }
}

function switchHistoryTab(tab: 'list' | 'analytics'): void {
    if (tab === 'list') {
        tabHistoryList?.classList.add('is-active');
        tabHistoryList?.setAttribute('aria-selected', 'true');
        tabHistoryList?.setAttribute('tabindex', '0');
        tabGrammarAnalytics?.classList.remove('is-active');
        tabGrammarAnalytics?.setAttribute('aria-selected', 'false');
        tabGrammarAnalytics?.setAttribute('tabindex', '-1');
        if (historyListView) historyListView.hidden = false;
        if (grammarAnalyticsView) grammarAnalyticsView.hidden = true;
    } else {
        tabGrammarAnalytics?.classList.add('is-active');
        tabGrammarAnalytics?.setAttribute('aria-selected', 'true');
        tabGrammarAnalytics?.setAttribute('tabindex', '0');
        tabHistoryList?.classList.remove('is-active');
        tabHistoryList?.setAttribute('aria-selected', 'false');
        tabHistoryList?.setAttribute('tabindex', '-1');
        if (historyListView) historyListView.hidden = true;
        if (grammarAnalyticsView) grammarAnalyticsView.hidden = false;
        renderGrammarAnalytics();
    }
}

tabHistoryList?.addEventListener('click', () => switchHistoryTab('list'));
tabGrammarAnalytics?.addEventListener('click', () => switchHistoryTab('analytics'));

function setupBulkActions(): void {
    const selectAllCb = document.getElementById('bulkSelectAll') as HTMLInputElement | null;
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    const bulkExportCsvBtn = document.getElementById('bulkExportCsvBtn');

    selectAllCb?.addEventListener('change', () => {
        const filtered = getFilteredHistory();
        if (selectAllCb.checked) {
            filtered.forEach((item) => selectedItemIds.add(item.id));
        } else {
            selectedItemIds.clear();
        }
        document.querySelectorAll<HTMLInputElement>('.history-card-select-cb').forEach((cb) => {
            const id = Number(cb.dataset.id);
            cb.checked = !isNaN(id) ? selectedItemIds.has(id) : false;
        });
        updateBulkBarUI();
    });

    bulkDeleteBtn?.addEventListener('click', async () => {
        if (selectedItemIds.size === 0) return;
        const count = selectedItemIds.size;
        for (const id of selectedItemIds) {
            await deleteHistoryItem(id);
        }
        history = history.filter((item) => !selectedItemIds.has(item.id));
        selectedItemIds.clear();
        updateBulkBarUI();
        renderHistory();
        showHistoryStatus(`${t('deleteSelected', 'Удалено записей')}: ${count}`, 'success');
    });

    bulkExportCsvBtn?.addEventListener('click', () => {
        const itemsToExport = history.filter((item) => selectedItemIds.has(item.id));
        if (itemsToExport.length === 0) return;
        const csvContent = formatHistoryAsCsv(itemsToExport);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = `lexisync-selected-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}

async function initialize(): Promise<void> {
    localizeDocument();
    const theme = await chrome.storage.local.get({ selectedTheme: 'auto', visualStyle: 'liquid-glass' });
    const dark =
        theme.selectedTheme === 'dark' ||
        (theme.selectedTheme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    applyAppearanceStyle(document.documentElement, theme.visualStyle);
    setupBulkActions();
    history = await getHistory();
    renderHistory();
    renderGrammarAnalytics();
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
function syncFilterChips(): void {
    const currentMode = modeFilter?.value || 'all';
    document.querySelectorAll<HTMLButtonElement>('.history-chip').forEach((chip) => {
        const filter = chip.dataset.filter;
        if (favoritesOnly && filter === 'favorites') {
            chip.classList.add('is-active');
        } else if (!favoritesOnly && filter === currentMode) {
            chip.classList.add('is-active');
        } else {
            chip.classList.remove('is-active');
        }
    });
}

document.querySelectorAll<HTMLButtonElement>('.history-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
        document.querySelectorAll('.history-chip').forEach((c) => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        const filter = chip.dataset.filter;
        if (filter === 'favorites') {
            favoritesOnly = true;
            favoriteFilter?.setAttribute('aria-pressed', 'true');
            if (modeFilter) modeFilter.value = 'all';
        } else {
            favoritesOnly = false;
            favoriteFilter?.setAttribute('aria-pressed', 'false');
            if (modeFilter && filter) modeFilter.value = filter;
        }
        renderHistory();
    });
});

modeFilter?.addEventListener('change', () => {
    syncFilterChips();
    renderHistory();
});
sortFilter?.addEventListener('change', renderHistory);
favoriteFilter?.addEventListener('click', () => {
    favoritesOnly = !favoritesOnly;
    favoriteFilter.setAttribute('aria-pressed', String(favoritesOnly));
    syncFilterChips();
    renderHistory();
});
resetFilterBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    if (modeFilter) modeFilter.value = 'all';
    if (sortFilter) sortFilter.value = 'newest';
    favoritesOnly = false;
    favoriteFilter?.setAttribute('aria-pressed', 'false');
    syncFilterChips();
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
            const format = exportFormatSelect?.value || 'json';
            const dateStr = new Date().toISOString().slice(0, 10);
            let blob: Blob;
            let filename: string;

            if (format === 'csv') {
                blob = new Blob([formatHistoryAsCsv(history)], { type: 'text/csv;charset=utf-8' });
                filename = `lexisync-history-${dateStr}.csv`;
            } else if (format === 'md') {
                blob = new Blob([formatHistoryAsMarkdown(history, MODE_NAMES)], {
                    type: 'text/markdown;charset=utf-8',
                });
                filename = `lexisync-history-${dateStr}.md`;
            } else {
                blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json;charset=utf-8' });
                filename = `lexisync-history-${dateStr}.json`;
            }

            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.href = url;
            link.download = filename;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        },
        t('historyExported', 'Файл истории подготовлен.'),
    );
});

importBtn?.addEventListener('click', () => {
    importFileInput?.click();
});

importFileInput?.addEventListener('change', async () => {
    const file = importFileInput.files?.[0];
    if (!file) return;

    try {
        if (file.size > 2 * 1024 * 1024) {
            throw new UserFacingHistoryError(t('historyFileTooLarge', 'Файл истории не должен превышать 2 МБ.'));
        }
        const text = await file.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new UserFacingHistoryError(t('invalidImportFormat', 'Неверный формат файла: ожидается массив JSON'));
        }
        if (!Array.isArray(parsed)) {
            throw new UserFacingHistoryError(t('invalidImportFormat', 'Неверный формат файла: ожидается массив JSON'));
        }
        if (parsed.length > HISTORY_LIMIT) {
            throw new UserFacingHistoryError(
                t('historyImportLimit', 'За один раз можно импортировать не более 500 записей.'),
            );
        }
        const count = await importHistoryItems(parsed);
        history = await getHistory();
        renderHistory();
        showHistoryStatus(`${t('historyImported', 'Импортировано записей')}: ${count}`, 'success');
    } catch (err) {
        showHistoryStatus(
            err instanceof Error ? err.message : t('historyImportFailed', 'Ошибка при импорте файла'),
            'error',
        );
    } finally {
        importFileInput.value = '';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    void initialize().catch(() => {
        showHistoryStatus(t('historyLoadFailed', 'Не удалось загрузить историю. Перезагрузите страницу.'), 'error');
    });
});
