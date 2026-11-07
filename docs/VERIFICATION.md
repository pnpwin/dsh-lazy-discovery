# Verification log

## GitHub release 1.1.0

- Runtime, CLI, build and benchmark helpers now live under `src/`; `test/` and `locale/` remain in place.
- Clean frozen-lockfile dependency installation completed with lifecycle scripts disabled.
- Build validated 12 source modules, both Host exports, portable patch, icon, locales and distribution metadata.
- Final release suite: **67/67 PASS** (64 original behavior tests plus three distribution/benchmark regressions).
- Offline benchmark report recomputed the sanitized provider observations without network/model calls. The controlled token comparison is documented in [the report](<context-comparison.md>).
- Historical local-runtime checks below describe the prototype before the packaging-only migration. New GitHub installation validation is reported separately when performed.

## Before installation

- Ordered stage1 native tests: 2/2 PASS.
- Ordered stage2 persistent-cache/connect-on-first-use tests: 4/4 PASS.
- Stage3 actual SDK stdio echo + experimental proxy: 3/3 PASS.
- Skills tests:18/18 PASS (full bodies excluded, exact scope/cwd, incomplete, invalidation, stock /name, waterfall ordering).
- Search/private disk cache tests:19/19 PASS.
- Race regression tests:13/13 PASS.
- Paired-event projection tests:2/2 PASS.
- Full suite at review:63/63 PASS; final suite includes a real stdio experimental-proxy CLI process test, bringing the total to64/64 PASS. Independent teammate reviewed and reproduced notification, taskSupport hash, teardown and cancellation races; fixes now have regression coverage.

## Live DSH verification — 7 November 2026

- Installed bundle `@local/dsh-lazy-discovery` version1.0.0; active entry `include:local-lazy-discovery` loads `/host`. Final `set_bundle enabled:true` returned `application: applied`, warnings[]. Live Config inspection confirmed the schema and resolved package directory.
- First import attempt failed because workspace Node resolution did not inherit DSH's ASAR dependencies. Fixed by resolving canonical Host modules through the Desktop installation anchor, avoiding duplicate scope/service instances. A fresh Host subpath was used; the profile applied it successfully. No application files or profile files were hand-edited.
- Original eager `include:mcp-firecrawl` disabled through Plugin Manager, `application: applied`; live Config status now inactive. Rollback re-enables that row and disables this bundle.
- Cold live MCP search discovered3 Firecrawl tools and did not register them natively. A load committed exactly one tool ID; the following step exposed only `mcp__firecrawl__firecrawl_scrape`.
- One native Firecrawl scrape of a harmless public page succeeded (HTTP200,1 Firecrawl credit). No credential imported; no side effects beyond this read-only request.
- Disabled/re-enabled this bundle to test teardown/reinitialization and log-derived restore. The single selected native tool restored from the Session projection; catalogSource=disk, connections=0, discoveries=0,calls=0. Warm metadata search left connection counters zero.
- Live skill search `создать таблицу Excel` returned `office-xlsx` plus matching metadata. Nonsense query returned empty. No full instruction bodies are included by search.
- A brand-new independent Agent confirmed search guidance only, no full skill catalog in its initial context; event search found zero committed stock full-catalog messages. It had0 active MCP tools (did not inherit the parent's loaded scrape), disk catalog3,0 connections/discoveries/calls. Skill search returned2 metadata cards and warmed catalog count0→20.
- In that same fresh Agent, exact `skill_search(agent-experience)` returned metadata only; a single subsequent stock `skill(agent-experience)` returned canonical `<skill_content>`. No other bodies were loaded and MCP counters stayed zero.
- Private on-disk cache inspection: directory0700, all3 observed files0600. Manifest packed entries all exist. Original PNG icon was opened/checked; installed locale/icon resources exist. Rendered GUI inventory appearance is not independently browser-verified.

## Measured JSON bytes (not tokens)

| Surface | Before selection | After loading one scrape tool |
|---|---:|---:|
| All3 known MCP schemas, hypothetical eager |20,070|20,070|
| Actual native MCP schemas after eager row disabled |2 (`[]`)|7,370|
| Four discovery control schemas |1,388|1,388|
| Full20 skill names/descriptions, old eager catalog component |4,828|not injected upfront|

These are serialized JSON UTF-8 bytes, not provider prompt tokens, cache billing or total request sizes. Bootstrap/search results/loaded bodies add their own cost. Only known catalog coverage was compared. No percentage billing claim is made.

## Verification limits

- The original64 automated tests include fake scoped registries plus actual official SDK stdio/proxy negotiation; live DSH native registration/call and fresh Agent behavior were separately checked. Packaging/benchmark regression tests were added for the GitHub release.
- Negative guard-denial and interactive approval UI were not exercised in the live profile. Execution delegates the unchanged Native pipeline; no bypass dispatcher was introduced.
- Full OS-process restart was not forced. Cache reinitialization/live bundle reload and unit resume/fork folds were tested; no claim of complete production recovery certification.
- `/name` preservation is covered by18 adapter tests; stock loader implementation was not modified. Existing conversation history can still contain earlier full catalogs. Start a new session to measure a clean prefix.
- The FastMCP-style proxy is implemented and tested but remains opt-in, not globally enabled. MCP resources are outside this initial tool-only bridge's live coverage.
