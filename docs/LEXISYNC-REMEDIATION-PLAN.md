# План исправлений LexiSync по результатам полного аудита

Основание: `docs/LEXISYNC-FULL-AUDIT.md`, HEAD `fee6e4098bd74c118fed4c7b7ae461e92aa1d810`, версия 5.6.9. Этот документ — план для отдельного этапа. **Не выполнять автоматически, не менять версию, не создавать tag/release и не публиковать расширение без отдельного разрешения.**

Порядок немного уточняет исходные этапы: AUD-001 включён в этап приватности до общей migration-работы, потому что он уже может отправлять текст в сеть; AUD-003/012 выполняются до routing, потому что затрагивают сохранность текста. Каждый этап завершать отдельным reviewable набором изменений.

## Этап 0. Подтверждение критичных проблем

1. **Цель:** превратить самые опасные выводы в постоянные красные regression tests до исправления.
2. **Находки:** AUD-001, AUD-002, AUD-003, AUD-004, AUD-005, AUD-012.
3. **Файлы:** новые/существующие tests `ai-quality`, `unit`, `storage`, `content-lifecycle`, `e2e`; production-файлы пока не менять.
4. **Изменения:** добавить минимальные репродукции migration local, attached units/currency, stale Undo, malformed import и URL log; для contenteditable проверить фактический host undo.
5. **Новые тесты:** `2026г→2027г`, `12кг→13кг`, `100 ₽→100 $`; edit-after-replace; legacy upgrade без fetch; exported log без URL.
6. **Команды:** `npm run test:unit`; точечный `playwright test ... --grep`; `git diff --check`.
7. **Готово, когда:** каждый подтверждённый баг воспроизводится; AUD-012 либо повышен до confirmed, либо документирован как browser-specific limitation.
8. **Риски:** тест случайно закрепит спорный UX вместо инварианта.
9. **Не сломать:** существующие 331 unit и snapshot protection E2E; не обращаться к paid API.
10. **Зависимости:** нет; обязательный вход для этапов 1–4.

## Этап 1. Приватность и безопасность

1. **Цель:** исключить неявную сетевую передачу и попадание текста/секретов в экспорт.
2. **Находки:** AUD-001, AUD-004, AUD-005, AUD-006, AUD-020.
3. **Файлы:** `settings-migrations.ts`, `runtime-settings-cache.ts`, `settings-transfer.ts`, `ai-sanity-check.ts`, `error-log.ts`, `settings-store.ts`, UI/locales/privacy docs.
4. **Изменения:** fail-closed migration/import; consent state; URL-free errors + sanitizer; factory-reset partial error; sender allowlist для destructive mutations.
5. **Новые тесты:** upgrade/import matrices, no-network-before-consent, secret-store fault injection, hostile sender, log redaction.
6. **Команды:** `npm run check:static`, `npm run test:unit`, privacy E2E, secret scan.
7. **Готово, когда:** ни legacy/import, ни log/reset/message path не расширяет передачу или сохраняет секрет молча.
8. **Риски:** заблокировать легитимные сообщения content/options; потерять настройку существующего пользователя.
9. **Не сломать:** native live spellcheck без сети, personal dictionary local-only, secret isolation, existing settings format.
10. **Зависимости:** этап 0; product copy/consent decision для AUD-001.

## Этап 2. Корректность текста и DOM replacement

1. **Цель:** предотвратить искажение фактов и потерю последующих правок.
2. **Находки:** AUD-002, AUD-003, AUD-012.
3. **Файлы:** `ai-sanity-check.ts`, `text-replacement.ts`, `content-result-actions.ts`, selection/request lifecycle.
4. **Изменения:** защищённые numeric+unit+currency entities; compare-and-swap Undo input/textarea; scoped inverse patch contenteditable или безопасный отказ.
5. **Новые тесты:** полная numeric matrix; Undo после user edit; multi-node editor; detached/mutated target; append Undo.
6. **Команды:** `npm run test:unit`, `npm run build:e2e`, targeted Chrome E2E; после стабилизации Firefox subset.
7. **Готово, когда:** изменённое значение всегда блокируется, а Undo никогда не удаляет ввод после операции LexiSync.
8. **Риски:** ложные positives для допустимого форматирования; editor-specific DOM differences.
9. **Не сломать:** случаи A–E, URL/email/phone preservation, preview=replace, stale snapshot guard.
10. **Зависимости:** этапы 0–1; правила допустимой нормализации чисел.

