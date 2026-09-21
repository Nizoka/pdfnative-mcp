# AGENTS.md

Condensed, editor-agnostic guidance for AI coding agents working **on** pdfnative-mcp (Cursor, Aider, Claude Code, Copilot, Continue, Zed, Cline, Windsurf, Goose, Gemini CLI, …).
Canonical detail: [.github/copilot-instructions.md](.github/copilot-instructions.md) + [.github/instructions/](.github/instructions/).
Claude Code loads [CLAUDE.md](CLAUDE.md), which imports this file. Keep the three consistent.
Agents that **use** the server read [docs/AGENT_CONTRACT.md](docs/AGENT_CONTRACT.md) (tool catalogue, decision tree, token economy, error codes) instead.

## Mission and constraints

pdfnative-mcp is the official Model Context Protocol server of the pdfnative engine: 28 tools over the document lifecycle
(generate, sign/verify/LTV, page tree, forms, metadata, encryption, inspection, validation), 7 prompts and resources, on stdio and Streamable HTTP.

- **Three runtime dependencies, no more.** `pdfnative`, `@modelcontextprotocol/server`, `zod`. Proposing another runtime package is a hard block
  (`draft_governance_issue` and `npm run verify:issue` enforce it).
- **Faithful thin wrapper.** Every PDF feature lives in the engine; the server never reimplements one and never over-promises (engine limits are stated in the tool description and in ROADMAP.md).
- **Validate at the boundary.** Every `tools/call` argument comes from a model: each object schema is Zod `.strict()`, kept in step by hand with the
  JSON Schema advertised for it; every failure is an `isError` result with one documented `ToolError` code — no uncoded failure.
- **Additive and byte-identical.** Default responses of existing tools do not change across releases; new behaviour is opt-in.
  Read `docs/API_STABILITY.md` before touching a schema or an error code.
- **Offline by default.** The only egress path is `src/network.ts` (operator-configured RFC 3161 / OCSP / CRL endpoints, SSRF guard);
  no tool argument ever supplies a URL or an absolute path. File output stays under `PDFNATIVE_MCP_OUTPUT_DIR` (`src/output.ts`).
- **No secret in any output.** Never log or echo passwords, keys, certificates, `PDFNATIVE_MCP_TSA_AUTH` or `PDFNATIVE_MCP_HTTP_TOKEN`;
  never cache secret-, time- or network-dependent results.
- **Operator knobs are read once at boot**, declared in `server.json`, and an invalid value refuses to start — never a silent fallback.
- **ESM-first TypeScript strict.** Relative imports carry `.js`; no `any`; no unused locals; on stdio, stdout carries JSON-RPC frames only (logs go to stderr).
- **Reproducible output.** Dates are written in UTC; a per-call `creationDate`, `PDFNATIVE_MCP_CREATION_DATE` or `SOURCE_DATE_EPOCH` pins them;
  the sample set is byte-stable under `TZ=UTC` and held to `tests/_fixtures/samples.sha256.json`.
- **Human-in-the-loop.** Agents draft and verify; the maintainer pushes, opens PRs/issues, tags and publishes (see Governance).
- **English everywhere.** Code, comments, tests, examples, docs and release notes are English; demonstrated content in another language
  is marked `demo-language: <tag> (reason)` on or above the line (`verify:docs` rule `prose-language`).

## The gate

`npm run gate` is THE quality gate (`scripts/gate.ts`; the step list is its `STEPS` table). Logs land in `test-output/.gate/<step>.log`; the summary is at most 20 lines.

| Profile | Command | Runs |
|---|---|---|
| Fast — before every commit | `npm run gate:fast` | typecheck:all, lint, test, server-json, verify:docs |
| CI — the default | `npm run gate` | fast minus `test`, plus build, dist-check, dist-probe, smoke, verify:tool-shape, test:generate, test:coverage, verify:samples, corpus:pdfa, validate:pdfx — build and samples precede the tests |
| Publish — release branches | `npx tsx scripts/gate.ts --publish --require-all` | everything, incl. validate:pdfa (veraPDF; `--require-all` fails on a skip) |

