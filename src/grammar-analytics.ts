import type { HistoryItem } from './types';

export type GrammarErrorCategory =
    | 'tsya_tsya'
    | 'ne_ni'
    | 'punctuation'
    | 'introductory_words'
    | 'spelling'
    | 'case_agreement'
    | 'layout'
    | 'capitalization'
    | 'typography';

export interface GrammarCategoryInfo {
    id: GrammarErrorCategory;
    titleRu: string;
    titleEn: string;
    icon: string;
    color: string;
    descriptionRu: string;
    ruleHintRu: string;
    exampleRu: string;
}

export const GRAMMAR_CATEGORIES: Record<GrammarErrorCategory, GrammarCategoryInfo> = {
    tsya_tsya: {
        id: 'tsya_tsya',
        titleRu: 'Правописание -тся и -ться',
        titleEn: '-tsya / -tsya verb endings',
        icon: '🎯',
        color: '#EF4444',
        descriptionRu: 'Ошибки в написании мягкого знака в глаголах.',
        ruleHintRu:
            'Задайте вопрос к глаголу: «что делает?» (нет ь) — пишем -тся; «что делать?» (есть ь) — пишем -ться.',
        exampleRu: '«Он учится» (что делает?) vs «Надо учиться» (что делать?)',
    },
    ne_ni: {
        id: 'ne_ni',
        titleRu: 'Слитное и раздельное НЕ / НИ',
        titleEn: 'Spelling of NE / NI particles',
        icon: '🔤',
        color: '#F97316',
        descriptionRu: 'Частицы и приставки не- и ни- со словами разных частей речи.',
        ruleHintRu:
            'С глаголами — раздельно («не знаю»). Если можно заменить синонимом без НЕ — слитно («неправда = ложь»). С противопоставлением «а» — раздельно («не правда, а ложь»).',
        exampleRu: '«не был», «некрасивый», «ни за что», «не глубокая, а мелкая»',
    },
    punctuation: {
        id: 'punctuation',
        titleRu: 'Пунктуация и запятые',
        titleEn: 'Punctuation and Commas',
        icon: '✍️',
        color: '#3B82F6',
        descriptionRu: 'Пропущенные или лишние запятые в сложных предложениях и оборотах.',
        ruleHintRu:
            'Запятая ставится между частями сложного предложения (перед «что», «чтобы», «который», «если», «потому что») и выделяет причастные/деепричастные обороты.',
        exampleRu: '«Я знаю, что вы правы», «Сделав работу, он ушёл»',
    },
    introductory_words: {
        id: 'introductory_words',
        titleRu: 'Вводные слова и конструкции',
        titleEn: 'Introductory Words & Phrases',
        icon: '💬',
        color: '#8B5CF6',
        descriptionRu: 'Выделение запятыми вводных слов (конечно, возможно, к счастью, во-первых).',
        ruleHintRu:
            'Вводные слова всегда выделяются запятыми с обеих сторон. Их можно мысленно убрать из предложения без потери смысла.',
        exampleRu: '«К счастью, поезд прибыл вовремя», «Вы, безусловно, правы»',
    },
    spelling: {
        id: 'spelling',
        titleRu: 'Орфография и опечатки',
        titleEn: 'Spelling & Typos',
        icon: '📝',
        color: '#10B981',
        descriptionRu: 'Безударные гласные, непроверяемые согласные и опечатки в корнях слов.',
        ruleHintRu:
            'Подбирайте однокоренное проверочное слово, где сомнительная гласная стоит под ударением (вода — во́ды).',
        exampleRu: '«посвЯтить стихи» (свЯтость) vs «посвЕтить фонарём» (свЕт)',
    },
    case_agreement: {
        id: 'case_agreement',
        titleRu: 'Согласование и окончания',
        titleEn: 'Grammatical Agreement & Endings',
        icon: '🔗',
        color: '#06B6D4',
        descriptionRu: 'Согласование существительных с прилагательными, причастиями и числительными.',
        ruleHintRu:
            'Задавайте вопрос от главного слова к зависимому: «в доме (каком?) новом», «по окончании (чего?) встречи».',
        exampleRu: '«согласно приказу» (дательный падеж, не «приказа»)',
    },
    capitalization: {
        id: 'capitalization',
        titleRu: 'Заглавные буквы и регистр',
        titleEn: 'Capitalization & Case',
        icon: '🔠',
        color: '#EC4899',
        descriptionRu: 'Пропущенные заглавные буквы в начале предложений, именах и названиях.',
        ruleHintRu:
            'Каждое новое предложение, имена собственные, географические названия и торговые марки начинаются с заглавной буквы.',
        exampleRu: '«Москва», «LexiSync», «В начале было слово.»',
    },
    layout: {
        id: 'layout',
        titleRu: 'Ошибочная раскладка клавиатуры',
        titleEn: 'Wrong Keyboard Layout',
        icon: '⌨️',
        color: '#6366F1',
        descriptionRu: 'Текст, случайно набранный в английской или русской раскладке.',
        ruleHintRu: 'Используйте быстрое сочетание клавиш для мгновенной смены раскладки набранного текста.',
        exampleRu: '«ghbdtn» ➔ «привет», «руддщ» ➔ «hello»',
    },
    typography: {
        id: 'typography',
        titleRu: 'Типографика и оформление',
        titleEn: 'Typography & Quotes',
        icon: '✨',
        color: '#14B8A6',
        descriptionRu: 'Использование кавычек-ёлочек («»), длинного тире (—) и удаление лишних пробелов.',
        ruleHintRu: 'В русском языке приняты кавычки «ёлочки» и длинное тире с отбивкой пробелами.',
        exampleRu: '«Кавычки-ёлочки», «Тире — это знак»',
    },
};

