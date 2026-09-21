# Contributing to pdfnative-mcp

Thanks for considering a contribution! This project is intentionally small, focused, and high-quality — the bar is **exactly three runtime dependencies — `pdfnative`, the MCP SDK (`@modelcontextprotocol/server` ^2.0.0) and `zod` — and no new one, ever**.

## Quick start

```bash
git clone https://github.com/Nizoka/pdfnative-mcp.git
cd pdfnative-mcp
npm ci --ignore-scripts      # what CI runs; `.npmrc` sets ignore-scripts=true anyway
npm run build                # the gate's smoke step, the sample generator and the corpus drive dist/
npm run gate:fast            # typecheck, lint, tests, server.json, docs checks — the loop while you work
```

Requirements: Node.js ≥ 22 (CI runs 22 and 24 on Linux, plus a `windows` job that builds and tests); optional: [veraPDF](https://verapdf.org) 1.30.2 + Java for the PDF/A step (see [PDF/A validation](#pdfa-validation-verapdf)).

For the full local-verification workflow — quality gate, examples-as-tests, checking that generated PDFs are actually valid, opening output in a viewer, external PDF/A validation, and the MCP Inspector — see [docs/guides/LOCAL_TESTING.md](docs/guides/LOCAL_TESTING.md).

Windows notes: the Bash one-liners run under Git Bash; PowerShell swallows a bare `--` after `npm run`, so pass script flags by calling the script directly (`npx tsx scripts/gate.ts --fast`). Every file the project writes uses LF line endings (`.gitattributes`); do not run `git add --renormalize` in a feature branch — the maintainer does that in one dedicated commit.

## Workflow

1. **Open an issue first** for non-trivial changes (new tools, breaking changes, dependency additions).
2. **Branch from `main`**: `git checkout -b feat/my-feature` (use Conventional Commit prefixes: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`). Commits carry no `Co-Authored-By` or "generated with" trailer.
3. **Keep diffs small and focused**. One logical change per PR.
4. **Add tests** for any new behaviour. CI runs [the gate](#the-gate) on every PR — on Linux (Node 22 and 24) — and builds and tests on Windows.
5. **Update the changelog** under the `## [Unreleased]` section.

## The gate

`npm run gate` is THE quality gate — one command, one summary of at most 20 lines, logs under `test-output/.gate/<step>.log`. The step table is `STEPS` in `scripts/gate.ts`:

| Profile | Command | Steps |
|---|---|---|
| Fast — before every commit | `npm run gate:fast` | `typecheck:all`, `lint`, `test`, `server-json`, `verify:docs` |
| CI — the default | `npm run gate` | `typecheck:all`, `lint`, `build`, `dist-check`, `dist-probe`, `smoke`, `verify:tool-shape`, `server-json`, `test:generate`, `test:coverage`, `verify:docs`, `verify:samples`, `corpus:pdfa`, `validate:pdfx` — the build and the samples come before the coverage run, so the suites that need `dist/` execute (and fail, not skip, when their input is missing) |
| Publish — release branches | `npx tsx scripts/gate.ts --publish --require-all` | + `validate:pdfa` (veraPDF); `--require-all` turns any skipped step into a failure |

`--only <step>` runs one step, `--json` emits a machine-readable result. PowerShell swallows a bare `--` after `npm run`, so call the script there: `npx tsx scripts/gate.ts --fast`. Three steps are inline: `dist-probe` (no `console.log` in emitted JavaScript, only `src/` under `dist/`), `smoke` (the **built** server over stdio: handshake, tool count, version, and stdout carrying JSON-RPC frames only) and `server-json` (offline validation against the vendored MCP registry schema). The individual scripts still exist — [scripts/README.md](scripts/README.md) has the full table with flags and exit codes:

```bash
npm run typecheck:all      # tsc over src/ + tests/, then scripts/
npm run lint               # eslint src --max-warnings 0 (a warning fails)
npm run test               # vitest run (dot reporter)
npm run test:coverage      # vitest with v8 coverage — thresholds in vitest.config.ts
npm run build              # tsc → dist/
npm run verify:tool-shape  # the built tools/list against tests/_fixtures/tool-shape.json
npm run verify:docs        # every count, version, link and parity rule (docs/assets/ecosystem.json)
npm run test:generate      # write the sample set to test-output/samples/ with the BUILT server
npm run verify:samples     # compare it with tests/_fixtures/samples.sha256.json
npm run corpus:pdfa        # write the conformance corpus to test-output/pdfa/
npm run validate:pdfx      # validate the PDF/X-4 entries in-process (pdfnative's validator)
npm run validate:pdfa      # validate the PDF/A entries with veraPDF
```

All new code must include tests. Coverage thresholds are enforced once, in `vitest.config.ts`, mirrored by `declared.coverageStatements` in `docs/assets/ecosystem.json`, re-measured at each release and **never lowered** to make a change pass — add tests.

Opt-in git hooks: `npm run hooks:install` sets `core.hooksPath` to `.githooks/` for this clone (pre-commit: lint + a CRLF guard; pre-push: the fast gate); `npm run hooks:uninstall` removes them. They are never activated automatically.

## Coding standards

- TypeScript **strict** mode is mandatory; ESM-first — relative imports carry `.js`.
- ESLint must pass with **zero warnings** — enforced: `npm run lint` is `eslint src --max-warnings 0`, so a warning fails the gate (no non-null assertions; narrow explicitly).
- No `any`. Use `unknown` + narrowing.
- **No `console.log` in `src/`.** On stdio, stdout is the JSON-RPC channel: logs go to stderr (the gate's `smoke` and `dist-probe` steps fail on a stray stdout line).
- Public APIs (anything exported from `src/index.ts`) require TSDoc comments.
- All tool inputs MUST be validated with Zod inside the handler (defence in depth — the JSON Schema is for clients, the Zod schema is for safety). Every object schema is `.strict()`; every failure is a `ToolError` with a documented code.
- English everywhere — demonstrated content in another language carries a `demo-language: <tag> (reason)` marker on or above the line (`verify:docs` rule `prose-language`).

## Adding a tool

A new or changed tool touches **all** of these (`verify:docs` rules `tool-parity`, `error-parity` and `env-var-parity` fail on a missed step — the same four steps as [AGENTS.md](AGENTS.md) §Architecture):

1. `src/tools/<name>.ts` exporting the `<NAME>_NAME` constant, `<NAME>_INPUT_SCHEMA` (JSON Schema `as const`, served to clients), an optional `<NAME>_OUTPUT_SCHEMA`, the parallel Zod schema and the handler `(args: unknown) => Promise<…>`; then its entry in the `TOOLS` registry of `src/server.ts` (`title`, `description`, `annotations`, `_meta.apiVersion`, one or two executable `_meta.examples`). A new result shape also needs a `dispatchOutput` branch. Build the JSON Schema and the Zod schema from the same constants where a shared fragment exists (`src/layout.ts`, `src/print.ts`, `src/color.ts`, `src/typography.ts`, `src/pdfx.ts`, …).
2. `tests/<name>.test.ts` (success, each error code, file mode), a worked example `examples/<name>.json` (executed by `tests/examples.test.ts` — `npm run examples:check` — and, when hermetic, rendered into the sample baseline), and for an engine feature its item in `tests/_fixtures/engine-surface.json`. Every new `ToolError` code must appear in `docs/AGENT_CONTRACT.md` §6 and be named by a test — `tests/error-codes.test.ts` enforces both.
3. The catalogue fixture — only for a deliberate structural change: `npm run build && npx tsx scripts/tool-shape.ts --write` refreshes `tests/_fixtures/tool-shape.json`, which `tests/catalogue-parity.test.ts` and the gate step `verify:tool-shape` compare with the live `tools/list` (structure only — descriptions are stripped, so wording never trips it). Any fixture diff is reviewed under [docs/API_STABILITY.md](docs/API_STABILITY.md) §5, and `TOOL_API_VERSION` moves when a schema or an error code changes. `tests/catalogue-superset.test.ts` must keep passing against the frozen `tests/_fixtures/tool-shape.v1.5.0.json` — never regenerate that file; it proves nothing published in 1.5.0 was removed or narrowed.
4. The documents: README tool matrix and tool reference, `docs/AGENT_CONTRACT.md` (catalogue, decision tree, §6), `docs/AI_GUIDE.md` decision table, `docs/KNOWLEDGE_BASE.md`, `llms.txt`, `docs/API_STABILITY.md` §5, `docs/assets/ecosystem.json`, `CHANGELOG.md` — then `SERVER_INSTRUCTIONS` and the relevant MCP prompt in `src/server.ts`.

Drive the **built** server (`node dist/cli.js` over stdio; harness `tests/_stdio-session.ts`) before claiming a change works — source tests alone do not prove the emitted package.

## Samples & byte baseline

`npm run build && npm run test:generate && npm run verify:samples` is the whole loop. `scripts/generate-samples.ts` runs every hermetic `examples/*.json` sequence (those needing no PKI, TSA or revocation fixture — the rest stay covered by vitest) and the conformance corpus through the **built** server into the git-ignored `test-output/samples/` — under `TZ=UTC`, with every operator variable scrubbed and every instant pinned twice (the process pin plus the per-call `creationDate` / `signingTime` / `modDate`).

`scripts/verify-samples.ts` fingerprints the set and compares it with the committed baseline `tests/_fixtures/samples.sha256.json` — 96 samples: plain output byte for byte, and the samples that cannot repeat their bytes (a CSPRNG file key, a per-run signature) through a semantic projection, each listed explicitly with its reason in `ENCRYPTED_SAMPLES` / `SIGNED_SAMPLES` / `TIMESTAMPED_SAMPLES` (`scripts/lib/sample-fingerprint.ts`). The baseline is a chain: each entry records the release whose output it is (`since`), and an unchanged entry keeps it.

- A new sample: add the example (or the corpus entry), then `npm run build && npm run test:generate && npx tsx scripts/verify-samples.ts --update`. A sample listed as semantic is proven non-repeatable with a double run first.
- **An intended output change** (an engine bump, a rendering fix) is rebaselined the same way, explained in the manifest's `provenance` note and **declared in the release note** (Upgrade section) — the `since` of every re-anchored entry moves to the release doing it, so the diff shows exactly what changed.
- `--update` is never used to silence a surprise: an unexplained byte change is a regression until proven otherwise.
- The `sample-regression` workflow rebuilds and regenerates the set on every pull request and is a required status check (see [Branch protection](#branch-protection)).

## PDF/A validation (veraPDF)

The server's PDF/A claims are checked against the official reference validator, [veraPDF](https://verapdf.org), and its PDF/X-4 claims against the engine's structural validator. `npm run corpus:pdfa` drives the **built** server (`scripts/generate-pdfa-corpus.ts`, corpus table in `scripts/lib/pdfa-corpus.ts`) to write the **41 files** of the conformance corpus to `test-output/pdfa/` — 33 claiming PDF/A (levels 1b / 2b / 2u / 3b: outline, watermarks, charts, print boxes, RGB / CMYK / Gray output intents, typography, tables, international text incl. the new scripts, barcodes, images, attachments, AcroForms, a PAdES signature, `update_metadata`, a composite document), 6 claiming PDF/X-4, and 2 page-tree outputs that claim nothing (`merge_pdfs` / `extract_pages` rebuild the page tree without the source XMP — the manifest records that and the validator asserts it). It is a representative sample, not an exhaustive feature matrix. The corpus is reproducible: pinned dates, a throw-away signing identity, a per-file SHA-256 in `manifest.json`.

`npm run validate:pdfa` (`scripts/validate-pdfa.ts`, pure core in `scripts/lib/verapdf.ts`) validates each PDF/A file against the profile it claims in XMP and compares the verdict with the manifest's `expectCompliant` flag. With veraPDF 1.30.2 the result is 27 PASS and 6 XFAIL. Two guards keep the run honest:

- **Negative canaries** (`expectCompliant: false` — six under PDF/A: an unsigned signature placeholder, a document and an AcroForm without `embedFonts`, CMYK content under the sRGB intent, an ICC v4 profile under PDF/A-1b, and Tai Tham under PDF/A-2u, an engine limit listed in ROADMAP.md; two more under PDF/X-4) must be rejected; otherwise the validator is accepting everything. An unexpected pass (`XPASS`) is always fatal, and a run without any negative canary fails. A known upstream limit is a tracked canary, not a dropped file: flip its expectation deliberately when the engine fixes it.
- A **coverage canary** fails the run when a file listed in `manifest.json` is missing, when its XMP claim disagrees with the manifest, or when the number of claiming files differs from `declared.pdfaSamples` in `docs/assets/ecosystem.json` — a silent regression in claim emission cannot shrink the validated corpus.

`npm run validate:pdfx` (`scripts/validate-pdfx.ts`, core in `scripts/lib/pdfx.ts`) does the same for the PDF/X-4 entries with pdfnative's structural validator (`validatePdfX()`), in-process — no external tool, **never skipped**; its coverage canary is `declared.pdfxSamples`, and zero PDF/X entries is a failure. It checks structural prerequisites; it is not a certified preflight.

Per file the validators report `PASS` / `FAIL` / `XFAIL` / `XPASS` / `INFRA` / `SKIP`. Exit codes:

| Exit | Meaning |
|------|---------|
| 0 | Every expectation met — or veraPDF is absent: install hints are printed and validation is **skipped** (a skip is not a pass; the gate reports the step as **SKIP**, and `--require-all` turns that skip into a failure) |
| 1 | Conformance expectation not met (`FAIL` or `XPASS`), no negative canary in the corpus, or the coverage canary tripped |
| 2 | Infrastructure: corpus directory / manifest absent (run `corpus:pdfa` first), or veraPDF is installed but unusable (Java missing, the runner fails to start) |

Environment: `VERAPDF_HOME=<dir>` points at a veraPDF install (`verapdf` / `verapdf.bat` at the root or under `bin/`); `JAVACMD` names the JDK's `java` when Java is not on `PATH`; `VERAPDF_REPORT_DIR=<dir>` relocates the raw per-file veraPDF XML reports (default `test-output/pdfa/reports/`).

**CI is blocking**: `.github/workflows/verapdf.yml` builds, writes the corpus and validates it through the composite action `.github/actions/setup-verapdf` (installer pinned to **1.30.2**, SHA-256 in `.github/checksums/` verified before `java -jar` executes it) on every push / PR touching `src/`, `scripts/`, the package manifest or the TypeScript configs, and the publish workflow runs the whole `--publish --require-all` profile again before the package is published. veraPDF is an external CI tool, not a dependency — the no-new-runtime-dependency policy is unchanged. (The `verapdf` workflow is path-filtered, so it is deliberately **not** a required status check — see [Branch protection](#branch-protection).)

Installing veraPDF locally (Java 8+ required):

```bash
# macOS
brew install --cask verapdf

# Linux (headless, no GUI — same mechanism as CI; adjust the install path)
curl -fsSL -o installer.zip https://software.verapdf.org/rel/1.30/verapdf-greenfield-1.30.2-installer.zip
unzip installer.zip && cd verapdf-greenfield-*
cat > auto-install.xml <<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>/opt/verapdf</installpath></com.izforge.izpack.panels.target.TargetPanel>
  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select"><pack index="0" name="veraPDF GUI" selected="true"/><pack index="1" name="veraPDF Mac and *nix Scripts" selected="true"/><pack index="2" name="veraPDF Documentation" selected="false"/><pack index="3" name="veraPDF Sample Plugins" selected="false"/></com.izforge.izpack.panels.packs.PacksPanel>
  <com.izforge.izpack.panels.install.InstallPanel id="install"/>
  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
XML
java -jar verapdf-izpack-installer-*.jar auto-install.xml
export VERAPDF_HOME=/opt/verapdf
```

```powershell
# Windows — download the same installer zip, unzip, and run the installer with a
# Windows <installpath> (a portable install under %USERPROFILE%\verapdf works). Point
# VERAPDF_HOME at the directory holding verapdf.bat, and JAVACMD at the JDK's java.exe:
# the .bat launcher reads JAVACMD (JAVA_HOME alone is not enough when it is spawned from Node).
$env:VERAPDF_HOME = "$env:USERPROFILE\verapdf"
$env:JAVACMD = "C:\Program Files\Java\jdk-13.0.1\bin\java.exe"
```

The `.bat` launcher is invoked through a shell with quoted arguments (Node refuses to spawn batch files directly), so paths with spaces work.

## Documentation and the ecosystem manifest

`docs/assets/ecosystem.json` is the single source of every count and version quoted in the docs (`packages`, `declared`, `derived`, `assertions`). `npm run verify:docs` (`scripts/verify-docs.ts`, 24 rules) recomputes the derived counts from the source tree (the `TOOLS` and prompt tables, every `ToolError` code, `server.json`, `examples/`, `tests/`, the sample baseline, the corpus table) and holds README, `docs/`, `llms.txt`, AGENTS.md, CLAUDE.md, the Copilot files, the changelog ladder, the rulesets, the workflows and the current release note to it: stale counts, stale versions, tool / error-code / operator-variable parity between `src/` and the docs, Claude Code budgets and generated rules, the PR template, links and heading anchors, `Verified on` stamps and English-only prose.

A line that legitimately quotes a superseded figure (release history) opts out with `verify-docs:allow <rule>` — an HTML comment at the end of that line, or on the line above when the line is a table row or a heading. The marker is for genuine history only, never to silence a stale current claim.

Touching a count or a version means editing the manifest **and** running `verify:docs`. `declared` holds the figures no filesystem walk can derive (measured at release); `derived` is recomputed and fails on drift.

## Agent contract

Two documents, two audiences:

- [AGENTS.md](AGENTS.md) — the **repository rules** for coding agents working *on* the server (mission and constraints, the gate, where is what, the four-step tool wiring, never-touch and generated files). It stays at 120 lines or fewer; [CLAUDE.md](CLAUDE.md) imports it and adds only what is specific to Claude Code; [.github/copilot-instructions.md](.github/copilot-instructions.md) carries the same conventions for Copilot. Keep the three consistent.
- [docs/AGENT_CONTRACT.md](docs/AGENT_CONTRACT.md) — the **consumer contract** for agents that *use* the server (tool catalogue, decision tree, token economy, error codes in §6). A tool input, output field or error-code change is a change to this contract and is reviewed under [docs/API_STABILITY.md](docs/API_STABILITY.md).

`.claude/rules/*.md` are generated from `.github/instructions/*.instructions.md` by `npm run agents:rules` (scoped by the source `applyTo`) and never edited by hand: edit the instruction file, regenerate, and `verify:docs` rule `claude-rules-sync` fails on drift. Agents never push, tag, open PRs or issues, or publish (`.github/AGENT_RULES.md`; enforced in Claude Code by `.claude/hooks/guard.mjs`); issue and PR drafts go to [.github/drafts/](.github/drafts/README.md) and a human submits them.

## Pull Request Checklist

The pull request template carries the same items, word for word (`verify:docs` rule `pr-template-parity` and `tests/tools/workflows.test.ts` hold the two together).

- [ ] `npm run gate` passes — the CI profile in one command (`npm run gate:fast` for a quick loop while iterating; PowerShell swallows a bare `--`, so call `npx tsx scripts/gate.ts --fast` there)
- [ ] All tests pass (`npm run test`)
- [ ] Type check passes (`npm run typecheck:all`)
- [ ] Lint passes (`npm run lint`)
- [ ] New code has tests (coverage thresholds in `vitest.config.ts` must not regress)
- [ ] No `any` types introduced
- [ ] No new runtime dependencies added (`pdfnative`, `@modelcontextprotocol/server` and `zod` stay the only three)
- [ ] A new or changed tool touches every wiring point: `src/tools/<name>.ts` (JSON Schema and the parallel Zod schema in lock-step), the `TOOLS` registry in `src/server.ts`, `tests/<name>.test.ts`, `examples/`, README, `docs/AGENT_CONTRACT.md`, `llms.txt`, `docs/API_STABILITY.md`
- [ ] If a tool schema or an error code changed: `npm run build && npx tsx scripts/tool-shape.ts --write` refreshed `tests/_fixtures/tool-shape.json` deliberately, `tests/catalogue-superset.test.ts` still passes against the frozen 1.5.0 fixture, and `TOOL_API_VERSION` was reviewed under `docs/API_STABILITY.md`
- [ ] If samples, PDF/A or PDF/X behaviour changed: `npm run build && npm run test:generate && npm run verify:samples && npm run corpus:pdfa && npm run validate:pdfx && npm run validate:pdfa` passes locally (veraPDF installed — see [PDF/A validation](#pdfa-validation-verapdf); new claiming corpus entries bump `declared.pdfaSamples` / `declared.pdfxSamples`; an intended output change is rebaselined with `npx tsx scripts/verify-samples.ts --update` and declared in the release note)
- [ ] If docs, README, llms.txt, AGENTS.md, CLAUDE.md or `.claude/` changed: `npm run verify:docs` passes
- [ ] CHANGELOG.md updated if user-facing changes
- [ ] For releases: follow [Release](#release) — `release-notes/vX.Y.Z.md` and `.github/drafts/pr-vX.Y.Z.md` written, and `npx tsx scripts/gate.ts --publish --require-all` passes locally, which runs every individual gate: `typecheck:all`, `lint`, `build`, `dist-check`, `dist-probe`, `smoke`, `verify:tool-shape`, `server-json`, `test:generate`, `test:coverage`, `verify:docs`, `verify:samples`, `corpus:pdfa`, `validate:pdfx`, `validate:pdfa`

## Release

A release is prepared on a `release/vX.Y.Z` branch by whoever drives it (a maintainer or an agent) and **merged, tagged and published by the maintainer only**:

1. `npx tsx scripts/release-prepare.ts --version X.Y.Z [--date YYYY-MM-DD] [--previous vA.B.C]` applies the mechanical bump in one pass — `package.json` / `package-lock.json`, `src/version.ts`, `server.json` (twice), `docs/assets/ecosystem.json` (version + `verifiedOn`) and the `Verified on` stamps, `CITATION.cff`, the `SECURITY.md` support table, the README engine badge, the knowledge-base header, `llms.txt` — and scaffolds `release-notes/vX.Y.Z.md` from [release-notes/TEMPLATE.md](release-notes/TEMPLATE.md) and `.github/drafts/pr-vX.Y.Z.md` from [release-notes/PR_TEMPLATE.md](release-notes/PR_TEMPLATE.md) (`--dry-run` previews; it never commits, tags or publishes). The version moves in lock-step (`tests/metadata.test.ts`).
2. Decide `TOOL_API_VERSION` (`src/server.ts`) under [docs/API_STABILITY.md](docs/API_STABILITY.md) §3: it moves only when a schema or an error code changes, which is a reviewed decision the script never takes.
3. Write the release note, mirror it into `CHANGELOG.md` (`## [X.Y.Z]` plus the compare link at the bottom — `verify:docs` rule `changelog-ladder` requires one per heading), update `ROADMAP.md`, and refresh every count the manifest governs (`declared.tests` and the coverage figures come from the last gate run, never from memory).
4. Every rebaseline of `tests/_fixtures/samples.sha256.json`, every output change and every new corpus entry is declared in the note's Upgrade section **before** publication.
5. `npx tsx scripts/gate.ts --publish --require-all` must pass locally with veraPDF installed (every step, no SKIP); in Claude Code, `/release-audit release-notes/vX.Y.Z.md vA.B.C` runs the independent audit (two auditors, an adversarial verifier, a GO / NO-GO ledger under `.audit/`) — fix what it confirms.
6. Fill every section of `.github/drafts/pr-vX.Y.Z.md`. The per-version bodies are committed — they are the auditable record of what each release claimed and what was run — and every figure in them comes from a command run on the branch. **Stop here.**
7. **Maintainer:** push the branch, open the PR with that body, wait for `ci (22)`, `ci (24)` and `sample-regression` (required by `.github/rulesets/main.json`), merge, tag `vX.Y.Z` on the merge commit, publish the GitHub Release with the note as body (title `vX.Y.Z - short description`), approve the `npm-publish` environment; `publish.yml` checks that the tag equals the package version, re-runs the publish gate with veraPDF, publishes with provenance through npm Trusted Publishing (OIDC, no long-lived token), and attaches the CycloneDX SBOM and the build-provenance attestation to the release. Afterwards: validate and publish `server.json` to the MCP registry (a manual, networked step — the gate validates `server.json` offline against the vendored schema), and update the `pdfnative-mcp` entry of `docs/assets/ecosystem.json` in pdfnative and pdfnative-cli.

Rollback: never unpublish and never move a tag (`.github/rulesets/tags.json` makes release tags immutable) — cut a superseding patch release.

### Bumping the engine pin

Moving `pdfnative` to a new release is adopting that release: every user-facing entry of its changelog must end up exercised through the server, or waived in writing. In the same change:

1. Read the engine's changelog entry; extend `tests/_fixtures/engine-surface.json` with one item per bullet — named tests and examples, or a waiver (`LIB`, `TOOLING`, `DOCS`, `tested-upstream` with its transmission suite, `upstream-limit`). Set `engine` to the new version: `tests/engine-surface.test.ts` fails until the matrix follows the pin.
2. A new diagnostic code gets an executed trigger in `tests/_diagnostic-triggers.ts` and moves `declared.diagnosticCodes` — a code the docs name is a code a test triggers. A new script code gets a string in `tests/_script-text.ts`; a new engine option gets an example that sets it.
3. Refresh the build-error registry `tests/_fixtures/pdfnative-build-errors.json` from the engine's error messages (`mapBuildError` in `src/diagnostics.ts` classifies on the bare message, and the registry test holds every entry to a `ToolError` code).
4. Re-run the `it.fails` markers (`tests/upstream-limits.test.ts`, `tests/scripts-27.test.ts`): a limit of the engine is pinned there and listed under *Blocked upstream* in [ROADMAP.md](ROADMAP.md); when the engine fixes one the suite goes red — delete the marker, flip the matching corpus canary, move the ROADMAP item.
5. Regenerate the samples, declare any rebaseline in the release note (the engine pin never moves without one), and update `packages.pdfnative` in `docs/assets/ecosystem.json`.

### Branch protection

The rules for `main` are versioned in [.github/rulesets/main.json](.github/rulesets/main.json), GitHub's ruleset format: no deletion, no force-push, pull request required (single maintainer, so zero approvals — but every review thread resolved, stale reviews dismissed on push, merge or squash only), and the status checks `ci (22)`, `ci (24)` and `sample-regression` required and up to date with `main`. `verapdf`, the `windows` job, the Docs workflow and the other path-filtered workflows are deliberately **not** required: a required check that never reports leaves a pull request stuck on "Expected — waiting for status to be reported". The repository Admin role may bypass the ruleset through a pull request only — never by pushing to `main` directly. Release tags are protected by [.github/rulesets/tags.json](.github/rulesets/tags.json) (`refs/tags/v*`: no deletion, no force-update, no update; creation stays with the maintainer). `verify:docs` (rule `ruleset-parity`) fails when a required check names no workflow job.

The JSON files are the committed copies; they take effect only once the maintainer imports them: Settings → Rules → Rulesets → New ruleset → Import a ruleset. Agents never import or edit a ruleset on GitHub (the Claude Code guard hook refuses every writing GitHub API call).

## Reporting bugs

Use [GitHub Issues](https://github.com/Nizoka/pdfnative-mcp/issues) with:
- Reproduction steps (ideally a JSON-RPC payload sent to the stdio server).
- Expected vs. actual output.
- Node version (`node -v`) and OS.

An engine limit found through the server is drafted locally (`draft_governance_issue`, or a copy of [.github/drafts/TEMPLATE.md](.github/drafts/TEMPLATE.md)), checked with `npm run verify:issue`, and submitted upstream by a human.

## Security issues

**Do not open public issues for security problems.** See [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).
