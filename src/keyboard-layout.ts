const EN_LOWER = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./";
const RU_LOWER = 'ёйцукенгшщзхъфывапролджэячсмитьбю.';

const EN_SHIFT = '~@#$%^&*()_+{}|:"<>?';
const RU_SHIFT = 'Ё"№;%:?*()_+ХЪ/ЖЭБЮ,';

const EN_TO_RU = new Map<string, string>();
const RU_TO_EN = new Map<string, string>();

for (let i = 0; i < EN_LOWER.length; i++) {
    const en = EN_LOWER[i];
    const ru = RU_LOWER[i];
    EN_TO_RU.set(en, ru);
    RU_TO_EN.set(ru, en);

    if (/[a-zA-Z]/u.test(en) && /[\p{sc=Cyrillic}]/u.test(ru)) {
        EN_TO_RU.set(en.toUpperCase(), ru.toUpperCase());
        RU_TO_EN.set(ru.toUpperCase(), en.toUpperCase());
    }
}

for (let i = 0; i < EN_SHIFT.length; i++) {
    const en = EN_SHIFT[i];
    const ru = RU_SHIFT[i];
    EN_TO_RU.set(en, ru);
    RU_TO_EN.set(ru, en);
}

export function detectLayoutDirection(text: string): 'en-to-ru' | 'ru-to-en' {
    let latin = 0;
    let cyrillic = 0;
    for (const character of text) {
        if (/[a-zA-Z]/u.test(character)) latin++;
        if (/[\p{sc=Cyrillic}]/u.test(character)) cyrillic++;
    }
    return cyrillic > latin ? 'ru-to-en' : 'en-to-ru';
}

export function fixKeyboardLayout(text: string): string {
    const direction = detectLayoutDirection(text);
    const map = direction === 'en-to-ru' ? EN_TO_RU : RU_TO_EN;
    return [...text].map((char) => map.get(char) ?? char).join('');
}
