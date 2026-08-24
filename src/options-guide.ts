export interface GuideDiffSegment {
    text: string;
    type?: 'del' | 'add';
}

export interface GuideFeatureDemo {
    id: string;
    number: string;
    icon: string;
    title: string;
    shortcut: string;
    description: string;
    inputText: string;
    outputText: string;
    diffSegments?: GuideDiffSegment[];
    statusText: string;
    tip: string;
}

export const GUIDE_DEMOS: GuideFeatureDemo[] = [
    {
        id: 'spellcheck',
        number: '1',
        icon: '⚡',
        title: 'Проверка ошибок и пунктуации',
        shortcut: 'Alt+R',
        description: 'Мгновенно находит орфографические, грамматические и пунктуационные ошибки, сохраняя ваш стиль.',
        inputText: 'Превед! Мы делаем крутой проэкт, но нету времени на проверку.',
        outputText: 'Привет! Мы делаем крутой проект, но нет времени на проверку.',
        diffSegments: [
            { text: 'Превед', type: 'del' },
            { text: ' Привет', type: 'add' },
            { text: '! Мы делаем крутой ' },
            { text: 'проэкт', type: 'del' },
            { text: ' проект', type: 'add' },
            { text: ', но ' },
            { text: 'нету', type: 'del' },
            { text: ' нет', type: 'add' },
            { text: ' времени на проверку.' },
        ],
        statusText: '✓ Исправлено 3 ошибки за 310 мс',
        tip: 'Совет: Выделите текст и нажмите Alt+R — панель LexiSync откроется и сразу применит исправление.',
    },
    {
        id: 'paraphrase',
        number: '2',
        icon: '✍️',
        title: 'Другими словами (Стиль)',
        shortcut: 'Alt+Y',
        description: 'Перефразирует текст, делая его более убедительным, ясным и профессиональным.',
        inputText: 'Надо сделать так чтобы всё работало быстрее и не падало.',
        outputText: 'Необходимо оптимизировать производительность системы и обеспечить её отказоустойчивость.',
        statusText: '✓ Стиль улучшен • Деловая формулировка',
        tip: 'Совет: Во вкладке «AI и стиль» можно настроить персональный профиль тональности (деловой, дружелюбный, лаконичный).',
    },
    {
        id: 'inplace',
        number: '3',
        icon: '⚡',
        title: 'Тихое исправление на месте',
        shortcut: '0 мс / Хоткей',
        description:
            'Исправляет опечатки и неверную раскладку клавиатуры прямо в активном поле ввода без всплывающих окон.',
        inputText: 'ghbdtn? rfr ltkf',
        outputText: 'привет, как дела',
        statusText: '✨ Исправлено на месте (0 мс)',
        tip: 'Совет: Если забыли переключить язык (например, набрали «ghbdtn»), нажмите горячую клавишу тихого исправления!',
    },
    {
        id: 'translate',
        number: '4',
        icon: '🌍',
        title: 'Умный перевод на 10+ языков',
        shortcut: 'Меню / Alt',
        description: 'Контекстный перевод с сохранением форматирования, терминологии и естественного звучания.',
        inputText: 'LexiSync is a lightning-fast browser extension powered by Mistral AI.',
        outputText: 'LexiSync — молниеносное расширение для браузера на базе Mistral AI.',
        statusText: '✓ Переведено на Русский (100% точность)',
        tip: 'Совет: В окне результата можно переключить целевой язык одним кликом по селектору языков.',
    },
    {
        id: 'emoji',
        number: '5',
        icon: '🎨',
        title: 'Добавить эмодзи',
        shortcut: 'Alt+T',
        description: 'Оживляет текст уместными, выразительными эмодзи для соцсетей, чатов и рассылок.',
        inputText: 'Запустили новый релиз! Ждем ваши отзывы и предложения.',
        outputText: '🚀 Запустили новый релиз! 🎉 Ждем ваши отзывы и предложения 💬✨',
        statusText: '✓ Добавлены выразительные эмодзи',
        tip: 'Совет: Используйте для постов в Telegram, комментариев и корпоративных поздравлений.',
    },
    {
        id: 'ocr',
        number: '6',
        icon: '🔍',
        title: 'Распознавание с экрана (OCR)',
        shortcut: 'Alt+S',
        description: 'Извлекает текст из невыделяемых областей, скриншотов, презентаций, видео и защищённых сайтов.',
        inputText: '[ Выделенная область экрана с текстом «API_KEY=sk-demo-99238» ]',
        outputText: 'API_KEY=sk-demo-99238',
        statusText: '✓ Текст распознан и скопирован в буфер',
        tip: 'Совет: Нажмите Alt+S, выделите любую прямоугольную область мышью — текст мгновенно появится в окне.',
    },
    {
        id: 'suggestions',
        number: '7',
        icon: '💡',
        title: 'Персональные подсказки и Tab',
        shortcut: 'Клавиша Tab',
        description: 'Предлагает продолжение мысли прямо во время набора текста, обучаясь на вашем локальном стиле.',
        inputText: 'С уважением и наилучшими ',
        outputText: 'С уважением и наилучшими пожеланиями, команда проекта.',
        statusText: '✦ Нажмите Tab для принятия подсказки',
        tip: 'Совет: Подсказки работают локально за 0 мс. Принимайте вариант клавишей Tab или стрелками.',
    },
    {
        id: 'copy',
        number: '8',
        icon: '📋',
        title: 'Мультиформатное копирование',
        shortcut: 'Кнопка «Копировать»',
        description: 'Копирует текст в буфер одновременно как Rich HTML и Plain Text для идеальной вставки везде.',
        inputText: '**Ключевые пункты:**\n- Скорость\n- Безопасность\n- Удобство',
        outputText: 'Ключевые пункты:\n• Скорость\n• Безопасность\n• Удобство',
        statusText: '✓ Скопировано в буфер (Google Docs, Word, Markdown)',
        tip: 'Совет: При вставке в Google Docs или Word форматирование сохранится, а в блокноте вставится чистый текст.',
    },
    {
        id: 'pii',
        number: '9',
        icon: '🛡️',
        title: 'Локальная маскировка PII',
        shortcut: '0 мс Приватность',
        description: 'Автоматически обезличивает email, телефоны, банковские карты и API-ключи перед обращением к AI.',
        inputText: 'Свяжитесь по user@corp.com или телефону +7 (999) 000-11-22 для оплаты счета.',
        outputText: 'Свяжитесь по [__EMAIL_1__] или телефону [__PHONE_1__] для оплаты счета.',
        statusText: '🔒 2 конфиденциальных элемента безопасно замаскированы',
        tip: 'Совет: Включите в разделе «Приватность», чтобы секретные данные никогда не покидали ваш браузер.',
    },
    {
        id: 'commands',
        number: '10',
        icon: '📚',
        title: 'Галерея шаблонов и свои команды',
        shortcut: 'Меню действий',
        description: 'Создавайте собственные AI-действия под ваши рабочие задачи или выбирайте из каталога шаблонов.',
        inputText: 'function add(a, b) { return a + b; }',
        outputText: '## Code Review\n- Чистая функция\n- Добавить валидацию типов\n- Сложность O(1)',
        statusText: '✓ Выполнена команда «Code Review»',
        tip: 'Совет: Во вкладке «Команды» нажмите «Галерея готовых шаблонов» для добавления пресетов в один клик.',
    },
    {
        id: 'tone',
        number: '11',
        icon: '💖',
        title: 'Анализ тональности и вежливости',
        shortcut: 'Меню «Ещё» / Тональность',
        description: 'Оценивает вежливость текста от 1 до 10, определяет тональность и предлагает мягкую формулировку.',
        inputText: 'Вы сделали отчет с опозданием, переделайте график немедленно.',
        outputText:
            'Тональность: Требовательная (Вежливость: 4/10)\n\nРекомендованный вариант:\n«Подскажите, пожалуйста, будет ли возможность обновить график в отчете к сегодняшнему вечеру? Спасибо!»',
        statusText: '✓ Оценка вежливости 4/10 • Предложен вежливый вариант',
        tip: 'Совет: Помогает избежать недопонимания в рабочей переписке с коллегами и клиентами.',
    },
    {
        id: 'continue',
        number: '13',
        icon: '⏩',
        title: '«Дописать за меня» (Продолжение)',
        shortcut: 'Меню действий / Дописать',
        description: 'Анализирует незаконченную мысль и предлагает логичное, связное продолжение в вашем стиле.',
        inputText: 'Мы провели всестороннее тестирование нового модуля безопасности и пришли к выводу, что ',
        outputText:
            'Мы провели всестороннее тестирование нового модуля безопасности и пришли к выводу, что система полностью готова к интеграции в промышленную среду.',
        statusText: '✓ Мысль логично продолжена',
        tip: 'Совет: Выделите начало абзаца и выберите «Дописать за меня» для преодоления страха чистого листа.',
    },
    {
        id: 'notes_to_doc',
        number: '14',
        icon: '📝',
        title: 'Заметки в связный текст (Notes to Doc)',
        shortcut: 'Меню действий / Заметки в текст',
        description: 'Превращает сырые списки тезисов в структурированное деловое письмо или официальный отчет.',
        inputText: '- релиз в четверг\n- обновить доки\n- уведомить саппорт о даунтайме 10 мин',
        outputText:
            'Добрый день!\n\nИнформируем вас о запланированном релизе в четверг. В ходе работ будет 10-минутный технологический перерыв, служба поддержки уже уведомлена. Документация будет актуализирована до конца дня.',
        statusText: '✓ Тезисы преобразованы в готовое письмо',
        tip: 'Совет: Записывайте ключевые пункты на ходу, а LexiSync сформирует готовый для отправки документ.',
    },
    {
        id: 'snippets',
        number: '15',
        icon: '⚡',
        title: 'Текстовые сниппеты и макросы',
        shortcut: 'Шорткод /... + Tab',
        description: 'Мгновенная вставка повторяющихся фраз и шаблонов писем по слэш-командам прямо во время ввода.',
        inputText: '/thanks',
        outputText: 'Большое спасибо за сотрудничество и оперативный ответ!',
        statusText: '⚡ Шаблон /thanks подставлен за 0 мс',
        tip: 'Совет: Настройте собственные шорткоды (например /email, /meeting) во вкладке «Команды».',
    },
    {
        id: 'quick_lookup',
        number: '16',
        icon: '🔎',
        title: 'Быстрый перевод по Alt + Двойной клик',
        shortcut: 'Alt + Двойной клик',
        description: 'Мгновенный перевод любого слова или фразы прямо на странице без лишних переходов.',
        inputText: 'resilience',
        outputText: 'resilience [rɪˈzɪlɪəns] — устойчивость, отказоустойчивость, жизнестойкость',
        statusText: '✓ Быстрый перевод слова над курсором',
        tip: 'Совет: Зажмите клавишу Alt и дважды кликните по любому незнакомому слову на сайте.',
    },
    {
        id: 'summary',
        number: '17',
        icon: '📋',
        title: 'Суммаризация и выжимка (TL;DR)',
        shortcut: 'Меню действий / Выжимка',
        description: 'Выделяет ключевые тезисы и факты из длинных статей, регламентов и объемных писем.',
        inputText: '[ Объемная статья на 5 страниц о результатах финансового квартала ]',
        outputText:
            '## Ключевые тезисы:\n1. Выручка выросла на 24% г/г.\n2. Основной драйвер — облачные сервисы.\n3. Снижение операционных расходов на 8%.\n4. Прогноз на след. квартал положительный.',
        statusText: '✓ Выжимка сформирована • Экономия 10 минут чтения',
        tip: 'Совет: Идеально для быстрого ознакомления с длинными аналитическими материалами.',
    },
    {
        id: 'case_converter',
        number: '18',
        icon: '🔠',
        title: 'Умная смена регистра букв',
        shortcut: 'Меню действий / Регистр',
        description:
            'Мгновенное переключение регистра (как в предложениях, строчные, ЗАГЛАВНЫЕ, Title Case, camelCase, snake_case).',
        inputText: 'СЛУЧАЙНО НАБРАННЫЙ КАПСОМ ТЕКСТ',
        outputText: 'Случайно набранный капсом текст',
        statusText: '✓ Регистр изменен за 0 мс локально',
        tip: 'Совет: В окне результата можно переключать формат регистра в 1 клик по удобным чипам.',
    },
    {
        id: 'text_cleaner',
        number: '19',
        icon: '🧹',
        title: 'Очистка текста и типографика',
        shortcut: 'Меню действий / Очистка',
        description:
            'Удаляет лишние пробелы, склеивает разорванные строки из PDF, убирает невидимые символы и расставляет правильные кавычки-ёлочки и тире.',
        inputText: 'Текст  с   двойными   пробелами,\nразорванными строками и - "дефисами".',
        outputText: 'Текст с двойными пробелами, разорванными строками и — «дефисами».',
        statusText: '✓ Текст очищен и отформатирован за 0 мс',
        tip: 'Совет: Идеально для очистки скопированного из PDF или чатов текста перед отправкой.',
    },
];

