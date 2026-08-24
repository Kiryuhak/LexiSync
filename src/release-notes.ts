import { t } from './i18n';

export type ReleaseNoteKind = 'new' | 'improved' | 'fixed';
export type ReleaseNotesLocale = 'ru' | 'en';

interface LocalizedText {
    ru: string;
    en: string;
}

export interface ReleaseNote {
    version: string;
    date: string;
    kind: ReleaseNoteKind;
    title: LocalizedText;
    changes: LocalizedText[];
}

const text = (ru: string, en: string): LocalizedText => ({ ru, en });

const note = (
    version: string,
    date: string,
    kind: ReleaseNoteKind,
    ruTitle: string,
    enTitle: string,
    changes: Array<[string, string]>,
): ReleaseNote => ({
    version,
    date,
    kind,
    title: text(ruTitle, enTitle),
    changes: changes.map(([ru, en]) => text(ru, en)),
});

// Пользовательская версия CHANGELOG: все опубликованные выпуски, но без внутренних технических подробностей.
export const RELEASE_NOTES: ReleaseNote[] = [
    note(
        '5.4.0',
        '2026-08-24',
        'new',
        'Текстовые макросы, локальные инструменты и надёжная история',
        'Text snippets, local tools, and reliable history',
        [
            [
                'Добавлены текстовые макросы: короткие команды раскрываются прямо в поле ввода без запроса к AI и не работают в чувствительных полях.',
                'Added text snippets: short commands expand directly in input fields without an AI request and stay disabled in sensitive fields.',
            ],
            [
                'Смена регистра, очистка пробелов и типографика теперь доступны как быстрые локальные инструменты.',
                'Case conversion, whitespace cleanup, and typography are now available as fast local tools.',
            ],
            [
                'История поддерживает до 500 записей, безопасный импорт без дублей и экспорт в JSON, CSV или Markdown.',
                'History now supports up to 500 records, safe duplicate-free import, and JSON, CSV, or Markdown export.',
            ],
            [
                'Исправлено сохранение автоматической проверки, позиционирование изменяемых окон и отображение статистики при повреждённых локальных данных.',
                'Fixed automatic proofreading persistence, positioning of resized result windows, and statistics with malformed local data.',
            ],
            [
                'Удалён неподдерживаемый эксперимент голосового ввода: LexiSync не запрашивает доступ к микрофону.',
                'Removed the unsupported voice-input experiment: LexiSync does not request microphone access.',
            ],
        ],
    ),
    note(
        '5.3.4',
        '2026-08-23',
        'fixed',
        'Надёжная защита данных и читаемый интерфейс во всех темах',
        'Reliable data protection and readable UI across all themes',
        [
            [
                'Исправлено сохранение настройки маскировки персональных данных: защита теперь остаётся включённой после повторного открытия настроек и синхронизируется между браузерами.',
                'Fixed personal data masking persistence: protection now remains enabled after reopening settings and syncs between browsers.',
            ],
            [
                'Email, телефоны, карты, IP-адреса и секретные ключи скрываются перед запросом к Mistral AI и безопасно восстанавливаются в готовом тексте после полного ответа.',
                'Emails, phone numbers, cards, IP addresses, and secret keys are hidden before the Mistral AI request and safely restored in the final text after the complete response.',
            ],
            [
                'Исправлен контраст руководства, библиотеки команд и окна сброса в светлой, тёмной, MagicOS, Aurora и остальных темах.',
                'Fixed contrast in the guide, command library, and reset dialog across light, dark, MagicOS, Aurora, and all other themes.',
            ],
            [
                'Вкладка команд и интерактивное руководство стали компактнее на узких экранах и получили улучшенную клавиатурную доступность.',
                'The Commands tab and interactive guide are now more compact on narrow screens and provide improved keyboard accessibility.',
            ],
            [
                'Галерея получила понятные шаблоны для повседневных задач и больше не создаёт дубликаты при повторном добавлении.',
                'The library now offers easy-to-understand templates for everyday tasks and no longer creates duplicates when added repeatedly.',
            ],
        ],
    ),
    note(
        '5.3.3',
        '2026-08-23',
        'new',
        'Интерактивное руководство, маскировка PII, библиотека шаблонов, сброс настроек и тихое исправление',
        'Interactive feature guide, PII masking, prompt library, factory reset, and silent quick fix',
        [
            [
                'Добавлена новая вкладка «Руководство» с интерактивными живыми демонстрациями для всех 10 ключевых возможностей и горячих клавиш.',
                'Added a new "Guide" tab with interactive live demonstrations for all 10 key features and keyboard shortcuts.',
            ],
            [
                'Внедрена локальная маскировка персональных данных (PII): email, телефоны, банковские карты и API-ключи автоматически обезличиваются на устройстве перед запросом к AI.',
                'Implemented local PII masking: emails, phone numbers, credit cards, and API keys are automatically anonymized on-device before querying AI.',
            ],
            [
                'Встроена галерея готовых шаблонов команд: добавление готовых промптов (Code Review, SQL, протокол встречи, перевод) в один клик.',
                'Built-in prompt library: 1-click addition of curated prompts (Code Review, SQL, meeting notes, translation).',
            ],
            [
                'Добавлено тихое исправление на месте (0 мс): мгновенное исправление опечаток, пунктуации и неверной раскладки прямо в активном поле ввода.',
                'Added silent in-place fix (0 ms): instant correction of typos, punctuation, and keyboard layout directly in the active input field.',
            ],
            [
                'Поддержано мультиформатное копирование: форматированный HTML для Word/Google Docs/Notion и чистый текст для редакторов кода.',
                'Added multi-format rich copying: formatted HTML for Word/Google Docs/Notion and plain text for code editors.',
            ],
            [
                'Добавлен сброс настроек до заводских с модальным подтверждением для безопасного возврата к исходной конфигурации.',
                'Added a factory reset option with confirmation modal to safely restore the default configuration.',
            ],
            [
                'Устранены паразитные символы разметки и исключено ошибочное оборачивание одиночных фраз в пустые Markdown-таблицы.',
                'Cleaned up markdown artifacts and strictly prevented single phrases from wrapping into empty pseudo-tables.',
            ],
            [
                'Добавлен умный расчёт времени чтения и степени сжатия для длинных текстов и выжимок.',
                'Added smart reading time estimation and compression badges for long articles and summaries.',
            ],
        ],
    ),
    note(
        '5.3.2',
        '2026-08-21',
        'improved',
        'Стабильная работа на сложных сайтах, приватные исключения и ускоренный запуск',
        'Stable operation on complex sites, private exclusions, and faster startup',
        [
            [
                'Окна результата и меню теперь сохраняют правильное положение в Telegram и других приложениях с масштабированными или вложенными модальными областями.',
                'Result windows and menus now stay correctly positioned in Telegram and other apps with scaled or nested modal areas.',
            ],
            [
                'Длинные названия AI-команд аккуратно переносятся внутри компактного меню, а карточка текущего сайта выровнена с остальными элементами popup.',
                'Long AI command names now wrap cleanly inside the compact menu, and the current-site card is aligned with the rest of the popup.',
            ],
            [
                'Глобальный доступ больше не мешает отдельно отключать LexiSync на текущем сайте; разрешения и сохранённые исключения всегда отображаются согласованно.',
                'Global access no longer prevents disabling LexiSync on the current site, and permissions now stay consistent with saved exclusions.',
            ],
            [
                'До загрузки настроек расширение остаётся неактивным, а отключённые сайты защищены от фоновой проверки и случайной отправки текста в API.',
                'The extension stays inactive until settings load, while disabled sites are protected from background checks and accidental API requests.',
            ],
            [
                'Снижено потребление памяти: service worker хранит только необходимые рабочие настройки, а размер истории определяется напрямую в IndexedDB без загрузки текстов.',
                'Memory use is reduced: the service worker caches only essential runtime settings, and history size is counted directly in IndexedDB without loading text.',
            ],
            [
                'Стили оформления изолированы от страниц, а перенос настроек корректно сохраняет все современные темы и параметры внешнего вида.',
                'Visual styles are isolated from web pages, while settings transfer now preserves every modern theme and appearance option.',
            ],
        ],
    ),
    note(
        '5.3.1',
        '2026-08-18',
        'improved',
        'Изоляция событий в модальных окнах, стабильное позиционирование и повышенная контрастность',
        'Modal event isolation, stable positioning, and enhanced contrast',
        [
            [
                'Исправлено сворачивание диалоговых окон написания писем (Яндекс.Почта, Gmail, Outlook) при кликах по кнопкам тулбара и меню расширения за счет монтирования в активный контекст модального окна и изоляции pointer-событий.',
                'Fixed email compose modal collapse (Yandex Mail, Gmail, Outlook) on toolbar/menu clicks by mounting within the active modal context and isolating pointer events.',
            ],
            [
                'Улучшено позиционирование попапов и AI-меню: точный учет верхней и нижней границ выделения предотвращает выталкивание окна в правый нижний угол при нехватке высоты.',
                'Improved popup and AI menu positioning with upper and lower selection bound tracking, preventing edge-clamping jumps to screen corners.',
            ],
            [
                'Ограничена максимальная высота меню с адаптивным скроллом для гарантированного удобства на экранах любого масштаба и разрешения.',
                'Added adaptive max-height scrolling for menus to ensure usability across all screen scales and resolutions.',
            ],
            [
                'Повышена плотность и контрастность фонов выпадающих списков и панелей (94–98%) во всех стилях оформления (Liquid Glass, MagicOS, Vision Aurora, Silk Obsidian).',
                'Increased background density and contrast (94-98%) for dropdowns and panels across all visual styles (Liquid Glass, MagicOS, Vision Aurora, Silk Obsidian).',
            ],
            [
                'Упрощен заголовок и вывод режима «Выжимка» без технических префиксов TL;DR.',
                'Cleaned up "Summary" mode header and output without technical TL;DR prefixes.',
            ],
        ],
    ),
    note(
        '5.3.0',
        '2026-08-18',
        'new',
        'Новые стили Vision Aurora и Silk Obsidian, умный ответ, объяснение и форматирование',
        'New Vision Aurora & Silk Obsidian styles, Smart Reply, Explain, and Clean & Format',
        [
            [
                'Новые стили оформления «Vision Aurora» (пространственное стекло с эффектом преломления) и «Silk Obsidian» (100% непрозрачный бархатный монолит с идеальной читаемостью).',
                'New visual styles: "Vision Aurora" (spatial frosted glass with refraction) and "Silk Obsidian" (100% opaque velvet matte for zero background blending).',
            ],
            [
                'Режим «Умный ответ» (Smart Reply) для быстрого составления вежливых ответов с чипами согласия, отказа, уточнения и альтернативы.',
                'Smart Reply mode for instant polite message drafting with intent chips (agree, decline, clarify, alternative).',
            ],
            [
                'Режим «Объясни просто» (Explain Simply) для разъяснения сложных терминов понятным языком и с наглядными примерами.',
                'Explain Simply mode for breaking down complex concepts and terminology in plain language with examples.',
            ],
            [
                'Режим «Очистить и форматировать» (Clean & Format) для устранения битых переносов строк из PDF, лишних пробелов и структурирования текста.',
                'Clean & Format mode for removing broken PDF line breaks, duplicate spaces, and structuring messy text.',
            ],
            [
                'Быстрое добавление слов в персональный словарь в один клик прямо из карточки проверки орфографии.',
                'One-click personal dictionary additions right from the spellcheck correction cards.',
            ],
            [
                'Локальные офлайн-правила типографики: мгновенное исправление кавычек-ёлочек, тире, дробей и неразрывных пробелов.',
                'Instant offline typography formatting for quotes, em-dashes, fractions, and non-breaking spaces.',
            ],
            [
                'Улучшенный алгоритм Live-Proofread с защитой границ слов (без дробления букв) и единым стилем с выбранной темой.',
                'Enhanced Live-Proofread with word-boundary protection (no fragmented word diffs) and full theme style inheritance.',
            ],
        ],
    ),
    note(
        '5.2.8',
        '2026-08-17',
        'improved',
        'Поддержка Google Таблиц, автопроверка ячеек и улучшение интерфейса',
        'Google Sheets support, live cell proofreading, and UI refinements',
        [
            [
                'Поддержка проверки и подсветки опечаток в Google Таблицах, Google Docs, Notion и contenteditable-редакторах.',
                'Support for spellchecking and error highlighting in Google Sheets, Google Docs, Notion, and contenteditable editors.',
            ],
            [
                'Мгновенная активация нативной проверки орфографии прямо во время ввода текста в ячейках Google Таблиц.',
                'Instant native spellcheck activation right as you type in Google Sheets cells and formula bar.',
            ],
            [
                'Быстрое применение исправлений по Ctrl+Enter (Cmd+Enter) в окне автопроверки без нарушения фокуса ввода.',
                'Quick apply of corrections via Ctrl+Enter (Cmd+Enter) in Live-Proofread without disrupting editing focus.',
            ],
            [
                'Адаптивный перенос кнопок в окне результата и устранение переполнения кнопки «Отменить замену».',
                'Responsive action buttons wrapping in the result modal and fix for the "Undo replacement" button overflow.',
            ],
        ],
    ),
    note(
        '5.2.7',
        '2026-08-17',
        'improved',
        'Удобство использования, оптимизация и IndexedDB',
        'Usability enhancements, optimizations, and IndexedDB',
        [
            [
                'Горячая клавиша Ctrl+Enter (Cmd+Enter) во всплывающем окне для быстрой вставки или копирования результата.',
                'Ctrl+Enter (Cmd+Enter) shortcut in popup window for instant text replacement or copying.',
            ],
            [
                'Наглядный счётчик изменений текста (слова, символы, процент сжатия/расширения) в строке статуса.',
                'Visual text change metrics (words, chars, compression/expansion percentage) in the status bar.',
            ],
            [
                'Быстрый сброс всех фильтров на странице Истории в один клик и порционный плавный рендеринг через IndexedDB.',
                'One-click reset of all filters in History and smooth batch rendering backed by IndexedDB.',
            ],
            [
                'Улучшено взаимодействие с Live-Proofread: закрытие по Escape и клику снаружи без сброса полей ввода, быстрое применение по Ctrl+Enter.',
                'Improved Live-Proofread interaction: Escape key and outside click dismissal without field resets, quick apply with Ctrl+Enter.',
            ],
            [
                'Кнопка быстрого повтора последнего действия (Quick Re-run) в тулбаре выделения текста.',
                'Quick Re-run action button in the text selection toolbar.',
            ],
            [
                'Доступ ко всем сайтам и встроенным тренажёрам (Stepik, Coursera и др.) с автоопределением сторонних фреймов и точным позиционированием в полях ввода.',
                'Access to all websites and embedded learning platforms (Stepik, Coursera, etc.) with automatic cross-origin iframe detection and accurate input positioning.',
            ],
            [
                'Индикатор токенов для длинных текстов (>4000 знаков), автоочистка устаревшего кэша и плавные микро-анимации.',
                'Token count badge for large texts (>4000 chars), automated expired cache cleanup, and smooth micro-animations.',
            ],
        ],
    ),
    note(
        '5.2.6',
        '2026-08-15',
        'fixed',
        'Точные действия и доступность меню',
        'Precise actions and menu accessibility',
        [
            [
                'При импорте настроек форма в настройках теперь сразу показывает новые значения лимитов и параметров темы.',
                'Importing settings now immediately updates the budget limits and theme options in the settings page.',
            ],
            [
                'В режиме распознавания текста (OCR) показывается кнопка копирования вместо неработающей кнопки замены, а текст можно редактировать.',
                'OCR mode now shows a copy action instead of an inactive replace button, and the recognized text can be edited directly.',
            ],
            [
                'В тулбаре и AI-меню выделения добавлена навигация стрелками на клавиатуре и закрытие по Escape.',
                'Selection toolbar and AI menus now support arrow key navigation and Escape key dismissal.',
            ],
            [
                'Кнопка скрытия и показа API-ключа получила корректные атрибуты доступности для программ чтения с экрана.',
                'The show/hide API key button now announces its state properly to screen readers.',
            ],
        ],
    ),
    note(
        '5.2.5',
        '2026-08-14',
        'fixed',
        'Встроенные редакторы и надёжная история',
        'Embedded editors and reliable history',
        [
            [
                'Горячие клавиши теперь работают с выделенным текстом в редакторах, встроенных в страницу, например в учебных заданиях.',
                'Keyboard shortcuts now work with selected text in editors embedded into a page, such as learning exercises.',
            ],
            [
                'Если текст выделен во встроенном поле, LexiSync больше не показывает ошибочное сообщение о недоступном буфере обмена.',
                'When text is selected in an embedded field, LexiSync no longer shows an incorrect clipboard access message.',
            ],
            [
                'История теперь подтверждает выполненные действия и понятным текстом сообщает, если что-то не получилось.',
                'History now confirms completed actions and clearly explains when something could not be completed.',
            ],
            [
                'Если для повтора нет открытой веб-страницы, LexiSync показывает причину вместо отсутствия реакции.',
                'If there is no open web page for replay, LexiSync now explains the issue instead of appearing unresponsive.',
            ],
            [
                'Кнопки защищены от случайного двойного запуска, а выгрузка истории надёжнее начинается в Firefox.',
                'Buttons are protected from accidental duplicate actions, and history downloads start more reliably in Firefox.',
            ],
        ],
    ),
    note('5.2.4', '2026-08-13', 'improved', 'Понятное название расширения', 'A clearer extension name', [
        [
            'Новое название «Корректор грамматики и орфографии - LexiSync» сразу объясняет основное назначение расширения.',
            'The new name “Grammar and Spell Checker - LexiSync” immediately explains the extension’s main purpose.',
        ],
        [
            'Название в списке расширений, магазине и подсказке кнопки браузера теперь согласовано.',
            'The name is now consistent in the extensions list, store listing, and browser button tooltip.',
        ],
    ]),
    note('5.2.3', '2026-08-11', 'improved', 'Безопаснее, быстрее и стабильнее', 'Safer, faster, and more reliable', [
        [
            'Автопроверка не отправляет содержимое полей пароля, логина, почты, телефона, адреса и платёжных данных, даже если сайт неверно обозначил поле.',
            'Live proofread does not send password, login, email, phone, address, or payment fields even when a site labels them incorrectly.',
        ],
        [
            'Персональные подсказки не обучаются на чувствительных полях, а применение исправления не запускает повторный запрос.',
            'Personal suggestions do not learn from sensitive fields, and applying a correction does not start another request.',
        ],
        [
            'После временной ошибки LexiSync не повторяет запросы без участия пользователя, а лимиты не запускают бесполезный цикл.',
            'After a temporary failure, LexiSync does not repeat requests without user action, and usage limits do not start a useless loop.',
        ],
        [
            'Автоматическая проверка загружается только после включения, поэтому обычные страницы запускают меньше кода LexiSync.',
            'Automatic proofread now loads only after it is enabled, so regular pages start less LexiSync code.',
        ],
        [
            'Chrome больше не показывает ложные ошибки несовпадения ресурсов после открытия настроек, popup или истории.',
            'Chrome no longer reports false resource mismatch errors after opening settings, the popup, or history.',
        ],
        [
            'Если фоновый обработчик перезапустился во время запроса, панель завершает загрузку и предлагает повторить действие.',
            'If the background worker restarts during a request, the panel stops loading and offers to retry the action.',
        ],
        [
            'Отмена запроса безопасно работает, даже если соединение с фоновым обработчиком уже успело закрыться.',
            'Cancelling a request remains safe even if the connection to the background worker has already closed.',
        ],
    ]),
    note('5.2.1', '2026-08-09', 'fixed', 'Чёткий текст в стеклянных стилях', 'Clear text in glass styles', [
        [
            'В стилях MagicOS и Aurora окно истории стало плотнее, поэтому текст больше не сливается с настройками на фоне.',
            'In MagicOS and Aurora, the update history surface is now denser so its text stays clear over the settings page.',
        ],
        [
            'Контраст улучшен отдельно для светлой и тёмной темы без отказа от эффекта стекла.',
            'Contrast is improved separately for light and dark themes while preserving the glass effect.',
        ],
    ]),
    note('5.2.0', '2026-08-09', 'new', 'Большое обновление интерфейса', 'Major interface update', [
        [
            'Нажмите на номер версии, чтобы посмотреть все изменения LexiSync в одном компактном окне.',
            'Select the version badge to see every LexiSync update in one compact window.',
        ],
        [
            'Добавлен поиск по номеру версии и описанию улучшения.',
            'Search is available by version number or improvement.',
        ],
        [
            'Настройки получили цветную шапку, спокойную анимацию и понятные описания функций.',
            'Settings now feature a colorful header, calm animation, and clear feature descriptions.',
        ],
        [
            'Повтор запроса и команды «Короче» или «Подробнее» больше не оставляют пустое окно.',
            'Retry and refinement actions no longer leave an empty result window.',
        ],
        [
            'После отключения автопроверки или исключения сайта ожидающий запрос больше не отправляется.',
            'Disabling live proofread or excluding a site now prevents the pending request from being sent.',
        ],
        [
            'Синхронизация Firefox и персональное дополнение слов по Tab стали стабильнее.',
            'Firefox settings sync and personal Tab completion are now more reliable.',
        ],
    ]),
    note('5.1.4', '2026-08-08', 'improved', 'Более компактное окно результата', 'More compact result window', [
        [
            'Окно результата стало уже и использует один интерфейс с предпросмотром в настройках.',
            'The result window is narrower and now matches its preview in settings.',
        ],
        [
            'Уточнена совместимость настольного и мобильного Firefox.',
            'Desktop and mobile Firefox compatibility was clarified.',
        ],
    ]),
    note('5.1.3', '2026-08-08', 'fixed', 'Точный учёт лимитов', 'Accurate limit tracking', [
        [
            'Отменённый до отправки запрос больше не расходует лимит и не попадает в статистику.',
            'A request cancelled before sending no longer uses a limit or appears in statistics.',
        ],
    ]),
    note('5.1.2', '2026-08-07', 'fixed', 'Меню учитывает отключение сайта', 'Menu respects disabled sites', [
        [
            'Отложенное меню не появляется после отключения LexiSync для текущего сайта.',
            'The delayed selection menu no longer appears after LexiSync is disabled for the current site.',
        ],
    ]),
    note('5.1.1', '2026-08-07', 'fixed', 'Автопроверка на узких экранах', 'Live proofread on narrow screens', [
        [
            'Карточка исправлений остаётся внутри экрана и рядом с полем ввода.',
            'The correction card stays within the viewport and near the text field.',
        ],
    ]),
    note('5.1.0', '2026-08-07', 'new', 'Стиль MagicOS и улучшенные окна', 'MagicOS style and improved windows', [
        ['Добавлен отдельный стиль MagicOS Liquid Glass.', 'A dedicated MagicOS Liquid Glass style was added.'],
        [
            'Компактные окна удерживаются рядом с выделенным текстом, а длинный результат прокручивается внутри.',
            'Compact windows stay near selected text while long results scroll inside.',
        ],
    ]),
    note('5.0.0', '2026-08-05', 'improved', 'Проще и легче', 'Simpler and lighter', [
        [
            'Удалена невостребованная рабочая панель и связанные разрешения.',
            'The unused workspace panel and its related permission were removed.',
        ],
        [
            'Автопроверка и лимиты перенесены в понятные разделы настроек.',
            'Live proofread and limits were moved to clearer settings sections.',
        ],
    ]),
    note('4.1.9', '2026-08-02', 'fixed', 'Единые цвета уведомлений', 'Consistent notification colors', [
        [
            'Кнопки, ошибки и уведомления корректно отображаются в светлой и тёмной темах.',
            'Buttons, errors, and notices now display correctly in light and dark themes.',
        ],
    ]),
    note(
        '4.1.8',
        '2026-08-02',
        'fixed',
        'Горячие клавиши в русской раскладке',
        'Shortcuts on Russian keyboard layouts',
        [
            [
                'Сочетания клавиш распознаются по физической клавише и работают стабильнее при смене раскладки.',
                'Shortcuts use the physical key and work more reliably across keyboard layouts.',
            ],
        ],
    ),
    note('4.1.7', '2026-08-02', 'fixed', 'Многоязычные подсказки', 'Multilingual suggestions', [
        [
            'Исправлена обработка регистра слов в локальной модели подсказок.',
            'Word casing in the local suggestion model was corrected.',
        ],
    ]),
    note('4.1.6', '2026-08-02', 'improved', 'Точнее автопроверка и OCR', 'More accurate proofread and OCR', [
        ['Исправлена локализация живой проверки текста.', 'Live proofread localization was corrected.'],
        [
            'Результаты OCR кэшируются, а расход токенов для кириллицы оценивается точнее.',
            'OCR results are cached and token estimates for Cyrillic are more accurate.',
        ],
    ]),
    note('4.1.5', '2026-08-01', 'fixed', 'Настройки не открываются сами', 'Settings no longer open unexpectedly', [
        [
            'Закрытие панели без API-ключа больше не открывает страницу настроек с задержкой.',
            'Closing the panel without an API key no longer opens settings later.',
        ],
    ]),
    note('4.1.3', '2026-07-29', 'improved', 'Удобное выделение и копирование', 'Better selection and copying', [
        [
            'Панель распознаёт выделение мышью, клавиатурой и во вложенных редакторах.',
            'The panel detects mouse, keyboard, and embedded-editor selections.',
        ],
        [
            'Добавлен запасной способ копирования для страниц с ограниченным Clipboard API.',
            'A fallback copy method was added for pages with restricted Clipboard API access.',
        ],
    ]),
    note('4.1.2', '2026-07-29', 'fixed', 'Одинаковое меню в Firefox и Chrome', 'Consistent Firefox and Chrome menu', [
        [
            'Нажатие на значок LexiSync в Firefox снова открывает компактное меню.',
            'Selecting the LexiSync icon in Firefox once again opens the compact menu.',
        ],
    ]),
    note('4.1.1', '2026-07-29', 'fixed', 'Стабильное открытие в Firefox', 'Reliable opening in Firefox', [
        [
            'Исправлено открытие интерфейса непосредственно после действия пользователя.',
            'The interface now opens reliably immediately after a user action.',
        ],
    ]),
    note('4.1.0', '2026-07-28', 'improved', 'Надёжная работа с длинным текстом', 'Reliable long-text processing', [
        [
            'Длинные абзацы и символы больше не повреждаются при разбиении.',
            'Long paragraphs and characters are no longer damaged during splitting.',
        ],
        [
            'Устаревшие проверки при вводе отменяются, а черновики сохраняются экономнее.',
            'Outdated proofread requests are cancelled and drafts are saved more efficiently.',
        ],
    ]),
    note('4.0.0', '2026-07-28', 'new', 'Большое рабочее обновление', 'Major workspace update', [
        [
            'Появились редактор, история, поиск и перенос результата обратно на страницу.',
            'An editor, history, search, and result transfer back to the page were introduced.',
        ],
        [
            'Добавлены цепочки обработки и быстрые варианты результата.',
            'Processing chains and quick result alternatives were added.',
        ],
    ]),
    note('3.0.0', '2026-07-28', 'improved', 'Безопаснее сборки Chrome и Firefox', 'Safer Chrome and Firefox builds', [
        [
            'Добавлена полная проверка разрешений, архивов и требований Manifest V3.',
            'Full validation of permissions, archives, and Manifest V3 requirements was added.',
        ],
        [
            'Расширены тесты длинных текстов, кэша и сетевых ограничений.',
            'Tests now cover long text, caching, and network limits.',
        ],
    ]),
    note('2.19.0', '2026-07-28', 'new', 'Несколько стилей интерфейса', 'Multiple interface styles', [
        [
            'Добавлен выбор оформления с живым предпросмотром.',
            'Interface styles can now be selected with a live preview.',
        ],
        [
            'Стиль применяется к меню, результатам, popup, истории и подсказкам.',
            'The selected style applies to menus, results, popup, history, and suggestions.',
        ],
    ]),
    note('2.18.0', '2026-07-28', 'new', 'Режимы окна результата', 'Result window modes', [
        ['Добавлены режимы «Авто», «Компактно» и «Подробно».', 'Auto, Compact, and Detailed result modes were added.'],
        [
            'Исправления можно просматривать и отклонять прямо в компактной карточке.',
            'Corrections can be reviewed and rejected directly in the compact card.',
        ],
    ]),
    note('2.17.1', '2026-07-22', 'improved', 'Компактная карточка результата', 'Compact result card', [
        [
            'Готовый текст, замена и копирование собраны в короткой карточке.',
            'Ready text, replace, and copy actions were combined in a short card.',
        ],
        ['Исправленные фрагменты подсвечиваются зелёным.', 'Corrected fragments are highlighted in green.'],
    ]),
    note('2.17.0', '2026-07-22', 'improved', 'Надёжные параллельные изменения', 'Reliable concurrent changes', [
        [
            'Настройки, словарь и команды больше не теряют одновременные изменения.',
            'Settings, dictionary entries, and commands no longer lose concurrent changes.',
        ],
        [
            'Расширена автоматическая проверка жизненного цикла запросов и сборок.',
            'Automated request lifecycle and build checks were expanded.',
        ],
    ]),
    note('2.16.0', '2026-07-22', 'improved', 'Защита локальных данных', 'Local data protection', [
        [
            'История, кэш, статистика и языковая модель сохраняются последовательно без потери записей.',
            'History, cache, statistics, and language model records are saved without data loss.',
        ],
        [
            'Добавлены статический анализ, форматирование и отчёт покрытия тестами.',
            'Static analysis, formatting, and test coverage reporting were introduced.',
        ],
    ]),
    note(
        '2.15.1',
        '2026-07-19',
        'fixed',
        'Восстановлены иконки и панель выделения',
        'Icons and selection panel restored',
        [
            [
                'Иконки действий снова отображаются, а панель появляется после выделения текста.',
                'Action icons display correctly again and the panel appears after text selection.',
            ],
        ],
    ),
    note('2.15.0', '2026-07-19', 'new', 'Профили стиля и потоковый ответ', 'Style profiles and streaming responses', [
        [
            'Профиль стиля может включаться автоматически для выбранных сайтов.',
            'A style profile can activate automatically for selected sites.',
        ],
        [
            'Ответ Mistral показывается постепенно, поддерживает отмену и повторные попытки.',
            'Mistral responses appear progressively with cancellation and retry support.',
        ],
    ]),
    note('2.14.0', '2026-07-18', 'new', 'Режимы AI и перенос настроек', 'AI modes and settings transfer', [
        [
            'Добавлены быстрый и качественный режимы, профили стиля и глоссарий.',
            'Fast and quality modes, style profiles, and a glossary were added.',
        ],
        [
            'Настройки можно экспортировать и безопасно импортировать без API-ключа.',
            'Settings can be exported and safely imported without the API key.',
        ],
    ]),
    note('2.13.0', '2026-07-18', 'new', 'Быстрые настройки и свои команды', 'Quick settings and custom commands', [
        ['В popup появились настройки функций для текущего сайта.', 'The popup gained per-site feature controls.'],
        [
            'Добавлены пользовательские AI-команды и редактирование результата.',
            'Custom AI commands and result editing were added.',
        ],
    ]),
    note('2.12.0', '2026-07-18', 'new', 'Локальные персональные подсказки', 'Local personalized suggestions', [
        [
            'LexiSync предлагает продолжение слова и следующую фразу прямо у поля ввода.',
            'LexiSync suggests word completions and next phrases near the text field.',
        ],
        [
            'Подсказки обучаются локально и могут быть полностью очищены.',
            'Suggestions learn locally and their data can be fully cleared.',
        ],
    ]),
    note('2.11.0', '2026-07-16', 'new', 'Выбор отдельных исправлений', 'Choose individual corrections', [
        [
            'Каждое исправление можно принять или вернуть отдельно.',
            'Each correction can be accepted or reverted individually.',
        ],
        [
            'Добавлены личный словарь и отмена после замены текста.',
            'A personal dictionary and undo after replacement were added.',
        ],
    ]),
    note('2.10.0', '2026-07-15', 'improved', 'Контроль приватности и сети', 'Privacy and network controls', [
        [
            'Контекст страницы отправляется только после включения настройки.',
            'Page context is sent only after the setting is enabled.',
        ],
        [
            'Добавлены отмена запроса, таймаут и автоматические повторы при временных ошибках.',
            'Request cancellation, timeout, and automatic retries for temporary errors were added.',
        ],
    ]),
    note('2.9.0', '2026-07-15', 'improved', 'Отдельные сборки для браузеров', 'Separate browser builds', [
        [
            'Проект перенесён на WXT с отдельными пакетами Chrome и Firefox.',
            'The project moved to WXT with separate Chrome and Firefox packages.',
        ],
        [
            'Firefox получил собственные настройки совместимости и обработки данных.',
            'Firefox received dedicated compatibility and data-handling settings.',
        ],
    ]),
    note('2.7.1', '2026-07-07', 'improved', 'Автоматическая проверка расширения', 'Automated extension testing', [
        [
            'Добавлены браузерные тесты основных функций без расходования реальных API-токенов.',
            'Browser tests for core features were added without consuming real API tokens.',
        ],
    ]),
    note('2.7.0', '2026-07-06', 'new', 'Распознавание текста на экране', 'On-screen text recognition', [
        [
            'Добавлены «Ножницы» для выбора области экрана и OCR через Alt+S.',
            'Screen-area selection and OCR were added with the Alt+S shortcut.',
        ],
        ['Распознанный текст автоматически копируется.', 'Recognized text is copied automatically.'],
    ]),
    note('2.6.0', '2026-07-06', 'new', 'Локализация и помощь с API-ключом', 'Localization and API key guidance', [
        ['Добавлена поддержка нескольких языков.', 'Multiple language support was introduced.'],
        [
            'При отсутствии ключа LexiSync объясняет проблему и открывает нужный раздел настроек.',
            'When the key is missing, LexiSync explains the issue and opens the relevant settings.',
        ],
    ]),
    note('2.5.1', '2026-07-04', 'new', 'История и удобная работа с ключом', 'History and easier key handling', [
        ['Появилась локальная история последних результатов.', 'A local history of recent results was added.'],
        [
            'API-ключ можно показать или скрыть, а списки в ответах форматируются аккуратнее.',
            'The API key can be shown or hidden, and lists in responses are formatted more cleanly.',
        ],
    ]),
    note('2.5', '2026-07-04', 'new', 'Google Docs и горячие клавиши', 'Google Docs and shortcuts', [
        [
            'Добавлена работа с Google Docs и системным контекстным меню.',
            'Google Docs and system context menu support were added.',
        ],
        [
            'Появились горячие клавиши для исправления, стиля и эмодзи.',
            'Shortcuts for correction, style, and emoji actions were introduced.',
        ],
    ]),
];

