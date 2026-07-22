import { enqueueStorageMutation } from './storage-queue';

export interface WordStat {
    count: number;
    lastUsed: number;
    value: string;
}

export interface PairStat {
    count: number;
    lastUsed: number;
}

export interface AdaptiveLanguageModel {
    version: 2;
    words: Record<string, WordStat>;
    pairs: Record<string, PairStat>;
    rejections: Record<string, number>;
}

export const EMPTY_ADAPTIVE_MODEL: AdaptiveLanguageModel = { version: 2, words: {}, pairs: {}, rejections: {} };
export const ADAPTIVE_MODEL_STORAGE_KEY = 'adaptiveLanguageModel';
export const ADAPTIVE_PAIR_SEPARATOR = '\u0001';

export type AdaptiveMutation = 'record' | 'reject' | 'accept' | 'clear';

const MAX_WORDS = 1600;
const MAX_PAIRS = 2600;

interface AdaptiveMutationPayload {
    word?: unknown;
    previous?: unknown;
    weight?: unknown;
}

function normalizeWord(value: unknown): string {
    return String(value || '')
        .trim()
        .slice(0, 32)
        .toLocaleLowerCase('ru-RU');
}

function pruneRecord<T extends { count: number; lastUsed: number }>(record: Record<string, T>, limit: number): void {
    const keys = Object.keys(record);
    if (keys.length <= limit) return;
    keys.sort((a, b) => {
        const scoreA = record[a].count * 10 + record[a].lastUsed / 1e12;
        const scoreB = record[b].count * 10 + record[b].lastUsed / 1e12;
        return scoreB - scoreA;
    });
    for (const key of keys.slice(limit)) delete record[key];
}

export function parseAdaptiveModel(value: unknown): AdaptiveLanguageModel {
    if (!value || typeof value !== 'object') return structuredClone(EMPTY_ADAPTIVE_MODEL);
    const candidate = value as Partial<AdaptiveLanguageModel>;
    return {
        version: 2,
        words: candidate.words && typeof candidate.words === 'object' ? candidate.words : {},
        pairs: candidate.pairs && typeof candidate.pairs === 'object' ? candidate.pairs : {},
        rejections: candidate.rejections && typeof candidate.rejections === 'object' ? candidate.rejections : {},
    };
}

export function applyAdaptiveMutation(mutation: AdaptiveMutation, payload: AdaptiveMutationPayload): Promise<void> {
    return enqueueStorageMutation(async () => {
        if (mutation === 'clear') {
            await chrome.storage.local.set({
                [ADAPTIVE_MODEL_STORAGE_KEY]: EMPTY_ADAPTIVE_MODEL,
                adaptiveBlockedWords: [],
            });
            return;
        }

        const word = normalizeWord(payload.word);
        if (!word) throw new Error('INVALID_ADAPTIVE_WORD');
        const stored = await chrome.storage.local.get({ [ADAPTIVE_MODEL_STORAGE_KEY]: EMPTY_ADAPTIVE_MODEL });
        const model = parseAdaptiveModel(stored[ADAPTIVE_MODEL_STORAGE_KEY]);
        const now = Date.now();

        if (mutation === 'record') {
            const weight = Math.min(10, Math.max(1, Number(payload.weight) || 1));
            const existing = model.words[word];
            model.words[word] = {
                count: Math.min(9999, (existing?.count || 0) + weight),
                lastUsed: now,
                value: String(payload.word || word).slice(0, 32),
            };
            const previous = normalizeWord(payload.previous);
            if (previous) {
                const pairKey = `${previous}${ADAPTIVE_PAIR_SEPARATOR}${word}`;
                const pair = model.pairs[pairKey];
                model.pairs[pairKey] = { count: Math.min(9999, (pair?.count || 0) + weight), lastUsed: now };
            }
        } else if (mutation === 'reject') {
            model.rejections[word] = Math.min(20, (model.rejections[word] || 0) + 1);
        } else if (mutation === 'accept') {
            model.rejections[word] = Math.max(0, (model.rejections[word] || 0) - 1);
        } else {
            throw new Error('INVALID_ADAPTIVE_MUTATION');
        }
        pruneRecord(model.words, MAX_WORDS);
        pruneRecord(model.pairs, MAX_PAIRS);
        await chrome.storage.local.set({ [ADAPTIVE_MODEL_STORAGE_KEY]: model });
    });
}
