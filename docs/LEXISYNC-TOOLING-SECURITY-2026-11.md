# Отчёт об аудите безопасности инструментов сборки LexiSync (2026-11-21)

## 1. Введение и контекст

При выполнении основного CI-пайплайна (`ci.yml`, Run ID: 44869000240) на коммите `382a698332c864be1afec9b4ac165562ae038a0a` произошёл сбой на шаге **«Проверить инструменты сборки»** (`npm run audit:tooling`).

Скрипт `scripts/audit-tooling.mjs` завершился с ошибкой:

```text
Error: Аудит инструментов выявил новые уязвимости высокого или критического уровня: fx-runner, node-forge, sharp, shell-quote, source-map-js, undici, vite, web-ext
```

Анализ показал, что аудит production-зависимостей (`npm run audit:dependencies`) был полностью чист (0 уязвимостей), однако в базу npm audit поступили новые предупреждения безопасности для dev-зависимостей сборки.

---

## 2. Детальный реестр уязвимостей и классификация

| Пакет             | Уязвимая версия | Advisory ID / URL                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Severity | Тип уязвимости                                                                  | Исправленная версия | Путь зависимости                                                                                                   | Решение                                                                                        |
| ----------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **sharp**         | `0.35.4`        | [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)                                                                                                                                                                                                                                                                                                                                                                                             | High     | Уязвимость в librsvg dependency (CVE-2026-96889)                                | `0.35.5`            | `devDependencies > sharp`                                                                                          | Обновлена прямая devDependency до `^0.35.5`                                                    |
| **undici**        | `7.29.1`        | [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c)<br>[GHSA-4w7w-5xrc-9h26](https://github.com/advisories/GHSA-4w7w-5xrc-9h26)<br>[GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx)<br>[GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm)                                                                                                                                                         | High     | DoS via excessive encodings, cache poisoning, bypass TLS options                | `7.30.2`            | `web-ext > addons-linter > cheerio > undici`                                                                       | Обновлён `package.json` override до `7.30.2`                                                   |
| **vite**          | `8.1.4`         | [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm)<br>[GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv)                                                                                                                                                                                                                                                                                                                 | High     | Обход проверки `fs.existsSync()` и инъекция аргументов CLI редактора на Windows | `8.3.8`             | `wxt > vite`, `vitest > vite`                                                                                      | Добавлен `package.json` override `"vite": "8.3.8"`                                             |
| **source-map-js** | `1.2.1`         | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)                                                                                                                                                                                                                                                                                                                                                                                             | High     | DoS через смещения секций в индексированных source-map                          | `1.2.4`             | `addons-linter > css-tree > source-map-js`<br>`wxt > magicast > source-map-js`<br>`vite > postcss > source-map-js` | Добавлен `package.json` override `"source-map-js": "1.2.4"`                                    |
| **shell-quote**   | `1.10.0`        | [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv)                                                                                                                                                                                                                                                                                                                                                                                             | Critical | Command injection в `quote()` через символы перевода строк                      | `1.12.0`            | `web-ext > fx-runner > shell-quote`                                                                                | Обновлён `package.json` override до `^1.12.0`                                                  |
| **node-forge**    | `1.4.0`         | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)<br>[GHSA-7wch-p9px-956x](https://github.com/advisories/GHSA-7wch-p9px-956x)<br>[GHSA-jc66-7q78-782g](https://github.com/advisories/GHSA-jc66-7q78-782g)<br>[GHSA-8hrf-8g6f-7xwp](https://github.com/advisories/GHSA-8hrf-8g6f-7xwp)<br>[GHSA-hqq3-7jhf-c5jx](https://github.com/advisories/GHSA-hqq3-7jhf-c5jx)<br>[GHSA-5x38-2vff-x55p](https://github.com/advisories/GHSA-5x38-2vff-x55p) | High     | Подделка подписей RSA PKCS#1 v1.5, ReDoS в pem.decode, отказ в обслуживании TLS | `1.4.3`             | `web-ext > @devicefarmer/adbkit > node-forge`                                                                      | Добавлен `package.json` override `"node-forge": "1.4.3"`                                       |
| **fx-runner**     | `1.6.0`         | N/A (мета)                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Critical | Транзитивная мета-уязвимость                                                    | Устранена           | `web-ext > fx-runner`                                                                                              | Автоматически разрешена после обновления `shell-quote`                                         |
| **web-ext**       | `10.7.0`        | N/A (мета)                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Critical | Транзитивная мета-уязвимость                                                    | Устранена           | `devDependencies > web-ext`                                                                                        | Автоматически разрешена после обновления `fx-runner`, `addons-linter`, `shell-quote`, `undici` |

---

## 3. Выводы независимого аудита Codex

В рамках параллельного анализа инструмент Codex CLI проверил исходное состояние `package.json`, `package-lock.json` и `scripts/audit-tooling.mjs`.

### Ключевые подтверждения Codex:

1. **Подтверждено:** Пакеты `fx-runner` и `web-ext` не имели собственных прямых уязвимостей, а являлись транзитивными мета-уязвимостями, агрегирующими `shell-quote` и `undici`.
2. **Подтверждено:** Обновления `sharp@0.35.5`, `undici@7.30.2`, `vite@8.3.8`, `source-map-js@1.2.4`, `shell-quote@1.12.0` и `node-forge@1.4.3` полностью закрывают уязвимые диапазоны всех high и critical предупреждений.
3. **Подтверждено:** Версия Vite 8.3.8 полностью совместима с WXT 0.21.4 (поддерживает `^8.0.0-0`), Vitest 4.1.11 (поддерживает `^8.0.0`) и средой Node.js 24.
4. **Рекомендации по скрипту аудита:** Ликвидировать независимые глобальные множества `allowedPackages` и `allowedAdvisories`, перейти на строгую модель fail-closed с валидацией кодов процесса, структуры отчёта и поддержкой аннотаций `::error::` GitHub Actions.

---

## 4. Архитектурные изменения `scripts/audit-tooling.mjs`

1. **Модульность:** Логика анализа вынесена в функцию `analyzeAuditReport(report, options)`, что обеспечивает 100% покрытие модульными тестами без сетевых вызовов.
2. **Fail-Closed политика:**
    - Обработка ошибок сетевого взаимодействия и реестра npm (`report.error`) с генерацией исключения.
    - Валидация формата JSON и обязательного наличия секции `vulnerabilities`.
    - Повторные попытки (`retries`) при временных сетевых сбоях CLI.
3. **Строгая гранулярность исключений:**
    - Исключения связывают конкретный пакет с конкретным ID advisory (`package + advisoryId`), максимальным уровнем severity, владельцем и обязательной датой истечения (`expires`).
    - Истёкшие исключения автоматически блокируют выполнение.
4. **Нулевой базовый список исключений (Zero Allowlist):**
    - Так как все уязвимости high/critical устранены на уровне зависимостей, `ALLOWED_EXCEPTIONS = []`. Любое новое появление уязвимости немедленно заблокирует CI.
5. **Интеграция с GitHub Actions:**
    - Формирование структурированных аннотаций `::error title=Security Vulnerability::...` с указанием пакета, GHSA ссылки, путей зависимостей и возможности исправления.
6. **Набор тестов:**
    - Создан тестовый файл `tests/audit-tooling.spec.ts` (7 тестов), проверяющий fail-closed реакцию на ошибки реестра, пустой ввод, истёкшие исключения и разрешение цепочек мета-уязвимостей.

---

## 5. Сравнение состояния `npm audit` До и После

### До обновления:

```text
Total blocking packages: 8 (sharp, shell-quote, fx-runner, web-ext, source-map-js, node-forge, undici, vite)
Exit code: 1
```

### После обновления:

```text
found 0 vulnerabilities (npm audit --omit=dev --audit-level=high)
found 0 high/critical vulnerabilities (npm audit --audit-level=high)
Exit code: 0
```

Остаточные умеренные (moderate) предупреждения относятся исключительно к инструментам разработки (vitest mocker, minimatch, fast-uri) и не затрагивают production-код расширения.

---

## 6. Результаты локальной проверки QA Gate

- `npm run check:static`: **PASS** (Prettier, ESLint, tsc, tsc6, check:i18n, check:svg — 0 ошибок).
- `npm run scan:secrets`: **PASS** (199 отслеживаемых файлов проверены, секреты отсутствуют).
- `npm run audit:dependencies`: **PASS** (0 vulnerabilities в production).
- `npm run audit:tooling`: **PASS** (0 high/critical findings в dev dependencies).
- `npm run test:unit`: **PASS** (13 тестовых файлов, 419 тестов green).
- `git diff --check`: **PASS** (0 пробельных ошибок).
