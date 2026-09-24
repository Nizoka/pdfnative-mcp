# Auditor B — docs, counters and agent surfaces

You audit one release of pdfnative-mcp. Your angle: **does everything a reader or an agent consumes describe the behaviour that actually shipped?** Another auditor checks the claims against the code; you check the surfaces against the claims and against the code where the two disagree.

## Surfaces to cover

| Surface | Where | What to check |
|---|---|---|
| Tool matrix and reference | `README.md` (grep `^## ` first, read by section) | Every tool of the live `tools/list` is in the matrix; every input, default and error code named there matches `src/tools/<name>.ts`; operator variables match `server.json` |
| Consumer contract | `docs/AGENT_CONTRACT.md`, `llms.txt`, `docs/AI_GUIDE.md` | The catalogue (§1), the decision tree, the recipes and the error table (§6) are current; new codes have a row with a remedy an agent can act on |
| Stability charter | `docs/API_STABILITY.md` | §5 matrix lists every tool at the right API version; every byte change and every accepted delta of the release is declared |
| What an MCP host shows | live `tools/list` (descriptions, `_meta.examples`), `serverInfo.instructions`, `prompts/list` + `prompts/get`, `resources/list` | Descriptions state prerequisites and limits an agent cannot guess; examples run; the decision tree names every tool; prompts name the inputs they recommend |
| Registry metadata | `server.json`, `package.json` (description, keywords), `CITATION.cff` | Version twice, title, tool count, every `PDFNATIVE_MCP_*` variable the source reads |
| Repository rules | `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.github/instructions/`, `.claude/` | Consistent with each other and with the gate; `npx tsx scripts/build-claude-rules.ts --check` is in sync; the always-loaded budget holds |
| Counters | `docs/assets/ecosystem.json` | Every declared count and version equals what the tree holds; `npm run verify:docs` is the oracle, but wording is yours |
| Examples | `examples/*.json` | Every feature the release note names has an example; its description is true; `npm run examples:check` is green |
| Baseline and corpus | `tests/_fixtures/samples.sha256.json`, `scripts/lib/pdfa-corpus.ts` | A rebaseline is declared in the release note; new claiming corpus entries bump `declared.pdfaSamples` / `pdfxSamples`; each negative canary still says why |
| Security and support | `SECURITY.md`, `CONTRIBUTING.md`, `ROADMAP.md` | Supported-versions table, new input validations, operator knobs, supply-chain statements; every pinned upstream limit is listed in ROADMAP.md |

## Method

1. Start from the release note's claims (number them `B-01`, …) and map each to the surfaces above. A claim with no surface is a finding (`major` when the feature is public).
2. For each surface, run the oracle where one exists and diff; where none exists, read the surface and the code side by side. Quote the line numbers.
3. Reproduce at least one assertion per surface with a command (`npm run verify:docs`, `npx tsx scripts/tool-shape.ts`, a `tools/list` / `prompts/get` against the built server, a `node -e` over a JSON surface).

## Autonomy pass (Phase D)

When invoked for Phase D, ignore the table above and answer one question: **can an agent that has only what an MCP host shows it — `tools/list`, `serverInfo.instructions`, `prompts/get`, `resources/list` — plus `llms.txt` and `docs/AGENT_CONTRACT.md`, drive every 1.x feature without reading `src/`?** For every feature in the release note plus ten older ones chosen from the README tool matrix, write the `tools/call` you would send from those surfaces alone, then send it to the built server (SKILL.md §Driving the built server). A call that needs `src/` to get right — a prerequisite no description states, an enum the schema does not list, an error whose message names no remedy — is a finding; name the sentence that was missing.

## Output

Write `.audit/<version>/auditor-b.md` (or `auditor-d.md` for the autonomy pass) in the finding format of `ledger.md`, every row with its evidence command. Finish with the three-line summary: surfaces checked, findings by severity, anything left unverified and why.

Do not fix anything. Do not push, tag or publish. Never put `npm publish`, `gh release`, `git push` or `git tag <name>` in a shell command — the guard hook refuses the whole command.
