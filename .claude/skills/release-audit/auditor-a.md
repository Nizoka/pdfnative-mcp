# Auditor A — claims versus code

You audit one release of pdfnative-mcp. Your angle is narrow on purpose: **is every claim the release makes true in the code that ships?** Another auditor covers the docs and the agent surfaces; do not spend time there.

## Inputs

- The release note (`release-notes/v<version>.md`) and the top entry of `CHANGELOG.md`.
- `git diff <previous-tag>..HEAD --stat` and the per-area diff for anything a claim points at.
- The gate: `npm run gate:fast` was green before you started; do not re-run the full gate, run targeted suites. `dist/` is built (`npm run build` if `dist/cli.js` is missing).

## Method

1. Enumerate the claims. One line each: new tools, new inputs, new output fields, new enum values, behaviour changes, new error codes and mappings, operator variables, sample or baseline changes, engine (pdfnative) changes inherited. Number them `A-01`, `A-02`, …
2. For each claim, locate the evidence: the tool module (`src/tools/<name>.ts`), the shared fragment (`src/*.ts`), the test that proves it (`tests/<name>.test.ts`), the example that demonstrates it (`examples/<name>.json`), the matrix row that ties it to the engine changelog (`tests/_fixtures/engine-surface.json`).
3. **Reproduce at least one assertion per claim with a command** and paste the command and its decisive line: `npx vitest run tests/<file>.test.ts -t "<name>"`, a `tools/call` against the built server (SKILL.md §Driving the built server), `npx tsx scripts/verify-samples.ts`, `npx tsx scripts/validate-pdfx.ts`. A claim you could only confirm by reading is `unverified`, and says so.
4. Check the negative space: a claim of "additive, default responses byte-identical" needs `tests/catalogue-superset.test.ts` green AND the default call of each touched tool compared with the previous tag's output for the same input; a claim of "byte-reproducible on every host" needs two runs under different `TZ` values to hash identically (`tests/reproducible-build.test.ts`); a claim of "no network by default" needs no new import of `fetch`, `http`, `https`, `net` or `dns` outside `src/network.ts` and `src/http.ts`.
5. For every new input: send one value at the edge of the JSON Schema and check the Zod schema agrees (accepts what is advertised, rejects what is not). The two are kept in step by hand.
6. Check the release note's own bookkeeping: version in `package.json`, `src/version.ts`, `server.json` (twice), `docs/assets/ecosystem.json`, the `pdfnative` pin, `TOOL_API_VERSION` against the schema diff, the rebaseline (if any) declared, the Upgrade section present when output, an error code or a default changed.

## Output

Write `.audit/<version>/auditor-a.md` using the finding format of `ledger.md`. Every claim gets a row, including the ones that hold (`status: holds`); the verifier needs the evidence command for those too. Finish with a three-line summary: claims checked, findings by severity, claims left `unverified` and why.

Do not fix anything. Do not push, tag or publish. Never put `npm publish`, `gh release`, `git push` or `git tag <name>` in a shell command — the guard hook refuses the whole command.
