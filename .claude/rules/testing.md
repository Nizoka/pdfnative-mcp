---
paths:
  - "tests/**"
  - "scripts/**"
  - "examples/**"
---
<!-- GENERATED from .github/instructions/testing.instructions.md by scripts/build-claude-rules.ts — do not edit -->

# Testing Standards

## The gate
- `npm run gate` (CI profile) is the single definition of green; `npm run gate:fast` while iterating; `npx tsx scripts/gate.ts --publish --require-all` before a release (needs veraPDF). One line per step, logs under `test-output/.gate/`. Summarise its output — do not paste logs.
- PowerShell swallows a bare `--` after `npm run`: call `npx tsx scripts/<name>.ts <flags>` directly.
- Build before the suites that need `dist/`: `tests/cli-stdio.test.ts`, `tests/reproducible-build.test.ts` (they skip locally, fail under CI / `GATE_REQUIRE_ARTIFACTS=1`). `.npmrc` disables install-time scripts.

## Framework
- vitest 4, `TZ=UTC`, `pool: 'forks'`, no shuffle, `dot` reporter. Tests are flat under `tests/`; shared fixtures are `_`-prefixed; repository-tooling tests live in `tests/tools/`.
- Commands: `npm test`, `npm run test:coverage`, `npm run typecheck:all` (src + tests + scripts), `npm run lint` (`eslint src --max-warnings 0` — warnings fail), `npm run examples:check`.
- Coverage thresholds live once, in `vitest.config.ts`. Never lower them; raise them when a release lifts coverage.

## Catalogue parity
- `tests/catalogue-parity.test.ts` compares the live `tools/list` structure with `tests/_fixtures/tool-shape.json`.
- After a deliberate schema change: `npm run build && npx tsx scripts/tool-shape.ts --write`, then review the fixture diff under docs/API_STABILITY.md §5. Never refresh it to silence an accidental change.
- `tests/catalogue-superset.test.ts` compares the live catalogue with the frozen `tests/_fixtures/tool-shape.v1.5.0.json`: no tool / property / enum value removed, no new `required`, no tighter bound; every accepted delta is enumerated in the test and must still occur. Never regenerate the 1.5.0 fixture.
- `tests/error-codes.test.ts` inventories every `ToolError` code in `src/` and asserts `docs/AGENT_CONTRACT.md` §6 documents it and a test names it.

## Samples and the byte baseline
- `npm run build && npm run test:generate` drives the BUILT server and writes `test-output/samples/`; `npm run verify:samples` compares it with `tests/_fixtures/samples.sha256.json`. The baseline is a chain: an unchanged entry keeps its `since`.
- An intended output change is rebaselined with `npx tsx scripts/verify-samples.ts --update`, explained in the manifest's `provenance` note and declared in the release notes. Never `--update` to silence a surprise.
- A sample that cannot repeat its bytes (CSPRNG, per-run key, TSA clock) is listed explicitly in `ENCRYPTED_SAMPLES` / `SIGNED_SAMPLES` / `TIMESTAMPED_SAMPLES` (`scripts/lib/sample-fingerprint.ts`) — prove it with a double run first.

## Conformance corpus
- `npm run corpus:pdfa` writes `test-output/pdfa/` from `scripts/lib/pdfa-corpus.ts`; `npm run validate:pdfx` (in-process `validatePdfX()`, never skips) and `npm run validate:pdfa` (veraPDF 1.30.2: set `VERAPDF_HOME`, and `JAVACMD` when Java is not on PATH). Exit codes 0 / 1 (conformance) / 2 (infrastructure).
- Every new claiming entry bumps `declared.pdfaSamples` / `declared.pdfxSamples` in `docs/assets/ecosystem.json`. Negative canaries (`expectCompliant: false`) must stay rejected: an XPASS is fatal. A known upstream limit is a tracked canary, not a dropped file.

## Engine surface
- `tests/engine-surface.test.ts` holds `tests/_fixtures/engine-surface.json` to the tree: every engine changelog bullet is tied to named tests / samples or waived with a reason. It fails when the `pdfnative` pin moves without the matrix.
- A limit of the engine is pinned with `it.fails` (`tests/upstream-limits.test.ts`, `tests/scripts-27.test.ts`) and listed in ROADMAP.md: when the engine fixes it the suite goes red — delete the marker.
- `tests/engine-surface.fuzz.test.ts` is seeded (`tests/_fuzz.ts`): the only acceptable failure is a `ToolError` with a documented code.

## Test focus
- Validate tool success, each error code, and file mode.
- Validate schema constraints for each MCP tool, JSON Schema and Zod together.
- Validate sandbox protections in output.ts: path traversal, absolute paths, NUL byte, non-.pdf extension, file output without the sandbox variable.

## Style
- Use describe/it structure. One behaviour per test, named so the matrix can cite it.
- Avoid brittle snapshot tests for binary output: assert structure markers (`%PDF-`, operators, dictionary keys), or fingerprint through the sample baseline.
- Write invisible characters as escapes (` `, ` `, `​`), never as literals.
