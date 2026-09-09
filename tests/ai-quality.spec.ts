import { describe, expect, test, vi } from 'vitest';
import { cleanAiOutputText, validateAiOutput } from '../src/ai-sanity-check';
import { streamCloudflareText } from '../src/cloudflare-client';
import type { MistralSettings } from '../src/mistral-client';
import { executeAiStreamRequest, resetAiProviderHealth } from '../src/ai-client';
import { AiProviderError } from '../src/ai-provider-types';

interface RegressionCase {
    id: string;
    category: string;
    original: string;
    expected: string;
    forbiddenPatterns?: RegExp[];
}

export const RUSSIAN_REGRESSION_SUITE: RegressionCase[] = [
    {
        id: 'tsya-1',
        category: 'Правописание -тся/-ться',
        original: 'Он надеется встретится с нами завтра.',
        expected: 'Он надеется встретиться с нами завтра.',
        forbiddenPatterns: [/встретится/],
    },
    {
        id: 'tsya-2',
        category: 'Правописание -тся/-ться',
        original: 'Мне кажеться, это хорошая идея.',
        expected: 'Мне кажется, это хорошая идея.',
        forbiddenPatterns: [/кажеться/],
    },
    {
        id: 'ne-1',
        category: 'Не с прилагательными',
        original: 'Это совершенно не правильный ответ.',
        expected: 'Это совершенно неправильный ответ.',
        forbiddenPatterns: [/не правильный/],
    },
    {
        id: 'ne-ni-1',
        category: 'Не и ни',
        original: 'Как не крути, ничего не вышло.',
        expected: 'Как ни крути, ничего не вышло.',
        forbiddenPatterns: [/как не крути/i],
    },
    {
        id: 'punct-subord-1',
        category: 'Сложноподчиненное предложение',
        original: 'Я точно знаю что вы придёте вовремя.',
        expected: 'Я точно знаю, что вы придёте вовремя.',
        forbiddenPatterns: [/знаю что/],
    },
    {
        id: 'punct-intro-1',
        category: 'Вводные слова',
        original: 'К счастью поезд не опоздал.',
        expected: 'К счастью, поезд не опоздал.',
        forbiddenPatterns: [/^К счастью поезд/],
    },
    {
        id: 'hyphen-pronoun-1',
        category: 'Дефис в местоимениях',
        original: 'Кто то забыл свои ключи на столе.',
        expected: 'Кто-то забыл свои ключи на столе.',
        forbiddenPatterns: [/Кто то/],
    },
    {
        id: 'hyphen-adverb-1',
        category: 'Дефис в наречиях',
        original: 'Мы поговорили по дружески и всё решили.',
        expected: 'Мы поговорили по-дружески и всё решили.',
        forbiddenPatterns: [/по дружески/],
    },
    {
        id: 'agreement-case-1',
        category: 'Управление и падеж',
        original: 'Оплата произведена согласно договора.',
        expected: 'Оплата произведена согласно договору.',
        forbiddenPatterns: [/согласно договора/],
    },
    {
        id: 'agreement-gender-1',
        category: 'Согласование рода и числа',
        original: 'Вкусный кофе остыло на столе.',
        expected: 'Вкусный кофе остыл на столе.',
        forbiddenPatterns: [/кофе остыло/],
    },
    {
        id: 'participle-clause-1',
        category: 'Причастный оборот',
        original: 'Человек стоящий у окна читал книгу.',
        expected: 'Человек, стоящий у окна, читал книгу.',
        forbiddenPatterns: [/Человек стоящий/],
    },
    {
        id: 'adverbial-clause-1',
        category: 'Деепричастный оборот',
        original: 'Выпив чашку чая он продолжил работу.',
        expected: 'Выпив чашку чая, он продолжил работу.',
        forbiddenPatterns: [/чая он/],
    },
    {
        id: 'spelling-vocab-1',
        category: 'Словарные слова и приставки',
        original: 'Нужно точно расчитать бюджет проекта.',
        expected: 'Нужно точно рассчитать бюджет проекта.',
        forbiddenPatterns: [/расчитать/],
    },
    {
        id: 'spelling-root-1',
        category: 'Правописание корней',
        original: 'Спортсмен раскрыл парашут вовремя.',
        expected: 'Спортсмен раскрыл парашют вовремя.',
        forbiddenPatterns: [/парашут/],
    },
    {
        id: 'proper-name-1',
        category: 'Имена собственные',
        original: 'Конференция пройдёт в городе санкт-петербург.',
        expected: 'Конференция пройдёт в городе Санкт-Петербурге.',
        forbiddenPatterns: [/санкт-петербург/],
    },
    {
        id: 'numbers-preservation-1',
        category: 'Сохранение чисел',
        original: 'В 2026 году прибыль выросла на 15,4%.',
        expected: 'В 2026 году прибыль выросла на 15,4%.',
        forbiddenPatterns: [/2025/, /2024/],
    },
    {
        id: 'url-preservation-1',
        category: 'Сохранение ссылок',
        original: 'Документация доступна по адресу https://lexisync.org/guide для всех.',
        expected: 'Документация доступна по адресу https://lexisync.org/guide для всех.',
    },
    {
        id: 'email-preservation-1',
        category: 'Сохранение email',
        original: 'Отправте отчет на support@lexisync.ai сегодня.',
        expected: 'Отправьте отчет на support@lexisync.ai сегодня.',
        forbiddenPatterns: [/Отправте/],
    },
    {
        id: 'tech-terms-1',
        category: 'Технические термины и идентификаторы',
        original: 'Метод getUserById() возвращает ошибку в строке 42.',
        expected: 'Метод getUserById() возвращает ошибку в строке 42.',
    },
    {
        id: 'business-tone-1',
        category: 'Деловой стиль',
        original: 'В ответ на ваш запрос высылаем комерческое предложение.',
        expected: 'В ответ на ваш запрос высылаем коммерческое предложение.',
        forbiddenPatterns: [/комерческое/],
    },
    {
        id: 'colloquial-preserve-1',
        category: 'Разговорный стиль',
        original: 'Щас проверю отчет и сразу отпишусь.',
        expected: 'Сейчас проверю отчет и сразу отпишусь.',
        forbiddenPatterns: [/Щас/],
    },
    {
        id: 'no-errors-clean-1',
        category: 'Безошибочный текст (не изменять)',
        original: 'Сегодня отличная погода для прогулки по парку.',
        expected: 'Сегодня отличная погода для прогулки по парку.',
    },
    {
        id: 'long-compound-sentence-1',
        category: 'Длинное предложение с перечислением',
        original: 'Мы обсудили дизайн разработку тестирование и релиз но окончательного решения пока нет.',
        expected: 'Мы обсудили дизайн, разработку, тестирование и релиз, но окончательного решения пока нет.',
    },
    {
        id: 'tautology-cliche-1',
        category: 'Плеоназм и канцеляризмы',
        original: 'В конечном итоге главный приоритет был достигнут.',
        expected: 'В конечном итоге главный приоритет был достигнут.',
    },
    {
        id: 'punctuation-direct-speech-1',
        category: 'Прямая речь',
        original: 'Он сказал «Мы закончим проект в срок».',
        expected: 'Он сказал: «Мы закончим проект в срок».',
    },
    {
        id: 'spelling-compound-words-1',
        category: 'Сложные слова',
        original: 'Мы заключили научно исследовательский договор.',
        expected: 'Мы заключили научно-исследовательский договор.',
        forbiddenPatterns: [/научно исследовательский/],
    },
    {
        id: 'spelling-particles-1',
        category: 'Частицы кое/то/либо/нибудь/таки',
        original: 'Все таки мы успели сдать релиз вовремя.',
        expected: 'Всё-таки мы успели сдать релиз вовремя.',
        forbiddenPatterns: [/Все таки/],
    },
    {
        id: 'spelling-adverbs-merged-1',
        category: 'Слитное и раздельное написание наречий',
        original: 'Мы пошли в глубь леса не спеша.',
        expected: 'Мы пошли вглубь леса не спеша.',
        forbiddenPatterns: [/в глубь леса/],
    },
];

