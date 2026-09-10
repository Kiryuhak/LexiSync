# Google Drive OAuth для LexiSync

Пользователю LexiSync не нужно создавать или копировать токены. В готовой сборке достаточно открыть **Настройки → Приватность**, ввести мастер-пароль и нажать **Синхронизировать сейчас**. Браузер сам покажет вход Google и запрос доступа.

Мастер-пароль шифрует резервную копию локально с помощью AES-256-GCM. Он не сохраняется, не передаётся Google и не является паролем аккаунта Google.

## Настройка релизной сборки

1. В Google Cloud включите Google Drive API и настройте экран согласия OAuth.
2. Добавьте scope `https://www.googleapis.com/auth/drive.appdata`. Он разрешает работу только со скрытыми файлами приложения и не даёт LexiSync читать обычные документы пользователя.
3. Для Chrome создайте OAuth Client ID типа **Chrome Extension** и укажите идентификатор расширения `iacebnbpapcgjlplkeapekjeoljfdpgl`.
4. Для Firefox создайте отдельный OAuth Client ID типа **Web application**. В список разрешённых redirect URI добавьте loopback-адрес, который Firefox формирует для дополнения:

    ```text
    http://127.0.0.1/mozoauth2/<поддомен identity.getRedirectURL()>
    ```

    Поддомен можно узнать во временно установленной Firefox-сборке командой в консоли страницы настроек:

    ```js
    new URL(chrome.identity.getRedirectURL()).hostname.split('.')[0];
    ```

5. Скопируйте только публичные Client ID. Client Secret расширению не нужен и не должен добавляться в репозиторий.

Для локальной сборки создайте `.env` по образцу `.env.example`:

```dotenv
LEXISYNC_GOOGLE_DRIVE_CHROME_CLIENT_ID=...apps.googleusercontent.com
LEXISYNC_GOOGLE_DRIVE_FIREFOX_CLIENT_ID=...apps.googleusercontent.com
```

Для GitHub Release добавьте те же значения как repository variables:

- `GOOGLE_DRIVE_CHROME_CLIENT_ID`;
- `GOOGLE_DRIVE_FIREFOX_CLIENT_ID`.

Релизный workflow намеренно завершится ошибкой, если хотя бы одна переменная отсутствует. Это защищает от публикации сборки с неработающей кнопкой синхронизации.

## Как работает авторизация

- Chrome использует `chrome.identity.getAuthToken`; кэш и срок действия токена контролирует браузер.
- Firefox использует `identity.launchWebAuthFlow`, проверяет случайный параметр `state` и хранит полученный краткоживущий токен в приватной IndexedDB расширения.
- При ответе Google Drive `401/403` LexiSync удаляет устаревший токен, повторно запрашивает доступ и повторяет операцию не более одного раза.
- Токены не передаются в content scripts, DOM сайтов, резервные копии, журнал диагностики или телеметрию.
