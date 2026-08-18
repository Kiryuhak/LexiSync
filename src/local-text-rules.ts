/**
 * Модуль мгновенного (0 мс) локального исправления опечаток,
 * пунктуационных пробелов, регистра предложений и типографики.
 */

function wordPattern(str: string): RegExp {
    return new RegExp(`(?<![\\p{L}\\p{N}_])${str}(?![\\p{L}\\p{N}_])`, 'giu');
}

const COMMON_TYPOS: Array<[RegExp, string]> = [
    [wordPattern('вообщем'), 'в общем'],
    [wordPattern('в общем то'), 'в общем-то'],
    [wordPattern('впринципе'), 'в принципе'],
    [wordPattern('здраствуйте'), 'здравствуйте'],
    [wordPattern('здрасте'), 'здравствуйте'],
    [wordPattern('тчо'), 'что'],
    [wordPattern('тоже самое'), 'то же самое'],
    [wordPattern('придеться'), 'придётся'],
    [wordPattern('придется'), 'придётся'],
    [wordPattern('пожалуста'), 'пожалуйста'],
    [/(?<![\p{L}\p{N}_])симпотичн(\p{L}+)(?![\p{L}\p{N}_])/giu, 'симпатичн$1'],
    [/(?<![\p{L}\p{N}_])извени(те)?(?![\p{L}\p{N}_])/giu, 'извини$1'],
    [wordPattern('какбудто'), 'как будто'],
    [wordPattern('будующий'), 'будущий'],
    [wordPattern('сдесь'), 'здесь'],
    [wordPattern('сейчасже'), 'сейчас же'],
    [wordPattern('врятли'), 'вряд ли'],
    [wordPattern('наврятли'), 'навряд ли'],
    [wordPattern('лудше'), 'лучше'],
    [wordPattern('координально'), 'кардинально'],
    [/(?<![\p{L}\p{N}_])эксперемент(\p{L}*)(?![\p{L}\p{N}_])/giu, 'эксперимент$1'],
    [wordPattern('день рождение'), 'день рождения'],
    [wordPattern('не имеет значение'), 'не имеет значения'],
    [/(?<![\p{L}\p{N}_])одеть (пальто|куртку|шапку|обувь|одежду|перчатки|очки)(?![\p{L}\p{N}_])/giu, 'надеть $1'],
    [wordPattern('страниццу'), 'страницу'],
    [/(?<![\p{L}\p{N}_])ошипк(\p{L}+)(?![\p{L}\p{N}_])/giu, 'ошибк$1'],
    [wordPattern('помойму'), 'по-моему'],
    [wordPattern('по твоему'), 'по-твоему'],
    [wordPattern('по нашему'), 'по-нашему'],
    [wordPattern('кокрас'), 'как раз'],
    [wordPattern('как раз таки'), 'как раз-таки'],
    [wordPattern('все таки'), 'всё-таки'],
    [wordPattern('все-таки'), 'всё-таки'],
    [wordPattern('также как'), 'так же, как'],
    [wordPattern('точь в точь'), 'точь-в-точь'],
    [wordPattern('тетет-а-тет'), 'тет-а-тет'],

    // English slips
    [wordPattern('teh'), 'the'],
    [wordPattern('dont'), "don't"],
    [wordPattern('cant'), "can't"],
    [wordPattern('wont'), "won't"],
    [wordPattern('didnt'), "didn't"],
    [wordPattern('couldnt'), "couldn't"],
    [wordPattern('wouldnt'), "wouldn't"],
    [wordPattern('shouldnt'), "shouldn't"],
    [wordPattern('isnt'), "isn't"],
    [wordPattern('arent'), "aren't"],
    [wordPattern('wasnt'), "wasn't"],
    [wordPattern('werent'), "weren't"],
    [wordPattern('hasnt'), "hasn't"],
    [wordPattern('havent'), "haven't"],
    [wordPattern('hadnt'), "hadn't"],
    [wordPattern('recieve'), 'receive'],
    [wordPattern('seperate'), 'separate'],
    [wordPattern('occured'), 'occurred'],
    [wordPattern('truely'), 'truly'],
    [wordPattern('untill'), 'until'],
    [wordPattern('definately'), 'definitely'],
    [wordPattern('accomodate'), 'accommodate'],
];

