import { t } from './i18n';
import {
    getWordCorrections,
    renderSpellcheckDiffFragment,
    resolveCorrections,
    type WordCorrection,
} from './spellcheck';
import { addPersonalDictionaryWord } from './settings-store';
import { GRAMMAR_CATEGORIES } from './grammar-analytics';

export interface SpellcheckUiController {
    setResult: (original: string, corrected: string, corrections?: WordCorrection[]) => void;
    getResult: (fallback: string) => string;
}

interface SpellcheckUiOptions {
    contentPane: HTMLElement;
    correctionsContainer: HTMLElement;
    compactDetails: HTMLElement;
    isCompact: () => boolean;
    onResultChange: (result: string) => void;
    adjustPosition: () => void;
}

export function createSpellcheckUi(options: SpellcheckUiOptions): SpellcheckUiController {
    let original = '';
    let corrected = '';
    let corrections: WordCorrection[] = [];
    const rejected = new Set<number>();

    const getResult = (fallback: string) =>
        corrected ? resolveCorrections(corrected, corrections, rejected) : fallback;

    const decorateMarks = () => {
        for (const mark of options.contentPane.querySelectorAll<HTMLElement>('mark[data-token-index]')) {
            const correction = corrections.find((item) => item.tokenIndex === Number(mark.dataset.tokenIndex));
            if (!correction) continue;
            const description = `${correction.original.trim() || '∅'} → ${correction.corrected.trim() || '∅'}`;
            const catInfo = correction.category ? GRAMMAR_CATEGORIES[correction.category] : undefined;
            const hintText = catInfo?.ruleHintRu ? ` • ${catInfo.ruleHintRu}` : '';
            if (mark.title) {
                mark.setAttribute('aria-label', mark.title);
            } else {
                mark.title = `${description}${hintText}`;
                mark.setAttribute('aria-label', `${t('correctionDetails', 'Исправление')}: ${description}`);
            }
            mark.setAttribute('role', 'button');
            mark.tabIndex = 0;
        }
    };

    const renderCorrectionRows = () => {
        options.correctionsContainer.replaceChildren();
        if (options.isCompact()) {
            options.correctionsContainer.style.display = 'none';
            return;
        }
        options.correctionsContainer.style.display = corrections.length > 0 ? 'flex' : 'none';
        if (corrections.length === 0) return;

        // Панель массовых действий и счётчика
        const header = document.createElement('div');
        header.className = 'lexisync-corrections-header';
        header.style.cssText =
            'display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px; font-size:12px;';

        const summary = document.createElement('span');
        summary.style.cssText = 'font-weight:600; color:var(--text-secondary);';
        summary.textContent = `${t('correctionsFound', 'Исправлений')}: ${corrections.length}`;

        const batchActions = document.createElement('div');
        batchActions.style.cssText = 'display:flex; gap:6px;';

        const acceptAllBtn = document.createElement('button');
        acceptAllBtn.type = 'button';
        acceptAllBtn.className = 'lexisync-batch-btn';
        acceptAllBtn.textContent = t('acceptAllCorrections', 'Принять все');
        acceptAllBtn.title = t('acceptAllCorrectionsHint', 'Принять все предложенные исправления');
        acceptAllBtn.style.cssText =
            'border:0; border-radius:6px; padding:3px 8px; cursor:pointer; background:var(--bg-secondary); color:var(--text-primary); font-size:11px;';
        acceptAllBtn.onclick = () => {
            rejected.clear();
            render();
            options.onResultChange(getResult(corrected));
        };

        const rejectAllBtn = document.createElement('button');
        rejectAllBtn.type = 'button';
        rejectAllBtn.className = 'lexisync-batch-btn';
        rejectAllBtn.textContent = t('restoreAllCorrections', 'Вернуть все');
        rejectAllBtn.title = t('restoreAllCorrectionsHint', 'Оставить весь исходный текст без изменений');
        rejectAllBtn.style.cssText = acceptAllBtn.style.cssText;
        rejectAllBtn.onclick = () => {
            for (const item of corrections) rejected.add(item.tokenIndex);
            render();
            options.onResultChange(getResult(corrected));
        };

        batchActions.append(acceptAllBtn, rejectAllBtn);
        header.append(summary, batchActions);
        options.correctionsContainer.appendChild(header);

        for (const correction of corrections) {
            const row = document.createElement('div');
            row.className = 'lexisync-correction-row';
            row.style.cssText =
                'display:flex; align-items:center; gap:7px; padding:7px 9px; border:1px solid var(--border-color); border-radius:8px; font-size:12px;';

            const catInfo = correction.category ? GRAMMAR_CATEGORIES[correction.category] : undefined;
            if (catInfo) {
                const badge = document.createElement('span');
                badge.className = 'lexisync-correction-cat';
                badge.textContent = `${catInfo.icon} ${catInfo.titleRu}`;
                badge.title = catInfo.ruleHintRu || catInfo.descriptionRu;
                badge.style.cssText =
                    'font-size:10px; font-weight:600; padding:2px 6px; border-radius:4px; white-space:nowrap; background:rgba(99, 102, 241, 0.12); color:var(--text-primary); flex-shrink:0;';
                row.appendChild(badge);
            }

            const label = document.createElement('span');
            label.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            label.textContent = `${correction.original.trim() || '∅'} → ${correction.corrected.trim() || '∅'}`;
            if (catInfo?.ruleHintRu) {
                label.title = catInfo.ruleHintRu;
            }
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.textContent = rejected.has(correction.tokenIndex)
                ? t('restoreCorrection', 'Вернуть')
                : t('correctionAccepted', 'Принято');
            choice.title = rejected.has(correction.tokenIndex)
                ? t('acceptAgain', 'Снова принять исправление')
                : t('keepOriginal', 'Оставить исходное слово');
            choice.style.cssText =
                'border:0; border-radius:6px; padding:5px 7px; cursor:pointer; background:var(--bg-secondary); color:var(--text-primary); flex-shrink:0;';
            choice.onclick = () => toggleCorrection(correction);
            const dictionary = document.createElement('button');
            dictionary.type = 'button';
            dictionary.textContent = t('addDictionary', '+ Словарь');
            dictionary.title = t('dictionaryFuture', 'Не исправлять это слово в будущем');
            dictionary.style.cssText = choice.style.cssText;
            dictionary.onclick = async () => {
                await addPersonalDictionaryWord(correction.original.trim());
                rejected.add(correction.tokenIndex);
                dictionary.textContent = t('added', 'Добавлено');
                dictionary.disabled = true;
                render();
                options.onResultChange(getResult(corrected));
            };
            dictionary.hidden = !/^[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*$/u.test(correction.original.trim());
            row.append(label, choice, dictionary);
            options.correctionsContainer.appendChild(row);
        }
    };

    const render = () => {
        options.contentPane.replaceChildren(
            renderSpellcheckDiffFragment(original, corrected, rejected, {
                showDeletionMarkers: !options.isCompact(),
                corrections,
            }),
        );
        decorateMarks();
        renderCorrectionRows();
    };

    const toggleCorrection = (correction: WordCorrection) => {
        if (rejected.has(correction.tokenIndex)) rejected.delete(correction.tokenIndex);
        else rejected.add(correction.tokenIndex);
        render();
        options.onResultChange(getResult(corrected));
    };

    const showCompactDetails = (correction: WordCorrection) => {
        const catInfo = correction.category ? GRAMMAR_CATEGORIES[correction.category] : undefined;
        const description = document.createElement('span');
        description.className = 'lexisync-compact-correction-copy';
        const prefix = catInfo ? `${catInfo.icon} ` : '';
        description.textContent = `${prefix}${correction.original.trim() || '∅'} → ${correction.corrected.trim() || '∅'}`;
        if (catInfo?.ruleHintRu) {
            description.title = catInfo.ruleHintRu;
        }
        const keepOriginal = document.createElement('button');
        keepOriginal.type = 'button';
        keepOriginal.className = 'lexisync-tool-chip';
        keepOriginal.textContent = rejected.has(correction.tokenIndex)
            ? t('acceptCorrection', 'Принять исправление')
            : t('keepOriginal', 'Оставить исходное');
        keepOriginal.onclick = () => {
            toggleCorrection(correction);
            options.compactDetails.hidden = true;
            options.adjustPosition();
        };
        const addDictionary = document.createElement('button');
        addDictionary.type = 'button';
        addDictionary.className = 'lexisync-tool-chip';
        addDictionary.textContent = t('addDictionary', '+ Словарь');
        addDictionary.title = t('dictionaryFuture', 'Не исправлять это слово в будущем');
        addDictionary.onclick = async () => {
            await addPersonalDictionaryWord(correction.original.trim());
            rejected.add(correction.tokenIndex);
            options.compactDetails.hidden = true;
            render();
            options.onResultChange(getResult(corrected));
            options.adjustPosition();
        };

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'lexisync-compact-correction-close';
        close.textContent = '×';
        close.setAttribute('aria-label', t('closeCorrectionDetails', 'Закрыть описание исправления'));
        close.onclick = () => {
            options.compactDetails.hidden = true;
            options.adjustPosition();
        };
        options.compactDetails.replaceChildren(description, keepOriginal, addDictionary, close);
        options.compactDetails.hidden = false;
        keepOriginal.focus({ preventScroll: true });
        options.adjustPosition();
    };

    const activateMark = (event: Event) => {
        const mark = (event.target as HTMLElement).closest('mark[data-token-index]') as HTMLElement | null;
        const correction = corrections.find((item) => item.tokenIndex === Number(mark?.dataset.tokenIndex));
        if (!correction) return;
        if (options.isCompact()) showCompactDetails(correction);
        else toggleCorrection(correction);
    };
    options.contentPane.addEventListener('click', activateMark);
    options.contentPane.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        if (!(event.target as HTMLElement).closest('mark[data-token-index]')) return;
        event.preventDefault();
        activateMark(event);
    });

    return {
        setResult(nextOriginal, nextCorrected, nextCorrections) {
            original = nextOriginal;
            corrected = nextCorrected;
            corrections = nextCorrections ?? getWordCorrections(original, corrected);
            rejected.clear();
            options.compactDetails.hidden = true;
            render();
        },
        getResult,
    };
}
