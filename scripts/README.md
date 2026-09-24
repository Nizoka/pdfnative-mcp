# scripts/ — the quality gate, the sample set, the conformance corpus and the verifiers

Maintenance scripts run with `tsx` (no build step) and drive the **built** server
(`dist/server.js`, the same `callToolDirect()` the `tools/call` handler delegates to — never
`src/`) wherever a PDF is produced. The npm aliases in `package.json` are the public names;
call a script directly to pass flags (PowerShell swallows a bare `--` after `npm run`).
`scripts/tsconfig.json` extends `../tsconfig.scripts.json` so an editor types these files as
`typecheck:scripts` does.

## Quick start

```bash
npx tsx scripts/gate.ts --fast     # typecheck:all, lint, test, server-json, verify:docs — the loop while you work
npm run gate                       # the CI profile (default)
npm run build && npm run test:generate && npx tsx scripts/verify-samples.ts   # the sample baseline
```

## The scripts

| Script | npm alias | Gate step | Purpose | Flags | Exit codes |
|---|---|---|---|---|---|
| `gate.ts` | `gate`, `gate:fast` | — (it is the gate) | Runs the STEPS table in order, one line per step, logs under `test-output/.gate/<id>.log`; profiles `--fast` / `--ci` (default) / `--publish`. Inline steps: `dist-check`, `dist-probe` (no `console.log` in emitted JavaScript, only `src/` under `dist/`), `smoke` (the built server over stdio — stdout must carry JSON-RPC frames only), `server-json` (offline validation against the vendored registry schema) | `--only <id>`, `--from <id>`, `--require-all` (a SKIP fails), `--json` | 0 green (or skipped with a reason), 1 a step failed / would have skipped under `--require-all`, 2 usage |
| `generate-samples.ts` | `test:generate` | `test:generate` | Runs every hermetic `examples/*.json` (those needing no PKI, TSA or revocation fixture — the rest stay covered by vitest) and the conformance corpus through the built server into `test-output/samples/`, under `TZ=UTC`, operator variables scrubbed, every instant pinned twice (process pin + per-call `creationDate` / `signingTime` / `modDate` derived from the live schema) | `--quiet`, `--verbose`, `--json` | 0 every sample written, 1 a tool call failed (its message is reproduced), 2 `dist/` missing or bad usage |
| `verify-samples.ts` | `verify:samples` | `verify:samples` | Fingerprints the generated set (bytes, or semantic for encrypted / signed samples) and holds it to `tests/_fixtures/samples.sha256.json`, a chained baseline (`since` per entry) | `--strict` (a new, unbaselined sample fails), `--update` (rewrite — only with a rebaseline declared in the release note), `--json` | 0 match, 1 a changed / removed (or, with `--strict`, new) sample, 2 usage or missing samples |
| `generate-pdfa-corpus.ts` | `corpus:pdfa` | `corpus:pdfa` | Writes the PDF/A + PDF/X conformance corpus (`lib/pdfa-corpus.ts`) and its manifest (with a `sha256` per file) into `test-output/pdfa/` through the built server | `--quiet`, `--verbose`, `--json` | 0 written, 1 a tool call failed, 2 `dist/` missing or bad usage |
| `validate-pdfa.ts` | `validate:pdfa` | `validate:pdfa` (publish) | Runs every PDF/A-claiming corpus file through veraPDF (`VERAPDF_HOME` or PATH; `JAVACMD` for the JDK) and compares with `expectCompliant`; negative canaries must be rejected (XPASS fails) | `--quiet`, `--verbose`, `--json`; env `VERAPDF_HOME`, `VERAPDF_REPORT_DIR`, `JAVACMD` | 0 every expectation met (or veraPDF absent: skipped with install hints — the gate reports SKIP, `--require-all` fails), 1 a FAIL or XPASS, 2 infrastructure (corpus missing, veraPDF installed but unusable) |
| `validate-pdfx.ts` | `validate:pdfx` | `validate:pdfx` | Runs the engine's structural `validatePdfX()` over the PDF/X files of the corpus and compares with `expectCompliant`; in-process, never skips; zero PDF/X entries is a failure | `--quiet`, `--verbose`, `--json` | 0 every expectation met, 1 a FAIL or XPASS, 2 usage or missing corpus |
| `tool-shape.ts` | `verify:tool-shape` | `verify:tool-shape` | Structural fingerprint of the built `tools/list` (descriptions stripped) against `tests/_fixtures/tool-shape.json`; `--check` also holds the catalogue under 320 KiB, the instructions under 8 KiB, and `declared.toolsListBytes` of the manifest within 2 % of the measurement | `--check` (exit 1 on drift), `--write` (refresh — only for a deliberate schema change, reviewed under docs/API_STABILITY.md §5) | 0 match or written, 1 drift, 2 `dist/` missing |
| `verify-docs.ts` | `verify:docs` | `verify:docs` | 24 rules holding every count, version, tool, error code, operator variable, link, anchor, stamp and agent file to `docs/assets/ecosystem.json` and the source tree (`lib/mcp-surface.ts`); `verify-docs:allow <rule>` opts a line out | `--online` (compare with the npm registry), `--strict` (with `--online`: docs behind npm is an error), `--json` | 0 no error, 1 an error (warnings such as `eol-lf` do not fail) |
| `release-prepare.ts` | `release:prepare` | — | Applies a version bump in one pass: package manifests, `src/version.ts`, `server.json` (twice), `ecosystem.json` + "Verified on" stamps, CITATION.cff, the SECURITY.md table, the README engine badge, the knowledge-base header, llms.txt, a release-note and a PR-draft scaffold; prints every touched file. Never commits, tags or publishes | `--version X.Y.Z`, `--date`, `--previous vA.B.C`, `--dry-run` | 0 applied, 1 a target file is missing or its pattern was not found, 2 usage |
| `build-claude-rules.ts` | `agents:rules` | (`verify:docs` rule `claude-rules-sync`) | Projects `.github/instructions/*.instructions.md` into `.claude/rules/*.md` (scoped by `applyTo` → `paths:`), deleting orphans | `--check` (exit 1 on drift, no writes), `--json` | 0 in sync or generated, 1 drift / a source without `applyTo` |
| `verify-issue.mjs` | `verify:issue` | — | Policy check of an issue draft under `.github/drafts/` against `.github/ai-governance.json` (zero new dependency, reproduction, duplicate search); the offline twin of the `draft_governance_issue` tool | `<draft.md>` | 0 compliant, 1 a violation, 2 usage |
| `install-git-hooks.mjs` | `hooks:install`, `hooks:uninstall` | — | Sets `core.hooksPath` to `.githooks/` (pre-commit: lint + CRLF guard; pre-push: the fast gate) for this clone only | `--uninstall` | 0 done, 1 git unavailable |