let activeItemIndex: number | null = null;
let animationTimer: ReturnType<typeof setTimeout> | null = null;

export function renderInteractiveGuide(container: HTMLElement): void {
    container.replaceChildren();
    container.className = 'interactive-guide-list';

    GUIDE_DEMOS.forEach((demo, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = `guide-accordion-item ${activeItemIndex === index ? 'is-expanded' : ''}`;
        itemEl.dataset.index = String(index);

        // Header / Trigger
        const headerBtn = document.createElement('button');
        headerBtn.type = 'button';
        headerBtn.className = 'guide-accordion-header';
        headerBtn.id = `guide-trigger-${demo.id}`;
        headerBtn.setAttribute('aria-controls', `guide-panel-${demo.id}`);
        headerBtn.setAttribute('aria-expanded', String(activeItemIndex === index));

        const titleWrap = document.createElement('div');
        titleWrap.className = 'guide-header-title-wrap';

        const numBadge = document.createElement('span');
        numBadge.className = 'guide-num-badge';
        numBadge.textContent = `${demo.number}. ${demo.icon}`;

        const titleText = document.createElement('strong');
        titleText.className = 'guide-header-title';
        titleText.textContent = demo.title;

        titleWrap.append(numBadge, titleText);

        const metaWrap = document.createElement('div');
        metaWrap.className = 'guide-header-meta';

        const shortcutBadge = document.createElement('kbd');
        shortcutBadge.className = 'guide-shortcut-kbd';
        shortcutBadge.textContent = demo.shortcut;

        const chevron = document.createElement('span');
        chevron.className = 'guide-chevron';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('d', 'm6 9 6 6 6-6');
        svg.appendChild(path);
        chevron.appendChild(svg);

        metaWrap.append(shortcutBadge, chevron);
        headerBtn.append(titleWrap, metaWrap);

        // Body / Demo Panel
        const bodyEl = document.createElement('div');
        bodyEl.className = 'guide-accordion-body';
        bodyEl.id = `guide-panel-${demo.id}`;
        bodyEl.setAttribute('role', 'region');
        bodyEl.setAttribute('aria-labelledby', headerBtn.id);
        bodyEl.hidden = activeItemIndex !== index;

        const desc = document.createElement('p');
        desc.className = 'guide-demo-desc';
        desc.textContent = demo.description;

        const stageCard = document.createElement('div');
        stageCard.className = 'guide-demo-stage';

        const stageHeader = document.createElement('div');
        stageHeader.className = 'guide-stage-header';

        const dotsWrap = document.createElement('div');
        dotsWrap.className = 'guide-window-dots';
        for (const color of ['red', 'yellow', 'green'] as const) {
            const dot = document.createElement('span');
            dot.className = `dot dot-${color}`;
            dotsWrap.appendChild(dot);
        }

        const stageCaption = document.createElement('span');
        stageCaption.className = 'guide-stage-caption';
        stageCaption.textContent = `Демонстрация: ${demo.title}`;

        const stageShortcut = document.createElement('span');
        stageShortcut.className = 'guide-stage-shortcut';
        const stageKbd = document.createElement('kbd');
        stageKbd.textContent = demo.shortcut;
        stageShortcut.appendChild(stageKbd);

        stageHeader.append(dotsWrap, stageCaption, stageShortcut);

        const stageContent = document.createElement('div');
        stageContent.className = 'guide-stage-content';

        const inputBlock = document.createElement('div');
        inputBlock.className = 'guide-stage-box guide-stage-input';
        const inputLabel = document.createElement('span');
        inputLabel.className = 'guide-box-label';
        inputLabel.textContent = 'Исходный текст:';
        const inputContent = document.createElement('div');
        inputContent.className = 'guide-box-text';
        inputContent.textContent = demo.inputText;
        inputBlock.append(inputLabel, inputContent);

        const arrowDiv = document.createElement('div');
        arrowDiv.className = 'guide-stage-arrow';
        const arrowIcon = document.createElement('span');
        arrowIcon.className = 'guide-arrow-icon';
        arrowIcon.textContent = '➔';
        const arrowBadge = document.createElement('span');
        arrowBadge.className = 'guide-arrow-badge';
        arrowBadge.textContent = `${demo.icon} LexiSync`;
        arrowDiv.append(arrowIcon, arrowBadge);

        const outputBlock = document.createElement('div');
        outputBlock.className = 'guide-stage-box guide-stage-output';
        const outputLabel = document.createElement('span');
        outputLabel.className = 'guide-box-label';
        outputLabel.textContent = 'Результат обработки:';
        const outputContent = document.createElement('div');
        outputContent.className = 'guide-box-text guide-output-text';

        if (demo.diffSegments) {
            demo.diffSegments.forEach((segment) => {
                if (segment.type === 'del') {
                    const mark = document.createElement('mark');
                    mark.className = 'guide-diff-del';
                    mark.textContent = segment.text;
                    outputContent.appendChild(mark);
                } else if (segment.type === 'add') {
                    const mark = document.createElement('mark');
                    mark.className = 'guide-diff-add';
                    mark.textContent = segment.text;
                    outputContent.appendChild(mark);
                } else {
                    outputContent.appendChild(document.createTextNode(segment.text));
                }
            });
        } else {
            outputContent.textContent = demo.outputText;
        }
        outputBlock.append(outputLabel, outputContent);

        const statusBanner = document.createElement('div');
        statusBanner.className = 'guide-stage-status';
        statusBanner.setAttribute('role', 'status');
        const statusSpan = document.createElement('span');
        statusSpan.textContent = demo.statusText;
        statusBanner.appendChild(statusSpan);

        stageContent.append(inputBlock, arrowDiv, outputBlock);
        stageCard.append(stageHeader, stageContent, statusBanner);

        const footerWrap = document.createElement('div');
        footerWrap.className = 'guide-demo-footer';

        const tipBox = document.createElement('div');
        tipBox.className = 'guide-demo-tip';
        const tipStrong = document.createElement('strong');
        tipStrong.textContent = '💡 Подсказка: ';
        tipBox.append(tipStrong, document.createTextNode(demo.tip.replace(/^Совет:\s*/u, '')));

        const replayBtn = document.createElement('button');
        replayBtn.type = 'button';
        replayBtn.className = 'guide-replay-btn';
        const replayIcon = document.createElement('span');
        replayIcon.textContent = '🔄 ';
        const replayText = document.createElement('span');
        replayText.textContent = 'Повторить анимацию';
        replayBtn.append(replayIcon, replayText);
        replayBtn.onclick = () => {
            playItemAnimation(stageCard);
        };

        footerWrap.append(tipBox, replayBtn);
        bodyEl.append(desc, stageCard, footerWrap);

        headerBtn.onclick = () => {
            if (activeItemIndex === index) {
                activeItemIndex = null;
                renderInteractiveGuide(container);
            } else {
                activeItemIndex = index;
                renderInteractiveGuide(container);
                const currentItem = container.children[index] as HTMLElement | undefined;
                if (currentItem) {
                    const currentStage = currentItem.querySelector<HTMLElement>('.guide-demo-stage');
                    if (currentStage) playItemAnimation(currentStage);
                }
            }
        };

        itemEl.append(headerBtn, bodyEl);
        container.appendChild(itemEl);
    });

    if (activeItemIndex !== null) {
        const currentItem = container.children[activeItemIndex] as HTMLElement | undefined;
        if (currentItem) {
            const currentStage = currentItem.querySelector<HTMLElement>('.guide-demo-stage');
            if (currentStage) playItemAnimation(currentStage);
        }
    }
}

