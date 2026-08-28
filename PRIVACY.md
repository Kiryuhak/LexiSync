# Политика конфиденциальности LexiSync

**Дата вступления в силу:** 24 августа 2026 г.
**Последнее обновление:** 27 августа 2026 г.

[English version](#lexisync-privacy-policy)

LexiSync — браузерное расширение для проверки, исправления и преобразования текста, перевода и распознавания текста на изображениях. Настоящая Политика объясняет, какие данные обрабатывает LexiSync, зачем они нужны, где хранятся и когда передаются третьим сторонам.

## Важное уведомление о передаче данных

При запуске AI-команды выбранный пользователем текст или выбранная область изображения передаются напрямую из браузера к выбранному **AI-провайдеру (Mistral AI API или Groq API)** по защищённому HTTPS-соединению с использованием собственного API-ключа пользователя. Это необходимо для исправления, переписывания, перевода, добавления эмодзи и OCR.

Передача окружающего текста, заголовка и домена страницы **отключена по умолчанию**. Она выполняется только после включения пользователем соответствующей настройки и может быть отдельно запрещена для выбранных сайтов.

Локальная маскировка персональных данных **включена по умолчанию** для текстовых AI-команд. До отправки запроса LexiSync на устройстве заменяет распознанные email-адреса, телефоны, номера банковских карт, IP-адреса и распространённые форматы секретных ключей служебными маркерами. После получения полного ответа исходные значения восстанавливаются локально. Пользователь может отключить эту защиту в настройках. Автоматическое распознавание снижает риск случайной передачи, но не гарантирует обнаружение любых возможных чувствительных данных.

Функция автоматической проверки текста при вводе также **отключена по умолчанию**. После её включения текст поддерживаемого поля может автоматически отправляться в AI-сервис после выбранной задержки. Поля паролей, платёжных данных, кодов подтверждения и другие распознаваемые чувствительные поля исключаются на основе типа поля, атрибута `autocomplete` и его названия. Такая автоматическая фильтрация снижает риск, но не заменяет осторожность пользователя.

## 1. Кто отвечает за LexiSync

Разработчик и издатель расширения: **Kiryuhak**.

LexiSync не использует собственный сервер разработчика для обработки пользовательского текста. Запросы к AI направляются из расширения непосредственно к выбранному AI-провайдеру (Mistral AI или Groq) с ключом пользователя.

Связаться с разработчиком по вопросам конфиденциальности можно через [GitHub Issues](https://github.com/Kiryuhak/LexiSync/issues).

## 2. Какие данные обрабатываются

LexiSync может обрабатывать следующие категории данных.

### 2.1. Выбранный или введённый текст

- текст, который пользователь явно выделил и передал команде LexiSync;
- текст поддерживаемого поля ввода, если пользователь самостоятельно включил автоматическую проверку;
- результат и запрошенный пользователем разбор исправлений, возвращённые выбранным AI-провайдером;
- пользовательские инструкции, глоссарий, личный словарь и параметры стиля, необходимые для выбранной команды.

Текст может содержать созданный пользователем контент или личную переписку. LexiSync не требует вводить персональные, медицинские, финансовые или платёжные сведения и рекомендует не отправлять такие сведения в AI-сервисы без необходимости.

### 2.2. Изображения для OCR

При использовании OCR выбранная пользователем область снимка страницы преобразуется в изображение и передаётся в Mistral AI для распознавания текста. LexiSync не отправляет снимок страницы для OCR без запуска этой функции пользователем.

### 2.3. Необязательный контекст страницы

Если пользователь включил передачу контекста, вместе с запросом могут передаваться:

- фрагмент текста вокруг выделения;
- заголовок страницы;
- доменное имя текущего сайта.

Настройка отключена по умолчанию. Пользователь может отключить её глобально или для конкретного сайта.

### 2.4. API-ключи Mistral и Groq

Пользователь может предоставить собственные API-ключи Mistral AI и/или Groq. Ключи:

- хранятся локально в отдельной защищённой базе IndexedDB расширения на устройстве пользователя;
- используются исключительно для авторизации запросов к официальным API (`https://api.mistral.ai/` и `https://api.groq.com/`);
- не включаются в экспорт настроек;
- не передаются через синхронизацию настроек браузера;
- не отправляются разработчику LexiSync или сторонним аналитическим сервисам.

### 2.5. Локальные настройки и данные функций

На устройстве могут храниться:

- тема, масштаб и оформление интерфейса;
- выбранный основной AI-провайдер (Mistral, Groq или Автоматически), режим AI, тон, язык, поисковая система и задержка автоматической проверки;
- пользовательские команды, текстовые макросы, глоссарий, личный словарь и профили стиля;
- списки разрешённых или исключённых сайтов;
- локальная история исходного и обработанного текста;
- локальный кэш результатов;
- локально изученные слова и словосочетания для адаптивных подсказок;
- агрегированная локальная статистика: число запросов, режимы, ошибки, попадания в кэш, примерная оценка токенов и задержка ответа.

LexiSync не отправляет разработчику телеметрию, аналитику, журналы действий, историю запросов или рекламные идентификаторы.

### 2.6. Настройки, синхронизируемые браузером

Некоторые несекретные предпочтения могут сохраняться через `chrome.storage.sync` или совместимый механизм WebExtensions. Их синхронизация выполняется поставщиком браузера в рамках учётной записи пользователя. API-ключи, история текстов, кэш, пользовательские команды, текстовые макросы, словарь, глоссарий и списки сайтов не входят в набор автоматически синхронизируемых настроек LexiSync. Текстовые макросы включаются только в файл настроек, который пользователь самостоятельно экспортирует на устройство.

## 3. Когда данные передаются третьим сторонам

### 3.1. AI-провайдеры (Mistral AI и Groq)

Для AI-функций LexiSync передаёт выбранному AI-провайдеру только данные, необходимые для выбранной операции: текст, изображение OCR (только Mistral) и, если это разрешено пользователем, контекст страницы. Соответствующий API-ключ передаётся в заголовке авторизации напрямую к API провайдера:

- **Mistral AI:** [Политика конфиденциальности Mistral AI](https://legal.mistral.ai/terms/privacy-policy)
- **Groq:** [Политика конфиденциальности Groq](https://groq.com/privacy-policy/)

Срок хранения, модерация, место обработки и возможное использование данных определяются выбранным пользователем тарифом, настройками аккаунта и актуальными условиями провайдера. LexiSync не управляет инфраструктурой Mistral AI или Groq.

### 3.2. Поисковая система по выбору пользователя

Если пользователь нажимает кнопку поиска выделенного текста, LexiSync открывает новую вкладку с запросом в выбранной поисковой системе: Google, Яндекс или DuckDuckGo. Текст запроса и стандартные данные веб-запроса обрабатываются выбранной поисковой системой по её собственной политике. LexiSync не выполняет такой поиск автоматически.

### 3.3. Синхронизация браузера

Поставщик браузера может синхронизировать ограниченный набор несекретных настроек LexiSync между устройствами пользователя. Такая обработка регулируется политикой конфиденциальности Google Chrome, Mozilla Firefox или другого используемого браузера.

### 3.4. Другие случаи

LexiSync не продаёт пользовательские данные и не передаёт их рекламным сетям, брокерам данных или аналитическим сервисам. Передача также может потребоваться по закону или для защиты безопасности и прав пользователей, разработчика либо третьих лиц.

## 4. Сроки хранения

- **История:** хранится только локально, содержит не более 500 записей и удаляется после срока, выбранного пользователем; срок по умолчанию — 30 дней. При достижении лимита удаляются самые старые записи.
- **Кэш AI и OCR:** хранится только локально не более 7 дней и содержит не более 100 записей.
- **Дневная статистика использования:** локальная детализация ограничена последними 62 днями; общие счётчики сохраняются до очистки пользователем.
- **Настройки, словари и адаптивные данные:** хранятся до изменения, сброса или удаления расширения.
- **API-ключи:** хранятся до удаления ключей пользователем или удаления локальных данных расширения.
- **Данные у AI-провайдеров и поисковых систем:** хранятся в соответствии с политиками и настройками соответствующего сервиса.

В приватных окнах история и кэш LexiSync не сохраняются.

## 5. Управление данными

Пользователь может в настройках LexiSync:

- выбрать основного AI-провайдера и включить/отключить автоматический fallback;
- отключить передачу контекста страницы;
- отключить или повторно включить локальную маскировку персональных данных;
- отключить автоматическую проверку текста;
- запретить работу, историю, подсказки или контекст для отдельных сайтов;
- отключить локальную историю;
- изменить срок хранения истории;
- добавлять, изменять и удалять локальные текстовые макросы;
- удалить историю, кэш, локальную статистику и адаптивные данные;
- удалить API-ключи;
- отозвать доступ расширения к сайтам в настройках браузера;
- удалить расширение и его локальные данные.

Синхронизированные настройки могут дополнительно управляться через настройки синхронизации учётной записи браузера.

## 6. Разрешения браузера

LexiSync использует минимально необходимые разрешения:

- `storage` — локальное хранение и синхронизация несекретных настроек;
- `activeTab` — временный доступ к активной вкладке после действия пользователя;
- `scripting` — запуск упакованного с расширением интерфейса на разрешённой странице;
- `contextMenus` — команды для выделенного текста и изображений;
- `https://api.mistral.ai/*` — защищённые запросы к Mistral AI API;
- `https://api.groq.com/*` — защищённые запросы к Groq API;
- необязательный доступ к HTTP/HTTPS-сайтам — постоянная работа только на сайтах, которые пользователь разрешил отдельно.

Расширение не запрашивает доступ к cookies, полной истории браузера, геолокации, контактам, камере или микрофону и не выполняет удалённый JavaScript или WebAssembly.

## 7. Безопасность

- Все запросы к Mistral AI и Groq выполняются по HTTPS.
- Исполняемый код поставляется внутри пакета расширения в соответствии с Manifest V3.
- API-ключи отделены от обычных настроек и не включаются в синхронизацию или экспорт.
- Постоянный доступ к сайтам запрашивается только по инициативе пользователя и может быть отозван.
- Автоматическая проверка отключена по умолчанию и старается исключать чувствительные поля.
- Локальная маскировка персональных данных включена по умолчанию для текстовых AI-команд.

Ни один способ хранения или передачи данных не обеспечивает абсолютную безопасность. Пользователь отвечает за сохранность своего API-ключа и за выбор текста или изображения, отправляемого внешним сервисам.

## 8. Дети

LexiSync не предназначен специально для детей и сознательно не собирает сведения о возрасте. Если несовершеннолетний использует расширение, ответственность за соответствующее согласие несёт его законный представитель в соответствии с применимым законодательством.

## 9. Ограниченное использование данных (Chrome Web Store Limited Use)

LexiSync использует разрешения браузера и пользовательские данные только для предоставления и улучшения заявленной пользовательской функции работы с текстом. Данные не используются для персонализированной рекламы, ретаргетинга, профилирования, продажи, определения платёжеспособности или целей, не связанных с работой расширения.

Разработчик LexiSync не получает пользовательский текст на собственные серверы и не предоставляет людям доступ к нему. Передача Mistral AI, Groq и выбранной поисковой системе происходит только для выполнения функции, запрошенной пользователем, и регулируется условиями соответствующего сервиса.

## 10. Изменения политики

Политика может обновляться при изменении функций, требований магазинов расширений или законодательства. Актуальная версия публикуется в этом файле с новой датой обновления. Существенные изменения, затрагивающие обработку данных, будут также отражены в описании выпуска или интерфейсе LexiSync.

---

# LexiSync Privacy Policy

**Effective:** August 24, 2026
**Last updated:** August 27, 2026

LexiSync is a browser extension for checking, correcting, rewriting, translating, and recognizing text in images. This Policy explains what data LexiSync processes, why it is needed, where it is stored, and when it is transferred to third parties.

## Important data transfer notice

When a user starts an AI command, the selected text or selected image area is sent directly from the browser to the chosen **AI provider API (Mistral AI API or Groq API)** over HTTPS using the user's own API key. This transfer is necessary for correction, rewriting, translation, emoji suggestions, and OCR.

The transfer of surrounding text, page title, and current domain is **disabled by default**. It occurs only after the user enables the setting and can be disabled for individual websites.

Local personal-data masking is **enabled by default** for text AI commands. Before a request is sent, LexiSync replaces recognized email addresses, phone numbers, payment-card numbers, IP addresses, and common secret-key formats with placeholders on the user's device. Original values are restored locally after the complete response is received. Users can disable this protection in Settings. Automatic recognition reduces the risk of accidental transfer but cannot guarantee detection of every possible type of sensitive data.

Automatic proofreading while typing is also **disabled by default**. If enabled, text from a supported input field may be sent to the AI service automatically after the selected delay. Password, payment, verification-code, and other recognized sensitive fields are excluded using the input type, `autocomplete` value, and field identity. This filtering reduces risk but cannot replace user caution.

## 1. Controller and contact

Developer and publisher: **Kiryuhak**.

LexiSync does not operate a developer-owned server for processing user text. AI requests are sent directly from the extension to the selected AI provider (Mistral AI or Groq) using the user's key.

Privacy questions can be submitted through [GitHub Issues](https://github.com/Kiryuhak/LexiSync/issues).

## 2. Data processed by LexiSync

LexiSync may process:

- text explicitly selected by the user;
- text from a supported input field when the user enables automatic proofreading;
- AI results returned to the extension;
- user commands, glossary, personal dictionary, tone, and style settings needed for a request;
- an image of the user-selected page area when OCR is invoked (Mistral AI);
- surrounding text, page title, and current domain when optional page context is enabled;
- the user's Mistral AI and/or Groq API keys;
- local settings, per-site permissions and exclusions;
- local text history, result cache, adaptive language data, and aggregate usage counters.

Selected text may contain user-generated content or personal communications. LexiSync does not require personal, health, financial, or payment information and recommends not sending such information to AI services unless necessary.

## 3. Local storage and browser sync

API keys for Mistral AI and Groq are stored locally in a separate extension IndexedDB database. They are used only to validate keys and authorize requests to `https://api.mistral.ai/` and `https://api.groq.com/`. They are not exported, synchronized through browser settings sync, or sent to the LexiSync developer.

Local extension storage may contain appearance and feature settings, primary AI provider preference, automatic fallback toggle, commands, text snippets, dictionaries, glossaries, style profiles, site lists, text history, cached results, adaptive suggestion data, and aggregate request statistics. LexiSync does not send telemetry, analytics, activity logs, text history, or advertising identifiers to the developer.

A limited set of non-secret preferences may be synchronized using `chrome.storage.sync` or a compatible WebExtensions mechanism. The browser provider performs this synchronization under the user's browser account. The API key, text history, cache, custom commands, text snippets, dictionary, glossary, and site lists are not part of LexiSync's automatically synchronized settings. Text snippets are included only in a settings file that the user explicitly exports to the device.

## 4. Third-party transfers

### AI Providers (Mistral AI and Groq)

LexiSync sends the selected AI provider only the data needed for the requested AI operation: selected or automatically checked text, an OCR image (Mistral), and optional page context when enabled. The API key is included in the authorization header.

- **Mistral AI:** [Mistral AI Privacy Policy](https://legal.mistral.ai/terms/privacy-policy)
- **Groq:** [Groq Privacy Policy](https://groq.com/privacy-policy/)

Provider retention, moderation, processing location, and possible data use are determined by the user's plan, account settings, and current provider terms. LexiSync does not control Mistral AI or Groq infrastructure.

### User-selected search engine

When the user clicks the search button, LexiSync opens a new tab containing the selected text as a query in Google, Yandex, or DuckDuckGo. The selected search provider receives the query and ordinary web-request data under its own policy. LexiSync never starts this search automatically.

### Browser synchronization

The browser provider may synchronize a limited set of non-secret preferences between the user's devices. This processing is governed by the privacy policy of Google Chrome, Mozilla Firefox, or the user's other browser.

LexiSync does not sell user data or transfer it to advertising networks, data brokers, or analytics services. Data may also be disclosed when required by law or necessary to protect the security and rights of users, the developer, or third parties.

## 5. Retention

- **History:** local only, limited to 500 records, retained for the user-selected period; the default is 30 days. When the limit is reached, the oldest records are removed.
- **AI and OCR cache:** local only, limited to 100 records and retained for no more than 7 days.
- **Daily usage statistics:** local daily details cover the latest 62 days; aggregate counters remain until cleared by the user.
- **Settings, dictionaries, and adaptive data:** remain until changed, reset, or the extension is removed.
- **API keys:** remain until the user removes them or deletes the extension's local data.
- **AI provider and search-provider data:** retained according to the respective service's policy and account settings.

LexiSync does not save its history or cache in private browsing windows.

## 6. User controls

Users can:

- choose their primary AI provider and toggle automatic fallback;
- disable page-context transfer, local personal-data masking, and automatic proofreading;
- disable access, history, suggestions, or context for individual sites;
- disable local history or change its retention period;
- add, edit, and delete local text snippets;
- clear history, cache, aggregate usage statistics, and adaptive data;
- remove API keys;
- revoke site access in browser settings;
- uninstall the extension and remove its local data.

Synchronized preferences may also be managed through the browser account's synchronization settings.

## 7. Browser permissions

LexiSync uses the minimum permissions required for its user-facing purpose:

- `storage` for local data and non-secret preference synchronization;
- `activeTab` for temporary access after a user gesture;
- `scripting` to run packaged UI code on a user-authorized page;
- `contextMenus` for selected-text and image commands;
- `https://api.mistral.ai/*` for HTTPS requests to Mistral AI API;
- `https://api.groq.com/*` for HTTPS requests to Groq API;
- optional HTTP/HTTPS site access only for websites the user authorizes individually.

LexiSync does not request access to cookies, full browser history, geolocation, contacts, camera, or microphone, and does not execute remote JavaScript or WebAssembly.

## 8. Security

All Mistral AI and Groq requests use HTTPS. Executable code is packaged with the extension under Manifest V3. API keys are separated from ordinary settings and excluded from sync and export. Persistent website access is requested only after a user action and can be revoked. Automatic proofreading is disabled by default and attempts to exclude sensitive fields. Local personal-data masking is enabled by default for text AI commands.

No storage or transmission method is completely secure. Users are responsible for protecting their API keys and choosing which text or images to send to external services.

## 9. Children

LexiSync is not specifically directed to children and does not knowingly collect age information. Where a minor uses LexiSync, the legal guardian is responsible for any consent required by applicable law.

## 10. Chrome Web Store Limited Use disclosure

LexiSync uses browser permissions and user data solely to provide and improve its disclosed, user-facing text-processing purpose. Data is not used for personalized advertising, retargeting, profiling, sale, creditworthiness decisions, or purposes unrelated to the extension.

The LexiSync developer does not receive user text on developer-owned servers or provide human access to it. Transfers to Mistral AI, Groq, and a user-selected search provider occur only to perform a function requested by the user and are governed by the respective service's terms.

## 11. Policy changes

This Policy may be updated when features, extension-store requirements, or laws change. The current version will be published in this file with an updated date. Material changes affecting data processing will also be described in release notes or the LexiSync interface.
