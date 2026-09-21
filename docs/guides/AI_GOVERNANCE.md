# AI Governance & Human-In-The-Loop (HITL)

> How an AI agent may propose bugs and improvements for the pdfnative project
> **without ever writing to GitHub**. The agent is a **draftsman**; a human is the
> only gate that submits.

This guide is the narrative companion to the machine-readable contract in
[`.github/ai-governance.json`](../../.github/ai-governance.json) and the
agent-and-human protocol in [`.github/AGENT_RULES.md`](../../.github/AGENT_RULES.md).
It is surfaced to agents through the `draft_governance_issue` **tool** and two MCP
**prompts**, `governance_contract` and `draft_issue_workflow` (prompts are read with
`prompts/get`, not called with `tools/call`).

Two audiences, two rule files: an agent that **uses** the server reads the consumer
contract, [docs/AGENT_CONTRACT.md](../AGENT_CONTRACT.md) (tool catalogue, decision tree,
token economy, the error codes in §6 — `GOVERNANCE_VIOLATION` among them); an agent that
works **on** the repository reads [AGENTS.md](../../AGENTS.md), the repository rule file
(it held the consumer contract until v1.6.0; the contract moved, section numbers
unchanged). The human-in-the-loop rule below binds both.

---

## 1. The one rule

**The pdfnative-mcp server contains no code path that can write to GitHub, and makes
no outbound network call by default.** It cannot open an issue, comment, PR, or
release. It produces a **local draft** plus a **compliance report** and stops. A human
must review the draft and submit it themselves, under their own GitHub identity.

This is a guarantee **by construction**, not merely by policy: there is no GitHub SDK
anywhere in the server, and the only egress it can ever perform goes to the RFC 3161 /
OCSP / CRL endpoints the **operator** configured in the environment for PAdES
long-term validation (`PDFNATIVE_MCP_TSA_URL`, `PDFNATIVE_MCP_REVOCATION`,
`PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`, all in `src/network.ts`) — never to a URL
supplied by a tool argument, never to GitHub, never for telemetry. Without that
configuration the server opens no socket of its own.

---

## 2. Why this exists

The pdfnative project has two hard, non-negotiable properties that an
autonomously-filing agent would routinely break:

- **No new runtime dependencies.** The pdfnative engine has zero; pdfnative-mcp
  carries exactly three (pdfnative, the MCP SDK, zod) and adds none. A
  well-meaning agent that "fixes" a bug by proposing `npm install some-lib`
  violates the core philosophy.
- **Signal over noise.** Auto-filed, unreproduced, or duplicate issues erode the
  tracker for human maintainers.

Keeping a human in the loop preserves both, while still letting agents do the
valuable up-front work: reproduce, categorise, and draft a high-quality issue.

---

## 3. The contract (six non-negotiable rules)

1. **No new runtime dependencies** — never propose adding an external runtime npm
   package beyond the three the server already has. (Enforced: a draft that suggests `npm install <pkg>`, a `yarn/pnpm/bun add`,
   or edits `"dependencies"` is rejected with `GOVERNANCE_VIOLATION`.)
2. **No duplicates** — search **open AND closed** issues/PRs before drafting.
   (`duplicateSearchPerformed` must be `true`.)