export interface GrammarCategoryStat {
    category: GrammarCategoryInfo;
    count: number;
    percentage: number;
}

export interface WordFixStat {
    original: string;
    corrected: string;
    count: number;
}

export interface GrammarAnalyticsReport {
    totalEntries: number;
    totalCorrections: number;
    cleanEntriesCount: number;
    literacyScore: number;
    categories: GrammarCategoryStat[];
    topCategories: GrammarCategoryStat[];
    helpfulRules: GrammarCategoryInfo[];
    topWordFixes?: WordFixStat[];
}

const INTRODUCTORY_WORDS = [
    'конечно',
    'возможно',
    'к счастью',
    'к сожалению',
    'во-первых',
    'во-вторых',
    'в-третьих',
    'таким образом',
    'следовательно',
    'безусловно',
    'пожалуй',
    'например',
    'кстати',
    'наоборот',
    'впрочем',
    'однако',
];

const LAYOUT_REGEX = /^[a-z0-9\s.,!?'"`;:[\]{}<>-]+$/i;

function extractTsyaWords(text: string): string[] {
    const words = text
        .toLowerCase()
        .split(/[^\p{L}]+/u)
        .filter(Boolean);
    return words.filter((w) => w.endsWith('тся') || w.endsWith('ться'));
}

function extractNeNiPhrases(text: string): string[] {
    const phrases: string[] = [];
    const re = /(?:^|[^\p{L}])(не|ни)\s+([\p{L}]+)/giu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text.toLowerCase())) !== null) {
        phrases.push(`${m[1]} ${m[2]}`);
    }
    return phrases;
}

export function classifyTextDifference(original: string, result: string): Set<GrammarErrorCategory> {
    const categories = new Set<GrammarErrorCategory>();
    if (!original || !result || original.trim() === result.trim()) {
        return categories;
    }

    const origLower = original.toLowerCase();
    const resLower = result.toLowerCase();

    // 1. Проверка раскладки
    if (
        LAYOUT_REGEX.test(original.trim()) &&
        /[а-яё]/i.test(result) &&
        original.length > 2 &&
        !/^(http|www|https|git)/i.test(original)
    ) {
        categories.add('layout');
    }

    // 2. Проверка -тся / -ться
    const origTsya = extractTsyaWords(original);
    const resTsya = extractTsyaWords(result);
    if (origTsya.some((w) => !resTsya.includes(w)) || resTsya.some((w) => !origTsya.includes(w))) {
        categories.add('tsya_tsya');
    }

    // 3. Проверка не / ни
    const origNe = extractNeNiPhrases(original);
    const resNe = extractNeNiPhrases(result);
    if (origNe.length !== resNe.length || origNe.some((w, i) => resNe[i] !== w)) {
        categories.add('ne_ni');
    }

    // 4. Вводные слова
    const hasIntroInResult = INTRODUCTORY_WORDS.some((word) => resLower.includes(word));
    const hasIntroInOriginal = INTRODUCTORY_WORDS.some((word) => origLower.includes(word));
    if (hasIntroInResult && !hasIntroInOriginal) {
        categories.add('introductory_words');
    } else if (hasIntroInResult && original.includes(',') !== result.includes(',')) {
        categories.add('introductory_words');
    }

    // 5. Заглавные буквы
    if (original[0] !== result[0] && original[0]?.toLowerCase() === result[0]?.toLowerCase()) {
        categories.add('capitalization');
    }

    // 6. Типографика (кавычки, тире)
    if (
        (original.includes('"') && result.includes('«')) ||
        (original.includes('--') && result.includes('—')) ||
        (original.includes(' - ') && result.includes(' — '))
    ) {
        categories.add('typography');
    }

    // 7. Пунктуация (запятые, точки, двоеточия)
    const origPunctCount = (original.match(/[,;:\-—?!]/g) || []).length;
    const resPunctCount = (result.match(/[,;:\-—?!]/g) || []).length;
    if (origPunctCount !== resPunctCount && !categories.has('introductory_words')) {
        categories.add('punctuation');
    }

    // 8. Если изменились буквы в словах
    const origWords = origLower.split(/\s+/);
    const resWords = resLower.split(/\s+/);
    if (origWords.length === resWords.length) {
        let wordDiff = 0;
        for (let i = 0; i < origWords.length; i++) {
            if (origWords[i] !== resWords[i]) wordDiff++;
        }
        if (wordDiff > 0 && !categories.has('tsya_tsya') && !categories.has('ne_ni') && !categories.has('layout')) {
            categories.add('spelling');
        }
    } else {
        categories.add('case_agreement');
    }

    if (categories.size === 0) {
        categories.add('spelling');
    }

    return categories;
}

