# CLAUDE.md

Guidance for Claude Code (and other Claude-based agents) working in this repository.
For the runtime tool catalogue and end-user recipes, read [`AGENTS.md`](AGENTS.md);
for architecture depth, [`docs/KNOWLEDGE_BASE.md`](docs/KNOWLEDGE_BASE.md). This file
is about *contributing to* the codebase, not *using* the server.

## What this is

`pdfnative-mcp` is a thin, faithful **Model Context Protocol** server wrapping the
zero-dependency [`pdfnative`](https://github.com/Nizoka/pdfnative) PDF engine.
TypeScript (strict, ESM-only), Node ≥ 22, `@modelcontextprotocol/sdk`. **24 tools**,
MCP prompts + resources. Current release: **1.5.0** (on pdfnative 1.6.0).

## Commands

```bash
npm run build          # tsc -p tsconfig.build.json  (emits dist/)
npm run typecheck:all  # tsc --noEmit  (covers src + tests)
npm run lint           # eslint src
npm test               # vitest run
npm run test:coverage  # vitest run --coverage  (enforces thresholds)
npm run examples:check # runs examples/*.json live through the tools/call handler
```

**Quality gate (run before every commit/PR):**

```bash
npm run typecheck:all && npm run lint && npm run test && npm run test:coverage && npm run build
```

Coverage thresholds (global, in `vitest.config.ts`): statements 88 · branches 75 ·
functions 85 · lines 90. New code must keep the aggregate above these.

## Architecture map

- `src/cli.ts` — entry point (stdio by default; Streamable HTTP when `PDFNATIVE_MCP_PORT` is set).
- `src/server.ts` — the `TOOLS` registry (with MCP `annotations`), request handlers, `dispatchOutput` (duck-typed result → content builder), `SERVER_INSTRUCTIONS`, and the `resources` / `prompts` capabilities. `TOOL_API_VERSION` lives here.
- `src/tools/<name>.ts` — one file per tool: a hand-written JSON Schema `as const`, a **parallel Zod schema** (kept in lock-step), and the handler.
- Shared schema/util modules: `src/encryption.ts` (password + `encrypt` schema, `mapDecryptError`), `src/chart.ts` (`ChartBlock` schema + `toChartBlock`), `src/pagetree.ts` (`mapPageTreeError`), `src/pdfa.ts`, `src/doc-features.ts`, `src/watermark.ts`, `src/projection.ts` (token-frugal `verbosity`/`fields`), `src/output.ts` (sandboxed file write), `src/resources.ts`.
- `tests/` — one `*.test.ts` per tool/module; shared fixtures are `_`-prefixed (`_pdf-assert.ts`, `_cert-fixtures.ts`, `_pagetree-fixtures.ts`, `_encrypted-fixtures.ts`).

## Non-negotiable conventions

1. **Zero new runtime dependencies.** Only `pdfnative`, `@modelcontextprotocol/sdk`, `zod`. Adding one is a governance blocker (`.github/AGENT_RULES.md`).
2. **Faithful thin wrapper.** Surface pdfnative behaviour honestly; don't reimplement engine features on raw primitives, and don't over-promise (e.g. `encrypt_pdf`/`decrypt_pdf` rebuild the page tree and drop signatures/AcroForm — say so).
3. **Strict TypeScript.** No `any` (use `unknown` + narrowing). No unused locals/params.
4. **Validate every input** at the boundary with Zod; keep the JSON Schema and Zod schema aligned (they are hand-kept in sync).
5. **Additive & byte-identical.** Default responses for existing tools stay byte-identical across releases; new behaviour is opt-in. New inputs get backward-compatible defaults. See `docs/API_STABILITY.md` before touching any schema or error code — a schema/error change may require a `TOOL_API_VERSION` bump.
6. **Security.** Never write outside `PDFNATIVE_MCP_OUTPUT_DIR` (use `src/output.ts` helpers — they reject absolute paths, traversal, NUL bytes, non-`.pdf`). Never log or echo passwords, keys, or certificate material.
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

This server is a **draftsman, never an autonomous submitter**. It makes no outbound
network calls and has no GitHub write path. To propose an upstream change, use the
`draft_governance_issue` tool (or `npm run verify:issue`) to produce a local,
policy-checked draft — a human reviews and submits it. See
[`docs/guides/AI_GOVERNANCE.md`](docs/guides/AI_GOVERNANCE.md) and
[`.github/AGENT_RULES.md`](.github/AGENT_RULES.md).

## Working style (token-aware)

Gather context in parallel, then act. Make targeted edits — don't reprint whole
files. Let the diff speak: no change-summary essays, no new top-level docs unless
asked. Reuse the scoped rules in `.github/instructions/*.md` rather than re-deriving
conventions.
