# Upstream, attribution and licenses

This repository is an independent, opt-in DeepSeek Harness plugin maintained by **pnpwin**. It is not an official DeepSeek, Anthropic, MCP or FastMCP distribution and does not imply endorsement by those projects.

Project code: **MIT © 2026 pnpwin**. See [LICENSE](<LICENSE>).

## Runtime integrations and dependencies

| Upstream | Use in this project | License / provenance |
|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Host plugin composition, native Tool definitions/execution, Session projections, working-directory and skill registries. Compatibility target: DSH 0.2.2-rc.1. | MIT. Official installed package metadata was checked for the runtime integrations. |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | Official client/server SDK for lazy MCP transport, discovery, native calls, test fixtures and the opt-in proxy. Direct packages: `@modelcontextprotocol/client` and `@modelcontextprotocol/server`, version 2.2.0. | MIT; package metadata credits Anthropic, PBC. |
| [Zod](https://github.com/colinhacks/zod) | Typed runtime validation for Session projection state and SDK-facing data. Direct dependency: 4.4.3. | MIT; package metadata credits Colin McDonnell. |

The authoritative direct dependency versions are in [package.json](<package.json>); the committed lockfile, when present, fixes the transitive dependency graph. Transitive dependencies retain their own licenses. This file is an attribution guide, not a claim that every installed transitive package has the same license.

### DSH module identity

The plugin reuses the **running Host's** DSH modules instead of shipping a second DSH scope/service registry. Runtime resolution and native MCP output adaptation live under [src](<src/>). Native MCP public naming, canonical result handling, lifecycle events and stock skill-catalog behavior follow the installed DSH contracts inspected during development.

No DSH application installation, credentials or profile directory is copied into this repository or package. DSH remains a separately installed runtime governed by its own license. Compatibility with other versions is not asserted merely because imports resolve.

### MCP and FastMCP

The normal Host path exposes selected operations as individually named native DSH tools. The experimental proxy implements a small search/call surface using the **official MCP SDK**. Its design is informed by progressive discovery patterns such as [FastMCP](https://gofastmcp.com/), but **no FastMCP implementation is vendored or required**. “FastMCP-style” describes that interface pattern only; it is not a compatibility certification or upstream performance claim.

Protocol reference: [Model Context Protocol](https://modelcontextprotocol.io/). MCP discovery is not itself execution authorization. This project does not adopt broad claims that one protocol is inherently secure or insecure; deployment trust, permissions, transport handling and individual tool effects still matter.

## Original assets and local implementation

The project inventory icon and English/Russian display resources are project assets, not copied upstream logos. The search, bounded cache, replay-selection adapter and integration tests are local implementation. Any upstream license notices present in redistributed dependencies must be retained; dependency names and trademarks remain those of their respective owners.

## Benchmark provenance and publication boundaries

The context-comparison table records a local controlled four-variant DSH experiment, not an upstream benchmark result. Its public report is [docs/context-comparison.md](<docs/context-comparison.md>), with sanitized observations in [test/fixtures/context-benchmark.json](<test/fixtures/context-benchmark.json>). The offline report helper is [src/benchmark.mjs](<src/benchmark.mjs>).

- Values are provider-reported **first-request input tokens** for one model/route, not JSON-byte or character-density estimates.
- Recomputing the report does not make live provider/MCP requests and does not reproduce the original provider run.
- Raw prompts, session IDs, private catalogs, local absolute paths, credentials and transcripts are deliberately excluded from the public artifacts.
- Reductions in initial context are not claims about billing, latency, complete-task success or another deployment.

Historical checks and their limits are recorded in [docs/VERIFICATION.md](<docs/VERIFICATION.md>). See [README](<README.md>) or [README на русском](<README.ru.md>) for operation and rollback.
