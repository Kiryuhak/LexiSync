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
const RECORD_DEBOUNCE_MS = 180;
const RECORD_MAX_WAIT_MS = 750;
const ADAPTIVE_STORAGE_QUEUE = 'adaptive-model';

interface AdaptiveMutationPayload {
    word?: unknown;
    previous?: unknown;
    weight?: unknown;
}

interface PendingRecord {
    word: string;
    normalizedWord: string;
    previous: string;
    weight: number;
}

interface PendingRecordBatch {
    records: PendingRecord[];
    prerequisite: Promise<void>;
    debounceTimer?: ReturnType<typeof setTimeout>;
    maxWaitTimer?: ReturnType<typeof setTimeout>;
    resolve: () => void;
    reject: (error: unknown) => void;
    promise: Promise<void>;
}

let pendingRecordBatch: PendingRecordBatch | null = null;
let adaptiveMutationTail: Promise<void> = Promise.resolve();

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
        words: candidate.words && typeof candidate.words === 'object' ? { ...candidate.words } : {},
        pairs: candidate.pairs && typeof candidate.pairs === 'object' ? { ...candidate.pairs } : {},
        rejections: candidate.rejections && typeof candidate.rejections === 'object' ? { ...candidate.rejections } : {},
    };
}

function trackAdaptiveMutation(operation: Promise<void>): Promise<void> {
    adaptiveMutationTail = operation.then(
        () => undefined,
        () => undefined,
    );
    return operation;
}

function persistRecordBatch(records: PendingRecord[]): Promise<void> {
    return enqueueStorageMutation(async () => {
        const stored = await chrome.storage.local.get({ [ADAPTIVE_MODEL_STORAGE_KEY]: EMPTY_ADAPTIVE_MODEL });
        const model = parseAdaptiveModel(stored[ADAPTIVE_MODEL_STORAGE_KEY]);
        const now = Date.now();
        for (const record of records) {
            const existing = model.words[record.normalizedWord];
            model.words[record.normalizedWord] = {
                count: Math.min(9999, (existing?.count || 0) + record.weight),
                lastUsed: now,
                value: record.word,
            };
            if (record.previous) {
                const pairKey = `${record.previous}${ADAPTIVE_PAIR_SEPARATOR}${record.normalizedWord}`;
                const pair = model.pairs[pairKey];
                model.pairs[pairKey] = {
                    count: Math.min(9999, (pair?.count || 0) + record.weight),
                    lastUsed: now,
                };
            }
        }
        pruneRecord(model.words, MAX_WORDS);
        pruneRecord(model.pairs, MAX_PAIRS);
        await chrome.storage.local.set({ [ADAPTIVE_MODEL_STORAGE_KEY]: model });
    }, ADAPTIVE_STORAGE_QUEUE);
}

function closePendingRecordBatch(): Promise<void> {
    const batch = pendingRecordBatch;
    if (!batch) return adaptiveMutationTail;
    pendingRecordBatch = null;
    if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
    if (batch.maxWaitTimer) clearTimeout(batch.maxWaitTimer);
    const operation = batch.prerequisite.then(() => persistRecordBatch(batch.records));
    trackAdaptiveMutation(operation);
    void operation.then(batch.resolve, batch.reject);
    return operation;
}

function enqueueRecord(payload: AdaptiveMutationPayload): Promise<void> {
    const normalizedWord = normalizeWord(payload.word);
    if (!normalizedWord) return Promise.reject(new Error('INVALID_ADAPTIVE_WORD'));
    if (!pendingRecordBatch) {
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<void>((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });
        pendingRecordBatch = {
            records: [],
            prerequisite: adaptiveMutationTail,
            resolve,
            reject,
            promise,
        };
        pendingRecordBatch.maxWaitTimer = setTimeout(() => void closePendingRecordBatch(), RECORD_MAX_WAIT_MS);
    }
    const batch = pendingRecordBatch;
    batch.records.push({
        word: String(payload.word || normalizedWord).slice(0, 32),
        normalizedWord,
        previous: normalizeWord(payload.previous),
        weight: Math.min(10, Math.max(1, Number(payload.weight) || 1)),
    });
    if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
    batch.debounceTimer = setTimeout(() => void closePendingRecordBatch(), RECORD_DEBOUNCE_MS);
    return batch.promise;
}

export function flushAdaptiveMutations(): Promise<void> {
    return closePendingRecordBatch();
}

export function applyAdaptiveMutation(mutation: AdaptiveMutation, payload: AdaptiveMutationPayload): Promise<void> {
    if (mutation === 'record') return enqueueRecord(payload);

    if (mutation !== 'clear' && mutation !== 'reject' && mutation !== 'accept') {
        return Promise.reject(new Error('INVALID_ADAPTIVE_MUTATION'));
    }
    const word = mutation === 'clear' ? '' : normalizeWord(payload.word);
    if (mutation !== 'clear' && !word) return Promise.reject(new Error('INVALID_ADAPTIVE_WORD'));

    closePendingRecordBatch();
    const prerequisite = adaptiveMutationTail;
    const operation = prerequisite.then(() =>
        enqueueStorageMutation(async () => {
            if (mutation === 'clear') {
                await chrome.storage.local.set({
                    [ADAPTIVE_MODEL_STORAGE_KEY]: structuredClone(EMPTY_ADAPTIVE_MODEL),
                    adaptiveBlockedWords: [],
                });
                return;
            }
            const stored = await chrome.storage.local.get({ [ADAPTIVE_MODEL_STORAGE_KEY]: EMPTY_ADAPTIVE_MODEL });
            const model = parseAdaptiveModel(stored[ADAPTIVE_MODEL_STORAGE_KEY]);
            if (mutation === 'reject') {
                model.rejections[word] = Math.min(20, (model.rejections[word] || 0) + 1);
            } else {
                model.rejections[word] = Math.max(0, (model.rejections[word] || 0) - 1);
            }
            await chrome.storage.local.set({ [ADAPTIVE_MODEL_STORAGE_KEY]: model });
        }, ADAPTIVE_STORAGE_QUEUE),
    );
    return trackAdaptiveMutation(operation);
}
