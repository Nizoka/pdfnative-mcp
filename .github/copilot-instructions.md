# pdfnative-mcp - Project Guidelines

> Full context (architecture, tool schemas, output system, security design):
> [`docs/KNOWLEDGE_BASE.md`](../docs/KNOWLEDGE_BASE.md). Don't duplicate it here.
> Repository rules shared by every coding agent: [`AGENTS.md`](../AGENTS.md) — keep this file consistent with it.
> Contract for agents that *use* the server (tool catalogue, decision tree, token economy, error codes):
> [`docs/AGENT_CONTRACT.md`](../docs/AGENT_CONTRACT.md).

## Overview

MCP server bridging pdfnative 1.8.0 (pinned `^1.8.0`) to AI clients over stdio or Streamable
HTTP, on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, MCP
2026-07-28 with automatic 2025-era fallback). 28 tools, 7 prompts, 47 error codes, 27 Unicode scripts.
Current release 1.7.0 (`TOOL_API_VERSION` 1.7.0). Three runtime dependencies (pdfnative, the MCP SDK, zod) — never add one.
Quality bar: production-grade OSS (strict TypeScript, strong validation, secure
file IO, no egress except operator-configured TSA / OCSP / CRL endpoints,
reproducible output, deterministic releases). Faithful thin wrapper: every PDF feature lives in
the engine; never reimplement one, never over-promise (state engine limits in the tool description and ROADMAP.md).

## Architecture (one line each)

- src/cli.ts — stdio (`serveStdio`) / Streamable HTTP (`createMcpHandler`) entry point; boot-time operator knobs.
- src/http.ts — Node http ↔ Web Request/Response bridge + Host/Origin loopback guard.
- src/auth.ts — opt-in HTTP bearer token (`PDFNATIVE_MCP_HTTP_TOKEN`, constant-time compare, 401 + WWW-Authenticate).
- src/base64.ts — base64 boundary helpers (data: URI tolerated, PEM-vs-DER and double-encoding hints).
- src/server.ts — `TOOLS` registry (+ annotations, `_meta.examples`), request handlers, `dispatchOutput`, `classifyUnexpected`
  (unexpected failure on PDF input → `PDF_PARSE_FAILED`), SERVER_INSTRUCTIONS, prompts, resources, cache hints, `TOOL_API_VERSION`.
