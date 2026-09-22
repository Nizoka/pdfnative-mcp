---
description: "Use when editing MCP transport, tool registration, JSON schemas, or request/response handling."
applyTo: "src/server.ts,src/tools/**,src/cli.ts,src/*.ts"
---
# MCP Server Standards

## Transport and lifecycle
- stdio transport by default; Streamable HTTP when `PDFNATIVE_MCP_PORT` is set (loopback bind + Host/Origin guard; opt-in bearer token via `PDFNATIVE_MCP_HTTP_TOKEN`, see `src/auth.ts`).
- SDK: `@modelcontextprotocol/server` ^2.0.0 (MCP 2026-07-28, automatic 2025-era fallback).
- Gracefully close the server on SIGINT/SIGTERM; stdin EOF ends the stdio server with exit 0.
- **stdout is the JSON-RPC channel.** Never `console.log` in `src/` — logs go to stderr. The gate's `smoke` and `dist-probe` steps fail on a stray stdout line.

## Tool contract
- Each tool module exports:
  - `TOOL_NAME`, `TOOL_INPUT_SCHEMA`, optional `TOOL_OUTPUT_SCHEMA`
  - `handler(args: unknown)`
- Keep JSON schema and Zod validation aligned; Zod schemas are `.strict()` (unknown top-level or nested keys → `VALIDATION_ERROR`, matching `additionalProperties: false`). Build both from the same constants where you can (`src/color.ts`, `src/typography.ts`, `src/pdfx.ts`).
- Decode `pdfBase64` / DER / ICC inputs through `src/base64.ts` (data: URI tolerated; PEM-vs-DER, double-encoding and empty-payload hints). `Buffer.from(x, 'base64')` never throws — do not rely on it to validate.
- Return tool-level errors as `isError` responses with actionable messages — never throw across the MCP boundary. The one protocol-level exception: an unknown tool name on `tools/call` is a JSON-RPC `-32602` error with message `[UNKNOWN_TOOL] Unknown tool: <name>`.
- **Every failure carries a `ToolError` code.** pdfnative parses lazily, so a damaged PDF can throw from any accessor after `openPdf()`; `classifyUnexpected()` in `src/server.ts` reports whatever escapes a handler as `PDF_PARSE_FAILED`. Map the failures you expect yourself; the net is the last line, not the first.
- Every tool registered in `src/server.ts` must ship `_meta.apiVersion` (current `TOOL_API_VERSION`, see `docs/API_STABILITY.md`) and one or two executable `_meta.examples` (they are validated against `inputSchema` in tests; more examples belong in `examples/*.json`).
- `tools/list` structure is pinned by `tests/_fixtures/tool-shape.json` (`tests/catalogue-parity.test.ts`, gate step `verify:tool-shape`). Wording is free; any change to types, enums, defaults, constraints, `required`, `additionalProperties` or example count needs `npm run build && npx tsx scripts/tool-shape.ts --write` and a review under `docs/API_STABILITY.md` §5. `tests/catalogue-superset.test.ts` additionally rejects any removal / narrowing against the frozen 1.5.0 fixture (`tests/_fixtures/tool-shape.v1.5.0.json`); widening a plain schema into `anyOf` is accepted only when a member still accepts every published value.
- No `$ref` / `$defs` and no `$schema` keyword in input schemas (host compatibility); shared fragments are therefore inlined in every tool — keep their descriptions terse (`tools/list` ≈ 305 kB) and put the long form in a prompt or a guide.
- Update `SERVER_INSTRUCTIONS` (decision tree + pitfalls) and the relevant prompt whenever you add a tool or change its behaviour.

## Engine surface
- Thin, faithful wrapper: expose what pdfnative does, do not reimplement it on raw primitives, and say what a result does NOT establish (`validate_pdf` `caveats[]`).
- `strict` is classified HERE, by diagnostic code (`escalate()` in `src/diagnostics.ts`): `PDFA_*` → `PDF_A_COMPLIANCE_VIOLATION`, `PDFX_*` → `PDF_X_COMPLIANCE_VIOLATION`, other → `DIAGNOSTIC_ESCALATED`. It is never forwarded to the engine.
- A colour reaches the engine through `toEngineColor()` (`src/color.ts`): the engine reads a bare three-number tuple as 0–255.
- Moving the `pdfnative` pin means adopting the release: extend `tests/_fixtures/engine-surface.json` in the same change (CONTRIBUTING.md §Bumping the engine pin).

## Safety
- Never trust tool arguments — validate at the boundary with Zod.
- Validate size limits and enum boundaries. Current bounds: 50 MiB output, 24 MiB decoded images per call (`ImageByteBudget`, `src/image.ts`; 12 M base64 chars per inline `image` block / watermark image — `embed_image.imageBase64` stays unbounded, 1.5.0 contract), 8 MiB watermark image and ICC profile, 100 000-char `svg` data, 50 000 engine blocks after newline splitting, 256 MiB stdio frame / HTTP body.
- Operator knobs are read once at boot and an invalid value refuses to start: `PDFNATIVE_MCP_MAX_INFLATE_BYTES` (`src/inflate-cap.ts`), `PDFNATIVE_MCP_CREATION_DATE` / `SOURCE_DATE_EPOCH` (`src/reproducible.ts`). Never from a tool argument.
- Keep output bounded (50 MiB cap) and deterministic when possible; any call carrying `encrypt` is never cached, and the cache namespace carries the pinned creation instant.
- Shared fragments live in `src/layout.ts` (layout + `typography` + `encrypt`), `src/print.ts`, `src/pdfx.ts`, `src/color.ts`, `src/blocks.ts`, `src/table.ts`, `src/barcode.ts`, `src/form.ts`, `src/image.ts`, `src/watermark.ts` — a dedicated tool and its inline block must validate and render identically.
- Never echo key material in error messages or stderr.

## Compatibility
- Keep tool names stable across patch releases.
- Follow `docs/API_STABILITY.md` for `_meta.apiVersion` bump rules.
- Default responses stay byte-identical; a byte change inherited from the engine is declared in `docs/API_STABILITY.md` §5 and the release notes (Upgrade section), and re-anchors the sample baseline.