export function resolveReleaseNotesLocale(language: string): ReleaseNotesLocale {
    return language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function filterReleaseNotes(notes: ReleaseNote[], query: string, locale: ReleaseNotesLocale): ReleaseNote[] {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale === 'ru' ? 'ru-RU' : 'en-US');
    if (!normalizedQuery) return notes;
    return notes.filter((release) =>
        [release.version, release.date, release.title[locale], ...release.changes.map((change) => change[locale])]
            .join(' ')
            .toLocaleLowerCase(locale === 'ru' ? 'ru-RU' : 'en-US')
            .includes(normalizedQuery),
    );
}

function createReleaseItem(
    release: ReleaseNote,
    locale: ReleaseNotesLocale,
    currentVersion: string,
): HTMLDetailsElement {
    const details = document.createElement('details');
    details.className = 'release-note-item';
    details.dataset.releaseVersion = release.version;
    details.dataset.kind = release.kind;
    details.open = release.version === currentVersion;

    const summary = document.createElement('summary');
    const heading = document.createElement('span');
    heading.className = 'release-note-heading';
    const version = document.createElement('strong');
    version.textContent = `v${release.version}`;
    heading.appendChild(version);
    if (release.version === currentVersion) {
        const current = document.createElement('span');
        current.className = 'release-note-current';
        current.textContent = t('releaseNotesCurrent', 'Текущая');
        heading.appendChild(current);
    }
    const date = document.createElement('time');
    date.dateTime = release.date;
    date.textContent = new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(`${release.date}T00:00:00Z`));
    heading.appendChild(date);

    const title = document.createElement('span');
    title.className = 'release-note-title';
    title.textContent = release.title[locale];
    const marker = document.createElement('span');
    marker.className = 'release-note-marker';
    marker.textContent = t(
        release.kind === 'new'
            ? 'releaseNotesKindNew'
            : release.kind === 'fixed'
              ? 'releaseNotesKindFixed'
              : 'releaseNotesKindImproved',
        release.kind === 'new' ? 'Новое' : release.kind === 'fixed' ? 'Исправлено' : 'Улучшено',
    );
    summary.append(heading, title, marker);

    const changes = document.createElement('ul');
    for (const change of release.changes) {
        const item = document.createElement('li');
        item.textContent = change[locale];
        changes.appendChild(item);
    }
    details.append(summary, changes);
    return details;
}

