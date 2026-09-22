# release: v1.7.0 — fine typography, CMYK, PDF/X-4, 27 scripts, reproducible output, pdfnative 1.8

> **Branch:** `release/v1.7.0` → `main`
> **Type:** Minor release (additive, fully backward-compatible with v1.6.0)
> **pdfnative pin:** `^1.7.0` → `^1.8.0`
> **Prepared:** 2026-09-21 — release note: `release-notes/v1.7.0.md`

## Summary

For a user of an MCP host, 1.7.0 makes the same 28 tools do more: fine typography on every document tool (paragraphs that split with orphan / widow control, justified text with optical margins, French punctuation spacing, unit and short-word binding, OpenType features, kerning, exact base-14 metrics), CMYK colours wherever a colour is accepted, PDF/X-4 output with CMYK or Gray output intents and colour bars, a structural PDF/X-4 check in `validate_pdf`, 27 Unicode scripts (Lao, Tai Tham, New Tai Lue, Tai Le and Cham join, with Hausa / Yoruba / Igbo / Swahili as `latin` aliases), and output that is byte-identical on every host and time zone once an instant is pinned — by the caller, or now by the operator (`PDFNATIVE_MCP_CREATION_DATE`, `SOURCE_DATE_EPOCH`).

For an agent calling the tools, every new input is opt-in and described where it is used, every limit is stated (no hyphenation dictionary, no bundled press profile, PDF/X validation is structural and not a certified preflight, `tnum` / `lnum` are no-ops on Noto Sans), two new error codes are reachable only under `strict: true`, and a damaged PDF can no longer produce an uncoded failure. The consumer contract moved, unchanged in structure, to `docs/AGENT_CONTRACT.md`; a seventh prompt, `typography`, joins the six.

For the repository, this release adopts the engineering standard of pdfnative 1.8.0 and pdfnative-cli 1.5.0: one quality gate (`scripts/gate.ts`, fast / ci / publish profiles, the built server driven over stdio with stdout purity enforced), nine hardened workflows with blocking veraPDF, SBOM and provenance attestation and Trusted Publishing, a 96-sample byte baseline, a 41-file conformance corpus checked by veraPDF and by the in-process PDF/X validator, an engine-surface traceability matrix (85 engine changelog bullets → 34 tested, 51 waived in writing), a seeded fuzz suite, docs-as-code (`docs/assets/ecosystem.json` + `npm run verify:docs`, 24 rules), a committed agent layer (settings, fail-closed guard hook on Bash and PowerShell, generated rules, release-audit skill) and `scripts/release-prepare.ts`. ROADMAP items delivered: engine #74 (AcroForm font under PDF/A) and #75 (`toc` height in `inspect_layout`) closed upstream and adopted; veraPDF blocking; reproducible output; CMYK / PDF/X-4; the 27-script surface.

Counts (`docs/assets/ecosystem.json`): 28 tools, 7 prompts (6 → 7), 47 error codes (45 → 47), 12 operator variables (10 → 12); examples 32 → 43; samples in the baseline 0 → 96 (first baseline); conformance corpus 26 → 41 files; tests 937 → 1624 across 96 files.

## What changed

### Engine surface (`src/tools/`, shared fragments in `src/*.ts`)
- `typography` (12 keys, `src/typography.ts`) on the nine document tools (`generate_basic_pdf`, `add_table`, `add_chart`, `add_barcode`, `embed_image`, `add_form`, `add_international_text`, `add_attachment`, `prepare_signature_placeholder`) and on `inspect_layout`; paragraph blocks gain `align` (`left` / `right` / `center` / `justify`), `keepWithNext`, `splittable`; heading blocks gain `keepWithNext` (`generate_basic_pdf`, `inspect_layout`).
- CMYK colours (`src/color.ts`): every colour input keeps its 1.6.0 form and accepts a `'c m y k'` operand string (0–1) and a `[c, m, y, k]` percent tuple (0–100) — watermarks, header / footer templates, table `cellBorders`, outline entries, chart colours, `link` and `svg` blocks, `annotate_pdf` (tuple).
- `pdfx: 'pdfx4'` (`src/pdfx.ts`) on `generate_basic_pdf`, `add_table`, `add_chart`, `add_barcode`, `embed_image`, `add_international_text`; five incoherent combinations refused as `VALIDATION_ERROR` before the build; `outputIntent` accepts CMYK and Gray profiles; `print.marks.colourBars` (`true` | `{ tints, size }`).
- `validate_pdf.standard` (`'pdf-ua-1'` default | `'pdf-x-4'`), output `standard` and, for PDF/X only, `caveats[]`; `inspect_pdf` output `pdfX` (presence-gated) and check `'pdfx'`.
- `add_international_text.lang`: `lo`, `nod`, `khb`, `tdd`, `cjm`, and the `latin` aliases `ha`, `yo`, `ig`, `sw` (27 scripts).
- Diagnostics (`src/diagnostics.ts`): the nine engine codes enumerated from the engine's type; `strict` escalates by code — `PDFA_*` → `PDF_A_COMPLIANCE_VIOLATION`, `PDFX_*` → `PDF_X_COMPLIANCE_VIOLATION` (new), other → `DIAGNOSTIC_ESCALATED` (new); `strict` is no longer forwarded to the engine; `mapBuildError` classifies on the bare message, PDF/X before OutputIntent.
- Fixes: a 0–1 RGB triple was handed to the engine as a 0–255 tuple (`[1, 0, 0]` rendered almost black); an uncoded failure on a damaged PDF is now `PDF_PARSE_FAILED` (`classifyUnexpected` at the `tools/call` boundary); a stale `EXTRACTION_UNSUPPORTED` comment, colour-bar wording and the `print_ready` duplex value corrected.

