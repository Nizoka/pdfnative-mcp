# release: v1.8.0 — pdfnative 1.9.0: spot colours, right-to-left documents, the PDF/X-4 + PDF/A-2 dual claim, JPEG 2000, custom fonts, and the hardened release pipeline

> **Branch:** `release/v1.8.0` → `main`
> **Type:** Minor release (additive, fully backward-compatible with v1.7.0)
> **pdfnative pin:** `^1.8.0` → `^1.9.0`
> **Prepared:** 2026-11-01 — release note: `release-notes/v1.8.0.md`

## Summary

For a user of an MCP host, 1.8.0 exposes the whole pdfnative 1.9.0 surface through the existing 28 tools: spot colours and ink mixes (`print.spotColours`, `{ spot, tint }` / `{ inks }` at every colour site), right-to-left and bidirectional documents (`direction`, `actualText`, per-paragraph `direction`), one file claiming both PDF/X-4 and PDF/A-2b or 2u, JPEG 2000 images (`image/jp2`) on `embed_image`, the `image` block and watermarks, `annotate_pdf { type: 'link' }`, per-value chart colours and optional series labels, five more Indic scripts (32 in all), `extract_text { onStreamError }`, `add_ltv { match }`, and four more engine diagnostics (13). Nothing is reimplemented in the server: every feature is an engine export passed through, and the local P-256 verifier is deleted in favour of `ecdsaVerifyHash()`.