PowerShell swallows a bare `--`, so pass flags by calling the script: `npx tsx scripts/gate.ts --fast`, `--only <step>`, `--json`.
One suite: `npx vitest run tests/<name>.test.ts` (dot reporter). Drive the **built** server (`node dist/cli.js`, stdio) before claiming a change works.

## Where is what

| Path | Purpose | Read first |
|---|---|---|
| `src/cli.ts`, `src/http.ts`, `src/auth.ts` | Entry and transports: stdio by default, Streamable HTTP when `PDFNATIVE_MCP_PORT` is set (loopback guard, opt-in bearer token); boot-time knobs | `mcp-server.instructions.md` |
| `src/server.ts` | `TOOLS` registry (annotations, `_meta.examples`), request handlers, `dispatchOutput`, `classifyUnexpected`, instructions, prompts, resources, cache hints, `TOOL_API_VERSION` | `mcp-server.instructions.md` |
| `src/tools/` | One file per tool: JSON Schema `as const`, the parallel Zod schema, the handler | `mcp-server.instructions.md` |
| `src/*.ts` | Shared fragments: `layout`, `typography`, `color`, `print`, `pdfx`, `pdfa`, `diagnostics`, `blocks`, `table`, `chart`, `image`, `encryption`, `reproducible`, `network`, `output`, `base64` | `security.instructions.md` |
| `scripts/` | gate, sample generator, baseline, conformance corpus + validators (`helpers/`, `lib/`), tool-shape, verify-docs, release-prepare | `testing.instructions.md` |
| `tests/` | vitest, one `*.test.ts` per tool or module; `_`-prefixed shared fixtures; `_fixtures/` (tool shape, baseline, engine-surface matrix); `tools/` (repository tooling) | `testing.instructions.md` |
| `examples/` | Executable `tools/call` sequences, run live by `npm run examples:check` and rendered into the sample baseline | `testing.instructions.md` |
| `docs/` | `AGENT_CONTRACT.md` (consumer contract), `KNOWLEDGE_BASE.md` (deep reference), `API_STABILITY.md` (charter), `guides/`, `assets/ecosystem.json` (every count and version) | — |

Instruction files live under `.github/instructions/`.

## Architecture

`JSON-RPC frame → handler in src/server.ts → callToolDirect → tool handler (Zod parse → shared mappers → pdfnative) → dispatchOutput → content + structuredContent`.
Handlers are thin: parse, check static conflicts before the build, call the engine, map its errors to a `ToolError` code, return a result object or `emitPdf(...)`.

Adding or changing a tool touches ALL of these (`verify:docs` rules `tool-parity`, `error-parity`, `env-var-parity` fail on a missed step):

1. `src/tools/<name>.ts` (`<NAME>_NAME`, `<NAME>_INPUT_SCHEMA`, optional `<NAME>_OUTPUT_SCHEMA`, handler) and its entry in `TOOLS` (`src/server.ts`);
   a new result shape also needs a `dispatchOutput` branch.
2. `tests/<name>.test.ts` (success, each error code, file mode), `examples/<name>.json`, and for an engine feature its item in `tests/_fixtures/engine-surface.json`.
3. `npx tsx scripts/tool-shape.ts --write` — only for a deliberate structural change, reviewed under `docs/API_STABILITY.md` §5;
   `TOOL_API_VERSION` moves when a schema or an error code changes.
4. README tool matrix, `docs/AGENT_CONTRACT.md` (catalogue, decision tree, §6), `docs/AI_GUIDE.md`, `docs/KNOWLEDGE_BASE.md`, `llms.txt`, `docs/assets/ecosystem.json`, `CHANGELOG.md`.

