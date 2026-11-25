# Семейный план — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Выполнение самостоятельно в текущем чате; пользователь уже согласовал план, дополнительных утверждений плана не требуется.

**Goal:** Семейный список расходов с общей синхронизацией, PIN и офлайн.
**Architecture:** Статический PWA на GitHub Pages; отдельный Python HTTP API с SQLite за HTTPS. Клиент хранит зашифрованный снимок и очередь операций; сервер идемпотентно применяет частичные обновления в транзакции и возвращает актуальный снимок.
**Tech Stack:** HTML/CSS/JavaScript, Web Crypto, Service Worker; Python stdlib, SQLite, Caddy/systemd.
**Spec:** ../../../BRIEF.md

## Global Constraints
- Мобильная ширина 375px; русский язык; без платных сервисов.
- Секреты и семейные записи не входят в репозиторий.
- Настройки сервера изменять только после отдельного согласования команд.
- Изолированная новая папка; существующие приложения и файлы не менять.

## Review Focus
- Две офлайн-очереди: независимые добавления сохраняются, изменения разных полей объединяются.
- Повтор запроса после обрыва: операция применяется один раз.
- Сбой сети/записи диска: не показывать ложное сохранение и синхронизацию.
- Неправильный PIN, просроченный сеанс и чужой Origin: доступ не предоставляется.
- День/месяц, нулевая и неизвестная сумма: корректные даты и итоги.

### Task 1: API и синхронизация
Files: server/server.py, tests/test_server.py.
Interfaces: POST /api/login {pin} -> {token}; POST /api/sync {operations:[{opId,id,changes}]} -> {items,acknowledged}; GET /api/health.
- [ ] Сначала тесты авторизации, валидации, повторов, слияния полей, атомарности, сохранения в SQLite и CORS; выполнить и увидеть отсутствие реализации.
- [ ] Реализовать server.py; выполнить `python3 -m unittest discover -s tests -v`, ожидается PASS.

### Task 2: PWA и интерфейс
Files: index.html, style.css, app.js, model.mjs, vault.mjs, manifest.webmanifest, sw.js, icons/, tests/model.test.mjs, tests/vault.test.mjs.
Interfaces: model.applyOperations(items, operations), model.summarize(items); vault.encrypt/decrypt использует Web Crypto; UI обращается к API из config.js.
- [ ] Тесты частичного слияния, сумм, дат и шифрования/неверного PIN; сначала RED.
- [ ] Реализовать адаптивный интерфейс, очередь и блокировку; Node tests должны PASS.
- [ ] Проверить браузером добавление/редактирование/галочку/два контекста/офлайн и 375px; сохранить скриншот без личных данных.

### Task 3: Развёртывание и проверка
Files: deploy/install.sh, deploy/family-planner.service, deploy/Caddyfile.example, DEPLOY.md.
- [ ] Подготовить проверяемый установщик для нового сервиса, без перезаписи существующих конфигураций.
- [ ] Проверить shell-синтаксис, Python/JS, состав публикации, отсутствие PIN и семейных записей.
- [ ] После разрешения команд установить backend, проверить HTTPS; опубликовать GitHub Pages, проверить живую страницу и два устройства.
- [ ] Записать фактические ссылки и точку продолжения.
