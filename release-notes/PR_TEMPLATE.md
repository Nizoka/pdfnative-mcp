# Release Pull Request Template

The body of a release pull request. `npx tsx scripts/release-prepare.ts --version X.Y.Z` scaffolds
`.github/drafts/pr-vX.Y.Z.md` from the block below (same mechanism as [TEMPLATE.md](TEMPLATE.md): it resolves
`vX.Y.Z`, `X.Y.Z`, the previous tag `vX.Y.Z-1` and `YYYY-MM-DD`, and unescapes the inner code fences). Whoever
prepares the release fills every section; the maintainer pastes the result into the GitHub pull request verbatim.
The per-version bodies are committed: they are the auditable record of what each release claimed and what was run.

Every figure quoted in the body comes from a command run on the release branch — the gate summary, `npm run test:coverage`,
`npm run verify:samples`, the validators — never from memory. `<…>` marks what to fill in.

```markdown
# release: vX.Y.Z — <headline>

> **Branch:** `release/vX.Y.Z` → `main`
> **Type:** <Major | Minor | Patch> release (<additive, fully backward-compatible with vX.Y.Z-1 | breaking: …>)
> **pdfnative pin:** `^A.B.C` → `^D.E.F` (or "unchanged")
> **Prepared:** YYYY-MM-DD — release note: `release-notes/vX.Y.Z.md`

## Summary

<Two or three paragraphs: what the release does for a user of an MCP host, what it does for an agent calling the
tools, what the repository adopted. Name the engine version and every ROADMAP item delivered.>

Counts (`docs/assets/ecosystem.json`): <N> tools, <N> prompts, <N> error codes, <N> operator variables
<unchanged | X → Y>; examples <X → Y>; samples in the baseline <X → Y>; conformance corpus <X → Y> files;
tests <X → Y> across <N> files.

## What changed

### Engine surface (`src/tools/`, shared fragments in `src/*.ts`)
- <One bullet per input, enum value, output field or error code added — with the tools that carry it.>

### Server (`src/server.ts`, transports, prompts, resources)
- <Registry, instructions, prompts, handlers, operator variables.>

### Tooling (`scripts/`)
- <Gate steps, generators, validators, verifiers added or changed.>

### CI / repository (`.github/`, root)
- <Workflows, rulesets, templates, dotfiles, package.json, server.json.>

### Agent layer
- <AGENTS.md / CLAUDE.md / `.claude/`, `docs/AGENT_CONTRACT.md`, instruction files, prompts.>

### Tests, examples and samples
- <New suites, new `examples/*.json`, new corpus entries, new baseline entries.>

### Documentation
- <README, docs/, llms.txt, SECURITY, CONTRIBUTING, ROADMAP, CHANGELOG, CITATION, the release note.>

## Verification

What actually ran on the release branch (<OS>, Node <version>, veraPDF <version>):

| Command | Result |
|---|---|
| `npx tsx scripts/gate.ts --publish --require-all` | <N passed, 0 skipped in N s — the summary line as printed> |
| `npm run test:coverage` — tests | <N / N passing across N files> |
| `npm run test:coverage` — coverage | <S % statements / B % branches / F % functions / L % lines (thresholds S / B / F / L)> |
| `npm run build && npm run test:generate && npm run verify:samples` | <N samples match the baseline (N by bytes, N semantic)> |
| `npm run corpus:pdfa && npm run validate:pdfa` | <N PASS, N XFAIL, 0 FAIL, 0 XPASS — veraPDF version> |
| `npm run validate:pdfx` | <N PASS, N XFAIL> |
| `npm run verify:docs` | <N rules, 0 errors> |
| `npm audit --audit-level=high` | <clean> |
| Built server over stdio (`node dist/cli.js`) | <handshake, tools/list count, server version, stdout carries JSON-RPC frames only> |

Independent audit: `/release-audit release-notes/vX.Y.Z.md vX.Y.Z-1` — <PENDING | the ledger: tally per severity, every
confirmed finding with its fix commit, every waiver with its reason>.

## API stability

- `TOOL_API_VERSION`: <`A.B.C` → `X.Y.Z` because … | unchanged because no schema and no error code changed> (docs/API_STABILITY.md).
- Superset gate: `tests/catalogue-superset.test.ts` passes against the frozen `tests/_fixtures/tool-shape.v1.5.0.json` —
  no tool, property or enum value removed, no new `required`, no tighter bound.
- Accepted deltas: <every widening enumerated in the test (a plain schema widened into `anyOf`, a new optional input, a new enum value), or "none">.
- `tests/_fixtures/tool-shape.json`: <refreshed deliberately with `npx tsx scripts/tool-shape.ts --write` — what moved | unchanged>.
- Error codes: <new codes and the only calls that can return them | unchanged>; documented in `docs/AGENT_CONTRACT.md` §6.

## Output changes and rebaseline

- Default responses of existing tools: <byte-identical | the list of what changed and why the previous output was wrong>.
- Bytes inherited from the engine: <which documents change, which stay identical>.
- `tests/_fixtures/samples.sha256.json`: <N entries re-anchored at X.Y.Z with `npx tsx scripts/verify-samples.ts --update`, N new, N unchanged — reason in the manifest's `provenance` note | not rebaselined>.
- Every item above is declared in the Upgrade section of `release-notes/vX.Y.Z.md`.

## Out of scope (tracked in ROADMAP.md)

- <Upstream-blocked items (each pinned by an `it.fails` test, each with its draft under `.github/drafts/`) and deferred work, with the ROADMAP entry.>

## Maintainer steps after merge

Agents stop at this draft; everything below is done by the maintainer (`.github/AGENT_RULES.md`).

1. <The LF renormalisation commit, if pending.>
2. Push the branch, open the pull request with this body, wait for `ci (22)`, `ci (24)` and `sample-regression`, merge.
3. Tag `vX.Y.Z` on the merge commit and publish the GitHub Release (title `vX.Y.Z - <short description>`, body = `release-notes/vX.Y.Z.md`).
4. Approve the `npm-publish` environment: `publish.yml` re-runs the publish gate and publishes through npm Trusted Publishing, then attaches the SBOM and the attestation to the release. Confirm with `npm view pdfnative-mcp version`.
5. Validate and publish `server.json` to the MCP registry.
6. Import or update the rulesets (`.github/rulesets/main.json`, `.github/rulesets/tags.json`) if they changed — CONTRIBUTING §Branch protection.
7. Update the `pdfnative-mcp` entry of `docs/assets/ecosystem.json` in the sibling repositories (pdfnative, pdfnative-cli).
8. <Submit the upstream issue drafts under `.github/drafts/issue-*.md`, if any.>

## Checklist

- [ ] `npm run gate` passes — the CI profile in one command (`npm run gate:fast` for a quick loop while iterating; PowerShell swallows a bare `--`, so call `npx tsx scripts/gate.ts --fast` there)
- [ ] All tests pass (`npm run test`)
- [ ] Type check passes (`npm run typecheck:all`)
- [ ] Lint passes (`npm run lint`)
- [ ] New code has tests (coverage thresholds in `vitest.config.ts` must not regress)
- [ ] No `any` types introduced
- [ ] No new runtime dependencies added (`pdfnative`, `@modelcontextprotocol/server` and `zod` stay the only three)
- [ ] A new or changed tool touches every wiring point: `src/tools/<name>.ts` (JSON Schema and the parallel Zod schema in lock-step), the `TOOLS` registry in `src/server.ts`, `tests/<name>.test.ts`, `examples/`, README, `docs/AGENT_CONTRACT.md`, `llms.txt`, `docs/API_STABILITY.md`
- [ ] If a tool schema or an error code changed: `npm run build && npx tsx scripts/tool-shape.ts --write` refreshed `tests/_fixtures/tool-shape.json` deliberately, `tests/catalogue-superset.test.ts` still passes against the frozen 1.5.0 fixture, and `TOOL_API_VERSION` was reviewed under `docs/API_STABILITY.md`
- [ ] If samples, PDF/A or PDF/X behaviour changed: `npm run build && npm run test:generate && npm run verify:samples && npm run corpus:pdfa && npm run validate:pdfx && npm run validate:pdfa` passes locally (veraPDF installed; new claiming corpus entries bump `declared.pdfaSamples` / `declared.pdfxSamples`; an intended output change is rebaselined with `npx tsx scripts/verify-samples.ts --update` and declared in the release note)
- [ ] If docs, README, llms.txt, AGENTS.md, CLAUDE.md or `.claude/` changed: `npm run verify:docs` passes
- [ ] CHANGELOG.md updated if user-facing changes
- [ ] For releases: `release-notes/vX.Y.Z.md` and this draft written, and `npx tsx scripts/gate.ts --publish --require-all` passes locally, which runs every individual gate: `typecheck:all`, `lint`, `build`, `dist-check`, `dist-probe`, `smoke`, `verify:tool-shape`, `server-json`, `test:generate`, `test:coverage`, `verify:docs`, `verify:samples`, `corpus:pdfa`, `validate:pdfx`, `validate:pdfa`
- [ ] Every figure above was produced by a command on this branch, not typed from memory
- [ ] `release-notes/vX.Y.Z.md` and the CHANGELOG entry for X.Y.Z say the same things as this body
- [ ] No `Co-Authored-By` trailer and no "generated with" footer anywhere on the branch
```

## Conventions

- Keep the section order; omit nothing — write "none" or "unchanged" where a section has no entry, so a reader sees it was considered.
- The Verification table quotes results as printed; a command that was not run is marked "not run", never guessed.
- The checklist carries the items of [.github/pull_request_template.md](../.github/pull_request_template.md) (the two links of that template are dropped here, because a pull request body has no stable base path), plus three release items.
- English everywhere; no `Co-Authored-By` trailer and no mention of an AI assistant.
