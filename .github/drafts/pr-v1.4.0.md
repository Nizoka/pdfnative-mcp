# PR: v1.4.0 — AI governance + HITL, markup annotations, pdfnative 1.5

## Summary

A minor, fully backward-compatible release that extends pdfnative-mcp to **19 tools** and brings the pdfnative **AI-governance / Human-In-The-Loop (HITL)** system to the MCP surface. Adds `draft_governance_issue` — a **local, network-free** GitHub-issue drafter that produces a compliant draft `.md` plus a machine-readable compliance report (the agent is a *draftsman, never an autonomous submitter*: a human is the only gate, and the server makes **zero** GitHub writes and no outbound network call). Adds `annotate_pdf` — markup overlays (highlight, note, underline, strikeout, squiggly, square, circle, line, freetext) via pdfnative 1.5's incremental-update annotation writer (a **visual review layer, not a redaction**). Surfaces `/PageLabels` in `inspect_pdf`, adds an explicit `math` script to `add_international_text` (Noto Sans Math, on demand only — **no** global auto-routing), advertises the MCP **`prompts`** capability, and upgrades the engine to [pdfnative v1.5.0](https://github.com/Nizoka/pdfnative). No breaking changes — all v1.3.0 tool calls work unchanged and default responses are byte-identical.

Full notes: [`release-notes/v1.4.0.md`](../../release-notes/v1.4.0.md).

## Scope

| Phase | Subject |
| --- | --- |
| 0 | Branch + version bump (package.json `1.4.0`, pdfnative pin `^1.5.0`); `src/version.ts` single source of truth |
| 1 | AI governance / HITL: `src/governance.ts` (contract + `validateIssueMarkdown`), `GovernanceError` (`src/errors.ts`), `writeSandboxedText` (`src/output.ts`), `draft_governance_issue` tool, MCP prompts (`governance_contract`, `draft_issue_workflow`), `.github/ai-governance.json` + `AGENT_RULES.md` + `drafts/README.md`, `scripts/verify-issue.mjs` (`npm run verify:issue`) |
| 2 | `annotate_pdf` (markup overlay via pdfnative 1.5 incremental-update writer); `inspect_pdf` `/PageLabels`; `add_international_text` explicit `math` lang via shared `src/fonts.ts` |
| 3 | Server registration (2 tools → 19, prompts capability + `ListPrompts`/`GetPrompt` handlers, dispatch, `SERVER_VERSION`/`apiVersion` → 1.4.0, decision tree); `index.ts`, `server.json` |
| 4 | Examples: `annotate-pdf`, `draft-governance-issue`, `math-symbols`, `page-labels-inspect` |
| 5 | Tests: 4 new suites + extended `server.test.ts` (prompts + 19 tools), `inspect-pdf.test.ts` (pageLabels), `output.test.ts` (.md writer) |
| 6 | Docs: README, AGENTS.md, AI_GUIDE, API_STABILITY, KNOWLEDGE_BASE, LOCAL_TESTING, ROADMAP, llms.txt, copilot-instructions + new `docs/guides/AI_GOVERNANCE.md` |
| 7 | Release: `release-notes/v1.4.0.md`, CHANGELOG mirror, this PR draft |

## Closes

- Roadmap: ships the pdfnative **AI-governance / HITL** system as an MCP-native tool + prompts, and `annotate_pdf` on pdfnative v1.5.0's annotation writer.
- `redact_pdf` stays **deferred by design**: pdfnative 1.5's writer can only *overlay* content, and an overlay-only "redaction" would leave the original bytes intact and create **false security** — it fails this project's honesty bar. Tracked as an upstream true content-removal request (a fitting first use of `draft_governance_issue`). An encrypted-PDF round-trip likewise remains blocked upstream.

## Quality gate

