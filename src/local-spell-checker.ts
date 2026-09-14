import { applyLocalTextRules, type LocalTextFinding } from './local-rule-engine';

export interface LocalProofreadResult {
    correctedText: string;
    findings: LocalTextFinding[];
    unresolvedCount: number;
    dictionaryLoaded: boolean;
}

export interface RussianWordLookup {
    has(word: string): boolean;
    suggest(word: string, limit?: number): string[];
}

interface BloomMetadata {
    format: number;
    wordCount: number;
    bitCount: number;
    hashCount: number;
}

const TECHNICAL_WORDS = new Set([
    'lexisync',
    'mistral',
    'cloudflare',
    'github',
    'oauth',
    'indexeddb',
    'google',
    'drive',
    'chrome',
    'firefox',
    'mozilla',
    'typescript',
    'javascript',
    'chatgpt',
    'prompt',
    'промпт',
]);

const CERTAIN_CORRECTIONS: Record<string, string> = {
    ашибка: 'ошибка',
    ашибки: 'ошибки',
    ашибку: 'ошибку',
    вообщем: 'в общем',
    врядли: 'вряд ли',
    извените: 'извините',
    пожалуйсто: 'пожалуйста',
    будующее: 'будущее',
    прийдёт: 'придёт',
    харошая: 'хорошая',
    хароший: 'хороший',
    орфаграфия: 'орфография',
    провиряю: 'проверяю',
    синхранизация: 'синхронизация',
    сихронизация: 'синхронизация',
    тексст: 'текст',
    текссст: 'текст',
    промт: 'промпт',
};

const RUSSIAN_ALPHABET = [...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'];
let dictionaryPromise: Promise<RussianWordLookup> | null = null;

function runtimeUrl(path: string): string {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) return chrome.runtime.getURL(path);
    return path;
}

function hashWord(value: string, seed: number): number {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index++) {
        hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619) >>> 0;
    }
    return hash >>> 0;
}

function editDistance(left: string, right: string): number {
    const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
        let diagonal = rows[0];
        rows[0] = rightIndex;
        for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
            const previous = rows[leftIndex];
            rows[leftIndex] = Math.min(
                rows[leftIndex] + 1,
                rows[leftIndex - 1] + 1,
                diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
            );
            diagonal = previous;
        }
    }
    return rows[left.length];
}

class BloomRussianDictionary implements RussianWordLookup {
    constructor(
        private readonly bytes: Uint8Array,
        private readonly metadata: BloomMetadata,
    ) {}

    has(value: string): boolean {
        const word = value.toLocaleLowerCase('ru');
        const first = hashWord(word, 2_166_136_261);
        const second = (hashWord(word, 3_332_339_343) | 1) >>> 0;
        for (let index = 0; index < this.metadata.hashCount; index++) {
            const bit = (first + index * second + index * index) % this.metadata.bitCount;
            if ((this.bytes[bit >>> 3] & (1 << (bit & 7))) === 0) return false;
        }
        return true;
    }

    suggest(value: string, limit = 5): string[] {
        const word = value.toLocaleLowerCase('ru');
        if (!word || word.length > 40) return [];
        const candidates = new Set<string>();
        const consider = (candidate: string) => {
            if (candidate !== word && this.has(candidate)) candidates.add(candidate);
        };
        for (let index = 0; index < word.length; index++) {
            consider(word.slice(0, index) + word.slice(index + 1));
            if (index + 1 < word.length)
                consider(word.slice(0, index) + word[index + 1] + word[index] + word.slice(index + 2));
            for (const letter of RUSSIAN_ALPHABET)
                if (letter !== word[index]) consider(word.slice(0, index) + letter + word.slice(index + 1));
        }
        for (let index = 0; index <= word.length; index++)
            for (const letter of RUSSIAN_ALPHABET) consider(word.slice(0, index) + letter + word.slice(index));
        return [...candidates]
            .sort(
                (left, right) =>
                    editDistance(word, left) - editDistance(word, right) || left.localeCompare(right, 'ru'),
            )
            .slice(0, limit);
    }
}

