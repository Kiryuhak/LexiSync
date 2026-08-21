# Выпуск LexiSync

Версия в `package.json` является единственным источником номера релиза.

## GitHub Release

1. Выполнить локально `npm run test:all`.
2. Создать и отправить тег, совпадающий с версией, например `v5.1.5`.
3. Workflow `Релиз LexiSync` повторно проверит проект, один раз соберёт архивы и создаст GitHub Release.

Проверенные архивы сохраняются как внутренний artifact workflow. Задачи публикации скачивают именно эти файлы,
поэтому в GitHub Release, Firefox Add-ons и Chrome Web Store отправляется одна и та же побайтово проверенная сборка.

Workflow также можно запустить вручную. В этом случае тег будет создан для текущей версии.

## Публикация в магазины

Для автоматической отправки Firefox нужно добавить repository secrets:

- `FIREFOX_JWT_ISSUER`
- `FIREFOX_JWT_SECRET`

При отправке релизного тега `v*` workflow автоматически передаёт сборки в Firefox Add-ons и Chrome Web Store.
При ручном запуске отдельный магазин можно включить параметром `publish_firefox` или `publish_chrome`.
Переменные `PUBLISH_FIREFOX_AMO=true` и `PUBLISH_CHROME_STORE=true` сохраняют автопубликацию и для ручных запусков.

Идентификатор Firefox берётся из `browser_specific_settings.gecko.id`
в манифесте, а лицензия ISC, категория `language-support` и локализованное краткое описание
передаются из `scripts/firefox-amo-metadata.json`. Chrome Web Store настраивается отдельно:
для него нужны
`CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`,
`CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`. Секреты не должны храниться в репозитории или релизных архивах.

Chrome-публикация дополнительно сверяет номер версии и итоговое состояние через Chrome Web Store API. Временная
отмена заявки повторяется до трёх раз. Workflow считается успешным только после подтверждения ожидаемой версии в
состоянии `PENDING_REVIEW` или `PUBLISHED`; отложенная публикация и более новая существующая заявка завершают задачу
понятной ошибкой и никогда не перезаписываются.

Локальная команда `npm run xpi:firefox` создаёт неподписанный XPI для временной установки и проверки. Для постоянной установки Firefox принимает только файл, подписанный Mozilla; такой файл создаётся в задаче `publish-firefox`.
