# Выпуск LexiSync

Версия в `package.json` является единственным источником номера релиза.

## GitHub Release

1. Выполнить локально `npm run test:all`.
2. Создать и отправить тег, совпадающий с версией: `v4.1.0`.
3. Workflow `Релиз LexiSync` повторно проверит проект, соберёт архивы и создаст GitHub Release.

Workflow также можно запустить вручную. В этом случае тег будет создан для текущей версии.

## Публикация в магазины

Для автоматической отправки нужно добавить repository secrets:

- `CHROME_EXTENSION_ID`
- `CHROME_PUBLISHER_ID`
- `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`
- `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`
- `FIREFOX_EXTENSION_ID`
- `FIREFOX_JWT_ISSUER`
- `FIREFOX_JWT_SECRET`

Публикация включается ручным параметром `publish_stores` либо repository variable
`PUBLISH_EXTENSION_STORES=true`. Секреты не должны храниться в репозитории или релизных архивах.