export function generateGrammarAnalytics(items: HistoryItem[]): GrammarAnalyticsReport {
    // Перевод, изменение стиля и остальные творческие команды не являются
    // проверкой грамотности и не должны ухудшать пользовательский индекс.
    const analyzableItems = items.filter((item) => item.mode === 'spellcheck' || item.mode === 'layout');
    const totalEntries = analyzableItems.length;
    if (totalEntries === 0) {
        return {
            totalEntries: 0,
            totalCorrections: 0,
            cleanEntriesCount: 0,
            literacyScore: 100,
            categories: [],
            topCategories: [],
            helpfulRules: [GRAMMAR_CATEGORIES.tsya_tsya, GRAMMAR_CATEGORIES.ne_ni, GRAMMAR_CATEGORIES.punctuation],
        };
    }

    const counts: Record<GrammarErrorCategory, number> = {
        tsya_tsya: 0,
        ne_ni: 0,
        punctuation: 0,
        introductory_words: 0,
        spelling: 0,
        case_agreement: 0,
        layout: 0,
        capitalization: 0,
        typography: 0,
    };

    let totalCorrections = 0;
    let cleanEntriesCount = 0;
    const wordFixMap = new Map<string, { original: string; corrected: string; count: number }>();

    for (const item of analyzableItems) {
        if (!item.original || !item.result || item.original.trim() === item.result.trim()) {
            cleanEntriesCount++;
            continue;
        }

        const detected = classifyTextDifference(item.original, item.result);
        if (detected.size === 0) {
            cleanEntriesCount++;
        } else {
            for (const cat of detected) {
                counts[cat]++;
                totalCorrections++;
            }
        }

        const origWords = item.original.trim().split(/\s+/);
        const resWords = item.result.trim().split(/\s+/);
        if (origWords.length === resWords.length && origWords.length <= 40) {
            for (let i = 0; i < origWords.length; i++) {
                const wOrig = origWords[i].replace(/[.,!?:;«»""'()]/g, '');
                const wRes = resWords[i].replace(/[.,!?:;«»""'()]/g, '');
                if (
                    wOrig &&
                    wRes &&
                    wOrig.toLowerCase() !== wRes.toLowerCase() &&
                    wOrig.length >= 3 &&
                    wOrig.length <= 25
                ) {
                    const key = `${wOrig.toLowerCase()}→${wRes.toLowerCase()}`;
                    const existing = wordFixMap.get(key);
                    if (existing) {
                        existing.count++;
                    } else {
                        wordFixMap.set(key, { original: wOrig, corrected: wRes, count: 1 });
                    }
                }
            }
        }
    }

    const topWordFixes = Array.from(wordFixMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const categoriesList: GrammarCategoryStat[] = Object.keys(counts).map((key) => {
        const catId = key as GrammarErrorCategory;
        const count = counts[catId];
        const percentage = totalCorrections > 0 ? Math.round((count / totalCorrections) * 100) : 0;
        return {
            category: GRAMMAR_CATEGORIES[catId],
            count,
            percentage,
        };
    });

    categoriesList.sort((a, b) => b.count - a.count);

    const literacyScore = totalEntries > 0 ? Math.round((cleanEntriesCount / totalEntries) * 100) : 100;
    const clampedScore = Math.min(100, Math.max(0, literacyScore));

    const topCategories = categoriesList.filter((c) => c.count > 0).slice(0, 4);

    const helpfulRules =
        topCategories.length > 0
            ? topCategories.map((c) => c.category)
            : [GRAMMAR_CATEGORIES.tsya_tsya, GRAMMAR_CATEGORIES.ne_ni, GRAMMAR_CATEGORIES.punctuation];

    return {
        totalEntries,
        totalCorrections,
        cleanEntriesCount,
        literacyScore: clampedScore,
        categories: categoriesList,
        topCategories,
        helpfulRules,
        topWordFixes,
    };
}