## Consumer contract in brief

A tool succeeds with `content` + `structuredContent` (validating against its `outputSchema`) or fails with `isError: true` and `[CODE] message`,
`CODE` being one of the 47 documented in `docs/AGENT_CONTRACT.md` §6; an unknown tool name is JSON-RPC `-32602` `[UNKNOWN_TOOL]`.
`outputMode: 'file'` writes under the operator sandbox; `verbosity: 'summary'` / `fields` shrink read results; both MCP eras (2026-07-28 and the 2025 handshake) are served.

## Never touch

- `release-notes/v*.md` of already-shipped versions (read-only history), and `tests/_fixtures/tool-shape.v1.5.0.json` (the frozen published catalogue — never regenerated).
- `dist/`, `coverage/`, `test-output/`, `node_modules/`, `package-lock.json` (npm owns it), and the table below: regenerate, never hand-edit.
- Any figure in `docs/assets/ecosystem.json` without running `npm run verify:docs` afterwards; the `pdfnative` pin without a release note; the coverage thresholds downwards.

## Generated files

| File | Regenerate with |
|---|---|
| `.claude/rules/*.md` | `npm run agents:rules` (from `.github/instructions/*.instructions.md`; drift fails `verify:docs`) |
| `tests/_fixtures/tool-shape.json` | `npx tsx scripts/tool-shape.ts --write` — only with a schema change declared in the release note |
| `tests/_fixtures/samples.sha256.json` | `npm run build && npm run test:generate && npx tsx scripts/verify-samples.ts --update` — only with a rebaseline declared in the release note |
| `test-output/samples/`, `test-output/pdfa/` | `npm run test:generate`, `npm run corpus:pdfa` (git-ignored) |
| `dist/`, `coverage/` | `npm run build`, `npm run test:coverage` |

## Counts and versions

28 tools, 7 prompts, 13 block kinds, 47 error codes, 27 Unicode scripts, 43 examples, 1624 tests, 96 samples in the baseline, 41 corpus files.
`docs/assets/ecosystem.json` is the source of every count and version quoted in the docs; run `npm run verify:docs` after touching any of them.
Coverage thresholds live once in `vitest.config.ts` and are enforced by the gate. Engine: pdfnative 1.8.0 (`^1.8.0`); Node ≥ 22.

## Releasing

Follow CONTRIBUTING.md §Release and `scripts/release-prepare.ts`; Conventional Commits (`feat(scope):`, `fix(scope):`, `docs:`, `chore:`), never with a `Co-Authored-By` trailer.
Every runtime change gets a ROADMAP.md entry, a CHANGELOG line and a line in the next `release-notes/vX.Y.Z.md`; the version moves in lock-step (`tests/metadata.test.ts`).
`/release-audit` (Claude Code skill) runs the pre-release audit; the maintainer merges, tags and publishes.

## Governance

Human-in-the-loop, enforced: agents never push, never open PRs/issues/releases, never publish, never tag, and never add `Co-Authored-By` trailers.
Protocol: [.github/AGENT_RULES.md](.github/AGENT_RULES.md); machine-readable policy: [.github/ai-governance.json](.github/ai-governance.json).
Issue drafts go to `.github/drafts/` and are validated with `npm run verify:issue` (or the `draft_governance_issue` tool) before a human submits them.

## Ecosystem

- [pdfnative](https://github.com/Nizoka/pdfnative) — the zero-dependency engine this server wraps; every PDF feature is upstream (`ROADMAP.md` lists what is upstream-blocked).
- [pdfnative-cli](https://github.com/Nizoka/pdfnative-cli) — the terminal wrapper of the same engine, for pipelines and shell agents.
- [pdfnative-react](https://github.com/Nizoka/pdfnative-react) — React renderer (JSX → pdfnative blocks).

See also: [ROADMAP.md](ROADMAP.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [llms.txt](llms.txt).
