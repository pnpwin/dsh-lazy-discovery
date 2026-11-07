# DSH Lazy Discovery

**Ленивая загрузка схем MCP и поиск skills по текущей задаче для DeepSeek Harness.**

[GitHub](https://github.com/pnpwin/dsh-lazy-discovery) · [English](<README.md>) · [Upstream и лицензии](<UPSTREAM.md>) · [Проверки](<docs/VERIFICATION.md>)

Пакет: `@pnpwin/dsh-lazy-discovery` · версия: **1.1.0** · совместимый runtime: **DSH 0.2.2-rc.1**.

Опциональный Host-плагин оставляет большие каталоги вне первоначального контекста модели. Штатный загрузчик `skill`, прямой вызов skill через `/name` и обычный Native executor DSH сохраняются. Лимит контекстного окна не увеличивается. Плагин не является security sandbox.

## Как работает агент

| Инструмент | Назначение |
|---|---|
| `skill_search({query, limit?})` | Поиск описаний model-invocable skills для текущих scope и рабочей директории Agent. |
| `skill({name})` | Загрузка полных инструкций по точному имени штатным инструментом DSH. |
| `mcp_tools_search({query, server?, limit?})` | Поиск по каталогам настроенных MCP-серверов: ограниченные карточки и точные ID вместо всех схем. |
| `mcp_tools_load({ids})` | Фиксация выбора; соответствующие Native schemas появляются на **следующем шаге**. Сам инструмент ничего не исполняет. |
| `discovery_status({})` | Состояние кэша, соединений и регистраций; отдельно помеченные размеры JSON в байтах. |

Пример:

```text
skill_search({query: "создать таблицу Excel"})
skill({name: "office-xlsx"})

mcp_tools_search({query: "извлечь содержимое веб-страницы", server: "firecrawl"})
mcp_tools_load({ids: ["<точный ID из результата поиска>"]})
# На следующем шаге — обычный вызов найденного Native tool.
```

Поиск учитывает Unicode, английские/русские алиасы и точные имена; отсутствие совпадений даёт пустой результат. Это лексический поиск, **не embeddings** и не гарантия нахождения всех подходящих инструментов. При необходимости переформулируйте запрос, сузьте задачу или укажите сервер. Неполный discovery отделяется от подтверждённого отсутствия. Skill, названный пользователем, можно загрузить напрямую; повторно загружать уже внедрённый `<skill_content>` не нужно.

## Установка

Попросите DSH установить GitHub bundle через Plugin Manager:

```json
{"action":"install_bundle","target":"github:pnpwin/dsh-lazy-discovery#v1.1.0"}
```

Для воспроизводимости фиксируйте проверенный commit или release tag. Установка меняет активный профиль и может требовать подтверждения. Проверяйте `application`, `warnings` и `nextStep` в результате: наличие пакета ещё не доказывает успешную активацию. Не обходите проверку совместимости runtime.

Поставляемая конфигурация использует **keyless Firecrawl MCP endpoint**. Соединение возникает при первом discovery, а не при старте bundle. Проект не подставляет API key. Доступность, лимиты и стоимость использования внешнего сервиса по-прежнему определяются самим сервисом.

### Не оставляйте второй eager-клиент

Bundle намеренно не отключает чужую eager MCP-запись в профиле. Получите точные идентификаторы через Plugin Manager и отключите соответствующий eager-клиент только после успешного применения lazy bundle. Два клиента с одинаковым публичным namespace могут конфликтовать; даже без конфликта такой запуск портит сравнение контекста.

Patch ID `local-lazy-discovery` сохранён для совместимости. При переходе с локального прототипа `@local/dsh-lazy-discovery` не держите обе версии включёнными: отключите/удалите прежний bundle в ходе миграции. Используйте Plugin Manager, а не ручные изменения manifest и patch профиля.

Для проверки чистого начального контекста создайте **новую сессию**. В старой истории могут оставаться ранее переданные каталоги: плагин отменяет их актуальность компактным сообщением, но не стирает уже состоявшиеся запросы к провайдеру.

## Конфигурация и устройство

[Patch bundle](<cordis.patch.yml>) задаёт переносимый путь кэша через `dshHomePath('cache/lazy-discovery')`.

| Поле | Значение |
|---|---|
| `cacheDirectory` | Абсолютный приватный каталог; переносимый путь задаётся patch bundle. |
| `cacheMaxAgeMs` | Срок актуальности MCP-каталога; по умолчанию 1 800 000 мс. |
| `skillMaxAgeMs` | Срок жизни прогретого каталога skills в памяти; по умолчанию 60 000 мс. |
| `servers` | Явные доверенные конфигурации MCP; пустой список оставляет только skills discovery. |

Сервер задаётся через `serverName`, `transport` (`streamable-http` или `stdio`) и соответствующие URL либо команду. Поддерживается HTTPS; обычный HTTP ограничен loopback. Команды stdio, переменные окружения и адреса серверов — доверенная конфигурация развёртывания. Холодный поиск способен запустить настроенный stdio-процесс, даже не вызывая бизнес-инструмент.

Runtime, CLI, build- и report-код находятся под `src/`; [тесты](<test/>) и [локализации](<locale/>) остаются в своих каталогах ресурсов. Exports корня пакета и `/host` ведут к одной runtime-точке входа. Модули DSH разрешаются из работающей установки, без установки вторых экземпляров scope/services. Интеграция зависит от версии DSH и сейчас поддерживает только заявленный релиз.

### Кэш и границы исполнения

- Права каталога/файлов кэша — 0700/0600 там, где они поддерживаются; записи ограничены по размеру, версионированы и атомарны.
- Сырые headers, env/transport-конфигурация и тела skill instructions не сохраняются. Описания, schemas и инструкции удалённых tools всё равно могут быть чувствительными данными — защищайте кэш.
- Disk hints skills не дают прав другому scope и не заменяют свежий scoped discovery после перезапуска процесса. Кэш в памяти учитывает объект Agent, scope chain, cwd и revision invalidation.
- MCP schemas на диске — подсказки. Перед выполнением проверяются текущее соединение/schema и hash выбора. Изменённый или удалённый tool требует нового search/load.
- Выбор восстанавливается Session projection из зафиксированных пар call/result `mcp_tools_load`. Новые типы session events и постоянные флаги «body уже загружен» не вводятся. Само открытие Session не устанавливает соединение; cache miss требует явного discovery.
- Один load выбирает до восьми tools, Session сохраняет до 64 выборов. Загрузка **не означает разрешение на выполнение**. Именованные Native calls проходят обычные guards, approval и permission pipeline DSH.
- После неопределённого transport failure потенциально завершившиеся side effects автоматически не повторяются.

## Измеренное уменьшение начального контекста

**Input tokens, сообщённые провайдером 7 ноября 2026 года:**

| Конфигурация | Input tokens первого запроса | Доля окна 500 000 tokens | Уменьшение к eager/eager |
|---|---:|---:|---:|
| Eager MCP + eager summaries skills | 14 469 | 2,89% | — |
| Только lazy MCP | 10 350 | 2,07% | 4 119 / 28,47% |
| Только lazy skills | 13 540 | 2,71% | 929 / 6,42% |
| Lazy MCP + lazy skills | 9 407 | 1,88% | 5 062 / 34,99% |

Измерения описаны в [отчёте сравнения](<docs/context-comparison.md>) и [очищенной сводке](<test/fixtures/context-benchmark.json>). Offline [report helper](<src/benchmark.mjs>) пересчитывает сохранённую таблицу без live API calls.

### Метод и ограничения

Четыре свежих изолированных Agent использовали один preset `cordis`, модель `gpt-6.1-sol`, provider `openai-codex`, reasoning effort high и одинаковую минимальную задачу без использования tools. Все вернули один короткий ответ, не сделали tool calls и сообщили пять output tokens. Таблица использует `assistant/message.usage.inputTokens` первого успешного ответа — **не** characters/4, offline BPE, JSON bytes или оценку счёта к оплате.

Контроли: **50 общих Native schemas**, совпадающих по содержимому, **один MCP-сервер / три tools Firecrawl**, **20 model-invocable skills**, одинаковая route capacity и совпадающие общие system/runtime texts. Динамические quota- и диагностические status-tools исключены во всех вариантах. MCP resources одинаково не включались. В lazy MCP учитывались две схемы search/load и routing text; в lazy skills — `skill_search` и routing text. Bootstrap overhead включён в итог, а не отброшен.

«Eager skills» — точный штатный начальный каталог **name + description**, cap500 и escaping, а не загрузка всех полных инструкций. Тела skills не загружались ни в одном варианте. Небольшая неаддитивность эффектов возникает из-за общей routing-преамбулы и сериализации.

Это одно контролируемое сравнение **первого запроса**, не многомодельный benchmark, тест latency, успешности задач или гарантия экономии денег. Результаты поиска, выбранные schemas, bodies и дополнительные шаги увеличивают последующий контекст; prompt cache и полная стоимость задачи могут отличаться. Ёмкость окна 500 000 tokens не меняется. В публичные benchmark-артефакты должны входить только очищенные сводки: без сырых prompts, локальных путей, session IDs, credentials и полных transcripts.

## Разработка и проверка

Используйте Node.js, поддерживаемый целевой установкой DSH. Из корня репозитория:

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm test
pnpm run benchmark:report
```

Build проверяет структуру пакета и исходников; report работает с очищенными измерениями и не является разрешением на платные provider calls. Релиз 1.1.0 прошёл **67 тестов**: 64 теста реализации и три регрессионных теста структуры пакета и benchmark. Актуальный результат показывает `pnpm test`. Покрыты настоящий official-SDK stdio/proxy negotiation, ограничения metadata, приватный кэш/reinitialization, scope/cwd, incomplete discovery, cancellation, notification races, committed selection, replay и порядок skill catalog middleware.

Отдельно в живом DSH проверены lazy Native registration, один read-only Native MCP call, прогретый поиск с нулём соединений после перезагрузки bundle, новый Agent без полного skill catalog и загрузка одного exact skill штатным loader. Это не сертифицирует полный OS restart, interactive approval UI, negative guard-denial cases или все модели/провайдеры. Подробнее — [журнал проверок](<docs/VERIFICATION.md>).

## Экспериментальный MCP proxy

Host bundle его не включает:

```bash
node src/proxy.mjs --experimental --config=/absolute/path/to/config.json
```

Нужны явный непустой `allowTools` и абсолютный каталог кэша. Proxy предоставляет `search_tools` и `call_tool`; для выполнения нужен hash schema из discovery. Это самостоятельный эксперимент FastMCP-style search/call на официальном MCP SDK, **не встроенный FastMCP**. Host видит meta-calls вместо Native identity каждого target tool; это не эквивалент стандартного per-target policy path. Не включайте proxy глобально как способ обойти policy.

## Откат и известные ограничения

1. Получите точные bundle/entry IDs и отключите этот bundle через Plugin Manager.
2. Верните eager MCP-запись, если ранее отключали её.
3. Откройте новую сессию. Штатный skill catalog вернётся без этого плагина; файлы кэша останутся неактивными данными.

Ограничения:

- Холодный глобальный MCP-поиск получает все неизвестные настроенные каталоги. Универсального query-filtered schema endpoint в протоколе нет; targeted server search сокращает лишний discovery.
- Штатный skill catalog consumer продолжает работать, но внешний prepend transformer после `next()` удаляет предложенное metadata-сообщение до admission. Более поздний сторонний prepend способен изменить этот порядок.
- Identity skill loader запоминается для scope chain, а не криптографически связывается с пакетом. Замена в том же scope закрывает discovery; совместимость с произвольным custom loader не заявляется.
- Bridge покрывает MCP **tools**, но не resource discovery, subscriptions и prompts. Отключение eager-клиента убирает и его resource namespace.
- Собственного frontend нет. Переводы inventory и оригинальная иконка включены; отрисовка GUI независимо в браузере не проверялась.

## Лицензия

MIT © 2026 pnpwin. Runtime integrations и сторонние лицензии перечислены в [UPSTREAM](<UPSTREAM.md>).