function matchCase(source: string, target: string): string {
    if (!source || !target) return target;
    if (source === source.toUpperCase()) return target.toUpperCase();
    if (source[0] === source[0].toUpperCase()) {
        return target.charAt(0).toUpperCase() + target.slice(1);
    }
    return target.toLowerCase();
}

export interface RuleFixResult {
    text: string;
    changed: boolean;
    fixesCount: number;
}

export function applyFastTypographyAndTypoFixes(input: string): RuleFixResult {
    if (!input || !input.trim()) {
        return { text: input, changed: false, fixesCount: 0 };
    }

    let result = input;
    let fixesCount = 0;

    // 1. Быстрый словарь частых опечаток с сохранением регистра
    for (const [pattern, replacement] of COMMON_TYPOS) {
        result = result.replace(pattern, (match) => {
            fixesCount++;
            return matchCase(match, replacement);
        });
    }

    // 2. Лишние пробелы перед знаками препинания: "слово , слово" -> "слово, слово"
    const beforePunctuation = result.replace(/[ \t]+([,.!?:;»)])/gu, '$1');
    if (beforePunctuation !== result) {
        fixesCount++;
        result = beforePunctuation;
    }

    // 3. Отсутствующий пробел после запятой, точки, двоеточия, вопросительного и восклицательного знаков
    // (Исключая числа вида 3.14 / 1,5 и URL https://...)
    const afterPunctuation = result.replace(/([,;:!?]|(?<!\d)\.(?!\d))(?=[\p{L}])/gu, '$1 ');
    if (afterPunctuation !== result) {
        fixesCount++;
        result = afterPunctuation;
    }

    // 4. Тире: дефис с пробелами вокруг заменяем на длинное тире
    const withEmDash = result.replace(/(?<=\s)-(?=\s)/gu, '—');
    if (withEmDash !== result) {
        fixesCount++;
        result = withEmDash;
    }

    // 5. Повторяющиеся пробелы (сохраняя переводы строк)
    const collapsedSpaces = result.replace(/[ \t]{2,}/gu, ' ');
    if (collapsedSpaces !== result) {
        fixesCount++;
        result = collapsedSpaces;
    }

    // 6. Заглавная буква в начале текста и после концов предложений (. ! ?)
    const capitalized = result.replace(/(?:^|([.!?]\s+))([\p{Ll}])/gu, (_, prefix, letter) => {
        fixesCount++;
        return (prefix || '') + letter.toUpperCase();
    });
    result = capitalized;

    // 7. Русские кавычки-ёлочки для текста с кириллицей: "текст" -> «текст»
    if (/[\p{sc=Cyrillic}]/u.test(result)) {
        const withQuotes = result.replace(/"([^"\n]+)"/gu, '«$1»');
        if (withQuotes !== result) {
            fixesCount++;
            result = withQuotes;
        }
    }

    return {
        text: result,
        changed: result !== input,
        fixesCount,
    };
}

export function cleanPdfLineBreaksAndWhitespace(input: string): string {
    if (!input || !input.trim()) return input;

    // 1. Склеивание переносов слов через дефис: "инфор-\nмация" -> "информация"
    let res = input.replace(/([\p{L}])-[\r\n]+([\p{L}])/gu, '$1$2');

    // 2. Склеивание строк внутри абзацев, сохраняя пустые строки между абзацами
    res = res.replace(/([^\r\n.!?:])[\r\n]+([^\r\n\s\d\-•*#])/gu, '$1 $2');

    // 3. Удаление множественных пробелов
    res = res.replace(/[ \t]{2,}/gu, ' ');

    return res.trim();
}
