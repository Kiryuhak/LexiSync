# Выпуск LexiSync

Версия в `package.json` является единственным источником номера релиза.

## GitHub Release

1. Выполнить локально `npm run test:all`.
2. Создать и отправить тег, совпадающий с версией, например `v5.1.5`.
3. Workflow `Релиз LexiSync` повторно проверит проект, соберёт архивы и создаст GitHub Release.

Workflow также можно запустить вручную. В этом случае тег будет создан для текущей версии.

## Публикация в магазины

Для автоматической отправки Firefox нужно добавить repository secrets:

- `FIREFOX_JWT_ISSUER`
- `FIREFOX_JWT_SECRET`

Firefox-публикация включается ручным параметром `publish_firefox` либо repository variable
`PUBLISH_FIREFOX_AMO=true`. Идентификатор Firefox берётся из `browser_specific_settings.gecko.id`
в манифесте, а лицензия ISC, категория `language-support` и локализованное краткое описание
передаются из `scripts/firefox-amo-metadata.json`. Chrome Web Store настраивается отдельно:
для него нужны
`CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`,
`CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` и параметр `publish_chrome` либо переменная
`PUBLISH_CHROME_STORE=true`. Секреты не должны храниться в репозитории или релизных архивах.

Локальная команда `npm run xpi:firefox` создаёт неподписанный XPI для временной установки и проверки. Для постоянной установки Firefox принимает только файл, подписанный Mozilla; такой файл создаётся в задаче `publish-firefox`.