For an agent calling the tools, two operator knobs close the two user issues and the oldest ROADMAP *Next* item: `PDFNATIVE_MCP_FONT_DIR` registers the operator's `.ttf` / `.otf` faces at boot (`font` input on `add_international_text`, `generate_basic_pdf`, `inspect_layout`; the one new error code, `FONT_NOT_FOUND`), `PDFNATIVE_MCP_OUTPUT_BASE_URL` gives every file-mode result a public `url` (issue #66), and `prepare_signature_placeholder.blocks` takes 5000 items so llama.cpp's grammar compiler accepts the catalogue (issue #65). Closes #65. Closes #66. The AI-governance contract is served as two static resources; a call carrying `password` is never cached; `extract_text` fails with a coded error on an over-cap stream instead of returning an empty page.

The repository adopts the pdfnative 1.9.0 pipeline: `publish.yml` is guard → build → publish → attest → registry (Trusted Publishing, SHA-512-pinned npm client, registry bytes attested with three SBOMs, `server.json` published to the MCP registry by OIDC), `workflow-lint` (zizmor + actionlint) is a required check, ClusterFuzzLite fuzzes five boundary targets, Node 26 runs the gate as an advisory job, the Linux jobs run in egress block mode, CodeQL scans the workflows, and a `pack-manifest` gate step holds the published file set. Every open Dependabot alert (37–49), every CodeQL alert (10, 11, 12, 16, 17) and the actionable Scorecard findings (2, 5, 7, 14, 15; 4 and 13 accepted and documented; 1 and 6 are maintainer steps below) are closed on this branch; the nine Dependabot pull requests (#29, #60, #62, #63, #64, #67, #68, #69, #70) are superseded by it. Every ROADMAP item unblocked by 1.9.0 and every item under *Next* at 1.7.0 is delivered; the new *Next* list holds the toolchain majors, the Tier-2 catalogue compaction, a fuzz-corpus storage repository, the remaining audit-mode jobs and the OpenSSF badge.

Counts (`docs/assets/ecosystem.json`): 28 tools, 7 prompts, 48 error codes (47 → 48), 14 operator variables (12 → 14); examples 43 → 51; samples in the baseline 96 → 112; conformance corpus 41 → 45 files; tests 1631 → 1804 across 103 files.

## What changed

### Engine surface (`src/tools/`, shared fragments in `src/*.ts`)
- `src/color.ts`: two `anyOf` members on every colour property (46 sites) — `{ spot: string, tint?: 0–1 }` (`/Separation`) and `{ inks: Record<string, number> }` (`/DeviceN`); `src/print.ts`: `print.spotColours[] { name, alternate: [c,m,y,k] | [r,g,b] }` (≤ 32) on the nine document tools. An undeclared ink is `VALIDATION_ERROR` naming it; an empty or duplicate declaration is `PRINT_ERROR`.
- `src/layout.ts`: `direction: 'auto' | 'ltr' | 'rtl'` and `actualText: boolean` (default true) on the nine document tools and `inspect_layout`; paragraph `direction` in `generate_basic_pdf` / `inspect_layout`. Omitted, the bytes are those of 1.7.0.
- `src/pdfx.ts`: `pdfx: 'pdfx4'` combines with `pdfA: 'pdfa2b' | 'pdfa2u'`; `pdfa1b` / `pdfa3b` refused before the build with the engine's messages. `validate_pdf { standard: 'pdf-x-4' }` caveats describe the 1.9.0 check (colour inside Form XObjects, images and Separation / DeviceN alternates).
- `src/image.ts`: `mimeType: 'image/jp2'` (JP2 signature box or raw J2K codestream) on `embed_image`, the `image` block and `watermark.image`; `src/chart.ts`: `series[].colors` per value, `label` optional; `annotate_pdf`: type `link` with `rect` and `url` (`http:` / `https:` / `mailto:`, no control characters).
- `add_international_text.lang`: `gu`, `pa`, `kn`, `ml`, `or` (32 scripts); `font` input on `add_international_text`, `generate_basic_pdf`, `inspect_layout` (`src/font-dir.ts`, `FONT_NOT_FOUND`).
- `extract_text.onStreamError: 'limit' | 'skip'` (default `limit` → `PDF_PARSE_FAILED` naming `PDFNATIVE_MCP_MAX_INFLATE_BYTES`; `PdfStreamLimitError` classified by `code === 'PDF_STREAM_LIMIT'`); `add_ltv.match: 'all' | 'chain'` over the engine's `composeLtvData()`; `verify_pdf` on `ecdsaVerifyHash()`; `inspect_pdf` decodes `/Info` strings with `decodePdfTextString()`; `embed_image` keeps the code of a strict diagnostic; `prepare_signature_placeholder.blocks` maxItems 2000 → 5000.
- `src/diagnostics.ts`: `PDFA1_JPX_IMAGE`, `PDFA_JPX_IMAGE`, `PDFA_GLYPH_WITHOUT_UNICODE`, `TEXT_GLYPH_NOT_COVERED` (13 codes); `PDFA\d*_` escalates like `PDFA_`.

### Server (`src/server.ts`, transports, prompts, resources)
- `TOOL_API_VERSION` `1.7.0` → `1.8.0`; output schemas gain `url` (single file, `split_pdf` parts, `draft_governance_issue`); the text block names `url` when `PDFNATIVE_MCP_OUTPUT_BASE_URL` is set.
- `src/output.ts`: `PDFNATIVE_MCP_OUTPUT_BASE_URL` (absolute `http(s):` URL, no credentials / query / fragment, requires `PDFNATIVE_MCP_OUTPUT_DIR`; the server never requests it). `src/font-dir.ts`: `PDFNATIVE_MCP_FONT_DIR` (≤ 64 files, ≤ 16 MiB each, `parseFontData` before `registerFont`, slug collisions refused). Both validated at boot in `src/cli.ts`; `server.json` declares 14 variables.
- `src/resources.ts`: `pdfnative://governance/policy` and `pdfnative://governance/rules`, always listed, served from the generated `src/governance-embed.ts`.
- `isCacheable`: a call carrying `password` is never persisted (CodeQL 11).

### Tooling (`scripts/`)
- `scripts/gate.ts`: inline step `pack-manifest` (CI and publish profiles; `tests/_fixtures/pack-manifest.json`, two byte-identical packs).
- `scripts/verify-docs.ts`: rules `governance-embed`, `keyword-count`; `THIRD-PARTY-NOTICES.md` in the verified set; `node-current` allowed in the Node-pin parity; `escapeRegExp` (`scripts/lib/escape-regexp.ts`, CodeQL 12 / 16 / 17).
- `scripts/build-governance-embed.ts` (`npm run agents:governance`); `scripts/lib/jpx.ts` (synthetic JP2 / J2K for examples, corpus and tests); `scripts/lib/example-runner.ts` placeholder `<synthetic RGB JP2, base64>`; `scripts/lib/tool-shape.ts` budget 320 → 384 KiB (deliberate, `docs/API_STABILITY.md` §5).
- `scripts/lib/pdfa-corpus.ts`: claim `'both'`; five new entries; the Tai Tham PDF/A-2u canary flipped to compliant; `scripts/lib/mcp-surface.ts` counts a dual claim for both standards.

### CI / repository (`.github/`, root)
- `publish.yml` (guard → build → publish → attest → registry), `ci.yml` (no `paths-ignore`, `workflow-lint`, block-mode egress), `codeql.yml` (job-level permissions, `actions` + `javascript-typescript`, `security-extended`), `fuzz.yml` (ClusterFuzzLite), `node-current.yml` (Node 26 advisory), `sample-regression.yml` / `verapdf.yml` / `audit.yml` / `dependency-review.yml` / `docs.yml` (`env:` instead of `${{ }}` in `run:`, block mode where egress is known); every action pinned to one SHA per action across the tree; `.github/actions/setup-verapdf` exposes `home`.
- `.github/dependabot.yml` (7-day cooldown, four ecosystems incl. `.clusterfuzzlite/engine` and its image); `.github/rulesets/main.json` requires `workflow-lint`; `.clusterfuzzlite/` (project, Dockerfile by digest, `build.sh`, Jazzer.js 4.0.0 engine with its own lockfile); `fuzz/` (five targets) and `src/fuzz-surface.ts`.
- `package.json`: `pdfnative ^1.9.0`, `@modelcontextprotocol/server ^2.4.0`, `zod ^4.6.0`, vitest / coverage 4.1.12, description and keywords for discoverability; `server.json` 1.8.0 with 14 variables; `CITATION.cff`; `.github/ai-governance.json` `verification.validator_covered_by`.

### Agent layer
- `AGENTS.md` (≤ 120 lines) and `CLAUDE.md` (the pair under 16 KiB) rewritten for the 1.8.0 tree: counts, the gate profiles with `pack-manifest`, `src/font-dir.ts` / `fuzz/` / `.clusterfuzzlite/` in *Where is what*, token discipline for the large fixtures and `tools/list`, the Windows session notes, hooks and permissions in force.
- `.github/instructions/*.instructions.md` (security: five-job pipeline, block mode, fuzz engine outside the manifest; mcp-server: spot / direction / font / base URL; testing: fuzz targets, the 72-bullet matrix; release: the registry job) → `npm run agents:rules`; `.github/copilot-instructions.md`; `.claude/settings.json` deny list (`.clusterfuzzlite/engine/package-lock.json`, `.audit/`); `.claude/skills/release-audit/auditor-b.md` (pipeline / fuzzing row).
- `docs/AGENT_CONTRACT.md` (catalogue, decision tree, §4 variables, §6 = 48 codes, *Client compatibility*), `docs/AI_GUIDE.md`, `llms.txt`.

### Tests, examples and samples
- New suites: `tests/engine-1-9.test.ts`, `tests/font-dir.test.ts`, `tests/output-base-url.test.ts`, `tests/client-compat.test.ts`, `tests/governance-resources.test.ts`, `tests/tools/synthetic-icc.test.ts`, `tests/fuzzing/targets.test.ts` (+ `_fuzz-seeds.ts`); `tests/scripts-27.test.ts` → `tests/scripts.test.ts` (32 scripts); `tests/tools/workflows.test.ts` rewritten for the new pipeline; `tests/upstream-limits.test.ts` (two markers lifted, one new `it.fails` for non-Latin-1 form values); `tests/ltv-tools.test.ts` (`match: 'chain'`).
- `tests/_fixtures/engine-surface.json`: 72 bullets of the 1.9.0 changelog, 37 tested / 35 waived; `pdfnative-build-errors.json` 33 messages; `tool-shape.json` regenerated; `pack-manifest.json` new.
- Eight new examples (51): `spot-colours`, `rtl-direction`, `dual-claim-pdfx-pdfa`, `jpeg2000-image`, `link-annotation`, `chart-per-value-colours`, `scripts-indic-1-9`, `extract-text-stream-policy`; `examples/README.md` indexes them.
- Baseline `tests/_fixtures/samples.sha256.json`: 112 entries — 52 re-anchored at 1.8.0 under the engine's byte ledger C1–C28, 43 unchanged, one more equal by its semantic fingerprint (the signed corpus entry), 16 new; four causes (C9–C12) reach base-14 documents too; `provenance` note appended. Corpus: 45 files (37 claiming PDF/A with 5 negative canaries, 7 PDF/X-4 including the dual claim).

### Documentation
- `release-notes/v1.8.0.md`, `CHANGELOG.md` (+ compare link), `ROADMAP.md` (v1.8.0 released; *Blocked upstream* = `redact_pdf`, the Thai tone-mark pair, non-Latin-1 form values; new *Next*), `docs/API_STABILITY.md` (§1, §5 v1.8.0 block), `docs/KNOWLEDGE_BASE.md`, `README.md` (matrix, badges, *Client compatibility*), `SECURITY.md` (runtimes, fuzzing, pipeline, accepted Scorecard findings, advisory link), `SUPPORT.md`, `CONTRIBUTING.md` (pack-manifest, fuzzing, release step 7, DCO), `docs/OPENSSF_BEST_PRACTICES.md` (new), `docs/guides/FONTS.md` (new), guides PRINT / TYPOGRAPHY / LTV / PDFA / CHARTS / ENCRYPTION / LOCAL_TESTING, `llms.txt`, `docs/assets/ecosystem.json`.

## Verification

What actually ran on the release branch (Windows 11, Node v22.23.2, veraPDF 1.30.2):

| Command | Result |
|---|---|
| `npx tsx scripts/gate.ts --publish --require-all` | gate --publish: 16 passed, 0 skipped in 611 s (typecheck:all, lint, build, dist-check, dist-probe, smoke `28 tools`, verify:tool-shape, server-json, pack-manifest, test:generate `112 samples`, test:coverage `1804 tests, 94.0% stmts`, verify:docs, verify:samples, corpus:pdfa, validate:pdfx, validate:pdfa) |
| `npm run test:coverage` — tests | 1800 passed, 2 expected failures (pinned engine limits), 2 skipped — 1804 across 103 files |
| `npm run test:coverage` — coverage | 94.02 % statements / 87.08 % branches / 99.13 % functions / 95.77 % lines (thresholds 90 / 83 / 95 / 92, raised from 89 / 82 / 94 / 91) |
| `npm run build && npm run test:generate && npm run verify:samples` | 112 tracked samples match the baseline (109 byte-exact, 3 semantic) |
| `npm run corpus:pdfa && npm run validate:pdfa` | 32 PASS, 5 XFAIL, 0 FAIL, 0 XPASS, 0 INFRA, 8 SKIP (of 37 validated) — veraPDF 1.30.2 |
| `npm run validate:pdfx` | 5 PASS, 2 XFAIL, 0 FAIL, 0 XPASS (of 7 validated) |
| `npm run verify:docs` | 28 rules passed across 37 files, 0 errors |
| `npm audit --audit-level=high` | clean (11 moderate remain, all in the ESLint 9 `minimatch` tree, closed by the ESLint 10 major listed under *Next*) |
| Built server over stdio (`node dist/cli.js`) | handshake `pdfnative-mcp 1.8.0`; `tools/list` 28 tools, 356 662 B, `_meta.apiVersion` 1.8.0 on every tool; 0 non-JSON-RPC stdout lines; spot colour / `direction` / five Indic scripts / `link` / `onStreamError` succeed; undeclared ink, bare `https:` link, a non-JP2 payload as `image/jp2`, `pdfx4` + `pdfa1b` are `VALIDATION_ERROR`; unknown `font` is `FONT_NOT_FOUND`; a registered face renders; `resources/list` = the two governance URIs; file mode under `PDFNATIVE_MCP_OUTPUT_BASE_URL` reports `url=https://files.example.com/pdf/reports/q3%20plan.pdf` and names it in the text; boot refuses a base URL without an output directory, a base URL ending in `?`, a relative `PDFNATIVE_MCP_FONT_DIR` (exit 1, reason on stderr) |

Independent audit: `/release-audit release-notes/v1.8.0.md v1.7.0` — to be invoked by the maintainer (the skill is reserved for explicit user invocation; agents cannot start it). A general-purpose verifier agent with a fresh context mapped the seventeen criteria of the release request to evidence on the branch before this draft was finalised (its table is summarised under *Verification* below).

Verifier agent (fresh context, 2026-10-31, before the final gate): 13 of 17 criteria CONFORMS at first pass; the four PARTIAL / NOT CONFORMING findings were fixed before this draft was finalised — `docs/AGENT_CONTRACT.md` carried a duplicated preamble and a truncated footnote ⁷ (repaired, one copy, 6 sections), `examples/README.md` indexed 43 of 51 examples (rebuilt from the files), `@types/node` was still 22.19.17 against pull request #67 (now 22.20.4), the `attest` job's `contents: write` was accepted only in a workflow comment (now in SECURITY.md §Accepted OpenSSF Scorecard findings), the ROADMAP line on transport fuzzing and the README line on block-mode egress overstated their scope (reworded), and the draft lacked the `Closes #65` / `Closes #66` keywords (added). Not verifiable locally: alert and issue closure (after merge), the Scorecard re-score (ruleset import, bestpractices.dev), the real pipeline run (needs the tag).

Release audit (2026-11-01, release day): two independent auditors — claims versus code and engine coverage; documents, counters, dates, line endings, CI and agent-facing surfaces — then an adversarial verifier that re-ran every evidence command: 35 rows, 28 CONFIRMED, 1 DOWNGRADED, 4 REJECTED, 2 DUPLICATE. Two blockers (`serverInfo.instructions` still said "pdfnative v1.8 … Tool API 1.7.0", pinned by a test; the `print_ready` prompt called PDF/X-4 exclusive with `pdfA`) and five majors (the decision tree without the 1.8.0 behaviours; seven stale "mutually exclusive" sentences across README, the guides, `llms.txt` and SECURITY.md; the `extract_text` description and `docs/AI_GUIDE.md` still describing the visual-order limit 1.9.0 lifted; the response cache blind to a replaced operator font; the engine causes C9–C12 missing from *Upgrade* while two base-14 watermark samples had moved under C11) were fixed before the final gate, with the minors: `onStreamError: 'throw'` exposed (the one engine option neither exposed nor waived), `ColumnDef.kind: 'amount'` recorded as a *Next* item, the per-filter stream-limit remedy, the matrix rows that cited a paragraph for a table fix and an `it.fails` for a passing one, `THIRD-PARTY-NOTICES.md` two minors behind `package.json` (now a `verify:docs` rule), the dates `scripts/release-prepare.ts` did not restamp (now every dated surface, held by `release-date-parity`), the Node 26 wording of SECURITY.md, `.git-blame-ignore-revs`, the `./package.json` export. Rejected by the verifier: `add_ltv.match` in online mode (documented by its "offline:" prefix), `url` on a non-link annotation (documented convention), the test count (1787 + 2 + 2 = 1804), the `llms.txt` 1.8.0 section (complete). Line endings: 413 tracked files `i/lf w/lf`, nothing left to treat.

First pipeline run of this pull request (2026-11-01): four checks failed and are fixed on the branch — CodeQL (three alerts: regex injection at the CHANGELOG restamp, now through `escapeRegExp`; the font file sized and read through one descriptor), `workflow-lint` (zizmor `github-env`: `setup-verapdf` no longer writes `GITHUB_ENV` / `GITHUB_PATH`, its `home` output being what both callers read), `dependency-review` (`fetch failed` under block mode: `api.deps.dev` and `api.securityscorecards.dev` join the allow-list) and `fuzz (code change)` (the `http-guards` oracle read `127.0.0.1:8\x01` more strictly than the SDK's URL parser; it now reads the stored headers the way the guards do, and both inputs are seeds). No runtime behaviour changes; the test count is unchanged.

## API stability

- `TOOL_API_VERSION`: `1.7.0` → `1.8.0` because optional inputs, enum values and one error code were added (docs/API_STABILITY.md §3, §5).
- Superset gate: `tests/catalogue-superset.test.ts` passes against the frozen `tests/_fixtures/tool-shape.v1.5.0.json` — no tool, property or enum value removed, no new `required`, no tighter bound.
- Accepted deltas: the four enumerated since 1.5.0 (`lang` oneOf → anyOf, watermark `text` no longer required on `generate_basic_pdf` / `add_table`, `sign_pdf.openWorldHint`), the projectable read-tool outputs, and the colour widenings (`CMYK_WIDENING`: each 1.5.0 colour schema kept as one `anyOf` member beside the CMYK forms and, since 1.8.0, the spot and ink-mix members). New optional inputs and enum values are additive and need no delta.
- `tests/_fixtures/tool-shape.json`: refreshed deliberately with `npx tsx scripts/tool-shape.ts --write` — the spot-colour members at 46 colour sites, `direction` / `actualText` / `font` / `print.spotColours` / paragraph `direction`, `image/jp2`, annotation type `link` + `url`, `series[].colors`, `label` optional, `lang` + 5, `onStreamError`, `match`, `blocks` maxItems 5000, `url` in the file-mode output schemas.
- Error codes: `FONT_NOT_FOUND` (only a call that sets `font`); `PDF_PARSE_FAILED`, `VALIDATION_ERROR`, `PRINT_ERROR`, `CHART_ERROR` gain triggers without changing meaning; 48 codes documented in `docs/AGENT_CONTRACT.md` §6.

## Output changes and rebaseline

- Default responses of existing tools: byte-identical except (a) `extract_text` on a content stream over the inflate cap — a coded `PDF_PARSE_FAILED` instead of an empty page (the behaviour the ROADMAP asked for; `onStreamError: 'skip'` restores the old one), (b) `extract_text` on untagged right-to-left or reordered shaped runs — logical order through the engine's `/ActualText` (`actualText: false` on the generating call restores the bare runs), (c) a strict diagnostic from `embed_image` keeps its own code instead of `VALIDATION_ERROR`, (d) a read with `password` is no longer served from the response cache.
- Bytes inherited from the engine (ledger C1–C28 of pdfnative 1.9.0): every document embedding a TrueType subset (lean, compact, renumbered, six-letter tag), every untagged document with right-to-left or reordered shaped text (`/ActualText` spans), one text object per line, the danda routing, a font registered but never drawn. Documents on base-14 fonts without those features are byte-identical.
- `tests/_fixtures/samples.sha256.json`: 52 entries re-anchored at 1.8.0 with `npx tsx scripts/verify-samples.ts --update`, 16 new, 44 unchanged — reason in the manifest's `provenance` note.
- Every item above is declared in the Upgrade section of `release-notes/v1.8.0.md`.

## Out of scope (tracked in ROADMAP.md)

- `redact_pdf` — deferred by design until the engine exports a content-removal API.
- Thai above-vowel + tone-mark pair extracted in geometric order on untagged output — `it.fails` in `tests/scripts.test.ts`.
- Non-Latin-1 form values under `fill_form { nonWinAnsi: 'needAppearances' }` (the engine writes the low byte of each UTF-16 unit into `/V`) — `it.fails` in `tests/upstream-limits.test.ts`, found by this release; the upstream issue draft is for the maintainer to submit.
- JPEG 2000 under PDF/A-1b is not a veraPDF corpus canary (veraPDF 1.30.2's PDF/A-1b profile checks only LZWDecode under ISO 19005-1 6.1.10 and accepts the file); the engine diagnostic `PDFA1_JPX_IMAGE` has its own executed trigger. The engine's PDF/A guide says veraPDF rejects such a file — a documentation nit worth reporting upstream.
- Toolchain majors (vitest 5, TypeScript 7, ESLint 10), Tier-2 catalogue compaction, a fuzz-corpus storage repository, the remaining audit-mode jobs, the OpenSSF Best Practices badge — ROADMAP *Next*.

## Maintainer steps after merge

Agents stop at this draft; everything below is done by the maintainer (`.github/AGENT_RULES.md`).

1. No LF renormalisation pending.
2. Push the branch, open the pull request with this body, wait for `ci (22)`, `ci (24)`, `os (windows-latest)`, `os (macos-latest)`, `sample-regression` and `workflow-lint`, merge. Close the superseded Dependabot pull requests #29, #60, #62, #63, #64, #67, #68, #69, #70.
3. Re-import `.github/rulesets/main.json` (adds `workflow-lint`; the live ruleset currently carries no required checks — Scorecard 1) and `.github/rulesets/tags.json`.
4. Tag `v1.8.0` on the merge commit and publish the GitHub Release (title `v1.8.0 - pdfnative 1.9.0: spot colours, right-to-left, dual claim, JPEG 2000, custom fonts, hardened pipeline`, body = `release-notes/v1.8.0.md`).
5. Approve the `npm-publish` environment: `publish.yml` runs guard → build → publish → attest → registry — the publish gate, one `npm pack`, Trusted Publishing, the registry bytes attested with three SBOMs and the Sigstore bundle attached to the release, then `server.json` published to the MCP registry by `mcp-publisher login github-oidc`. Confirm with `npm view pdfnative-mcp version` and the registry entry `io.github.Nizoka/pdfnative-mcp`. Before the first run, bind the `io.github.Nizoka/*` namespace to this repository's OIDC identity on the MCP registry.
6. Register the project at bestpractices.dev with `docs/OPENSSF_BEST_PRACTICES.md`; add the badge to the README once obtained (Scorecard 6).
7. Update the `pdfnative-mcp` entry of `docs/assets/ecosystem.json` in pdfnative and pdfnative-cli (28 tools, 1.8.0, `^1.9.0`); in pdfnative, flip the `supported: false` rows of `docs/data/surfaces.json` for spot colours, JPEG 2000 and right-to-left, and `docs/guides/mcp.md` (link annotations).
8. Submit the upstream issue drafts the maintainer wants to keep (the non-Latin-1 form-value limit; the PDF/A guide's veraPDF claim for JPEG 2000 under PDF/A-1).

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
- [x] For releases: `release-notes/v1.8.0.md` and this draft written, and `npx tsx scripts/gate.ts --publish --require-all` passes locally, which runs every individual gate: `typecheck:all`, `lint`, `build`, `dist-check`, `dist-probe`, `smoke`, `verify:tool-shape`, `server-json`, `pack-manifest`, `test:generate`, `test:coverage`, `verify:docs`, `verify:samples`, `corpus:pdfa`, `validate:pdfx`, `validate:pdfa`
- [x] Every figure above was produced by a command on this branch, not typed from memory
- [x] `release-notes/v1.8.0.md` and the CHANGELOG entry for 1.8.0 say the same things as this body
- [x] No `Co-Authored-By` trailer and no "generated with" footer anywhere on the branch
