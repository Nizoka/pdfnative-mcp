# CLAUDE.md

Guidance for Claude Code (and other Claude-based agents) working in this repository.
For the runtime tool catalogue and end-user recipes, read [`AGENTS.md`](AGENTS.md);
for architecture depth, [`docs/KNOWLEDGE_BASE.md`](docs/KNOWLEDGE_BASE.md). This file
is about *contributing to* the codebase, not *using* the server.

## What this is

`pdfnative-mcp` is a thin, faithful **Model Context Protocol** server wrapping the
zero-dependency [`pdfnative`](https://github.com/Nizoka/pdfnative) PDF engine.
TypeScript (strict, ESM-only), Node ≥ 22, `@modelcontextprotocol/server` (MCP SDK v2,
protocol 2026-07-28 with automatic 2025-era fallback). **27 tools**, MCP prompts +
resources. Current release: **1.6.0** (on pdfnative 1.7.0).

## Commands

```bash
npm run build          # tsc -p tsconfig.build.json  (emits dist/)
npm run typecheck:all  # tsc --noEmit  (covers src + tests)
npm run lint           # eslint src
npm test               # vitest run
npm run test:coverage  # vitest run --coverage  (enforces thresholds)
npm run examples:check # runs examples/*.json live through the tools/call handler
npm run validate:pdfa  # advisory: veraPDF over a generated PDF/A corpus (skips when veraPDF is absent; non-blocking in CI)
```

**Quality gate (run before every commit/PR):**

```bash
npm run typecheck:all && npm run lint && npm run test && npm run test:coverage && npm run build
```

Coverage thresholds (global, in `vitest.config.ts`): statements 89 · branches 80 ·
functions 90 · lines 91. New code must keep the aggregate above these; never lower them.

## Architecture map

- `src/cli.ts` — entry point (stdio via `serveStdio` by default; Streamable HTTP via `createMcpHandler` when `PDFNATIVE_MCP_PORT` is set; both with the SDK's legacy fallback).
- `src/http.ts` — Node `http` ↔ Web `Request`/`Response` bridge and the Host/Origin loopback guard for the HTTP transport.
- `src/server.ts` — the `TOOLS` registry (with MCP `annotations`), request handlers on the low-level `Server` (not `McpServer.registerTool`, which would validate `structuredContent` and break the projections), `dispatchOutput` (duck-typed result → content builder), `SERVER_INSTRUCTIONS`, `SERVER_CACHE_HINTS`, and the `resources` / `prompts` capabilities. `TOOL_API_VERSION` lives here.
- `src/tools/<name>.ts` — one file per tool: a hand-written JSON Schema `as const`, a **parallel Zod schema** (kept in lock-step), and the handler.
- Shared schema/util modules: `src/network.ts` (operator-configured TSA / OCSP / CRL providers + SSRF guard — the **only** egress path), `src/print.ts` (print-production `print` / `outputIntent` / `metadata` schema + mappers), `src/diagnostics.ts` (PDF/A diagnostics sink, `strict` / `includeDiagnostics` / `embedFonts`, `mapBuildError`), `src/encryption.ts` (password + `encrypt` schema, `mapDecryptError`), `src/chart.ts` (charts v2 schema + `toChartBlock`), `src/cms.ts` (CMS parser), `src/pdf-introspection.ts` (signature widgets, `/DSS`, page boxes), `src/pagetree.ts` (`mapPageTreeError`), `src/pdfa.ts`, `src/doc-features.ts`, `src/watermark.ts`, `src/projection.ts` (token-frugal `verbosity`/`fields`), `src/output.ts` (sandboxed file write), `src/resources.ts`.
- `tests/` — one `*.test.ts` per tool/module; shared fixtures are `_`-prefixed (`_pdf-assert.ts`, `_cert-fixtures.ts`, `_pagetree-fixtures.ts`, `_encrypted-fixtures.ts`, `_ltv-fixtures.ts` (offline mock PKI + RFC 3161 / OCSP / CRL providers), `_tsa-server.ts` (loopback TSA), `_http-fixture.ts`, `_mcp-harness.ts`). `tests/http-modern.test.ts` asserts the MCP 2026-07-28 conformance.

## Non-negotiable conventions

1. **Zero new runtime dependencies.** Only `pdfnative`, `@modelcontextprotocol/server`, `zod`. Adding one is a governance blocker (`.github/AGENT_RULES.md`).
2. **Faithful thin wrapper.** Surface pdfnative behaviour honestly; don't reimplement engine features on raw primitives, and don't over-promise (e.g. `encrypt_pdf`/`decrypt_pdf` rebuild the page tree and drop signatures/AcroForm — say so).
3. **Strict TypeScript.** No `any` (use `unknown` + narrowing). No unused locals/params.
4. **Validate every input** at the boundary with Zod; keep the JSON Schema and Zod schema aligned (they are hand-kept in sync).
5. **Additive & byte-identical.** Default responses for existing tools stay byte-identical across releases; new behaviour is opt-in. New inputs get backward-compatible defaults. See `docs/API_STABILITY.md` before touching any schema or error code — a schema/error change may require a `TOOL_API_VERSION` bump.
6. **Security.** Never write outside `PDFNATIVE_MCP_OUTPUT_DIR` (use `src/output.ts` helpers — they reject absolute paths, traversal, NUL bytes, non-`.pdf`). Never log or echo passwords, keys, certificate material, or `PDFNATIVE_MCP_TSA_AUTH`. Never add an egress path outside `src/network.ts`, and never let a tool argument supply a URL — endpoints come only from the operator environment.
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
