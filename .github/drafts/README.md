# Issue Drafts (Human-In-The-Loop staging area)

This directory is the **draft staging area** mandated by the AI-governance
contract ([.github/ai-governance.json](../ai-governance.json),
[.github/AGENT_RULES.md](../AGENT_RULES.md)).

AI agents — and the `draft_governance_issue` MCP tool — write proposed GitHub
issues here as local Markdown files. Nothing in this repository (and nothing in
the `pdfnative-mcp` server) can submit these drafts automatically.

**Workflow:**

1. An agent (or the `draft_governance_issue` tool) produces `something.md` here
   plus a compliance report.
2. Validate it: `npm run verify:issue -- .github/drafts/something.md`
3. **You** review it, then manually open the issue on GitHub under your own
   identity. You share responsibility for the content.

Draft files are intentionally git-ignored (except this README) so work-in-progress
proposals never leak into the repository history.