- ✅ `npm run typecheck:all` — 0 errors
- ✅ `npm run lint` — 0 errors (36 pre-existing non-null-assertion warnings in untouched files)
- ✅ `npm run test:coverage` — **355 tests** passing; **90.47** stmts / **79.18** branches / **95.81** funcs / **92.51** lines (≥ vitest thresholds 88 / 75 / 85 / 90)
- ✅ `npm run build` — clean `dist/`
- ✅ `npm run examples:check` — every `examples/*.json` references a live tool; self-contained examples execute and pass structural assertions
- ✅ `npm run verify:issue` — CLI validates a compliant draft and mirrors `src/governance.ts` byte-for-byte

## Changes summary

### Added
- **Tool `draft_governance_issue`** (new, 19th) — assembles a governance-compliant GitHub issue draft plus a structured `compliance` report and returns them; **never submits, no outbound network call**. Inputs: `title`, `issueType` (`bug|feature|security|docs|performance`), `summary`, `reproduction: { command, result }`, `expectedBehavior`, optional `actualBehavior`, `targetRepo` (default `pdfnative-mcp`), `affectedPackages` (default `['pdfnative-mcp']`), `duplicateSearchPerformed` (**must be `true`**), `outputMode` (`'inline'|'file'`) / `outputPath`. Contract breaches (runtime dependency, missing reproduction, `duplicateSearchPerformed:false`) → new `GOVERNANCE_VIOLATION` error.
- **Tool `annotate_pdf`** (new, 18th) — overlay markup annotations (`text`, `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext`) on an existing PDF via pdfnative 1.5's incremental-update annotation writer. 0-based `page` (bounds-checked), `rect: [x1, y1, x2, y2]`, optional `color`/`contents`. Encrypted sources → `ENCRYPTED_SOURCE`. **Visual overlay only — not a redaction.**
- **`inspect_pdf`** — optional `pageLabels[]` output field (`{ startPage, style?, prefix?, start? }`), present only when the PDF declares `/PageLabels` (pdfnative 1.5 `getPageLabels()`).
- **`add_international_text`** — explicit `math` lang code (maps to `noto-sans-math-data.js`, Noto Sans Math), embedded on demand only when requested (e.g. `lang: ['latin', 'math']`) — **no** global auto-routing.
- **MCP prompts** — the server advertises the `prompts` capability with `governance_contract` (the full contract) and `draft_issue_workflow` (the step-by-step recipe), sourced from `src/governance.ts`.
- **`src/governance.ts`** — single source of truth for the governance contract: `validateIssueMarkdown()` (zero-dependency + reproduction-block policy), prompt copy, identity/human-gate constants.
- **`src/version.ts`** — shared `PDFNATIVE_MCP_VERSION` used by the server and the governance tool.
- **`src/fonts.ts`** — shared font-module directory + loader helpers (deduplicated from `add_international_text`).
- **`src/errors.ts`** — `GovernanceError` (`GOVERNANCE_VIOLATION`).
- **`src/output.ts`** — `writeSandboxedText()`; `resolveSandboxedPath()` parameterised on the allowed extension (reuses every existing guard: relative path, no traversal, no NUL, extension enforcement).
- **Governance contract files** — `.github/ai-governance.json` (machine-readable), `.github/AGENT_RULES.md` (agent-and-human protocol), `.github/drafts/README.md`; `scripts/verify-issue.mjs` CLI (`npm run verify:issue`) mirroring `validateIssueMarkdown()`.
- **Docs** — new [`docs/guides/AI_GOVERNANCE.md`](../../docs/guides/AI_GOVERNANCE.md) (HITL contract + `draft_governance_issue` workflow).
- **Examples** — `annotate-pdf.json`, `draft-governance-issue.json`, `math-symbols.json`, `page-labels-inspect.json` (executable, guarded by examples-as-tests).
- **Tests** — `annotate-pdf.test.ts`, `draft-governance-issue.test.ts`, `governance.test.ts` (asserts the tool, the `verify:issue` CLI, and the repo contract files stay aligned), `fonts.test.ts`; extended `server.test.ts` (prompts + 19 tools), `inspect-pdf.test.ts` (`pageLabels`), `output.test.ts` (`.md` writer).

