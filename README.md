# ✨ LexiSync — расширение для Chrome и Firefox

![LexiSync — умная работа с текстом](docs/assets/lexisync-hero.svg)

<p align="center">
  <a href="https://chromewebstore.google.com/detail/%D0%BA%D0%BE%D1%80%D1%80%D0%B5%D0%BA%D1%82%D0%BE%D1%80-%D0%B3%D1%80%D0%B0%D0%BC%D0%BC%D0%B0%D1%82%D0%B8%D0%BA%D0%B8-%D0%B8-%D0%BE%D1%80/iacebnbpapcgjlplkeapekjeoljfdpgl"><strong>Установить из Chrome Web Store</strong></a>
  ·
  <a href="https://addons.mozilla.org/ru/firefox/addon/65facfa619b74330bdfa/"><strong>Установить из Firefox Add-ons</strong></a>
  ·
  <a href="https://github.com/Kiryuhak/LexiSync/releases/tag/v5.6.1"><strong>Релиз v5.6.1</strong></a>
  ·
  <a href="docs/RELEASING.md">Инструкция по выпуску</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/версия-5.6.1-blue.svg?style=flat-square" alt="Версия 5.6.1">
  <img src="https://img.shields.io/badge/Manifest-V3-success.svg?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Chrome-Поддерживается-4285F4.svg?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome">
  <img src="https://img.shields.io/badge/Firefox-Поддерживается-FF7139.svg?style=flat-square&logo=firefoxbrowser&logoColor=white" alt="Firefox">
  <img src="https://img.shields.io/badge/AI-Mistral_%7C_Cloudflare-F38020.svg?style=flat-square" alt="AI: Mistral & Cloudflare">
  <img src="https://img.shields.io/badge/лицензия-ISC-green.svg?style=flat-square" alt="Лицензия ISC">
</p>

Кросс-браузерное расширение для Chrome и Firefox на базе **Mistral AI** (`mistral-small-latest`, `mistral-ocr-latest`) и **Cloudflare Workers AI** (`@cf/meta/llama-3.2-3b-instruct`). Позволяет мгновенно исправлять ошибки, переписывать и переводить текст, менять раскладку, подбирать эмодзи и распознавать текст на изображениях без посредников и лишних задержек.

<h2 align="center">✨ Как работает LexiSync</h2>

<p align="center">
  Выделите текст, выберите нужное действие и примените готовый результат — всё прямо на веб-странице.
</p>

<p align="center">
  <img src="docs/assets/lexisync-showcase-color.gif" alt="Возможности LexiSync: работа с текстом, настройки, приватность и быстрый старт" width="100%">
</p>

<details>
  <summary><strong>🪄 Работа с текстом — меню и готовый результат</strong></summary>
  <br>
  <p align="center">
    <img src="docs/store-assets/firefox/lexisync-ai-actions.png" alt="Меню действий LexiSync на русском языке" width="49%">
    <img src="docs/store-assets/firefox/lexisync-result-window.png" alt="Компактное окно результата LexiSync" width="49%">
  </p>
</details>

<details>
  <summary><strong>🎨 Оформление и приватность</strong></summary>
  <br>
  <p align="center">
    <img src="docs/store-assets/firefox/lexisync-appearance-settings.png" alt="Настройки оформления LexiSync" width="49%">
    <img src="docs/store-assets/firefox/lexisync-privacy-settings.png" alt="Настройки приватности LexiSync" width="49%">
  </p>
</details>

<details>
  <summary><strong>🚀 Быстрый старт и история обновлений</strong></summary>
  <br>
  <p align="center">
    <img src="docs/store-assets/firefox/lexisync-quick-start.png" alt="Пошаговая настройка LexiSync" width="49%">
    <img src="docs/store-assets/firefox/lexisync-update-history.png" alt="История обновлений LexiSync" width="49%">
  </p>
</details>

## ✨ Что нового в 5.6.1

- **Интеграция Cloudflare Workers AI:** полная замена GigaChat на прямой REST API Cloudflare Workers AI с моделью `@cf/meta/llama-3.2-3b-instruct`. Высокая скорость генерации и отсутствие сторонних зависимостей.
- **Потоковая обработка (SSE):** поддержка Server-Sent Events со строгой валидацией терминатора `[DONE]`. В случае обрыва связи незавершённые фрагменты отсекаются, предотвращая искажение текста.
- **Безопасное хранение:** Account ID и API Token хранятся изолированно в `chrome.storage.local` с контролем доверенного контекста расширения. Все устаревшие кэши и токены GigaChat автоматически удаляются.
- **Интеллектуальный Fallback:** надёжное автоматическое переключение между Mistral AI и Cloudflare при лимитах (429 Rate Limit), сбоях серверов (5xx) или таймаутах. Ошибки неверных ключей (401, 403) и некорректного Account ID (404) не маскируются, позволяя сразу увидеть статус авторизации.
- **Улучшения UI/UX:** скрыты нативные стрелки-спиннеры для числовых полей ввода, оптимизирована вёрстка полей квот и расхода, карточки провайдеров обновлены под фирменный стиль Cloudflare.
- **Интерактивное обучение:** обновлён пошаговый мастер подключения для получения Cloudflare Account ID и API Token с правами Workers AI Read и их немедленной проверки.