### Server (`src/server.ts`, transports, prompts, resources)
- `TOOL_API_VERSION` `1.6.0` → `1.7.0`; `cacheNamespace()` carries the creation-date pin; `classifyUnexpected` / `takesPdfInput` net.
- `src/reproducible.ts`: `PDFNATIVE_MCP_CREATION_DATE` → `SOURCE_DATE_EPOCH` → wall clock, read once in `src/cli.ts`, invalid value refuses to start, source logged on stderr.
- Prompts: `typography` added; `print_ready`, `reproducible_output`, `pdfa_valid` rewritten; `SERVER_INSTRUCTIONS` decision tree extended; every "same host time zone" caveat removed (dates are UTC).
- `server.json`: registry schema `2025-12-11`, `SERVER_TITLE` parity, 12 environment variables.

### Tooling (`scripts/`)
- `gate.ts` (fast / ci / publish; inline `dist-check`, `dist-probe`, `smoke`, `server-json`), `generate-samples.ts` + `verify-samples.ts` + `lib/sample-fingerprint.ts` (bytes / semantic, chained baseline), `generate-pdfa-corpus.ts` / `validate-pdfa.ts` / `validate-pdfx.ts` (TypeScript, exit codes 0 / 1 / 2), `tool-shape.ts`, `verify-docs.ts` (24 rules) + `lib/mcp-surface.ts`, `release-prepare.ts`, `build-claude-rules.ts`, `lib/json-schema-lite.ts`, `helpers/hermetic.ts`; `scripts/README.md`.

