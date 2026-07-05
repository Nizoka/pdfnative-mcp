# AI Governance & Human-In-The-Loop (HITL)

> How an AI agent may propose bugs and improvements for the pdfnative project
> **without ever writing to GitHub**. The agent is a **draftsman**; a human is the
> only gate that submits.

This guide is the narrative companion to the machine-readable contract in
[`.github/ai-governance.json`](../../.github/ai-governance.json) and the
agent-and-human protocol in [`.github/AGENT_RULES.md`](../../.github/AGENT_RULES.md).
It is surfaced to agents through the `draft_governance_issue` tool and the
`governance_contract` / `draft_issue_workflow` MCP prompts.

---

## 1. The one rule

**The pdfnative-mcp server contains no code path that can write to GitHub or make
any outbound network call.** It cannot open an issue, comment, PR, or release. It
produces a **local draft** plus a **compliance report** and stops. A human must
review the draft and submit it themselves, under their own GitHub identity.

This is a guarantee **by construction**, not merely by policy: there is no HTTP
client, no `fetch`, and no GitHub SDK anywhere in the server.

---

## 2. Why this exists

The pdfnative project has two hard, non-negotiable properties that an
autonomously-filing agent would routinely break:

- **Zero runtime dependencies.** A well-meaning agent that "fixes" a bug by
  proposing `npm install some-lib` violates the core philosophy.
- **Signal over noise.** Auto-filed, unreproduced, or duplicate issues erode the
  tracker for human maintainers.

Keeping a human in the loop preserves both, while still letting agents do the
valuable up-front work: reproduce, categorise, and draft a high-quality issue.

---

## 3. The contract (six non-negotiable rules)

1. **Zero runtime dependencies** — never propose adding an external runtime npm
   package. (Enforced: a draft that suggests `npm install <pkg>`, a `yarn/pnpm/bun add`,
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

Minimal call:

```jsonc
{
  "title": "add_table drops the caption on the second page",
  "issueType": "bug",
  "summary": "When repeatHeader is true, the caption row only renders on page 1; subsequent pages repeat the header without the caption.",
  "reproduction": {
    "command": "node examples/run.mjs add-table-caption.json",
    "result": "Page 2 shows the header row but no caption row."
  },
  "expectedBehavior": "The caption repeats together with the header on every page.",
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
```

`scripts/verify-issue.mjs` mirrors `validateIssueMarkdown()` in
[`src/governance.ts`](../../src/governance.ts) byte-for-byte, so the CLI and the
tool never disagree. `tests/governance.test.ts` asserts that alignment.

---

## 7. What the server will never do

- Open, edit, comment on, or close a GitHub issue or PR.
- Trigger a release.
- Make any outbound network request or emit telemetry.
- Persist your draft anywhere except the opt-in `PDFNATIVE_MCP_OUTPUT_DIR` sandbox
  when you explicitly ask for `outputMode: 'file'`.

The agent drafts. The human decides. That is the whole contract.
