export const YANDEX_SPELLER_ENDPOINT = 'https://speller.yandex.net/services/spellservice.json/checkText';
export const YANDEX_SPELLER_ATTRIBUTION_URL = 'http://api.yandex.ru/speller/';
export const YANDEX_SPELLER_MAX_TEXT_LENGTH = 10_000;

export type YandexSpellerLanguage = 'ru' | 'ru,en';

export interface YandexSpellerErrorItem {
    code: number;
    pos: number;
    row: number;
    col: number;
    len: number;
    word: string;
    s: string[];
}

export interface YandexSpellerFinding extends YandexSpellerErrorItem {
    original: string;
    suggestions: string[];
    start: number;
    end: number;
    applied: boolean;
    ambiguous: boolean;
}

export interface YandexSpellerResult {
    correctedText: string;
    findings: YandexSpellerFinding[];
    unresolvedCount: number;
}

export type YandexSpellerErrorCode =
    | 'OFFLINE'
    | 'TIMEOUT'
    | 'HTTP_429'
    | 'HTTP_5XX'
    | 'HTTP_ERROR'
    | 'INVALID_RESPONSE'
    | 'EMPTY_RESPONSE'
    | 'TEXT_TOO_LONG';

export class YandexSpellerError extends Error {
    constructor(
        public readonly code: YandexSpellerErrorCode,
        message: string,
        public readonly status?: number,
    ) {
        super(message);
        this.name = 'YandexSpellerError';
    }
}

export interface CheckYandexSpellingOptions {
    lang?: YandexSpellerLanguage;
    options?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    ignoredWords?: string[];
    fetchImpl?: typeof fetch;
}

function isFiniteInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseResponse(value: unknown): YandexSpellerErrorItem[] {
    if (!Array.isArray(value)) throw new YandexSpellerError('INVALID_RESPONSE', 'Яндекс.Спеллер вернул неверный JSON.');
    return value.map((item) => {
        if (
            !item ||
            typeof item !== 'object' ||
            !isFiniteInteger((item as YandexSpellerErrorItem).code) ||
            !isFiniteInteger((item as YandexSpellerErrorItem).pos) ||
            !isFiniteInteger((item as YandexSpellerErrorItem).row) ||
            !isFiniteInteger((item as YandexSpellerErrorItem).col) ||
            !isFiniteInteger((item as YandexSpellerErrorItem).len) ||
            typeof (item as YandexSpellerErrorItem).word !== 'string' ||
            !Array.isArray((item as YandexSpellerErrorItem).s) ||
            !(item as YandexSpellerErrorItem).s.every((suggestion) => typeof suggestion === 'string')
        ) {
            throw new YandexSpellerError('INVALID_RESPONSE', 'Яндекс.Спеллер вернул ответ неожиданного формата.');
        }
        const source = item as YandexSpellerErrorItem;
        return { ...source, s: [...source.s] };
    });
}

export function applyYandexSpellerCorrections(
    text: string,
    errors: YandexSpellerErrorItem[],
    ignoredWords: string[] = [],
): YandexSpellerResult {
    const ignored = new Set(ignoredWords.map((word) => word.trim().toLocaleLowerCase()).filter(Boolean));
    const occupied: Array<{ start: number; end: number }> = [];
    const findings = errors
        .filter((error) => !ignored.has(error.word.toLocaleLowerCase()))
        .map((error): YandexSpellerFinding => {
            const start = error.pos;
            const end = start + error.len;
            const validRange = start >= 0 && end <= text.length && text.slice(start, end) === error.word;
            const overlaps = occupied.some((range) => start < range.end && end > range.start);
            const suggestions = [...new Set(error.s.filter(Boolean))];
            const applied = validRange && !overlaps && suggestions.length === 1;
            if (validRange && !overlaps) occupied.push({ start, end });
            return {
                ...error,
                s: suggestions,
                original: error.word,
                suggestions,
                start,
                end,
                applied,
                ambiguous: suggestions.length !== 1,
            };
        });

    let correctedText = text;
    for (const finding of findings.filter((item) => item.applied).sort((left, right) => right.start - left.start)) {
        correctedText =
            correctedText.slice(0, finding.start) + finding.suggestions[0] + correctedText.slice(finding.end);
    }
    return {
        correctedText,
        findings,
        unresolvedCount: findings.filter((finding) => !finding.applied).length,
    };
}

export async function checkYandexSpelling(
    text: string,
    options: CheckYandexSpellingOptions = {},
): Promise<YandexSpellerResult> {
    if (text.length > YANDEX_SPELLER_MAX_TEXT_LENGTH) {
        throw new YandexSpellerError(
            'TEXT_TOO_LONG',
            `Яндекс.Спеллер принимает не более ${YANDEX_SPELLER_MAX_TEXT_LENGTH} символов за запрос.`,
        );
    }
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort('timeout'), options.timeoutMs ?? 12_000);
    const abortFromCaller = () => timeoutController.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
        const body = new URLSearchParams({
            text,
            lang: options.lang ?? 'ru',
            options: String(options.options ?? 0),
        });
        const response = await fetchImpl(YANDEX_SPELLER_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body,
            signal: timeoutController.signal,
        });
        if (!response.ok) {
            if (response.status === 429)
                throw new YandexSpellerError('HTTP_429', 'Яндекс.Спеллер временно ограничил частоту запросов.', 429);
            if (response.status >= 500)
                throw new YandexSpellerError('HTTP_5XX', 'Яндекс.Спеллер временно недоступен.', response.status);
            throw new YandexSpellerError(
                'HTTP_ERROR',
                `Ошибка Яндекс.Спеллера: HTTP ${response.status}.`,
                response.status,
            );
        }
        const raw = await response.text();
        if (!raw.trim()) throw new YandexSpellerError('EMPTY_RESPONSE', 'Яндекс.Спеллер вернул пустой ответ.');
        let payload: unknown;
        try {
            payload = JSON.parse(raw);
        } catch {
            throw new YandexSpellerError('INVALID_RESPONSE', 'Яндекс.Спеллер вернул неверный JSON.');
        }
        return applyYandexSpellerCorrections(text, parseResponse(payload), options.ignoredWords);
    } catch (error) {
        if (error instanceof YandexSpellerError) throw error;
        if (timeoutController.signal.aborted) {
            if (options.signal?.aborted) throw new DOMException('Запрос отменён.', 'AbortError');
            throw new YandexSpellerError('TIMEOUT', 'Превышено время ожидания ответа Яндекс.Спеллера.');
        }
        throw new YandexSpellerError(
            'OFFLINE',
            'Не удалось подключиться к Яндекс.Спеллеру. Проверьте интернет-соединение.',
        );
    } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abortFromCaller);
    }
}

export async function checkYandexSpellerAvailability(options: CheckYandexSpellingOptions = {}): Promise<boolean> {
    try {
        await checkYandexSpelling('проверка', { ...options, ignoredWords: [] });
        return true;
    } catch {
        return false;
    }
}
