# CLAUDE.md

Guidance for Claude Code (and other Claude-based agents) working in this repository.
For the runtime tool catalogue and end-user recipes, read [`AGENTS.md`](AGENTS.md);
for architecture depth, [`docs/KNOWLEDGE_BASE.md`](docs/KNOWLEDGE_BASE.md). This file
is about *contributing to* the codebase, not *using* the server.

## What this is

`pdfnative-mcp` is a thin, faithful **Model Context Protocol** server wrapping the
zero-dependency [`pdfnative`](https://github.com/Nizoka/pdfnative) PDF engine.
TypeScript (strict, ESM-only), Node ≥ 22, `@modelcontextprotocol/server` (MCP SDK v2,
protocol 2026-07-28 with automatic 2025-era fallback). **28 tools**, 6 MCP prompts +
resources. Three runtime dependencies (pdfnative, the MCP SDK, zod). Current release: **1.6.0** (on pdfnative 1.7.0).

## Commands

```bash
npm run build          # tsc -p tsconfig.build.json  (emits dist/)
npm run typecheck:all  # tsc --noEmit  (covers src + tests)
npm run lint           # eslint src
npm test               # vitest run
npm run test:coverage  # vitest run --coverage  (enforces thresholds)
npm run examples:check # runs examples/*.json live through the tools/call handler
npm run validate:pdfa  # advisory: veraPDF over the 26-file PDF/A corpus (24 validated; skips when veraPDF is absent; VERAPDF_REQUIRED=1 fails closed; non-blocking in CI)
node scripts/tool-shape.mjs --write   # ONLY after a deliberate tools/list schema change — refreshes tests/_fixtures/tool-shape.json (catalogue parity gate)
```

**Quality gate (run before every commit/PR):**

```bash
npm run typecheck:all && npm run lint && npm run test && npm run test:coverage && npm run build
```

Coverage thresholds (global, in `vitest.config.ts`): statements 89 · branches 80 ·
functions 90 · lines 91. New code must keep the aggregate above these; never lower them.

## Architecture map

- `src/cli.ts` — entry point (stdio via `serveStdio` by default; Streamable HTTP via `createMcpHandler` when `PDFNATIVE_MCP_PORT` is set; both with the SDK's legacy fallback).
- `src/http.ts` — Node `http` ↔ Web `Request`/`Response` bridge and the Host/Origin loopback guard for the HTTP transport (disconnect detection per response, not per socket). `src/auth.ts` — opt-in bearer token (`PDFNATIVE_MCP_HTTP_TOKEN`).
- `src/server.ts` — the `TOOLS` registry (with MCP `annotations`), request handlers on the low-level `Server` (not `McpServer.registerTool`; the read tools' output schemas are projectable — every property optional — so `structuredContent` always validates, asserted by `tests/schema-conformance.test.ts`), `dispatchOutput` (duck-typed result → content builder), `SERVER_INSTRUCTIONS`, `SERVER_CACHE_HINTS`, and the `resources` / `prompts` capabilities. `TOOL_API_VERSION` lives here.
- `src/tools/<name>.ts` — one file per tool: a hand-written JSON Schema `as const`, a **parallel Zod schema** (kept in lock-step), and the handler. `src/tools/inspect-layout.ts` (28th tool) reuses `generate_basic_pdf`'s block schema and the layout fragment.
- Shared schema/util modules: `src/network.ts` (operator-configured TSA / OCSP / CRL providers + SSRF guard — the **only** egress path), `src/blocks.ts` (the 7 extended document blocks — `table`, `image`, `link`, `toc`, `barcode`, `svg`, `formField` — on top of the 6 basic ones; 13 kinds total), `src/layout.ts` (`pageSize` / `margins` / `headerTemplate` / `footerTemplate` / `compress` / `debug` / `encrypt` → `PdfLayoutOptions`; `assertLayoutPdfACompatible`), `src/table.ts` / `src/barcode.ts` / `src/form.ts` / `src/image.ts` (bodies shared by a dedicated tool and its inline block; `form.ts` maps `textarea` → `multilineText`; `image.ts` decodes + checks magic bytes and the PNG IHDR, `ImageByteBudget` 24 MiB per call — `embed_image` stays unbounded, blocks / watermarks use the bounded variant), `src/inflate-cap.ts` (`PDFNATIVE_MCP_MAX_INFLATE_BYTES` → engine cap; `throwIfInflateCapError` → `PDF_PARSE_FAILED`), `src/print.ts` (print-production `print` / `outputIntent` / `metadata` / `creationDate` schema + mappers), `src/diagnostics.ts` (PDF/A diagnostics sink, `strict` / `includeDiagnostics` / `embedFonts`, `mapBuildError`), `src/encryption.ts` (password + `encrypt` schema, `mapDecryptError`), `src/chart.ts` (charts v2 schema + `toChartBlock`), `src/cms.ts` (CMS parser), `src/pdf-introspection.ts` (signature widgets, `/DSS`, page boxes, annotations), `src/pagetree.ts` (`mapPageTreeError` — page-index errors → `VALIDATION_ERROR`), `src/base64.ts` (base64 / DER boundary decoding with agent-facing diagnostics — use it for every `pdfBase64` / DER input), `src/pdfa.ts`, `src/doc-features.ts`, `src/watermark.ts` (text and/or image + `position`), `src/projection.ts` (token-frugal `verbosity`/`fields`), `src/output.ts` (sandboxed file write), `src/resources.ts`.
- `tests/` — one `*.test.ts` per tool/module; shared fixtures are `_`-prefixed (`_pdf-assert.ts`, `_cert-fixtures.ts`, `_pagetree-fixtures.ts`, `_encrypted-fixtures.ts`, `_ltv-fixtures.ts` (offline mock PKI + RFC 3161 / OCSP / CRL providers), `_tsa-server.ts` (loopback TSA), `_http-fixture.ts`, `_mcp-harness.ts`). `tests/http-modern.test.ts` asserts the MCP 2026-07-28 conformance; `tests/catalogue-parity.test.ts` compares `tools/list` with the structural fixture `tests/_fixtures/tool-shape.json`; `tests/catalogue-superset.test.ts` proves the live catalogue is a superset of the published 1.5.0 one (`tests/_fixtures/tool-shape.v1.5.0.json` — never regenerate that file). New in 1.6.0: `document-blocks`, `layout-options`, `inspect-layout`, `watermark`, `inflate-cap`, `error-codes` (src ↔ AGENTS §6 inventory).

## Non-negotiable conventions

1. **Zero new runtime dependencies.** Only `pdfnative`, `@modelcontextprotocol/server`, `zod`. Adding one is a governance blocker (`.github/AGENT_RULES.md`).
2. **Faithful thin wrapper.** Surface pdfnative behaviour honestly; don't reimplement engine features on raw primitives, and don't over-promise (e.g. `encrypt_pdf`/`decrypt_pdf` rebuild the page tree and drop signatures/AcroForm — say so).
3. **Strict TypeScript.** No `any` (use `unknown` + narrowing). No unused locals/params.
4. **Validate every input** at the boundary with Zod — every object schema is `.strict()` (unknown keys → `VALIDATION_ERROR`), matching `additionalProperties: false`; keep the JSON Schema and Zod schema aligned (they are hand-kept in sync). Unknown tool names are a JSON-RPC `-32602` protocol error (`[UNKNOWN_TOOL]`), not an `isError` result.
5. **Additive & byte-identical.** Default responses for existing tools stay byte-identical across releases; new behaviour is opt-in. New inputs get backward-compatible defaults. See `docs/API_STABILITY.md` before touching any schema or error code — a schema/error change may require a `TOOL_API_VERSION` bump and always needs a reviewed `tests/_fixtures/tool-shape.json` refresh. Wording (descriptions, `_meta.examples` ≤ 2 per tool, `SERVER_INSTRUCTIONS`) is free to change.
6. **Security.** Never write outside `PDFNATIVE_MCP_OUTPUT_DIR` (use `src/output.ts` helpers — they reject absolute paths, traversal, NUL bytes, non-`.pdf`). Never log or echo passwords, keys, certificate material, `PDFNATIVE_MCP_TSA_AUTH` or `PDFNATIVE_MCP_HTTP_TOKEN`. Never cache secret-, time- or network-dependent output (`NON_CACHEABLE_TOOLS`, plus any call carrying `encrypt`). Never add an egress path outside `src/network.ts`, and never let a tool argument supply a URL — endpoints come only from the operator environment. Operator knobs are read once at boot (`PDFNATIVE_MCP_MAX_INFLATE_BYTES` in `src/inflate-cap.ts`; an invalid value must refuse to start, never fall back silently). Decode every image through `src/image.ts` (magic bytes + PNG IHDR checks) and keep `embed_image.imageBase64` unbounded (1.5.0 contract).
7. **Version lock-step.** `tests/metadata.test.ts` asserts `package.json`, `src/version.ts`, and `server.json` agree. Update all together.

## Adding a tool (the pattern)

1. Create `src/tools/<name>.ts`: export `<NAME>_NAME`, `<NAME>_INPUT_SCHEMA` (const), optional `<NAME>_OUTPUT_SCHEMA`, and the async handler (parse with Zod → call pdfnative → return a result object or `emitPdf(...)`).
2. Register it in the `TOOLS` array in `src/server.ts` with `annotations` and `_meta.examples`. If it returns a **new result shape**, add a `dispatchOutput` discriminator branch and a `build…Result` function.
3. Add `tests/<name>.test.ts` (cover success, each error code, and file mode) and, where it helps discovery, an `examples/<name>.json` (single-tool, placeholder-free examples run live).
4. Update the docs (README tool matrix, `AGENTS.md` catalogue + decision tree + error table, `llms.txt`, `docs/API_STABILITY.md` matrix) and the `CHANGELOG.md` `[Unreleased]` section.

## Release process

- Decide SemVer level first (new tool / new optional field ⇒ **minor**).
- `release-notes/vX.Y.Z.md` is **mandatory** and mirrored into `CHANGELOG.md`.
- Bump the four version references in lock-step; bump `TOOL_API_VERSION` only when a schema or error code changes.
- Publishing is automated via GitHub Actions **Trusted Publishing (OIDC)** on a published GitHub Release — no `NPM_TOKEN`, `--provenance`.

## Human-in-the-loop governance

This server is a **draftsman, never an autonomous submitter**. It has no GitHub write
path and makes no outbound network call by default: the only egress it can ever
perform goes to the RFC 3161 / OCSP / CRL endpoints the operator configured
(`PDFNATIVE_MCP_TSA_URL`, `PDFNATIVE_MCP_REVOCATION`,
`PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`) — never to a URL supplied by a tool argument,
never to GitHub, never for telemetry. To propose an upstream change, use the
`draft_governance_issue` tool (or `npm run verify:issue`) to produce a local,
policy-checked draft — a human reviews and submits it. See
[`docs/guides/AI_GOVERNANCE.md`](docs/guides/AI_GOVERNANCE.md) and
[`.github/AGENT_RULES.md`](.github/AGENT_RULES.md).

## Working style (token-aware)

Gather context in parallel, then act. Make targeted edits — don't reprint whole
files. Let the diff speak: no change-summary essays, no new top-level docs unless
asked. Reuse the scoped rules in `.github/instructions/*.md` rather than re-deriving
conventions.