async function loadRussianDictionary(): Promise<RussianWordLookup> {
    const [metadataResponse, bloomResponse] = await Promise.all([
        fetch(runtimeUrl('dictionaries/ru/ru.bloom.json')),
        fetch(runtimeUrl('dictionaries/ru/ru.bloom')),
    ]);
    if (!metadataResponse.ok || !bloomResponse.ok)
        throw new Error(`LOCAL_DICTIONARY_HTTP_${metadataResponse.status}_${bloomResponse.status}`);
    const metadata = (await metadataResponse.json()) as BloomMetadata;
    const bytes = new Uint8Array(await bloomResponse.arrayBuffer());
    if (
        metadata.format !== 1 ||
        !Number.isSafeInteger(metadata.wordCount) ||
        !Number.isSafeInteger(metadata.bitCount) ||
        !Number.isSafeInteger(metadata.hashCount) ||
        metadata.bitCount !== bytes.byteLength * 8 ||
        metadata.hashCount < 1 ||
        metadata.hashCount > 32
    ) {
        throw new Error('LOCAL_DICTIONARY_INVALID');
    }
    return new BloomRussianDictionary(bytes, metadata);
}

export async function getRussianWordLookup(personalDictionary: string[] = []): Promise<RussianWordLookup> {
    dictionaryPromise ??= loadRussianDictionary();
    const base = await dictionaryPromise;
    const personal = new Set(personalDictionary.map((word) => word.trim().toLocaleLowerCase('ru')).filter(Boolean));
    return {
        has: (word) =>
            personal.has(word.toLocaleLowerCase('ru')) ||
            TECHNICAL_WORDS.has(word.toLocaleLowerCase('ru')) ||
            base.has(word),
        suggest: (word, limit) => base.suggest(word, limit),
    };
}

function preserveCase(source: string, replacement: string): string {
    if (source === source.toLocaleUpperCase('ru')) return replacement.toLocaleUpperCase('ru');
    if (source[0] === source[0]?.toLocaleUpperCase('ru'))
        return replacement[0]?.toLocaleUpperCase('ru') + replacement.slice(1);
    return replacement;
}

function isCorrectCompound(dictionary: RussianWordLookup, word: string): boolean {
    const parts = word.split(/[-‑]/u);
    return parts.length > 1 && parts.every((part) => dictionary.has(part.toLocaleLowerCase('ru')));
}

export function checkRussianSpelling(text: string, dictionary: RussianWordLookup): LocalProofreadResult {
    const findings: LocalTextFinding[] = [];
    const replacements: Array<{ start: number; end: number; value: string }> = [];
    const wordPattern = /[А-Яа-яЁё]+(?:[-‑][А-Яа-яЁё]+)*/gu;
    for (const match of text.matchAll(wordPattern)) {
        const original = match[0];
        const lower = original.toLocaleLowerCase('ru');
        const start = match.index ?? 0;
        const certain = CERTAIN_CORRECTIONS[lower];
        if (certain) {
            const replacement = preserveCase(original, certain);
            findings.push({
                kind: 'spelling',
                original,
                replacement,
                suggestions: [replacement],
                start,
                end: start + original.length,
                confidence: 'high',
                applied: true,
            });
            replacements.push({ start, end: start + original.length, value: replacement });
            continue;
        }
        if (dictionary.has(lower) || isCorrectCompound(dictionary, lower)) continue;
        // Имена собственные и аббревиатуры не исправляем автоматически.
        if (original[0] === original[0]?.toLocaleUpperCase('ru')) continue;
        const suggestions = dictionary.suggest(lower, 5).map((item) => preserveCase(original, item));
        findings.push({
            kind: 'spelling',
            original,
            suggestions,
            start,
            end: start + original.length,
            confidence: suggestions.length ? 'medium' : 'low',
            applied: false,
        });
    }
    let correctedText = '';
    let cursor = 0;
    for (const replacement of replacements) {
        correctedText += text.slice(cursor, replacement.start) + replacement.value;
        cursor = replacement.end;
    }
    correctedText += text.slice(cursor);
    return {
        correctedText,
        findings,
        unresolvedCount: findings.filter((finding) => !finding.applied).length,
        dictionaryLoaded: true,
    };
}

export async function proofreadRussianLocally(
    text: string,
    personalDictionary: string[] = [],
    dictionary?: RussianWordLookup,
): Promise<LocalProofreadResult> {
    const rules = applyLocalTextRules(text);
    const spelling = checkRussianSpelling(
        rules.correctedText,
        dictionary ?? (await getRussianWordLookup(personalDictionary)),
    );
    return {
        correctedText: spelling.correctedText,
        findings: [...rules.findings, ...spelling.findings],
        unresolvedCount: spelling.unresolvedCount + rules.findings.filter((finding) => !finding.applied).length,
        dictionaryLoaded: true,
    };
}

export function resetLocalSpellCheckerCacheForTests(): void {
    dictionaryPromise = null;
}