describe('Russian Quality Regression Suite: структурная проверка корпуса', () => {
    test('тестовый набор содержит не менее 28 разнообразных примеров на русском языке', () => {
        expect(RUSSIAN_REGRESSION_SUITE.length).toBeGreaterThanOrEqual(28);
        const categories = new Set(RUSSIAN_REGRESSION_SUITE.map((c) => c.category));
        expect(categories.size).toBeGreaterThanOrEqual(15);
    });

    test('каждый сценарий содержит непустой оригинал и ожидаемый исправленный текст', () => {
        for (const item of RUSSIAN_REGRESSION_SUITE) {
            expect(item.original.trim().length).toBeGreaterThan(0);
            expect(item.expected.trim().length).toBeGreaterThan(0);
        }
    });
});

describe('Sanity Check: cleanAiOutputText', () => {
    test('удаляет Markdown code fences (```...```)', () => {
        const raw = '```\nЭто исправленный текст без ошибок.\n```';
        expect(cleanAiOutputText(raw)).toBe('Это исправленный текст без ошибок.');
    });

    test('удаляет служебные вступительные фразы моделей', () => {
        const raw = 'Вот исправленный текст:\nПривет, как ваши дела?';
        expect(cleanAiOutputText(raw)).toBe('Привет, как ваши дела?');

        const raw2 = 'Исправленный вариант: Мы приехали вовремя.';
        expect(cleanAiOutputText(raw2)).toBe('Мы приехали вовремя.');

        const raw3 = 'Here is the corrected text: All systems operational.';
        expect(cleanAiOutputText(raw3)).toBe('All systems operational.');
    });

    test('удаляет внешние кавычки, добавленные моделью, если их не было в оригинале', () => {
        const raw = '"Текст без лишних кавычек."';
        expect(cleanAiOutputText(raw, 'Текст без лишних кавычек.')).toBe('Текст без лишних кавычек.');
    });

    test('сохраняет внешние кавычки, если они были в исходном тексте', () => {
        const raw = '«Цитата автора»';
        expect(cleanAiOutputText(raw, '«Цитата автора»')).toBe('«Цитата автора»');
    });

    test('преобразует экранированные \\n в реальные переносы строк', () => {
        const raw = 'Первая строка\\nВторая строка';
        expect(cleanAiOutputText(raw)).toBe('Первая строка\nВторая строка');
    });
});