## Libraries (`lib/`) and helpers

| Module | Used by | What it holds |
|---|---|---|
| `lib/example-runner.ts` | generate-samples, tests | Which `examples/*.json` sequences are hermetic, how their `<placeholder>` inputs resolve (an earlier step, a generated document, the synthetic CMYK profile), and the driver over `callToolDirect()` |
| `lib/sample-fingerprint.ts` | verify-samples, `tests/samples-regression.test.ts` | Bytes / semantic fingerprints, the explicit `ENCRYPTED_SAMPLES` / `SIGNED_SAMPLES` / `TIMESTAMPED_SAMPLES` / `HOST_DEPENDENT_SAMPLES` tables, the baseline chain (`chainSince`), identical groups |
| `lib/pdfa-corpus.ts` | generate-pdfa-corpus, validators, verify-docs | The conformance corpus table (claims, negative canaries) |
| `lib/pdfx.ts`, `lib/verapdf.ts` | validate-pdfx, validate-pdfa, gate (skip condition) | PDF/X verdict plumbing; veraPDF location, invocation and report parsing |
| `lib/corpus-cert.ts`, `lib/synthetic-icc.ts` | generate-pdfa-corpus, generate-samples, tests | The throw-away signing identity of the corpus; the synthetic RGB / Gray / CMYK ICC profiles (byte-identical to the sibling repositories' fixtures) |
| `lib/tool-shape.ts` | tool-shape, `tests/catalogue-parity.test.ts` | The structural projection of `tools/list` |
| `lib/json-schema-lite.ts` | gate (`server-json`) | A draft-07 subset validator that fails on a keyword it does not implement |
| `lib/mcp-surface.ts` | verify-docs, tests | The server surface read from text: tools, prompts, error codes, operator variables, the changelog ladder |
| `lib/markdown-anchors.ts` | verify-docs (`anchor-parity`) | GitHub heading slugs, the anchor inventory of a document, its fragment links |
| `lib/agent-config.ts`, `lib/prose-language.ts` | verify-docs, build-claude-rules, tests | `.claude/settings.json` / rules / skills / PR-template checks; the English-only prose detector |
| `helpers/hermetic.ts`, `helpers/tz.ts` | every generator, the gate | `TZ=UTC` and the removal of every inherited operator variable — imported first |
| `helpers/server.ts`, `helpers/io.ts` | every generator | Loading the built server, pinning instants from the live schema, shared I/O and the pinned instant |

## Conventions

- Every script prints a one-line summary when stdout is not a terminal (CI, the gate, an
  agent) and a table under `--verbose`; `--json` is the machine-readable form.
- Exit 2 is always usage or infrastructure, never a content failure, so the gate can tell
  "the tool is missing" from "the check failed".
- Nothing here has a runtime dependency: `tsx` and `vitest` are dev tooling; the scripts
  load `dist/server.js` and never import `src/`.
- No script pushes, tags, publishes or opens anything on GitHub — those are the
  maintainer's steps (`.github/AGENT_RULES.md`).
- Tests for the pure parts live in `tests/tools/` (`gate`, `verify-docs`, `mcp-surface`,
  `release-prepare`, `json-schema-lite`, `hermetic-env`, `pdfx`, `verapdf`,
  `markdown-anchors`, `build-claude-rules`, `agent-config`, `guard`, `workflows`).
