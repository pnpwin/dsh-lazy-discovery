# DSH Lazy Discovery

**Lazy MCP tool schemas and task-focused skill discovery for DeepSeek Harness.**

[GitHub](https://github.com/pnpwin/dsh-lazy-discovery) · [Русский](<README.ru.md>) · [Upstream and licenses](<UPSTREAM.md>) · [Verification notes](<docs/VERIFICATION.md>)

Package: `@pnpwin/dsh-lazy-discovery` · version: **1.2.4** · compatible runtime: **DSH 0.2.2-rc.1**.

This opt-in Host plugin keeps large catalogs outside the initial model context. It preserves DSH's stock `skill` loader, direct `/name` skill invocation, and normal native tool execution. It does not increase the model's context-window limit and is not a security sandbox.

## Agent workflow

| Tool | Purpose |
|---|---|
| `skill_search({query, limit?})` | Search model-invocable skill summaries for the current Agent scope and working directory. |
| `skill({name})` | Load the exact full instructions through the unchanged stock DSH loader. |
| `mcp_tools_search({query, server?, limit?})` | Search configured MCP catalogs; return bounded metadata cards and exact IDs, not every schema. |
| `mcp_tools_load({ids})` | Commit the selected IDs; their native schemas become available on the **next step**. Does not execute the tools. |
| `discovery_status({})` | Report cache, connection and registration state plus explicitly labeled JSON-byte measurements. |

Example sequence:

```text
skill_search({query: "create an Excel workbook"})
skill({name: "office-xlsx"})

mcp_tools_search({query: "scrape a web page", server: "firecrawl"})
mcp_tools_load({ids: ["<exact ID returned by search>"]})
# On the next step, invoke the exact native tool normally.
```

Search supports Unicode text, English/Russian aliases, exact-name boosts and empty results for no match. It is lexical retrieval, not an embedding model or a guarantee that every relevant skill/tool will be found. Rephrase, narrow the query or select a server when necessary. Incomplete discovery is reported separately from confirmed absence. User-named skills can still be loaded directly; do not load a directly injected `<skill_content>` twice.

## Installation

Install the pinned GitHub release through Plugin Manager:

```json
{"action":"install_bundle","target":"github:pnpwin/dsh-lazy-discovery#v1.2.4"}
```

For an existing installation, use Plugin Manager to remove the previous bundle before installing this source; keep the same profile and patch IDs so existing settings remain addressable. Do not hand-edit profile files. The older `v1.1.0` release does not contain the credential-binding UI.

Pin a reviewed commit or release tag when reproducibility matters. Installation changes the active profile and may require approval. Read the returned `application`, `warnings` and `nextStep`; a resolved package alone does not prove that the plugin is active. Do not bypass an incompatible-runtime check.

The shipped configuration connects to the **keyless Firecrawl MCP endpoint** on first discovery, not during bundle startup. No API key is supplied by this project. The external service's current rate limits, availability and usage charges still apply.

### Avoid duplicate eager connections

Installing this bundle does **not** silently disable an eager MCP entry owned by your profile. List entries with Plugin Manager, obtain their exact identifiers, and disable the corresponding eager client only after the lazy bundle applies successfully. Two enabled clients for the same public namespace can conflict; even when they do not, they defeat the intended context comparison.

The entry patch ID remains `local-lazy-discovery` for compatibility. When migrating from the local `@local/dsh-lazy-discovery` prototype, do not keep both bundles enabled: disable/remove the old bundle as part of the migration. Use Plugin Manager rather than hand-editing profile manifests or patches.

Start a **fresh session** to inspect a clean initial context. Existing history can contain previously admitted catalogs; the plugin retires their names with a compact replacement but cannot erase past provider requests.

## Named MCP credentials

Version 1.2.4 adds independent native credential references and owner-only per-server authorization settings. Save feedback is shown beside the selected server; success is confirmed against the reloaded bindings. Failed drafts are preserved, and Verify/refresh is GET-only: it never retries a grant. Refresh the page after upgrading.

Whole-map `!!js` headers/env expressions are preserved when their resolved maps do not overlap the new targets. Resolved values are never materialized in saved config; overlaps or unknown generated maps fail closed. The release suite contains **138 passing tests**; native HTTP/config-reload verification and its limits are recorded in [Verification notes](<docs/VERIFICATION.md>).

Open **Settings → MCP authorization**. Each configured server has its own form: enable/disable the server, select Bearer/custom HTTP headers or stdio environment mappings, enter a credential name and explicitly authorize that destination. No secret-value input exists here. Endpoint/executable changes are made in the normal MCP configuration, not this page.

If Token Vault is enabled, the page optionally reads its authenticated names-only API for suggestions. Without Vault, enter a reference manually. The core DSH credentials provider resolves stored values first, then launch environment and dotenv fallbacks. Changing the launch environment generally requires restarting DSH. Disabling Vault does not delete native credentials or stop Lazy. Without any credentials provider, literal/keyless servers and skills still work; only configured reference-backed servers are unavailable.

Example **server configuration**, not a secret value:

```yaml
serverName: firecrawl
transport: streamable-http
url: https://mcp.firecrawl.dev/v2/mcp
headerRefs:
  Authorization:
    name: FIRECRAWL_API_KEY
    prefix: 'Bearer '
```

The same remote bearer mapping works with `CONTEXT7_API_KEY` and the Context7 endpoint. For local trusted processes:

```yaml
serverName: local-service
transport: stdio
command: /absolute/path/to/trusted-mcp-server
args: []
envRefs:
  SERVICE_API_KEY: SAVED_SERVICE_TOKEN
```

- Only named bindings reach that server. Nothing exports all stored tokens or changes global `process.env`. No hard dependency on the Vault package, its marker format or its UI exists.
- `headerRefs` is HTTP-only, `envRefs` is stdio-only. Names are POSIX identifiers up to 128 characters; `DSH_*` and prototype names are reserved. At most 32 mappings per server. Header prefixes are **public, non-secret** text, up to 256 characters; never paste a token there.
- Conflicting literal `headers/env` require explicit replacement in the UI. Only overlapping targets are removed; unrelated raw config, including YAML expressions, is preserved through native Config Editor.
- UI grants store a `credentialTarget` fingerprint pinning the exact endpoint or executable/args/cwd. A later destination change blocks those bindings until explicitly acknowledged again. Manually authored refs without a pin remain supported as owner-authored configuration.
- `enabled: false` disables that server; clearing reference mappings alone preserves pre-existing literal configuration. Removing a stored credential is **not** remote revocation and may reveal an environment/dotenv fallback. Disable the server to prevent new calls regardless of fallback.
- Required missing values fail closed; there is no automatic keyless downgrade or stale-token fallback.
- Credentials are rechecked for operations, including cached discovery/restore. Reference changes invalidate only affected server generations, cancel old transport work, remove stale registrations and clear memory metadata. Reconnection is lazy. Unrelated servers and skills keep working.
- Ref-backed catalogs use **memory cache only**: no disk cache reads or writes. A new auth generation must obtain a fresh catalog before selection hints can restore matching schemas. Literal/keyless caching remains unchanged.
- Bearer transport uses the SDK token provider, generation-pinned HTTP requests and `redirect: error`. No automatic business-call replay on 401/403, credential changes or uncertain outcomes. stdio credentials require replacing the process. A connection close cannot undo an action already accepted remotely.
- Reflected exact secret strings in discovery metadata or call results are rejected before model publication. This is not DLP for encoded/transformed values and not isolation from trusted MCP recipients or same-user OS processes. Native local DSH credentials are not encrypted by this integration.

`lazy_mcp_auth_status({})` exposes the same names/status projection as the page, without opening network connections or returning values. Grant/change operations are owner-only UI actions, not agent tools. The native owner API has the same authority as the authenticated page; this is not an OS user-presence boundary.

The bundle includes a `/host` engine row and a package-root `uiOnly` row for browser discovery. Headless/native discovery remains functional without the settings page or `connection` service. The optional Vault suggestion endpoint is `GET /api/token-vault/list` and is treated as unavailable on missing/failed responses.

The historical context-token measurements below describe release 1.1.0, not this added UI/status-tool release. They must not be advertised as fresh 1.2.0 provider measurements.

## Configuration and architecture

The bundle's [patch](<cordis.patch.yml>) supplies a portable cache path using `dshHomePath('cache/lazy-discovery')`. Configurable fields include:

| Field | Meaning |
|---|---|
| `cacheDirectory` | Absolute private cache directory; supplied portably by the bundle patch. |
| `cacheMaxAgeMs` | MCP catalog freshness window; default 1,800,000 ms. |
| `skillMaxAgeMs` | Warm in-memory skill catalog lifetime; default 60,000 ms. |
| `servers` | Explicit trusted MCP server configurations; use an empty list for skills-only use. |

Servers use `serverName`, `transport` (`streamable-http` or `stdio`), and the matching endpoint or command fields. HTTPS is supported; plain HTTP is restricted to loopback. Treat configured stdio commands, environment overrides and remote endpoints as trusted deployment configuration. A cold search can start a configured stdio process even though no business tool is called.

Runtime, CLI and build/report code lives under `src/`; [tests](<test/>) and [localized resources](<locale/>) stay in their own resource directories. The package root and `/host` exports resolve to the same runtime entry. DSH modules are resolved from the running installation rather than installed as duplicate scope/service packages. This integration is version-sensitive and currently targets only the declared DSH release.

### Cache and execution boundaries

- Private cache directory/file permissions are 0700/0600 where supported; writes are bounded, versioned and atomic.
- Raw headers, environment/transport configuration and skill instruction bodies are not persisted. Upstream tool descriptions, schemas and instructions can still be sensitive; protect the cache accordingly.
- Skill disk hints never authorize another scope or replace fresh scoped discovery after a process restart. Warm views are keyed by Agent identity, scope chain, working directory and invalidation revision.
- MCP cached schemas are hints. Before upstream execution, the connection/current schema is checked against the selected schema hash. A changed or removed tool requires search/load again.
- Committed paired `mcp_tools_load` call/result events reconstruct selection through a Session projection. No custom session-event types or permanent “body already loaded” flags are introduced. Restore does not connect merely to open a Session; a cache miss requires explicit discovery.
- A load selects at most eight tools; a Session retains at most 64 selections. Loading is **not execution authorization**. Named native calls continue through DSH's existing guards, approval and permission pipeline.
- Calls with possibly completed side effects are not automatically retried after uncertain transport failures.

## Measured initial-context comparison

**Provider-reported input tokens, 7 November 2026:**

| Configuration | First-request input tokens | Share of 500,000-token window | Reduction vs eager/eager |
|---|---:|---:|---:|
| Eager MCP + eager skill summaries | 14,469 | 2.89% | — |
| Lazy MCP only | 10,350 | 2.07% | 4,119 / 28.47% |
| Lazy skills only | 13,540 | 2.71% | 929 / 6.42% |
| Lazy MCP + lazy skills | 9,407 | 1.88% | 5,062 / 34.99% |

The [comparison report](<docs/context-comparison.md>) and [sanitized observations](<test/fixtures/context-benchmark.json>) document these measurements. The offline [report helper](<src/benchmark.mjs>) recomputes the saved table without live API calls.

### Method and limits

Four fresh isolated Agents used the same `cordis` preset, model `gpt-6.1-sol`, provider `openai-codex`, high reasoning effort and identical minimal no-tool task. Each returned the same short answer, made no tool calls and reported five output tokens. The figures above are the first successful `assistant/message.usage.inputTokens` reported by the provider—not characters divided by four, offline BPE estimates, JSON bytes, or billed-cost estimates.

Controls: **50 common native tool schemas** matched by content, **one MCP server / three Firecrawl tools**, **20 model-invocable skills**, the same route capacity, and matching common system/runtime text. Dynamic quota and diagnostic status tools were excluded from every variant. MCP resources were equally excluded. Lazy MCP included its two search/load schemas and routing text; lazy skills included `skill_search` and routing text. Bootstrap overhead was included, not ignored.

“Eager skills” means the exact stock initial **name + description catalog**, with its 500-character cap and escaping—not eager loading of all instruction bodies. No bodies were loaded in any variant. Small non-additivity between the two effects comes from shared routing text/serialization.

These are one controlled first-request comparison, **not** a multi-model benchmark, latency result, task-success evaluation or billing guarantee. Search results, loaded schemas, instruction bodies and extra turns add later context; prompt-cache behavior and total task costs may differ. Lazy discovery leaves the 500,000-token capacity unchanged. Public benchmark artifacts must contain only sanitized summaries, not raw prompts, local paths, session IDs, credentials or complete transcripts.

## Development and verification

Use a Node.js version supported by the target DSH installation. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm test
pnpm run benchmark:report
```

The build validates the package/source layout; the report command works from sanitized measurements and is not permission to run paid provider calls. Release 1.1.0 passed **67 tests**: 64 implementation tests plus three distribution/benchmark regression tests. The local 1.2.0 integration passed **111 tests**, including credential lifecycle and UI/controller regressions. The current `pnpm test` output remains authoritative. Coverage includes real official-SDK stdio/proxy negotiation, metadata bounds, private cache/reinitialization, scope/cwd changes, incomplete discovery, cancellation, notification races, committed selection, replay and skill-catalog ordering.

Separately, live DSH checks verified lazy native registration, one read-only native MCP call, zero-connection warm cached searches after bundle reload, a fresh Agent without the full skill catalog, and loading one exact skill through the stock loader. This does not certify a full OS restart, interactive approval UI, negative guard-denial cases or every provider/model. See [verification notes](<docs/VERIFICATION.md>).

## Experimental MCP proxy

Not enabled by the Host bundle:

```bash
node src/proxy.mjs --experimental --config=/absolute/path/to/config.json
```

An explicit nonempty `allowTools` list and absolute cache directory are required. The proxy exposes `search_tools` and `call_tool`; execution requires the returned schema hash. It is an independent FastMCP-style search/call experiment built with the official MCP SDK, **not vendored FastMCP**. A Host sees meta-calls rather than each target's native tool identity, so it is not equivalent to the default per-target native-policy path. Do not enable it globally as a policy shortcut.

## Rollback and known limitations

1. List bundles/entries to obtain exact IDs; disable this bundle with Plugin Manager.
2. Re-enable the eager MCP entry you previously disabled, if any.
3. Start a fresh session. Stock skill catalogs resume without this bundle; private cache files remain inert.

Known limits:

- Cold global MCP search discovers every unknown configured catalog. The protocol does not offer a universal query-filtered schema endpoint; targeted server search reduces unrelated discovery.
- Stock skill catalog consumers still run, but a prepend post-`next()` transformer removes their proposed metadata before admission. A later third-party prepend transformer can override this ordering.
- Skill-loader identity is remembered per scope chain, not cryptographically tied to package ownership. A same-scope replacement fails closed; arbitrary custom-loader compatibility is not claimed.
- The bridge covers MCP **tools**, not MCP resource discovery, subscriptions or prompts. Disabling an eager client also removes any resource namespace it supplied.
- The optional localized MCP authorization page is included. Inventory resources and the original icon remain packaged. Browser-rendered visual verification must be reported separately from registration and unit tests.

## License

MIT © 2026 pnpwin. See [upstream notices](<UPSTREAM.md>) for runtime integrations and third-party licenses.
