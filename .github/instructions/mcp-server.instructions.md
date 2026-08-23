---
description: "Use when editing MCP transport, tool registration, JSON schemas, or request/response handling."
applyTo: "src/server.ts,src/tools/**,src/cli.ts"
---
# MCP Server Standards

## Transport and lifecycle
- stdio transport by default; Streamable HTTP when `PDFNATIVE_MCP_PORT` is set (loopback bind + Host/Origin guard; opt-in bearer token via `PDFNATIVE_MCP_HTTP_TOKEN`, see `src/auth.ts`).
- SDK: `@modelcontextprotocol/server` ^2.0.0 (MCP 2026-07-28, automatic 2025-era fallback).
- Gracefully close the server on SIGINT/SIGTERM.
- Avoid writing to stdout except MCP protocol payloads (use stderr for logs).

## Tool contract
- Each tool module exports:
  - `TOOL_NAME`, `TOOL_INPUT_SCHEMA`, optional `TOOL_OUTPUT_SCHEMA`
  - `handler(args: unknown)`
- Keep JSON schema and Zod validation aligned; Zod schemas are `.strict()` (unknown top-level or nested keys → `VALIDATION_ERROR`, matching `additionalProperties: false`).
- Decode `pdfBase64` / DER inputs through `src/base64.ts` (data: URI tolerated; PEM-vs-DER, double-encoding and empty-payload hints).
- Return tool-level errors as `isError` responses with actionable messages — never throw across the MCP boundary. The one protocol-level exception: an unknown tool name on `tools/call` is a JSON-RPC `-32602` error with message `[UNKNOWN_TOOL] Unknown tool: <name>`.
- Every tool registered in `src/server.ts` must ship `_meta.apiVersion` (current `TOOL_API_VERSION`, see `docs/API_STABILITY.md`) and one or two executable `_meta.examples` (they are validated against `inputSchema` in tests; more examples belong in `examples/*.json`).
- `tools/list` structure is pinned by `tests/_fixtures/tool-shape.json` (`tests/catalogue-parity.test.ts`). Wording is free; any change to types, enums, defaults, constraints, `required`, `additionalProperties` or example count needs `node scripts/tool-shape.mjs --write` and a review under `docs/API_STABILITY.md` §5. `tests/catalogue-superset.test.ts` additionally rejects any removal / narrowing against the frozen 1.5.0 fixture (`tests/_fixtures/tool-shape.v1.5.0.json`).
- No `$ref` / `$defs` and no `$schema` keyword in input schemas (host compatibility); the 13-kind block union is therefore repeated in `inspect_layout` by design.
- Update `SERVER_INSTRUCTIONS` (decision tree + pitfalls) whenever you add a tool or change its behaviour.

## Safety
- Never trust tool arguments — validate at the boundary with Zod.
- Validate size limits and enum boundaries. Current bounds: 50 MiB output, 24 MiB decoded images per call (`ImageByteBudget`, `src/image.ts`; 12 M base64 chars per inline `image` block / watermark image — `embed_image.imageBase64` stays unbounded, 1.5.0 contract), 8 MiB watermark image, 100 000-char `svg` data, 50 000 engine blocks after newline splitting, 256 MiB stdio frame / HTTP body. The engine's decompression cap is operator-set once at boot (`PDFNATIVE_MCP_MAX_INFLATE_BYTES`, `src/inflate-cap.ts`) — never from a tool argument.
- Keep output bounded (50 MiB cap) and deterministic when possible; any call carrying `encrypt` is never cached.
- Shared fragments live in `src/layout.ts` (layout + `encrypt`), `src/blocks.ts`, `src/table.ts`, `src/barcode.ts`, `src/form.ts`, `src/image.ts`, `src/watermark.ts` — a dedicated tool and its inline block must validate and render identically.
- Never echo key material in error messages or stderr.

## Compatibility
- Keep tool names stable across patch releases.
- Follow `docs/API_STABILITY.md` for `_meta.apiVersion` bump rules.
- Breaking changes require explicit migration notes in release-notes.