Предыдущие изменения — в [CHANGELOG](CHANGELOG.md) и истории обновлений внутри расширения.

## 🚀 Основные возможности

- **📝 Исправление ошибок (Alt+R):** автоматическая проверка орфографии и пунктуации с понятной цветовой diff-подсветкой изменений.
- **🎭 Смена тональности (Alt+Y):** переписывание выделенного текста в выбранном стиле (деловой, дружеский, лаконичный, убедительный и др.).
- **⚡ Тихое исправление на месте:** мгновенная правка опечаток и раскладки клавиатуры за 0 мс прямо в поле ввода без вызова внешних окон.
- **😊 Подбор эмодзи (Alt+T):** нейросеть анализирует смысл текста и предлагает подходящие по контексту эмодзи.
- **🌐 Умный контекстный переводчик:** точный перевод с автоопределением исходного языка на более чем 10 мировых языков.
- **⌨️ Смена раскладки клавиатуры:** быстрое исправление текста, случайно набранного не в той раскладке (например, `ghbdtn` → `привет`).
- **📸 Распознавание текста / OCR (Alt+S):** извлечение текста из скриншотов, презентаций и невыделяемых областей экрана на базе Mistral OCR.
- **✨ Персональные подсказки:** локальное дописывание слов на лету по нажатию клавиши `Tab`.
- **🛡️ Локальная маскировка PII:** автоматическая маскировка email, телефонов, номеров банковских карт, IP-адресов и токенов до отправки запроса в AI с безопасным восстановлением в готовом результате.
- **📚 Галерея команд и свои AI-действия:** создание собственных инструкций и удобная библиотека готовых шаблонов.
- **⚡ Текстовые макросы:** локальное раскрытие пользовательских сокращений в полях ввода без обращения к серверу.
- **🧰 Локальные инструменты:** смена регистра, типографика и очистка лишних пробелов без передачи текста во внешние API.
- **🕒 История запросов на IndexedDB:** локальное хранилище до 500 записей с поиском, фильтрацией, избранным и экспортом в форматы JSON, CSV или Markdown.
- **💡 Понятный разбор исправлений:** кнопка «Почему так?» объясняет правила русского языка и грамматики простыми словами.
- **📋 Мультиформатный буфер обмена:** копирование как форматированного текста для Word / Google Docs, так и чистого Plain Text.
- **🎨 7 современных стилей оформления:** Liquid Glass, MagicOS, Aurora Glass, Material Design 3, Flutter Clean, Vision Aurora и Silk Obsidian со светлой и тёмной темами.
- **🔒 Полный контроль приватности:** запросы к AI отправляются только по прямому действию пользователя. Отсутствует внешняя телеметрия, поддержаны приватные вкладки и белый список исключений сайтов.

## 🛠 Технологии и архитектура

- **Язык:** TypeScript 7 в строгом режиме с дополнительной проверкой совместимости на TypeScript 6.
- **Сборка:** WXT 0.21 + Vite 8 (оптимизированные легковесные бандлы для Chrome и Firefox).
- **API:** WebExtensions Manifest V3, Mistral AI REST API, Cloudflare Workers AI REST API.
- **Хранилище:** IndexedDB для истории и chrome.storage.local с автоочисткой TTL для кэша и настроек.
- **Интерфейс:** нативный Vanilla DOM (без тяжелых runtime-фреймворков), Shadow DOM для полной изоляции стилей на сайтах, SVG-шаблоны и нативные CSS-переменные.

## 🎯 Качество и тестирование

Проект покрыт всесторонними автоматическими тестами:

- **Устойчивость сети и API:** контроль таймаутов первого чанка и активности потока, учёт заголовков `Retry-After`, cooldown-период провайдеров и защита от циклических повторов.
- **Изоляция интерфейса:** все всплывающие окна и панели монтируются в Shadow DOM и защищены от CSS-правил сторонних страниц.
- **Работа с DOM:** безопасная вставка и замена текста в любых полях ввода (`<input>`, `<textarea>`, `contenteditable`, фреймы) с сохранением позиции каретки и истории отмены (Undo/Redo).
- **Безопасность данных:** строгая валидация входящих сообщений Service Worker, доверенные отправители секретов (`isInternalCaller`), санитизация логов от токенов и ключей.
- **Приватность:** история и кэш автоматически отключаются в инкогнито/приватных окнах.
- **CI/CD пайплайн:** GitHub Actions на Node.js 24 проверяет Prettier, ESLint, типы, локализацию, безопасность зависимостей, манифесты и запускает полный набор unit- и E2E-тестов в Chromium и Firefox.

