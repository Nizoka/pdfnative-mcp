/**
 * AI-governance & Human-In-The-Loop (HITL) contract for pdfnative-mcp.
 *
 * This module is the runtime-embedded, single source of truth for the
 * governance policy declared in `.github/ai-governance.json` and
 * `.github/AGENT_RULES.md`. It backs:
 *   - the `draft_governance_issue` tool (draft assembly + policy validation),
 *   - the `governance_contract` / `draft_issue_workflow` MCP prompts,
 *   - `tests/governance.test.ts` (which asserts alignment with the repo files
 *     and with `scripts/verify-issue.mjs`).
 *
 * CRITICAL: nothing here — and nothing anywhere in the server — can submit a
 * GitHub issue, comment, PR, or make any outbound network call on its own (the
 * only egress is to operator-configured TSA / OCSP / CRL endpoints). The agent is a
 * DRAFTSMAN; the human is the only gate.
 */

/** Result of validating a draft issue's markdown against the policy. */
export interface IssueValidationResult {
    readonly ok: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
}

/**
 * Patterns that indicate an external runtime dependency is being proposed.
 * Kept byte-identical to `scripts/verify-issue.mjs`.
 */
const DEPENDENCY_PATTERNS: readonly RegExp[] = [
    /\bnpm\s+(install|i|add)\s+(?!--)[a-z@]/i,
    /\b(yarn|pnpm|bun)\s+add\s+/i,
    /\bpnpm\s+install\s+[a-z@]/i,
    /add\s+[`"']?[\w@/-]+[`"']?\s+to\s+(the\s+)?(runtime\s+)?dependencies\b/i,
    /"dependencies"\s*:\s*\{[^}]*[\w-]+[^}]*\}/i,
];

/** Required issue fields (advisory — surfaced as warnings when missing). */
const REQUIRED_FIELDS: ReadonlyArray<{ readonly key: string; readonly re: RegExp }> = [
    { key: 'minimal_reproduction', re: /repro|reproduc/i },
    { key: 'environment', re: /environment|version|node|os\b/i },
    { key: 'expected_behavior', re: /expected/i },
];

/**
 * Validate the text of a draft issue against the zero-dependency + reproduction
 * policy. Pure and filesystem-free so both the tool and unit tests can use it.
 */
export function validateIssueMarkdown(content: string): IssueValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const re of DEPENDENCY_PATTERNS) {
        if (re.test(content)) {
            errors.push('Proposing an external runtime dependency violates the zero-dependency policy.');
            break;
        }
    }

    if (!/```[\s\S]*?```/.test(content)) {
        errors.push('No reproduction code block found — include a minimal repro inside a fenced ``` block.');
    }

    for (const field of REQUIRED_FIELDS) {
        if (!field.re.test(content)) {
            warnings.push(`Recommended field appears to be missing: ${field.key}.`);
        }
    }

    return { ok: errors.length === 0, errors, warnings };
}

/** The non-negotiable identity reminder shown with every draft. */
export const IDENTITY_REMINDER =
    'This draft, if submitted, is published under YOUR GitHub identity. You share ' +
    'responsibility for its content. Review it fully before you open the issue manually.';

/** The human-in-the-loop gate statement embedded in every compliance report. */
export const HUMAN_GATE =
    'DRAFT ONLY. The pdfnative-mcp server never opens, edits, or submits GitHub ' +
    'issues, comments, PRs, or releases, and makes no outbound network call by default ' +
    '(its only possible egress is to operator-configured TSA / OCSP / CRL endpoints). A human ' +
    'MUST explicitly review this draft and submit it themselves.';

/**
 * Compact, agent-facing summary of the governance contract. Surfaced verbatim by
 * the `governance_contract` MCP prompt and echoed in server instructions.
 */
export const GOVERNANCE_CONTRACT_SUMMARY = `pdfnative-mcp AI Governance & Human-In-The-Loop contract (v1.0.0)

ROLE: You are a DRAFTSMAN, never an autonomous submitter.

NON-NEGOTIABLE RULES
  1. Zero runtime dependencies — never propose adding an external runtime npm package.
  2. No duplicates — search open AND closed issues/PRs before drafting.
  3. Local reproduction — run a minimal repro (tool call or Node/TS snippet) first.
  4. Byte-identity/schema awareness — keep default output byte-identical; keep JSON Schema + Zod aligned.
  5. Human-in-the-loop gate — produce a LOCAL draft only; a human reviews and submits.
  6. Identity integrity — remind the user the issue publishes under their GitHub identity.

THE SERVER ITSELF cannot write to GitHub and makes no outbound network call by default — its only possible egress is to the RFC 3161 / OCSP / CRL endpoints the operator configured (PDFNATIVE_MCP_TSA_URL / PDFNATIVE_MCP_REVOCATION), never to a URL from a tool argument.
Use the draft_governance_issue tool to produce a compliant local draft + compliance report,
then present both to the user and stop. The user is the only gate.`;

/**
 * Step-by-step HITL workflow. Surfaced by the `draft_issue_workflow` MCP prompt.
 */
export const DRAFT_ISSUE_WORKFLOW = `Human-In-The-Loop issue workflow for pdfnative-mcp

1. Detect a bug or improvement while working locally.
2. Reproduce it: run a minimal MCP tool call or Node/TS snippet and capture the exact command + result.
3. Confirm zero new runtime dependency is required (a hard blocker otherwise).
4. Search existing open AND closed issues/PRs for duplicates.
5. Call draft_governance_issue with the title, summary, issueType, reproduction, expected vs actual, and affected packages.
6. Present the returned draft markdown AND the compliance report to the user.
7. STOP. The user reviews, then manually opens the issue on GitHub under their own identity.

The agent never submits. The server never touches GitHub and never touches the network except for operator-configured TSA / OCSP / CRL endpoints.`;
