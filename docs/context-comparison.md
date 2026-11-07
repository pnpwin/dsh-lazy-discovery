# Context-footprint comparison

Measured on 7 November 2026 with DSH 0.2.2-rc.1, `openai-codex` / `gpt-6.1-sol`, reasoning effort `high`.

## Method

1. Use four **fresh** Agents with the same mounted `cordis` preset and identical short user task requiring no tools.
2. Hold 50 common native-tool schemas constant. Check exact schema equality, identical common system text and identical runtime context—not only tool counts.
3. Compare eager/lazy MCP × eager/lazy skills. There are three Firecrawl MCP tools and 20 model-invocable skills. Eager MCP includes server instructions. Eager skills includes the stock initial name/description catalog, normalization, 500-character cap and XML escaping; it does **not** load all instruction bodies.
4. In lazy variants, count discovery schemas and routing/bootstrap instructions too. Select no MCP tool and load no skill body before the first request. Exclude diagnostic `discovery_status`, dynamic `quota_status` and MCP resources equally from all four variants.
5. Deny tool execution in the isolated measurement scopes. All responses were identical, with zero tool calls and five provider output tokens each.
6. Read the first completed `assistant/message.usage.inputTokens` and `request/context.contextWindow`. These are provider-reported input counts, **not** the DSH characters/4 heuristic or JSON byte counts.
7. Reject runs with a different preset/scope, skill count, common schemas, model, capacity, prompt or feature state. Pilot runs with inconsistent tool availability/scope were discarded. Remove the temporary measurement bundle after collection; do not toggle production discovery globally.

## Observed input tokens

| Variant | Input tokens | Context occupancy | Saved vs eager |
|---|---:|---:|---:|
| Eager MCP + eager skill catalog | 14,469 | 2.89% | — |
| Lazy MCP only | 10,350 | 2.07% | 4,119 / 28.47% |
| Lazy skills only | 13,540 | 2.71% | 929 / 6.42% |
| Both lazy | 9,407 | 1.88% | 5,062 / 34.99% |

The recorded capacity stays **500,000 tokens**. Lazy discovery frees input budget; it does not enlarge the model's context window. Combined savings are 1.01 percentage points of that total capacity. If the other lazy feature is already enabled, MCP saves 4,133 tokens and skills saves 943. Effects are slightly non-additive because routing preambles are shared.

## Recalculate the published observations

Run `pnpm run benchmark:report`. It reads the [sanitized fixture](<../test/fixtures/context-benchmark.json>) through the [offline analysis helper](<../src/benchmark.mjs>). It recomputes the arithmetic and makes **no model or MCP request**. Distribution tests verify the exact differences and reject incomplete/duplicate/invalid observations.

To reproduce live measurements, collect a new four-way set in the target profile using the controls above. The saved fixture is an observation, not a promise that another model, profile, catalog size or DSH version produces identical token counts. Raw session prompts, private local paths, account data and session IDs are intentionally not published.

## Limits

This measures initial request footprint, before search/load histories accumulate. Selected schemas, search results and loaded instruction bodies consume context later. More discovery round trips can trade a smaller prefix for additional latency. Do not infer the same percentage reduction in total task cost, provider billing, cached-input charges or latency. The earlier JSON schema byte measurements are a separate diagnostic, not a tokenizer.