describe('Sanity Check: validateAiOutput', () => {
    test('бракует пустой ответ модели', () => {
        const res = validateAiOutput({ originalText: 'Текст', correctedText: '   ', mode: 'spellcheck' });
        expect(res.valid).toBe(false);
        expect(res.reason).toBe('AI_OUTPUT_EMPTY');
    });

    test('бракует критически сокращённый текст (более 45% сокращения)', () => {
        const original = 'Это достаточно длинное предложение с несколькими важными фактами и деталями.';
        const corrected = 'Кратко.';
        const res = validateAiOutput({ originalText: original, correctedText: corrected, mode: 'spellcheck' });
        expect(res.valid).toBe(false);
        expect(res.reason).toContain('AI_OUTPUT_TOO_SHORT');
    });

    test('бракует критически раздутый текст (>175% длины)', () => {
        const original = 'Короткая фраза.';
        const corrected =
            'Это невероятно длинная фраза, которую модель зачем-то придумала и раздула до огромных размеров с множеством лишних слов и ненужных подробностей.';
        const res = validateAiOutput({ originalText: original, correctedText: corrected, mode: 'spellcheck' });
        expect(res.valid).toBe(false);
        expect(res.reason).toContain('AI_OUTPUT_TOO_LONG');
    });

    test('бракует языковой дрифт (Cyrillic -> English translation)', () => {
        const original = 'Мы подготовили подробный отчёт о проделанной работе.';
        const corrected = 'We have prepared a detailed report on the work done.';
        const res = validateAiOutput({ originalText: original, correctedText: corrected, mode: 'spellcheck' });
        expect(res.valid).toBe(false);
        expect(res.reason).toContain('AI_OUTPUT_LANGUAGE_DRIFT');
    });

    test('бракует ответ, в котором потерян обязательный URL', () => {
        const original = 'Инструкция по установке находится на https://lexisync.org/install в документации.';
        const corrected = 'Инструкция по установке находится в документации на сайте.';
        const res = validateAiOutput({ originalText: original, correctedText: corrected, mode: 'spellcheck' });
        expect(res.valid).toBe(false);
        expect(res.reason).toContain('AI_OUTPUT_LOST_URL');
    });

    test('бракует ответ, в котором потерян email', () => {
        const original = 'Напишите на admin@company.com для получения доступа.';
        const corrected = 'Напишите администратору для получения доступа.';
        const res = validateAiOutput({ originalText: original, correctedText: corrected, mode: 'spellcheck' });
        expect(res.valid).toBe(false);
        expect(res.reason).toContain('AI_OUTPUT_LOST_EMAIL');
    });

    test('бракует ответ с мета-комментарием модели вместо чистого текста', () => {
        const original = 'Он надеется встретится.';
        const corrected = 'Я исправил следующие ошибки в вашем тексте: встретится -> встретиться.';
        const res = validateAiOutput({ originalText: original, correctedText: corrected, mode: 'spellcheck' });
        expect(res.valid).toBe(false);
        expect(res.reason).toContain('AI_OUTPUT_META_COMMENTARY');
    });

    test('успешно валидирует качественное корректное исправление', () => {
        const original = 'Он надеется встретится завтра в 15:00.';
        const corrected = 'Он надеется встретиться завтра в 15:00.';
        const res = validateAiOutput({ originalText: original, correctedText: corrected, mode: 'spellcheck' });
        expect(res.valid).toBe(true);
        expect(res.cleanedText).toBe('Он надеется встретиться завтра в 15:00.');
    });
});