let releaseNotesController: { open: () => void } | null = null;

function createReleaseNotesController(): { open: () => void } | null {
    const trigger = document.getElementById('app-version') as HTMLButtonElement | null;
    const dialog = document.getElementById('releaseNotesDialog') as HTMLDialogElement | null;
    const closeButton = document.getElementById('closeReleaseNotes') as HTMLButtonElement | null;
    const searchInput = document.getElementById('releaseNotesSearch') as HTMLInputElement | null;
    const count = document.getElementById('releaseNotesCount');
    const list = document.getElementById('releaseNotesList');
    if (!trigger || !dialog || !closeButton || !searchInput || !count || !list) return null;

    const currentVersion = chrome.runtime.getManifest().version;
    const locale = resolveReleaseNotesLocale(document.documentElement.lang);

    const render = () => {
        const releases = filterReleaseNotes(RELEASE_NOTES, searchInput.value, locale);
        list.replaceChildren(...releases.map((release) => createReleaseItem(release, locale, currentVersion)));
        count.textContent = releases.length
            ? t('releaseNotesCount', `Показано версий: ${releases.length}`, String(releases.length))
            : t('releaseNotesEmpty', 'По этому запросу обновлений не найдено.');
        list.hidden = releases.length === 0;
    };

    closeButton.addEventListener('click', () => dialog.close());
    searchInput.addEventListener('input', render);
    dialog.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        dialog.close();
    });
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        dialog.close();
    });
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => trigger.focus());
    render();
    return {
        open: () => {
            searchInput.value = '';
            render();
            if (!dialog.open) dialog.showModal();
            closeButton.focus();
        },
    };
}

export function openReleaseNotes(): void {
    releaseNotesController ??= createReleaseNotesController();
    releaseNotesController?.open();
}
