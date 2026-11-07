# Verification log

## Dynamic headers compatibility 1.2.4 — 7 November 2026

- The user's exact `dynamic-config` symptom was not explained by the earlier stale-form fix. A read-only native probe compared authenticated HTTP and Tool snapshots: they matched, both editable. The Host/UI ownership hypothesis was therefore rejected.
- Shape-only public ConfigEditor inspection then established the actual Context7 condition: raw `headers` is a whole-map `!!js` expression, effective `headers` is an empty map. The old update guard rejected every such expression even when the requested Authorization target had no overlap. Expression text and credential values were not requested or returned.
- Reproduced before/after using real canonical Lazy Config schema, a Host + uiOnly composition, actual authenticated HTTP and native ConfigEditor on two isolated disabled synthetic servers. Before: normal first Save200, expression-backed second400 `dynamic-config`. After: both200 with bound refs in fresh runtime projection; raw expression preserved and effective headers remained empty. Fixture reset:true.
- Minimal guard now preserves an exact raw expression only for an already-resolved known plain/null-prototype map with no overlapping target. HTTP target matching is case-insensitive; env matching is exact. Active overlap, unknown shape, malformed expression markers and stale raw revisions still reject; no resolved values are copied to disk.
- Source/schema/HTTP/regression suite **138/138 passed**, build19 modules. Applied changed code through public native `hmr.runExclusive` + `reconcileProfile` for required entries: applied, pending0, warnings0, no process restart required. Linked package version1.2.4; existing entries and user bindings retained. Read-only production probe again matched HTTP/Tool and confirmed original Context7 expression shape remained untouched.
- Both disposable diagnostics were uninstalled and their owned source removed after fixture reset. Test-only metadata/artwork omission applies only to these discarded fixtures. No real token or user binding was written, no external MCP request was issued, and the actual post-fix owner Save remains for the user to perform. Verify is read-only; it cannot itself create a binding.

## Native second-save and verified-card correction 1.2.3 — 7 November 2026

- User reported Context7 still unbound after Save, with no visible outcome. Found an actual stale-form condition: the old per-instance HMAC key changed every server revision after any config restart, including untouched rows. Separately, save errors were page-top/offscreen and success trusted any valid GET instead of comparing persisted mappings.
- Reproduced through the running DSH's real authenticated HTTP carrier and native ConfigEditor using an isolated two-disabled-server fixture, synthetic reference names and no MCP client: first save200; second save using its original unchanged-row revision400 `config-changed`; fresh revision200. Both raw Loader config and fresh runtime projections were checked. This proves a failing lifecycle condition, not the exact unrecorded HTTP response of the user's earlier click.
- New module-private root-scoped WeakMap key with entry-ID/module-name HMAC domains keeps unchanged-row revisions stable across ordinary config restarts. Canonical raw serialization ignores object key ordering but preserves expressions/array order and rejects actual changed rows; roots/entries remain isolated. No key is exported or persisted.
- Re-ran the same native fixture against the new controller: original second-row revision now200; both rows bound in raw Loader config and active fresh projection. Fixture reset returned true, its bundle was uninstalled and owned source removed. No real token or user binding was written; discarded test-only fixture intentionally had no artwork/display metadata.
- Client now keeps pending/verifying/errors/success beside each submitting card. Success requires matching server, transport, destination, enabled flag, complete header/env mappings/prefixes and no target-pin mismatch. Failed saves preserve drafts. Explicit Verify/refresh is GET-only, does not replay POST, and resets confirmation when restoring a draft against a fresh snapshot.
- Fresh canonical Host/API/state entry modules prevent retaining old controller code in the running module cache; compatibility entry exports remain. Build19 modules, **131/131 tests passed**, including native-carrier fixtures, revision isolation, false-success refusal and sequential Firecrawl/Context7 UI logic.
- Local1.2.3 installed through Plugin Manager: `application: applied`, warnings[]. Live settings slot active. User Firecrawl binding retained; actual Context7 intentionally remains unbound until the owner saves in the refreshed UI. No real key-bearing MCP call or post-fix visual/browser submission was performed.

## Save feedback 1.2.2 — 7 November 2026

