const EN_LAYOUT = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const RU_LAYOUT = 'ёйцукенгшщзхъфывапролджэячсмитьбю';

const EN_TO_RU = new Map([...EN_LAYOUT].map((letter, index) => [letter, RU_LAYOUT[index]]));
const RU_TO_EN = new Map([...RU_LAYOUT].map((letter, index) => [letter, EN_LAYOUT[index]]));

function translateCharacter(character: string, map: Map<string, string>): string {
    const lower = character.toLocaleLowerCase();
    const translated = map.get(lower);
    if (!translated) return character;
    return character === lower ? translated : translated.toLocaleUpperCase();
}

export function detectLayoutDirection(text: string): 'en-to-ru' | 'ru-to-en' {
    let latin = 0;
    let cyrillic = 0;
    for (const character of text) {
        if (EN_TO_RU.has(character.toLocaleLowerCase())) latin++;
        if (RU_TO_EN.has(character.toLocaleLowerCase())) cyrillic++;
    }
    return cyrillic > latin ? 'ru-to-en' : 'en-to-ru';
}

export function fixKeyboardLayout(text: string): string {
    const direction = detectLayoutDirection(text);
    const map = direction === 'en-to-ru' ? EN_TO_RU : RU_TO_EN;
    return [...text].map((character) => translateCharacter(character, map)).join('');
}