### Changed
- **Dependency:** `pdfnative` `^1.4.0` → `^1.5.0` (additive — annotation writer + page-label reader).
- **MCP `_meta.apiVersion`** bumped `1.3.0` → `1.4.0` on every tool; `SERVER_VERSION`, `server.json` versions, and `package.json` version → `1.4.0`.
- **Server:** `SERVER_DESCRIPTION` and `SERVER_INSTRUCTIONS` extended to **19 tools** (governance decision branch + corrected math note — explicit lang, **not** global auto-routing); `capabilities` now include `prompts`.
- **Tool count assertion** in `tests/server.test.ts` — 17 → 19; prompt assertions added.
- **Docs:** README, `AGENTS.md`, `docs/AI_GUIDE.md`, `docs/API_STABILITY.md`, `docs/KNOWLEDGE_BASE.md`, `docs/guides/LOCAL_TESTING.md`, `ROADMAP.md`, `llms.txt`, and `.github/copilot-instructions.md` refreshed for the 19-tool / pdfnative-1.5 surface.

### Deferred (with rationale)
- **`redact_pdf`** — deferred **by design**. pdfnative 1.5's annotation writer can only *overlay* content; an overlay-only "redaction" would leave the original bytes intact and create false security. Blocked on an upstream true content-removal API.
- **Encrypted-PDF round-trip fixtures** — once pdfnative exposes a Standard Security Handler writer.

## Reviewer checklist

- [ ] CHANGELOG.md v1.4.0 entry mirrors `release-notes/v1.4.0.md`
- [ ] `package.json` version === `server.json` versions === `SERVER_VERSION` === `src/version.ts` === `1.4.0`
- [ ] Tool count assertion in `tests/server.test.ts` equals 19; list includes `annotate_pdf`, `draft_governance_issue`
- [ ] Every tool exposes `_meta.apiVersion === '1.4.0'` and a non-empty `_meta.examples` array
- [ ] **`draft_governance_issue` makes zero network calls** and never writes to GitHub (no `fetch`/http/child_process/GitHub SDK anywhere); a `fetch` spy assertion covers it
- [ ] `draft_governance_issue` rejects a runtime-dependency proposal, a missing reproduction block, and `duplicateSearchPerformed:false` with `GOVERNANCE_VIOLATION`
- [ ] `validateIssueMarkdown()` in `src/governance.ts` stays byte-aligned with `scripts/verify-issue.mjs` (asserted by `governance.test.ts`)
- [ ] `annotate_pdf` maps all 9 types correctly, bounds-checks `page`, and rejects encrypted sources with `ENCRYPTED_SOURCE` — and is documented as overlay, **not** redaction
- [ ] `inspect_pdf` surfaces `pageLabels[]` when present and omits it when absent
- [ ] `add_international_text` `math` lang embeds the Noto Sans Math face **only when requested** (no global auto-routing); doc claims match
- [ ] MCP `prompts` capability advertised; `ListPrompts`/`GetPrompt` return `governance_contract` + `draft_issue_workflow`
- [ ] `writeSandboxedText` reuses the full sandbox guard set (relative path, no traversal, no NUL, `.md` extension); file-mode drafts stay inside `PDFNATIVE_MCP_OUTPUT_DIR`
- [ ] `server.json` validates against the MCP registry schema
- [ ] No `any` added in `src/`; no new CodeQL alerts
- [ ] Test coverage ≥ vitest thresholds (88 / 75 / 85 / 90)

## Notes for the merger

- No breaking changes; minor bump per [`docs/API_STABILITY.md`](../../docs/API_STABILITY.md) §3 (2 new tools + additive optional output field + new enum value + new prompts capability + a tool-scoped new error code).
- `redact_pdf` is intentionally **not** shipped — see the deferral rationale above; do not treat its absence as an oversight.
- Publish is via GitHub Actions Trusted Publishing (OIDC) — no `NPM_TOKEN`.
- GitHub Release title: `v1.4.0 — AI governance + HITL, markup annotations, pdfnative 1.5`.