## ⚙️ Разработка и сборка

```bash
npm ci                   # Воспроизводимая установка зависимостей
npm run dev              # Режим разработки Chrome с автообновлением
npm run dev:firefox      # Режим разработки Firefox с автообновлением
npm run build            # Финальная сборка для Chrome и Firefox
npm run zip              # Сборка готовых ZIP-архивов для магазинов
npm run xpi:firefox      # Создание XPI для временного тестирования в Firefox
npm run check:static     # Комплексная проверка: типы, линт, форматирование, i18n, svg
npm run check:i18n       # Проверка синхронизации ключей локализации ru/en
npm run typecheck        # Проверка типов Native TypeScript (TS7)
npm run typecheck:legacy # Проверка совместимости TypeScript 6
npm run lint             # Статический анализ кода через ESLint
npm run format:check     # Проверка соблюдения код-стайла Prettier
npm run test:unit        # Модульные тесты Vitest
npm run test:coverage    # Запуск тестов с формированием отчёта о покрытии
npm run test:e2e         # E2E-тестирование сценариев Chrome Playwright
npm run test:firefox     # E2E-тестирование сценариев Firefox Playwright
npm run test:all         # Полный запуск всех тестов и проверок
npm run verify:release   # Проверка релизных архивов, манифестов и web-ext lint
```

Для разработки рекомендуется **Node.js 24** (минимальная поддерживаемая версия — 22.15). Релизные пакеты формируются в каталогах `.output/release/chrome-mv3` и `.output/release/firefox-mv3`.

## 📦 Установка

- **Chrome Web Store:** установите расширение из [официального каталога Chrome Web Store](https://chromewebstore.google.com/detail/%D0%BA%D0%BE%D1%80%D1%80%D0%B5%D0%BA%D1%82%D0%BE%D1%80-%D0%B3%D1%80%D0%B0%D0%BC%D0%BC%D0%B0%D1%82%D0%B8%D0%BA%D0%B8-%D0%B8-%D0%BE%D1%80/iacebnbpapcgjlplkeapekjeoljfdpgl).
- **Firefox Add-ons:** установите LexiSync из [официального каталога Mozilla Add-ons (AMO)](https://addons.mozilla.org/ru/firefox/addon/65facfa619b74330bdfa/).
- **Chrome (ручная установка):** выполните `npm run build:chrome`, откройте страницу `chrome://extensions/`, включите _Режим разработчика_, нажмите _Загрузить распакованное расширение_ и выберите папку `.output/release/chrome-mv3`.
- **Firefox (ручная установка):** выполните `npm run build:firefox` (или `npm run xpi:firefox`), перейдите на страницу `about:debugging#/runtime/this-firefox`, нажмите _Загрузить временное дополнение..._ и укажите файл `.output/release/firefox-mv3/manifest.json` или полученный `.xpi`.

## 🔑 Начало работы

1. **Получите ключи AI-сервисов:**
    - **Mistral AI:** создайте аккаунт на [console.mistral.ai](https://console.mistral.ai/) и сгенерируйте API-ключ.
    - **Cloudflare Workers AI:** войдите в [Cloudflare Dashboard](https://dash.cloudflare.com/), скопируйте **Account ID** (в боковой панели аккаунта) и создайте **API Token** («My Profile» → «API Tokens») с шаблоном или разрешениями «Account - Workers AI - Read».
2. **Настройте провайдеров:**
    - Откройте настройки LexiSync через иконку на панели браузера или контекстное меню.
    - Вставьте полученные ключи в соответствующие поля и нажмите **Проверить**.
    - Выберите основной сервис (_Автоматически_, _Mistral AI_ или _Cloudflare Workers AI_) и при необходимости включите автоматический Fallback.
3. **Используйте возможности LexiSync:**
    - Выделите любой текст на странице и выберите нужное действие во всплывающем меню или воспользуйтесь сочетаниями клавиш (`Alt+R` — проверка орфографии, `Alt+Y` — стиль, `Alt+S` — OCR-распознавание).

## 🔒 Конфиденциальность и безопасность

- Распознавание текста с экрана (OCR, `Alt+S`) использует Mistral OCR и требует настроенного ключа Mistral независимо от выбранного текстового провайдера.
- Все обращения к API выполняются **напрямую из вашего браузера** по защищённому HTTPS-протоколу (`https://api.mistral.ai/`, `https://api.cloudflare.com/`). В проекте отсутствуют промежуточные прокси-серверы и внешняя телеметрия.
- Ключи, токены, настройки и история хранятся исключительно локально на вашем устройстве.
- Подробные сведения приведены в [Политике конфиденциальности](PRIVACY.md). Руководство по развёртыванию релизов описано в [`docs/RELEASING.md`](docs/RELEASING.md).

## 📄 Лицензия

LexiSync распространяется по свободной лицензии [ISC](LICENSE). Владелец авторских прав — **Kiryuhak**.