- Moved the generic page-top success text into a prominent theme-token success panel beside the matching server's Save bindings button. Includes a checkmark and server name, with one polite atomic status announcement; no token values are shown.
- Success still requires the matching POST acknowledgement and a successful GET reload. Page-owned state survives form remounts, edits of other servers do not dismiss it, and editing the saved server clears stale feedback.
- Build and **120/120 tests passed**, including location/localization/remount/error regressions. Updated the existing linked bundle and restarted it through Plugin Manager; `application: applied`, warnings[]. Live `lazy-mcp-auth` slot active; pre-existing server bindings preserved.
- Visual light/dark rendering and actual user-only browser save were not exercised; no browser control available. Refresh the connected page to load the new Client generation. Original display resources unchanged.

## HTTP transport correction 1.2.1 — 7 November 2026

- User-reported generic backend error traced to the plugin route contract: the 1.2.0 combined GET/POST route selected `requestBody: streaming`. The installed Connection bridge constructs streaming Requests with a body, which is invalid for GET/HEAD and fails before the plugin handler. Earlier handler-only unit tests and unauthenticated401 checks did not exercise this path.
- Split buffered GET `/api/lazy-discovery/auth` from bounded streaming POST `/api/lazy-discovery/auth/save`; native Connection rejects duplicate exact paths even when methods differ. Preserved32KiB streaming validation rather than buffering save bodies up to the carrier's larger default cap.
- Client now uses the new POST path and safely distinguishes access/route/non-JSON HTTP/timeout/network errors. It does not reflect raw error bodies or automatically retry a grant.
- Build validated16 source modules; **119/119 tests passed**. Added actual node:http carrier tests matching installed body construction, including an old-mode negative control, authenticated fixture GET, malformed/chunked oversized POST, confirmation checks and route teardown. These fixture tests are distinct from native runtime evidence.
- Installed local1.2.1 via Plugin Manager: `application: applied`, warnings[]. Actual authenticated HTTP check against the running DSH returned GET200 JSON with a valid2-server snapshot; POST `{}` to `/save` returned400 `invalid-request` without any grant; old POST path returned404. Served Client artifact returned200 and contains `/api/lazy-discovery/auth/save` (rev `ff0b138acc2b` at verification time).
- Native admission was obtained through the public Host Connection API inside a disposable, fixed-target, metadata-free diagnostic fixture. Authentication material remained only in Host memory; no cookie, launch URL, key or raw response body was emitted. Fixture was uninstalled and its owned source directory removed. Metadata/icon omission applies only to this discarded test fixture, not the delivered plugin.
- Existing user bindings remained unchanged. Actual successful browser form submission and real key-bearing MCP calls were not executed. Refresh the page to load the corrected Client artifact before retrying a save.

## Local credential integration 1.2.0 — 7 November 2026

- Installed local `@pnpwin/dsh-lazy-discovery` 1.2.0 and compatible `@pnpwin/dsh-token-vault` 1.0.2 through Plugin Manager. Both returned `application: applied`, warnings[]. No profile manifest/patch was hand-edited; no GitHub release was published.
- Final Lazy build validated 15 source modules and distribution resources; **111/111 tests passed**. Separate Vault syntax checks and **14/14 tests passed**.
- New coverage includes names-only settings projections; preserving raw config expressions with stale-revision/destination-pin checks; user-only grants; optional Vault suggestions/manual references; missing provider/value isolation; HTTP/stdio SDK fixtures; memory-only ref catalogs; provider loss/rotation and late connection/discovery responses; all-Agent registration removal; no business replay; credential-reflection refusal.
- Live `lazy_mcp_auth_status` returned the original two server names, both editable, with no automatically assigned references. The core credentials provider is available. Only names/configured state are projected; values were not requested.
- Live `discovery_status` immediately after install showed zero connections, discoveries and business calls for both servers, proving installation did not eagerly connect.
- Live Client Inspect confirmed additive settings slot `lazy-mcp-auth`, order 36, active beside the existing Vault settings section. Rendered light/dark appearance and actual browser form submission remain unverified; hook tests do not substitute for visual verification.
- The authenticated authorization endpoint rejected an unauthenticated request with401 and a foreign Origin with403. Owner writes are not exposed as model tools.
- The existing original icon was opened; new root and Host locale resources remain packaged. User credentials, real authenticated MCP calls and per-server grants were not used for testing or modified automatically.
- Historical prompt-token/context comparisons below remain 1.1.0 observations. New 1.2.0 provider prompt-token measurements were not run.

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