### CI / repository (`.github/`, root)
- Nine workflows (`ci` with Node 22 / 24 and a `windows` job, `publish` with the protected `npm-publish` environment, tag = version check, SBOM + attestation, `sample-regression`, `verapdf` blocking, `docs`, `codeql`, `scorecard`, `dependency-review`, `audit`); `harden-runner`, `persist-credentials: false`, `npm ci --ignore-scripts`, one SHA per action; `.github/rulesets/{main,tags}.json`; `dependabot`, `CODEOWNERS`, PR template mirrored in CONTRIBUTING.
- `.npmrc` (`ignore-scripts=true`), `.node-version`, `.gitattributes`, `.githooks/` + `hooks:install`, `.vscode/settings.json`, `tsconfig.scripts.json`, vitest under `TZ=UTC` with forks and the gate reporters; `package.json` scripts named like the siblings, description and keywords extended; version lock-step (`package.json`, `src/version.ts`, `server.json` ×2, `CITATION.cff`, `SECURITY.md`).
- Coverage thresholds raised: branches 80 → 82, functions 90 → 94 (statements 89 and lines 91 unchanged).
- Parity with the siblings, after the final review: `no-console` (warn / error allowed — stdout is the JSON-RPC channel) and `@typescript-eslint/no-shadow` in `eslint.config.js` (the latter found one real shadowing in `verify_pdf`'s P-256 verifier, renamed); `esbuild` pinned through `overrides` to the resolved `0.28.2`; `.gitignore` (`.env.*`, `*.tgz`, the scheduled-tasks lock) and `.editorconfig` (Markdown keeps trailing spaces) in the siblings' form; `THIRD-PARTY-NOTICES.md` shipped in the package (`files`).

### Agent layer
- `AGENTS.md` (≤ 120 lines, repository rules), `CLAUDE.md` = `@AGENTS.md` + addendum, `docs/AGENT_CONTRACT.md` (the former §1–§6), `.claude/settings.json` (no commit attribution, Read denies, HITL denies for Bash and PowerShell), `.claude/hooks/guard.mjs` (verbatim from the siblings, wired to both matchers), `.claude/rules/` generated from `.github/instructions/`, `.claude/skills/release-audit/`, `.github/prompts/{quality-gate,compliance-audit}`, `.github/ai-governance.json` 1.1.0 with the `claude_code` block, `.github/copilot-instructions.md` rewritten.

### Tests, examples and samples
- New suites: `color`, `typography`, `pdfx`, `validate-pdfx`, `reproducible`, `reproducible-build` (two time zones over the built server), `scripts-27`, `diagnostics-triggers`, `build-errors`, `engine-surface` + `engine-surface.fuzz`, `upstream-limits`, `samples-regression`, `prose-language`, and `tests/tools/` (workflows, guard, agent-config, build-claude-rules, gate, verify-docs, mcp-surface, release-prepare, json-schema-lite, hermetic-env, verapdf, pdfx, markdown-anchors).
- Eleven new examples (typography-report, typography-french, typography-exact-metrics, cmyk-colours, print-colour-bars, pdfx4-gray, pdfx4-cmyk-validate, scripts-lao-tai-cham, african-languages, emoji-skin-tones, reproducible-footer-date).
- Corpus 26 → 41 files (33 PDF/A claims incl. 6 negative canaries, 6 PDF/X-4 incl. 2 canaries, 2 page-tree outputs); `form-pdfa2b.pdf` turned positive (engine #74); Tai Tham split into a `pdfa2b` positive and a `pdfa2u` canary.
- First sample baseline: `tests/_fixtures/samples.sha256.json`, 96 entries anchored at 1.7.0 (94 by bytes, 2 semantic: one encrypted, one signed).

### Documentation
- README, llms.txt, `docs/AGENT_CONTRACT.md`, `docs/AI_GUIDE.md`, `docs/KNOWLEDGE_BASE.md`, `docs/API_STABILITY.md` (1.7.0 matrix, accepted deltas, engine-inherited byte changes 1.7 → 1.8), new `docs/guides/TYPOGRAPHY.md` and `docs/guides/REPRODUCIBLE.md`, every existing guide, `SECURITY.md` (cryptographic verification scope of `verify_pdf`, reproducible builds, supply chain), `THIRD-PARTY-NOTICES.md` (new), `CONTRIBUTING.md` (the gate, samples, corpus, manifest, agent contract, release, engine pin, branch protection), `ROADMAP.md` (1.7.0 released, next, blocked upstream), `CHANGELOG.md` (mirror + compare-link ladder), `CITATION.cff`, `release-notes/v1.7.0.md`, `release-notes/{TEMPLATE,PR_TEMPLATE}.md`, `.github/drafts/{TEMPLATE,README}.md`.

## Verification

What actually ran on the release branch (Windows 11, Node v22.17.0, veraPDF 1.30.2):

| Command | Result |
|---|---|
| `npx tsx scripts/gate.ts --publish --require-all` | `gate: 15 passed, 0 skipped in 437.6 s (re-run after the parity commits; 453.2 s before them)` |
| `npm run test:coverage` — tests | 1609 passed, 13 expected fail (pinned upstream limits), 2 skipped = 1624 across 96 files |
| `npm run test:coverage` — coverage | 93.53 % statements / 86.08 % branches / 98.88 % functions / 95.45 % lines (thresholds 89 / 82 / 94 / 91) |
| `npm run build && npm run test:generate && npm run verify:samples` | `96 tracked samples match the baseline (94 byte-exact, 2 semantic)` |
| `npm run corpus:pdfa && npm run validate:pdfa` | `27 PASS, 6 XFAIL, 0 FAIL, 0 XPASS, 0 INFRA, 8 SKIP (of 33 validated)` — veraPDF 1.30.2 |
| `npm run validate:pdfx` | `4 PASS, 2 XFAIL, 0 FAIL, 0 XPASS (of 6 validated)` |
| `npm run verify:docs` | `24 rules passed across 33 files (88 warnings: eol-lf ×88)` — the CRLF warnings clear with the renormalisation commit |
| `npm audit --audit-level=high` | `found 0 vulnerabilities` |
| Built server over stdio (`node dist/cli.js`) | gate `smoke`: handshake answered, `tools/list` = 28 tools, `serverInfo.version` = 1.7.0, stdout carried JSON-RPC frames only, clean exit |

Independent audit: `/release-audit release-notes/v1.7.0.md v1.6.0` — **GO** (ledger under `.audit/1.7.0/`, git-ignored). Two auditors (60 + 38 rows), one adversarial verifier: 10 findings confirmed (0 blocker, 1 major, 9 minor), 0 downgraded, 0 rejected, 2 duplicates; the four rows left unverified by the auditors were re-run by the verifier and hold. Every confirmed finding is fixed on the branch: the major one (the `pades_ladder` prompt named a `PDFNATIVE_MCP_REVOCATION` value the server refuses — pre-existing since 1.6.0) in `ff97b81`; the nine minor ones (wording of the `pdfx` prerequisite, `check` vs `checks`, the UTC qualification of the byte-identity claim, the `.mjs` sentence, a stale example description, an exit-code sentence, an invisible U+00AD in a guide, illustrative A4 boxes, a catalogue size) in `4785f97` / `ff97b81`. No waiver.

## API stability

- `TOOL_API_VERSION`: `1.6.0` → `1.7.0` because the input or output schema of 13 tools changed (new optional inputs and output fields) and two error codes were introduced (docs/API_STABILITY.md §5, "v1.7.0 minor bump rationale").
- Superset gate: `tests/catalogue-superset.test.ts` passes against the frozen `tests/_fixtures/tool-shape.v1.5.0.json` — no tool, property or enum value removed, no new `required`, no tighter bound.
- Accepted deltas: one new rule — a legacy colour schema may widen into an `anyOf` whose first member is the old schema verbatim (`CMYK_WIDENING`, held to the reviewed sites); `ACCEPTED_DELTAS` unchanged since 1.6.0.
- `tests/_fixtures/tool-shape.json`: refreshed deliberately with `npx tsx scripts/tool-shape.ts --write` (2979 insertions, 223 deletions) — the `typography` fragment on 10 tools, `pdfx` on 6, the widened colour schemas, `colourBars`, `validate_pdf.standard` / `caveats`, `inspect_pdf.pdfX` / check `'pdfx'`, five `lang` values and four aliases, the paragraph / heading block keys.
- Error codes: `PDF_X_COMPLIANCE_VIOLATION` and `DIAGNOSTIC_ESCALATED`, reachable only by a call that sets `strict: true`; `PDF_PARSE_FAILED` now also classifies an unexpected failure on damaged PDF input; documented in `docs/AGENT_CONTRACT.md` §6 (47 codes).

## Output changes and rebaseline

- Default responses of existing tools: byte-identical, with one server-side correction — a 0–1 RGB triple on `watermark.color` and the `annotate_pdf` colours now renders the colour it names (the previous output was wrong).
- Bytes inherited from the engine (each a correction, listed in `release-notes/v1.7.0.md` → Upgrade): documents embedding a TrueType subset (hinting tables kept, `checkSumAdjustment` computed), documents drawing `print.marks` (marks stop 0.5 pt short of the trim line), shaped text in every script with mark positioning, dates written in UTC, `{date}` following `creationDate`, `/ActualText` returned by `extract_text`, hand-made ICC stubs rejected (`PRINT_ERROR`). Documents on base-14 fonts without those features are byte-identical.
- `tests/_fixtures/samples.sha256.json`: first baseline — 96 entries anchored at 1.7.0 (`since: "1.7.0"`), the forced output of `chainSince` when no previous manifest exists and the convention pdfnative-cli followed for its own first baseline (91/91 at 1.5.0); provenance note in the manifest; declared in the release note. No earlier baseline existed to rebaseline from.
- Every item above is declared in the Upgrade section of `release-notes/v1.7.0.md`.

## Out of scope (tracked in ROADMAP.md)

- Blocked upstream, each pinned by an `it.fails` test that goes red the day the engine lifts it: `ecdsaVerifyHash` not exported (`verify_pdf` keeps its local P-256 verifier); `extractText` swallows a decode failure under the inflate cap; no helper composes `LtvData` from flat lists (`add_ltv` offline keeps its own composition); Tai Tham under PDF/A-2u lacks one ToUnicode entry (use `pdfa2b`); untagged extraction returns visual order for eleven scripts. Issue drafts for the engine are prepared locally and are not part of this branch.
- Deferred by design: custom fonts (`PDFNATIVE_MCP_FONT_DIR`), a `link` annotation in `annotate_pdf`, `redact_pdf`, per-tool HTTP page streaming, OCR, the opt-in telemetry hook; making the `windows` job a required check; `harden-runner` in block mode; automated MCP registry publication.

## Maintainer steps after merge

Agents stop at this draft; everything below is done by the maintainer (`.github/AGENT_RULES.md`).

1. The LF renormalisation commit (`git add --renormalize .`, then flip `EOL_LF_MODE` to `'fail'` in `scripts/lib/agent-config.ts`) — 87 tracked text files (plus one with mixed endings) are still CRLF in the index.
2. Push the branch, open the pull request with this body, wait for `ci (22)`, `ci (24)` and `sample-regression`, merge. First run: confirm `harden-runner` behaves on `windows-latest` (the `windows` job).
3. Tag `v1.7.0` on the merge commit and publish the GitHub Release (title `v1.7.0 - Fine typography, CMYK, PDF/X-4, 27 scripts, reproducible output, pdfnative 1.8`, body = `release-notes/v1.7.0.md`).
4. Before approving: create the protected `npm-publish` environment and bind the npm Trusted Publisher to it. Then approve: `publish.yml` re-runs the publish gate and publishes through npm Trusted Publishing, then attaches the SBOM and the attestation to the release. Confirm with `npm view pdfnative-mcp version`.
5. Validate and publish `server.json` to the MCP registry (`npx -y @modelcontextprotocol/publisher@latest validate server.json`, then the registry publication).
6. Import the rulesets (`.github/rulesets/main.json`, `.github/rulesets/tags.json`) — CONTRIBUTING §Branch protection.
7. Update the `pdfnative-mcp` entry of `docs/assets/ecosystem.json` in the sibling repositories (pdfnative, pdfnative-cli).
8. Review and submit the five upstream issue drafts for pdfnative (ecdsaVerifyHash export, extractText under the inflate cap, Tai Tham ToUnicode under PDF/A-2u, MarkupAnnotation `link`, LtvData helper) — prepared locally under `.github/drafts/`, deliberately left out of this branch.

## Checklist

- [x] `npm run gate` passes — the CI profile in one command (`npm run gate:fast` for a quick loop while iterating; PowerShell swallows a bare `--`, so call `npx tsx scripts/gate.ts --fast` there)
- [x] All tests pass (`npm run test`)
- [x] Type check passes (`npm run typecheck:all`)
- [x] Lint passes (`npm run lint`)
- [x] New code has tests (coverage thresholds in `vitest.config.ts` must not regress)
- [x] No `any` types introduced
- [x] No new runtime dependencies added (`pdfnative`, `@modelcontextprotocol/server` and `zod` stay the only three)
- [x] A new or changed tool touches every wiring point: `src/tools/<name>.ts` (JSON Schema and the parallel Zod schema in lock-step), the `TOOLS` registry in `src/server.ts`, `tests/<name>.test.ts`, `examples/`, README, `docs/AGENT_CONTRACT.md`, `llms.txt`, `docs/API_STABILITY.md`
- [x] If a tool schema or an error code changed: `npm run build && npx tsx scripts/tool-shape.ts --write` refreshed `tests/_fixtures/tool-shape.json` deliberately, `tests/catalogue-superset.test.ts` still passes against the frozen 1.5.0 fixture, and `TOOL_API_VERSION` was reviewed under `docs/API_STABILITY.md`
- [x] If samples, PDF/A or PDF/X behaviour changed: `npm run build && npm run test:generate && npm run verify:samples && npm run corpus:pdfa && npm run validate:pdfx && npm run validate:pdfa` passes locally (veraPDF installed; new claiming corpus entries bump `declared.pdfaSamples` / `declared.pdfxSamples`; an intended output change is rebaselined with `npx tsx scripts/verify-samples.ts --update` and declared in the release note)
- [x] If docs, README, llms.txt, AGENTS.md, CLAUDE.md or `.claude/` changed: `npm run verify:docs` passes
- [x] CHANGELOG.md updated if user-facing changes
- [x] For releases: `release-notes/vX.Y.Z.md` and this draft written, and `npx tsx scripts/gate.ts --publish --require-all` passes locally, which runs every individual gate: `typecheck:all`, `lint`, `build`, `dist-check`, `dist-probe`, `smoke`, `verify:tool-shape`, `server-json`, `test:generate`, `test:coverage`, `verify:docs`, `verify:samples`, `corpus:pdfa`, `validate:pdfx`, `validate:pdfa`
- [x] Every figure above was produced by a command on this branch, not typed from memory
- [x] `release-notes/vX.Y.Z.md` and the CHANGELOG entry for X.Y.Z say the same things as this body
- [x] No `Co-Authored-By` trailer and no "generated with" footer anywhere on the branch