3. **Local reproduction** — run a minimal repro (an MCP tool call or a Node/TS
   snippet) first and capture the exact command + result. (Enforced: the draft must
   contain a fenced ```` ``` ```` reproduction block.)
4. **Byte-identity / schema awareness** — keep default output byte-identical and
   keep the JSON Schema aligned with the Zod schema.
5. **Human-in-the-loop gate** — produce a **local** draft only; a human reviews and
   submits.
6. **Identity integrity** — remind the user that the issue publishes under **their**
   GitHub identity and that they share responsibility for its content.

---

## 4. The workflow

```
1. Detect a bug or improvement while working locally.
2. Reproduce it — run a minimal MCP tool call or Node/TS snippet; capture the exact command + result.
3. Confirm zero new runtime dependency is required (a hard blocker otherwise).
4. Search existing open AND closed issues/PRs for duplicates.
5. Call draft_governance_issue with the title, summary, issueType, reproduction, expected vs actual, and affected packages.
6. Present the returned draft markdown AND the compliance report to the user.
7. STOP. The user reviews, then manually opens the issue on GitHub under their own identity.
```

The `draft_issue_workflow` MCP prompt returns exactly these steps.

---

## 5. Using the `draft_governance_issue` tool

Minimal call — here drafting an engine limit this release documents (the
`international-pdfa2u-taitham.pdf` negative canary in the veraPDF corpus). The previous
edition of this guide used the PDF/A form-font gap as its example; that gap was
reported upstream (pdfnative issue #74), fixed in pdfnative 1.8.0, and its canary is now
an expected pass.

```json
{
  "title": "Tai Tham under PDF/A-2u: one shaped glyph has no ToUnicode entry",
  "issueType": "bug",
  "targetRepo": "pdfnative",
  "summary": "add_international_text with lang 'nod' and pdfA 'pdfa2u' produces a file veraPDF rejects on rule 6.2.11.7.2: a glyph produced by the shaper cannot be mapped to Unicode. No diagnostic is raised. The same text validates under pdfa2b.",
  "reproduction": {
    "command": "npm run build && npm run corpus:pdfa && npm run validate:pdfa   # international-pdfa2u-taitham.pdf: add_international_text, pdfA:'pdfa2u', lang:['nod','latin']",
    "result": "XFAIL [2u] test-output/pdfa/international-pdfa2u-taitham.pdf — veraPDF: rule 6.2.11.7.2 (the glyph can not be mapped to Unicode)."
  },
  "expectedBehavior": "Every glyph the Tai Tham shaper emits has a ToUnicode mapping, so the PDF/A-2u claim validates — or the engine raises a diagnostic when it cannot guarantee level U.",
  "duplicateSearchPerformed": true
}
```

Optional inputs:

| Field | Default | Notes |
|-------|---------|-------|
| `targetRepo` | `pdfnative-mcp` | Documentation label only — the server never contacts it. Usually `pdfnative-mcp` or `pdfnative`. |
| `actualBehavior` | reproduction result | What actually happened. |
| `affectedPackages` | `['pdfnative-mcp']` | Impacted packages. |
| `outputMode` | `inline` | `file` also writes the draft `.md` into `PDFNATIVE_MCP_OUTPUT_DIR`. |
| `outputPath` | — | Relative `.md` path inside the sandbox (only when `outputMode: 'file'`). |

### What you get back

- `draftMarkdown` — the full issue, ready for a human to review and paste into GitHub.
- `compliance` — a structured report the agent MUST present alongside the draft:
  `zeroDependencyConfirmed`, `reproductionCommand`, `reproductionResult`,
  `duplicateSearchPerformed`, `affectedPackages`, `identityReminderShown`,
  `humanGate`, and the captured `environment` (`node`, `os`, `pdfnativeMcp`).
- `warnings` — advisory notes (e.g. a recommended field appears to be missing).

### When it refuses (`GOVERNANCE_VIOLATION`)

The draft is rejected before you can submit it if it:

- proposes an external runtime dependency,
- omits a reproduction code block, or
- sets `duplicateSearchPerformed: false`.

Fix the draft and call again. This keeps the human from ever submitting a
contract-breaking issue.

---

## 6. Verifying a draft on disk

When `outputMode: 'file'` is used, the draft `.md` lands in the sandbox. A human
(or CI) can re-check it with the same policy the tool applied:

```bash
npm run verify:issue -- .github/drafts/<draft>.md
# PowerShell swallows a bare `--` after `npm run`: call the script directly there
node scripts/verify-issue.mjs .github/drafts/<draft>.md
```

`scripts/verify-issue.mjs` mirrors `validateIssueMarkdown()` in
[`src/governance.ts`](../../src/governance.ts) byte-for-byte, so the CLI and the
tool never disagree. `tests/governance.test.ts` asserts that alignment.

---

## 7. Enforcement for agents working on the repository

The server cannot write to GitHub by construction (§1). A **coding agent** working in a
clone has a shell, so there the rule is enforced mechanically rather than by trust. The
facts are recorded in `capability_manifest` of
[`.github/ai-governance.json`](../../.github/ai-governance.json):

- **Committed settings** — `.claude/settings.json`: no commit attribution, `Read` denied
  on generated and bulk files (`dist/`, `coverage/`, `test-output/`, `package-lock.json`,
  `node_modules/`), and the human-in-the-loop commands denied for both shells.
- **A fail-closed guard hook** — `.claude/hooks/guard.mjs` runs before every **Bash and
  PowerShell** command and refuses publishing to npm, creating / editing / closing /
  merging / commenting on PRs and issues, releases, writing GitHub API calls, any push,
  tag creation and the line-ending renormalisation commit — in the whole command, every
  shell segment, command substitutions and nested `-c` / `-Command` / `-e` payloads. It
  fails closed on input it cannot read; `tests/tools/guard.test.ts` is its contract.
- **Generated rules** — `.claude/rules/*.md` are projected from
  `.github/instructions/*.instructions.md` by `npm run agents:rules`, each scoped to the
  paths of its source; they are never edited by hand, and `npm run verify:docs` fails
  on drift.
- **A maintainer-invoked release audit** — the `release-audit` skill
  (`.claude/skills/release-audit/`) runs the pre-release audit and produces a GO / NO-GO
  ledger. It cannot be invoked by the agent on its own initiative, and it publishes
  nothing.

The division of labour is the same as for issues: the agent prepares — the version
bump, the changelog, the release note, the PR draft under `.github/drafts/`, a green
`npx tsx scripts/gate.ts --publish --require-all` — and **stops**. The maintainer
pushes, opens the PR, tags and publishes.

---

## 8. What the server will never do

- Open, edit, comment on, or close a GitHub issue or PR.
- Trigger a release.
- Make any outbound network request other than to the operator-configured TSA / OCSP /
  CRL endpoints (never to a URL from a tool argument), or emit telemetry.
- Persist your draft anywhere except the opt-in `PDFNATIVE_MCP_OUTPUT_DIR` sandbox
  when you explicitly ask for `outputMode: 'file'`.

The agent drafts. The human decides. That is the whole contract.
