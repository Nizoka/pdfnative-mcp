@AGENTS.md

# Claude Code addendum

Everything in AGENTS.md applies. This file adds only what is specific to Claude Code sessions in this repository.

## Token discipline

- Run tests through `npx tsx scripts/gate.ts --fast` or `npx vitest run <file>` (the dot reporter is configured); never paste a full test run into context.
- Never Read `dist/`, `coverage/`, `test-output/`, `package-lock.json`, `node_modules/`, `.clusterfuzzlite/engine/package-lock.json`, `.audit/`.
  The deny list in `.claude/settings.json` applies to Read and, at best effort, to Grep/Glob — ask the built server (`tools/list`, `prompts/get`) instead of reading `dist/`;
  `npm ls <pkg>` answers lockfile questions; the large fixtures (`engine-surface.json`, `tool-shape.json`) are read by `grep -n`, never whole.
- A tool's inputs are in `src/tools/<name>.ts`; a shared fragment (`layout`, `print`, `color`, `font-dir`, …) is one Grep away in `src/*.ts`. `tools/list` is about 350 kB: project it, never print it.
- Read README.md, ROADMAP.md, docs/KNOWLEDGE_BASE.md and docs/AGENT_CONTRACT.md by section: `grep -n "^## "` first, then a line range. CHANGELOG.md: only the top entry.
- `.github/instructions/*.md` are the per-area rules: open the ONE matching the area you touch.
- Sample regeneration: `npm run build && npm run test:generate` then `npx tsx scripts/verify-samples.ts`. Any `--update` (rebaseline) must be justified in the release note.
- Never push, never open PRs/issues/releases, never tag (HITL policy, hook-enforced). No `Co-Authored-By` trailers (`attribution.commit` is `""`).

## Gate

- `npx tsx scripts/gate.ts --fast` before proposing a commit; `npm run gate` is the CI profile; `--publish --require-all` on release branches only.
- `--only <step>` for one step, `--json` for machine output; logs in `test-output/.gate/<step>.log` — open only the failing step's log, through the shell.
- When the gate (or the whole vitest suite) exceeds the shell timeout, run it in the background and read `--json` / the `FAIL` lines only. The fuzz container never runs locally: `tests/fuzzing/targets.test.ts` is the proof.

## Where to look first

1. `src/server.ts` — the `TOOLS` registry, prompts, instructions; `tests/_fixtures/tool-shape.json` — every pinned schema shape.
2. AGENTS.md §Where is what — the path → purpose → instruction-file table.
3. `docs/assets/ecosystem.json` — every count and version; `npm run verify:docs` enforces it.

## Stdout gotcha

On stdio, stdout IS the protocol: one stray `console.log` in `src/` corrupts every session (the gate's `smoke` step fails on any non-JSON-RPC line). Log to stderr.
Always drive the **built** server (`node dist/cli.js`; harness `tests/_stdio-session.ts`) before claiming a change works.

## Windows session notes

- The session shell is PowerShell, with Git Bash as the Bash tool. PowerShell swallows `--` after `npm run` — call `npx tsx scripts/<name>.ts` directly.
- Multi-line `node -e` payloads and heredocs break on backticks, `$` and backslashes: write a script to the scratchpad and run it; a scratch `.mts` importing `pdfnative` must sit inside the repository (`test-output/`).
  Git Bash `sed` mangles `\d` / `\s` in replacements — use Edit for a line that carries a regular expression.
- veraPDF: portable install in `%USERPROFILE%\verapdf` with JDK 13; the runner reads `VERAPDF_HOME` and `JAVACMD` (the JDK's `java.exe` — `JAVA_HOME` alone is not enough when spawned from Node).
- `npm install` under npm 10.9 can fail with an arborist `edgesOut` error on a fresh resolution; `npx npm@11.19.1 install` works, `npm ci` is unaffected.
- vitest sometimes reports "no tests" right after a file write: run it again.

## Hooks and permissions in force

- `.claude/hooks/guard.mjs` (PreToolUse on Bash **and** PowerShell) denies `npm publish`/`unpublish`/`deprecate`/`dist-tag`/`version`, `gh pr|issue create|edit|close|comment|merge`,
  `gh release`, writing `gh api`, any `git push`, `git tag <name>`, `git add --renormalize` — in every command segment, `$( )`/backticks and `sh -c`/`pwsh`/`node -e`/`npx -c` payloads
  (a quoted string holding one is refused too: write it with Edit). The maintainer submits those (.github/AGENT_RULES.md); `tests/tools/guard.test.ts` is the rule table.
- `permissions.deny` blocks Read on the bulk files above and the same write commands, for both shells; `permissions.allow` pre-approves `npm run`, `npx vitest`,
  `npx tsx scripts/*`, `npx tsc`, `npx eslint`, `node -e` and read-only git. `node dist/cli.js` is asked each time: it can reach the operator's TSA.

## Plan mode, rules and skills

- Plan mode for multi-file changes (plans name files, commands and the expected gate outcome); `/code-review` the branch diff before drafting a PR body.
- `.claude/rules/*.md` are generated from `.github/instructions/*.instructions.md` by `npm run agents:rules` (scoped by `paths:` = the source `applyTo`);
  `src/governance-embed.ts` from `.github/ai-governance.json` + `AGENT_RULES.md` by `npm run agents:governance`.
  Never edit a generated file: edit the source, then regenerate (`verify:docs` rules `claude-rules-sync` / `governance-embed` fail on drift).
- `/release-audit [release-notes/vX.Y.Z.md] [previous-tag]` (`.claude/skills/release-audit/`) is the maintainer-invoked pre-release audit:
  two auditors, an adversarial verifier, an agent-autonomy pass and a GO/NO-GO ledger under `.audit/`.

## Release

Follow CONTRIBUTING.md §Release and `scripts/release-prepare.ts`: prepare everything (lock-step version, changelog, note, manifest, PR draft, publish gate) and stop before pushing.