describe('Cloudflare Stream & Quality Fallback Integration', () => {
    test('когда Cloudflare возвращает брак (language drift), выбрасывается QUALITY_CHECK_FAILED', async () => {
        const encoder = new TextEncoder();
        const badStream = new ReadableStream({
            start(controller) {
                controller.enqueue(
                    encoder.encode('data: {"response":"This is English text translating Russian"}\n\ndata: [DONE]\n\n'),
                );
                controller.close();
            },
        });
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(badStream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
        );

        let thrownError: unknown;
        try {
            await streamCloudflareText(
                { action: 'callMistral', mode: 'spellcheck', text: 'Мы подготовили отчёт о проделанной работе.' },
                { accountId: 'acc-1', apiToken: 'tok-1' },
                {
                    selectedTone: 'business',
                    sendPageContext: false,
                    personalDictionary: [],
                    glossary: [],
                    aiMode: 'balanced',
                } as unknown as MistralSettings,
                new AbortController().signal,
                () => undefined,
            );
        } catch (e) {
            thrownError = e;
        }
        expect(thrownError).toBeInstanceOf(AiProviderError);
        expect((thrownError as AiProviderError).code).toBe('QUALITY_CHECK_FAILED');
        expect((thrownError as AiProviderError).isFallbackEligible).toBe(true);

        vi.restoreAllMocks();
    });

    test('брак Cloudflare (QUALITY_CHECK_FAILED) автоматически сбрасывает поток и переключается на Mistral', async () => {
        resetAiProviderHealth();
        const encoder = new TextEncoder();
        const chunks: string[] = [];
        let resetCount = 0;

        // Первый запрос (Cloudflare) возвращает брак
        const badCfStream = new ReadableStream({
            start(controller) {
                controller.enqueue(
                    encoder.encode('data: {"response":"Totally wrong english text"}\n\ndata: [DONE]\n\n'),
                );
                controller.close();
            },
        });

        // Второй запрос (Mistral) возвращает правильный русский ответ
        const goodMistralStream = new ReadableStream({
            start(controller) {
                controller.enqueue(
                    encoder.encode(
                        'data: {"choices":[{"delta":{"content":"Он надеется встретиться."}}]} \n\ndata: [DONE]\n\n',
                    ),
                );
                controller.close();
            },
        });

        let callCount = 0;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url) => {
            callCount++;
            if (callCount === 1) {
                return new Response(badCfStream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
            }
            return new Response(goodMistralStream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        });

        const res = await executeAiStreamRequest({
            request: { action: 'callMistral', mode: 'spellcheck', text: 'Он надеется встретится.' },
            settings: {
                selectedTone: 'business',
                sendPageContext: false,
                personalDictionary: [],
                glossary: [],
                aiMode: 'balanced',
            } as unknown as MistralSettings,
            primaryProvider: 'cloudflare',
            autoFallback: true,
            mistralApiKey: 'mistral-valid-key',
            cloudflareAccountId: 'cf-acc-1',
            cloudflareApiToken: 'cf-tok-1',
            signal: new AbortController().signal,
            onChunk: (chunk) => chunks.push(chunk),
            onReset: () => {
                resetCount++;
                chunks.length = 0;
            },
        });

        expect(resetCount).toBe(1);
        expect(res.providerUsed).toBe('mistral');
        expect(res.fallbackOccurred).toBe(true);
        expect(res.fallbackReason).toBe('QUALITY_CHECK_FAILED');
        expect(chunks.join('')).toBe('Он надеется встретиться.');
        expect(res.fallbackNotification).toContain('Ответ Cloudflare не прошёл проверку качества');

        vi.restoreAllMocks();
    });
});
