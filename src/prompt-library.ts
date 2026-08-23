import type { CustomCommand } from './types';

export interface PromptTemplate extends CustomCommand {
    category: 'development' | 'productivity' | 'career' | 'writing';
    description: string;
    icon: string;
}

export const PROMPT_LIBRARY_TEMPLATES: PromptTemplate[] = [
    {
        id: 'tpl-code-review',
        name: 'Code Review & Баги',
        category: 'development',
        description: 'Поиск уязвимостей, краевых случаев и оптимизация производительности',
        icon: 'code',
        prompt: 'Проведи тщательный код-ревью переданного фрагмента. Найди потенциальные баги, утечки, проблемы с безопасностью и предложи чистый улучшенный вариант с краткими пояснениями.',
    },
    {
        id: 'tpl-sql-regex',
        name: 'Генератор SQL & Regex',
        category: 'development',
        description: 'Преобразование описания в готовый SQL-запрос или регулярное выражение',
        icon: 'terminal',
        prompt: 'Преобразуй описание задачи в корректный, производительный SQL-запрос или регулярное выражение Regex с пояснением каждого условия.',
    },
    {
        id: 'tpl-meeting-notes',
        name: 'Протокол встречи',
        category: 'productivity',
        description: 'Структурирование заметок в решения, задачи и сроки',
        icon: 'list',
        prompt: 'Преврати эти заметки в аккуратный протокол встречи: 1. Главные обсуждённые темы; 2. Принятые решения; 3. Список задач с ответственными (Action Items); 4. Сроки и следующие шаги.',
    },
    {
        id: 'tpl-cover-letter',
        name: 'Сопроводительное письмо',
        category: 'career',
        description: 'Убедительный отклик на вакансию с акцентом на навыках',
        icon: 'mail',
        prompt: 'Напиши вежливое, профессиональное и убедительное сопроводительное письмо на основе описания. Выдели ключевой опыт и готовность к решению задач компании.',
    },
    {
        id: 'tpl-json-translate',
        name: 'Перевод разметки (JSON/HTML)',
        category: 'writing',
        description: 'Перевод значений с сохранением синтаксиса и ключей',
        icon: 'translate',
        prompt: 'Переведи текстовые значения на русский язык. Строго сохрани все ключи JSON, HTML-теги, переменные шаблонов и программный синтаксис без искажения структуры.',
    },
    {
        id: 'tpl-release-notes',
        name: 'Release Notes',
        category: 'productivity',
        description: 'Формирование списка изменений из коммитов',
        icon: 'sparkles',
        prompt: 'Сформируй понятный для пользователей список изменений (Release Notes) на основе списка коммитов. Раздели на разделы: ✨ Новые возможности, ⚡ Оптимизация и 🐛 Исправления ошибок.',
    },
];
