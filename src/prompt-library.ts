import type { CustomCommand } from './types';

export interface PromptTemplate extends CustomCommand {
    category: 'development' | 'productivity' | 'career' | 'writing';
    description: string;
    icon: string;
}

export const PROMPT_LIBRARY_TEMPLATES: PromptTemplate[] = [
    {
        id: 'tpl-translate-en',
        name: 'Перевести на английский',
        category: 'writing',
        description: 'Точный и естественный перевод текста на английский язык',
        icon: 'translate',
        prompt: 'Переведи предоставленный текст на английский язык так, чтобы он звучал максимально естественно для носителей языка. Сохраняй исходный тон и форматирование.',
    },
    {
        id: 'tpl-summary',
        name: 'Краткая выжимка',
        category: 'productivity',
        description: 'Выделение главного из длинного текста или статьи',
        icon: 'list',
        prompt: 'Сделай краткую выжимку из предоставленного текста. Выдели основные идеи в виде маркированного списка, убрав всю «воду» и второстепенные детали.',
    },
    {
        id: 'tpl-polite',
        name: 'Сделать вежливее',
        category: 'writing',
        description: 'Смягчение тона сообщения для деловой переписки',
        icon: 'mail',
        prompt: 'Перепиши текст так, чтобы он звучал более вежливо, дипломатично и профессионально. Идеально для деловой переписки.',
    },
    {
        id: 'tpl-social',
        name: 'Пост для соцсетей',
        category: 'writing',
        description: 'Адаптация текста для публикации в соцсетях',
        icon: 'sparkles',
        prompt: 'Перепиши текст так, чтобы он стал увлекательным постом для социальных сетей. Добавь подходящие эмодзи, структурируй текст абзацами и сделай его вовлекающим.',
    },
    {
        id: 'tpl-explain',
        name: 'Объяснить как ребёнку',
        category: 'productivity',
        description: 'Упрощение сложных концепций до базового уровня',
        icon: 'terminal',
        prompt: 'Объясни эту концепцию или текст максимально простым языком, используя наглядные бытовые примеры. Представь, что ты объясняешь это 10-летнему ребёнку.',
    },
];
