import type { RequestMode } from './types';

export interface SidepanelCommand {
    id: string;
    name: string;
    mode: RequestMode;
    prompt?: string;
}

export interface VariantPreset {
    name: string;
    prompt: string;
}

export const SIDEPANEL_COMMANDS: SidepanelCommand[] = [
    { id: 'spellcheck', name: 'Исправить ошибки', mode: 'spellcheck' },
    { id: 'style', name: 'Улучшить стиль', mode: 'style' },
    { id: 'emoji', name: 'Добавить эмодзи', mode: 'emoji' },
    { id: 'translate', name: 'Перевести', mode: 'translate' },
    {
        id: 'shorter',
        name: 'Сделать короче',
        mode: 'custom',
        prompt: 'Сократи текст без потери смысла и сохрани язык исходного текста. Верни только готовый текст.',
    },
    {
        id: 'formal',
        name: 'Сделать формальнее',
        mode: 'custom',
        prompt: 'Перепиши текст в вежливом деловом стиле, сохрани язык и факты. Верни только готовый текст.',
    },
];

export const VARIANT_PRESETS: VariantPreset[] = [
    {
        name: 'Короче',
        prompt: 'Сделай текст заметно короче и яснее, сохрани язык и смысл. Верни только результат.',
    },
    {
        name: 'Нейтрально',
        prompt: 'Перепиши текст в спокойном нейтральном тоне, сохрани язык и факты. Верни только результат.',
    },
    {
        name: 'Живее',
        prompt: 'Сделай текст более живым и естественным без лишней эмоциональности, сохрани язык. Верни только результат.',
    },
];