## Этап 3. AI routing, Mistral, Cloudflare и Speller

1. **Цель:** сделать выбор/повторы/источник полностью предсказуемыми.
2. **Находки:** AUD-009, AUD-010, AUD-011; контроль AUD-002.
3. **Файлы:** `yandex-speller-client.ts`, `mistral-client.ts`, `ai-client.ts`, provider health/availability, result source badge.
4. **Изменения:** reserve только applied Speller edits; общий retry budget/visibility для OCR; явная политика missing-primary; не увеличивать максимум AI providers сверх двух.
5. **Новые тесты:** overlapping/reordered Speller findings; routing truth table; OCR abort/5xx/429; source badge и hybrid fallback.
6. **Команды:** unit/provider suites, Chrome E2E routing tests, бесплатный synthetic Speller contract check.
7. **Готово, когда:** нет loop/hidden switch, каждая сеть учтена, UI показывает фактический источник и fallback.
8. **Риски:** расход квот; изменение ожидаемой строгой привязки к primary.
9. **Не сломать:** Mistral 429 cooldown persistence, fallback-off invariant, hybrid retains Speller result, single main AI request.
10. **Зависимости:** этап 2; product decision по AUD-011.

## Этап 4. Настройки, storage, Google Drive и migration

1. **Цель:** атомарные и детерминированные import/restore/sync.
2. **Находки:** AUD-007, AUD-008; завершение AUD-001/004/006.
3. **Файлы:** `crypto-backup.ts`, `google-drive-sync.ts`, settings transfer/store/migrations, Drive UI/errors.
4. **Изменения:** restore preflight + transaction/rollback; newest/duplicate Drive policy; revision/precondition; точный partial-failure UI.
5. **Новые тесты:** failure after each restore write; duplicate files; stale remote revision; timeout/403/429; migration idempotency.
6. **Команды:** unit storage/crypto/Drive suites, `npm run test:coverage`, targeted mocked E2E.
7. **Готово, когда:** restore либо полный, либо восстановлен прежний snapshot; duplicate/conflict не решается случайно.
8. **Риски:** rollback secret stores; изменение remote file semantics.
9. **Не сломать:** AES-GCM/PBKDF2 format, appDataFolder, password never stored, Firefox OAuth state check.
10. **Зависимости:** этап 1; согласованная conflict policy.

## Этап 5. UI, accessibility и i18n

1. **Цель:** доказать UX на целевых размерах, темах и клавиатуре.
2. **Находки:** AUD-018; UI части AUD-001, AUD-006, AUD-011.
3. **Файлы:** content dialog/panel/styles, popup/options/history, ru/en locales, E2E/screenshots.
4. **Изменения:** consent/partial-error/cfg copy; единый focus/error/source contract; устранить только воспроизведённые layout/a11y defects.
5. **Новые тесты:** 375/768/desktop × light/dark; zoom 200%; keyboard/focus trap; axe injected panel; long RU/EN strings.
6. **Команды:** `npm run check:i18n`, `npm run check:static`, targeted visual/a11y E2E.
7. **Готово, когда:** нет serious/critical axe findings, clipping/overflow, unlabeled controls; обе локали полны.
8. **Риски:** хрупкие pixel snapshots и рост времени CI.
9. **Не сломать:** compact mode, Yandex attribution, provider badge, host CSS isolation.
10. **Зависимости:** этапы 1, 3; стабилизация waits из этапа 7 допустима раньше при необходимости.