- src/tools/* — one file per tool (JSON schema `as const` + parallel Zod + handler); inspect-layout.ts reuses the
  generate_basic_pdf block schema + layout fragment.
- src/network.ts — the only egress path: operator-configured TSA / OCSP / CRL providers + SSRF guard; URLs never come from tool arguments.
- src/blocks.ts — the 7 extended document blocks (table, image, link, toc, barcode, svg, formField) → 13 block kinds in total.
- src/layout.ts — pageSize / margins / headerTemplate / footerTemplate / compress / debug / encrypt / typography fragment shared by the nine document tools.
- src/typography.ts — the opt-in `typography` fragment (12 keys, all off by default; no hyphenation dictionary is installed).
- src/color.ts — shared colour fragment: hex / RGB plus CMYK operand strings (0–1) and percent tuples (0–100); `toEngineColor()`.
- src/print.ts — shared print-production schema (boxes, bleed, marks + colour bars, userUnit, outputIntent RGB / CMYK / Gray, metadata, creationDate).
- src/pdfx.ts, src/pdfa.ts — conformance targets from the engine's own tuples; static PDF/X conflicts refused as `VALIDATION_ERROR` before the build.
- src/reproducible.ts — operator pin of the creation instant (`PDFNATIVE_MCP_CREATION_DATE`, then `SOURCE_DATE_EPOCH`); read once at boot.
- src/diagnostics.ts — diagnostics sink (`strict` / `includeDiagnostics` / `embedFonts`), `escalate()` by diagnostic code, `mapBuildError`.
- src/table.ts, src/barcode.ts, src/form.ts, src/image.ts — bodies shared by a dedicated tool and its inline block
  (image.ts checks magic bytes + PNG IHDR, 24 MiB per-call budget; embed_image stays unbounded).
- src/watermark.ts — text and/or image watermark + position; PDF/A-1b transparency guard.
- src/inflate-cap.ts — PDFNATIVE_MCP_MAX_INFLATE_BYTES → engine decompression cap (read once at boot; invalid value refuses to start).
- src/encryption.ts — shared password/encrypt schema + decrypt error mapper.
- src/chart.ts — shared charts v2 schema + mapper (add_chart and the generate_basic_pdf chart block).
- src/projection.ts — token-frugal responses (`verbosity: 'summary'`, `fields`); src/cache.ts — opt-in response cache.
- src/resources.ts — native MCP resources over the sandbox output dir (pdfnative://output/…).
- src/output.ts — output mode (base64 or sandboxed file write); src/text.ts — newline sanitizer; src/errors.ts — ToolError, SecurityError, GovernanceError.
- scripts/* — TypeScript run by tsx: gate.ts, generate-samples.ts + verify-samples.ts (byte baseline), generate-pdfa-corpus.ts +
  validate-pdfa.ts / validate-pdfx.ts (conformance corpus), tool-shape.ts, verify-docs.ts, release-prepare.ts, build-claude-rules.ts. See scripts/README.md.
- tests/* — vitest, one `*.test.ts` per tool or module; `_`-prefixed shared fixtures; tests/_fixtures/ (tool shape, sample baseline,
  engine-surface matrix, build-error registry); tests/tools/ (repository tooling). Never regenerate tests/_fixtures/tool-shape.v1.5.0.json.
- examples/*.json — executable `tools/call` sequences (43), run by `npm run examples:check` and rendered into the sample baseline.

## Core conventions

- Strict TypeScript, ESM-first (relative imports carry `.js`); no `any` (use `unknown` + narrowing); English everywhere.
- Validate every tool input at the boundary with Zod (`.strict()` — unknown keys are a
  `VALIDATION_ERROR`); keep JSON schema and Zod aligned, built from the same constants where a shared fragment exists.
- Every failure is an `isError` result with one documented `ToolError` code (`docs/AGENT_CONTRACT.md` §6) — no uncoded failure.
- `strict` is classified by the server, never forwarded to the engine: `PDFA_*` → `PDF_A_COMPLIANCE_VIOLATION`,
  `PDFX_*` → `PDF_X_COMPLIANCE_VIOLATION`, anything else → `DIAGNOSTIC_ESCALATED`.
- `tools/list` is structurally fingerprinted: after a deliberate schema change run
  `npm run build && npx tsx scripts/tool-shape.ts --write` (refreshes `tests/_fixtures/tool-shape.json`,
  checked by `npm run verify:tool-shape` and `tests/catalogue-parity.test.ts`) and review under docs/API_STABILITY.md §5.
- Additive and byte-identical: default responses of existing tools do not change; new behaviour is opt-in.
- Unknown tool name on `tools/call` is a JSON-RPC `-32602` `[UNKNOWN_TOOL]` protocol error.
- On stdio, stdout carries JSON-RPC frames only: never `console.log` in `src/` — log to stderr.
- Never write outside PDFNATIVE_MCP_OUTPUT_DIR. For outputMode=file: reject absolute
  paths, path traversal, NUL bytes; enforce `.pdf`.
- Never echo key/cert material, passwords, PDFNATIVE_MCP_TSA_AUTH or
  PDFNATIVE_MCP_HTTP_TOKEN in errors or logs; never cache secret-, time- or network-dependent results.
- Never add a network path outside src/network.ts; never accept a URL or an absolute path from a tool argument.
- Operator env vars (12, read once at boot, declared in server.json, an invalid value refuses to start):
  PDFNATIVE_MCP_OUTPUT_DIR, PDFNATIVE_MCP_CACHE_DIR, PDFNATIVE_MCP_PORT,
  PDFNATIVE_MCP_HTTP_TOKEN, PDFNATIVE_MCP_MAX_INFLATE_BYTES, PDFNATIVE_MCP_TSA_URL,
  PDFNATIVE_MCP_TSA_AUTH, PDFNATIVE_MCP_REVOCATION, PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS,
  PDFNATIVE_MCP_NETWORK_TIMEOUT_MS, PDFNATIVE_MCP_CREATION_DATE, SOURCE_DATE_EPOCH.
- Honest limits: PDF/X validation is structural, not a certified preflight; no ICC press profile is bundled; `kerning` / `fontFeatures` /
  the `'fr'` narrow space need `embedFonts: true`; Tai Tham (`nod`) uses `pdfa2b`, not `pdfa2u`.
- `npm run lint` is `eslint src --max-warnings 0` — warnings fail the gate. CI runs the gate on Linux (Node 22 / 24); a `windows` job builds and tests.

## Quality gate (all PRs)

`npm run gate` is THE quality gate (`scripts/gate.ts`; the step list is its `STEPS` table; logs in `test-output/.gate/<step>.log`).
Profiles: `npm run gate:fast` (typecheck:all, lint, test, server-json, verify:docs) before every commit; `npm run gate` is the CI
profile (adds build, dist-check, dist-probe, smoke, verify:tool-shape, test:generate, test:coverage, verify:samples, corpus:pdfa,
validate:pdfx); `npx tsx scripts/gate.ts --publish --require-all` on release branches adds validate:pdfa (veraPDF 1.30.2, blocking in CI;
`--require-all` fails on a skip). PowerShell swallows a bare `--` after `npm run`: call `npx tsx scripts/gate.ts --fast` there.
Drive the **built** server (`node dist/cli.js`, stdio) before claiming a change works. Coverage thresholds live once in
`vitest.config.ts` — never lower them. `docs/assets/ecosystem.json` is the source of every count and version; run
`npm run verify:docs` after touching one.

## Generated files — regenerate, never hand-edit

`.claude/rules/*.md` (`npm run agents:rules`, from `.github/instructions/*.instructions.md`), `tests/_fixtures/tool-shape.json`
(`npx tsx scripts/tool-shape.ts --write`), `tests/_fixtures/samples.sha256.json` (`npx tsx scripts/verify-samples.ts --update`, only with a
rebaseline declared in the release note), `dist/`, `coverage/`, `test-output/`, `package-lock.json`.

## Release process

- Follow CONTRIBUTING.md §Release and `scripts/release-prepare.ts` (mechanical bump + scaffolds; it never commits, tags or publishes).
- release-notes/vX.Y.Z.md is mandatory; CHANGELOG.md mirrors it; the Upgrade section declares every output change and rebaseline.
- The PR body is drafted at `.github/drafts/pr-vX.Y.Z.md` from `release-notes/PR_TEMPLATE.md`.
- GitHub Release title: `vX.Y.Z - short description`.
- npm publish via GitHub Actions Trusted Publishing (OIDC), no NPM_TOKEN.
- Human-in-the-loop: agents draft and verify; the maintainer pushes, opens PRs / issues, tags and publishes
  (`.github/AGENT_RULES.md`). No `Co-Authored-By` trailer.

## Working efficiently (token-aware)

Optimize for minimal tokens in both planning and implementation, without lowering
quality:

- Gather context in parallel, then act; don't re-read files already in context.
- Make targeted edits — don't reprint whole files or restate unchanged code.
- Keep replies concise: no preambles, no change-summary essays, no new markdown
  docs unless asked. Let the diff speak.
- Reuse the scoped `.github/instructions/*.md` rather than re-deriving conventions.
- Never read `dist/`, `coverage/`, `test-output/`, `node_modules/`, `package-lock.json`; `tools/list` is about 300 kB — project it, never print it.
