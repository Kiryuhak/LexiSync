import { t } from './i18n';
import {
    getWordCorrections,
    renderSpellcheckDiffFragment,
    resolveCorrections,
    type WordCorrection,
} from './spellcheck';
import { addPersonalDictionaryWord } from './settings-store';

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
            mark.title = description;
            mark.setAttribute('aria-label', `${t('correctionDetails', 'Исправление')}: ${description}`);
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
        for (const correction of corrections) {
            const row = document.createElement('div');
            row.className = 'lexisync-correction-row';
            row.style.cssText =
                'display:flex; align-items:center; gap:7px; padding:7px 9px; border:1px solid var(--border-color); border-radius:8px; font-size:12px;';
            const label = document.createElement('span');
            label.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            label.textContent = `${correction.original.trim() || '∅'} → ${correction.corrected.trim() || '∅'}`;
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.textContent = rejected.has(correction.tokenIndex)
                ? t('restoreCorrection', 'Вернуть')
                : t('correctionAccepted', 'Принято');
            choice.title = rejected.has(correction.tokenIndex)
                ? t('acceptAgain', 'Снова принять исправление')
                : t('keepOriginal', 'Оставить исходное слово');
            choice.style.cssText =
                'border:0; border-radius:6px; padding:5px 7px; cursor:pointer; background:var(--bg-secondary); color:var(--text-primary);';
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
        const description = document.createElement('span');
        description.className = 'lexisync-compact-correction-copy';
        description.textContent = `${correction.original.trim() || '∅'} → ${correction.corrected.trim() || '∅'}`;
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
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'lexisync-compact-correction-close';
        close.textContent = '×';
        close.setAttribute('aria-label', t('closeCorrectionDetails', 'Закрыть описание исправления'));
        close.onclick = () => {
            options.compactDetails.hidden = true;
            options.adjustPosition();
        };
        options.compactDetails.replaceChildren(description, keepOriginal, close);
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
