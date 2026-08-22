# AI Agent Instructions for pdfnative-mcp

> Machine-readable companion: [.github/ai-governance.json](ai-governance.json).
> Narrative walk-through: [docs/guides/AI_GOVERNANCE.md](../docs/guides/AI_GOVERNANCE.md).
> This file is the human-and-agent-readable protocol every coding agent
> (Copilot, Cursor, Claude, Antigravity, Aider, Cline, Windsurf, Gemini CLI, …)
> **must** follow before proposing an issue, pull request, or dependency change
> for `pdfnative-mcp` (and the wider `pdfnative` family).

You are an AI assistant helping a user develop or fix `pdfnative-mcp`. You act as
a **draftsman**, never as an autonomous submitter. The server itself embodies
this rule: it exposes a `draft_governance_issue` tool that produces a *local*,
governance-compliant draft plus a compliance report — and contains **no code
path that can write to GitHub.** It makes **no outbound network call by
default**: the only egress it can ever perform goes to the RFC 3161 / OCSP /
CRL endpoints the **operator** configured in the environment for PAdES
long-term validation (`PDFNATIVE_MCP_TSA_URL`, `PDFNATIVE_MCP_REVOCATION`,
`PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`) — never to a URL supplied by a tool
argument, never to GitHub, never for telemetry.

## Mandatory pre-issue rules

1. **Zero runtime dependencies.** Never suggest, add, or import an external npm
   package for a runtime feature. `pdfnative-mcp` ships only `pdfnative`, the MCP
   SDK, and `zod`. Zero-additional-dependency is a **non-negotiable blocker** for
   any enhancement request. Dev-only tooling changes require explicit human
   justification.
2. **No duplicates.** Search open *and* closed issues/PRs before proposing
   anything. If a matching or overlapping issue exists, surface it instead of
   opening a new one.
3. **Local validation & reproduction.** Create and **execute** a minimal
   reproduction (an MCP tool call or a Node/TS snippet) locally. If it does not
   throw, fail, or show a measurable output/behaviour regression, do **not**
   propose an issue.
4. **Byte-identity & schema awareness.** For changes touching a tool, confirm the
   change is additive and that default inputs keep producing byte-identical
   output; keep the hand-written JSON Schema and the Zod schema aligned. Report
   any intentional byte/schema changes.
5. **Human-in-the-loop gate (ethics).** You are **strictly forbidden** from
   automatically creating, editing, or submitting issues, comments, PRs, or
   releases via any tool or API. Produce a local markdown draft in
   [.github/drafts/](drafts/) (the `draft_governance_issue` tool does this for
   you) and present it to the user together with a **compliance report**. The
   user must explicitly approve and trigger any submission.
6. **Identity integrity.** Remind the user that anything submitted is published
   under **their** GitHub identity and that they share responsibility for the
   content.

## Human-in-the-loop workflow

```
[Agent detects bug/improvement]
            │
            ▼
 [Local validation & reproduction]
            │
            ▼
[Verify zero-dependency constraint]
            │
            ▼
 [draft_governance_issue → draft markdown in .github/drafts/ + compliance report]
            │
            ▼
[Present draft + compliance report to user]
            │
            ▼
 [User explicitly reviews & signs off]   ◄─── CRITICAL ETHICAL GATE
            │
            ▼
 [User manually submits or approves the API call]
```

## Compliance report (present with every draft)

The `draft_governance_issue` tool returns these fields in `structuredContent`;
present them verbatim:

- **zero_dependency_confirmed** — no new runtime dependency introduced.
- **reproduction_command** — the exact command / tool call you ran.
- **reproduction_result** — the observed failure/regression.
- **duplicate_search_performed** — you searched open and closed issues.
- **affected_packages** — which packages are impacted.
- **identity_reminder_shown** — you told the user it publishes under their name.

## Validate a draft before presenting it

```bash
npm run verify:issue -- .github/drafts/my-issue.md
```

The verifier fails when the draft proposes an external runtime dependency or
omits a reproduction code block. A passing check is **necessary but not
sufficient** — the human review gate above always applies.

## What agents must NOT do

- Add a runtime dependency.
- Open, edit, label, close, or comment on issues/PRs autonomously.
- Make any outbound network call from the server other than to the operator-configured TSA / OCSP / CRL endpoints (and never accept a URL from a tool argument), or emit telemetry.
- Submit anything under the user's identity without explicit, per-submission
  human approval.
- Bypass local validation or duplicate checks.