function playItemAnimation(stageCard: HTMLElement): void {
    if (animationTimer) clearTimeout(animationTimer);

    const inputDiv = stageCard.querySelector<HTMLElement>('.guide-stage-input .guide-box-text');
    const outputDiv = stageCard.querySelector<HTMLElement>('.guide-output-text');
    const statusDiv = stageCard.querySelector<HTMLElement>('.guide-stage-status');
    const arrow = stageCard.querySelector<HTMLElement>('.guide-stage-arrow');

    if (!inputDiv || !outputDiv || !statusDiv || !arrow) return;

    outputDiv.style.opacity = '0';
    outputDiv.style.transform = 'translateY(6px)';
    statusDiv.style.opacity = '0';
    arrow.classList.remove('is-animating');

    inputDiv.classList.add('guide-input-flash');
    setTimeout(() => inputDiv.classList.remove('guide-input-flash'), 400);

    arrow.classList.add('is-animating');

    animationTimer = setTimeout(() => {
        arrow.classList.remove('is-animating');
        outputDiv.style.transition = 'all 280ms cubic-bezier(0.16, 1, 0.3, 1)';
        outputDiv.style.opacity = '1';
        outputDiv.style.transform = 'translateY(0)';
        outputDiv.classList.add('guide-output-flash');
        setTimeout(() => outputDiv.classList.remove('guide-output-flash'), 500);

        statusDiv.style.transition = 'opacity 220ms ease';
        statusDiv.style.opacity = '1';
    }, 450);
}

export function setupInteractiveGuide(): void {
    const container = document.getElementById('interactiveGuideContainer');
    if (container) {
        renderInteractiveGuide(container);
    }
}