## Этап 6. Производительность и сопровождаемость

1. **Цель:** измерить runtime overhead и только затем уменьшить связность/загрузку.
2. **Находки:** AUD-019; сетевой аспект AUD-010.
3. **Файлы:** `content-request-panel.ts`, `options.ts`, `options-page.css`, optional entrypoints, build reports.
4. **Изменения:** performance marks/budgets; выделить lifecycle/action controllers; lazy-load только по подтверждённым профилем границам.
5. **Новые тесты:** bundle budgets, panel-open latency, listener/timer cleanup, long-page smoke, repeated injection.
6. **Команды:** production build, size report, E2E repeated-open, browser trace/profile.
7. **Готово, когда:** установлен baseline и достигнут согласованный budget без функциональных регрессий.
8. **Риски:** преждевременная декомпозиция создаст races и большие diff.
9. **Не сломать:** optional features, request cancellation, single initialization, 320/375 layout.
10. **Зависимости:** после correctness этапов 1–5.

## Этап 7. Тесты и CI

1. **Цель:** закрыть cross-browser/integration blind spots и уменьшить flaky.
2. **Находки:** AUD-013, AUD-014, AUD-015, AUD-016, AUD-018.
3. **Файлы:** Playwright configs/specs, Vitest suites, CI workflow, package/lock, audit tooling.
4. **Изменения:** shared critical browser suite; state-driven waits; retries как отдельный flaky signal; opt-in API canary; безопасное обновление toolchain.
5. **Новые тесты:** Firefox Speller/UI/replace/session/permissions; scheduled provider contract; no-retry race suite.
6. **Команды:** полный gate, `npm audit --audit-level=high`, repeated E2E, Firefox lint/install/runtime.
7. **Готово, когда:** critical Chrome/Firefox flows одинаково проверены; полный audit либо чист, либо оставшееся исключение узко обосновано.
8. **Риски:** CI duration, upstream Firefox limitations, canary cost/flakiness.
9. **Не сломать:** fork PR без секретов, redaction, deterministic mocks, current coverage thresholds.
10. **Зависимости:** regression tests этапа 0; UI matrix этапа 5. Toolchain security можно вести параллельно.

## Этап 8. Финальная проверка перед релизом

1. **Цель:** доказать соответствие кода, manifests, артефактов и неизменность одного тега.
2. **Находки:** AUD-017 и повторная проверка всех AUD-001—020.
3. **Файлы:** release workflow, verification scripts, manifests, changelog/privacy/release notes; version files только после отдельного решения о релизе.
4. **Изменения:** hash/provenance gate; запрет clobber при отличающемся hash; checklist evidence. Публикацию этим этапом не выполнять автоматически.
5. **Новые тесты:** double-build hash equality; existing-release mismatch failure; tag/package/manifests equality; secret/source archive scan.
6. **Команды:** `check:static`, unit+coverage, Chrome/Firefox runtime, zip, artifact verify, Firefox lint, production+tooling audit, `git diff --check`, secret scan.
7. **Готово, когда:** весь gate зелёный без скрытого retry; hashes зафиксированы; открытые риски явно приняты владельцем.
8. **Риски:** workflow rerun может затронуть опубликованный release; проверять в dry-run/test tag до production.
9. **Не сломать:** один tag = один commit = один набор hashes; stores не публиковать без явного разрешения.
10. **Зависимости:** завершение этапов 0–7 и отдельное решение владельца о version/tag/release.

## Обязательный порядок и контроль изменений

Критический путь: **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**. Допустимо параллельно исследовать обновление toolchain из этапа 7 и подготовить тестовую инфраструктуру, но merge должен сохранять этот порядок инвариантов: сначала приватность и сохранность текста, затем routing/storage, затем UI/performance, затем release.

После каждого этапа обновлять таблицу находок доказательствами, а не закрывать ID только по наличию кода. Любое изменение privacy semantics, provider fallback или restore conflict policy требует явного product decision. План завершён; его выполнение не начато.
