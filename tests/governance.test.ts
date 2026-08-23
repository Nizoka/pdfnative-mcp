/**
 * Tests for the AI-governance contract module and its alignment with the repo's
 * governance artifacts (.github/ai-governance.json, scripts/verify-issue.mjs).
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import {
    validateIssueMarkdown,
    GOVERNANCE_CONTRACT_SUMMARY,
    DRAFT_ISSUE_WORKFLOW,
    IDENTITY_REMINDER,
    HUMAN_GATE,
} from '../src/governance.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'scripts', 'verify-issue.mjs');

/** Run the shipped CLI verifier on a draft and return its exit code (0 pass, 1 fail). */
async function runCliExitCode(draft: string): Promise<number> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-verify-'));
    const file = path.join(dir, 'draft.md');
    await fs.writeFile(file, draft, 'utf8');
    try {
        execFileSync(process.execPath, [CLI, file], { stdio: 'pipe' });
        return 0;
    } catch (err) {
        return (err as { status?: number }).status ?? 1;
    }
}

const GOOD_DRAFT = `# Something broke

## Reproduction
\`\`\`
node repro.mjs
\`\`\`
Environment: node v22, os windows.
Expected: it should work.
`;

const DEPENDENCY_DRAFT = `# Add a dependency

Please run npm install left-pad to fix this.

\`\`\`
repro here
\`\`\`
Expected + environment + node.
`;

const NO_REPRO_DRAFT = `# No repro provided

Expected behavior described but no fenced code block. environment node.
`;

describe('validateIssueMarkdown', () => {
    it('passes a well-formed draft', () => {
        const r = validateIssueMarkdown(GOOD_DRAFT);
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('rejects a draft proposing a runtime dependency', () => {
        const r = validateIssueMarkdown(DEPENDENCY_DRAFT);
        expect(r.ok).toBe(false);
        expect(r.errors.join(' ')).toMatch(/dependency/i);
    });

    it('rejects a draft with no reproduction code block', () => {
        const r = validateIssueMarkdown(NO_REPRO_DRAFT);
        expect(r.ok).toBe(false);
        expect(r.errors.join(' ')).toMatch(/reproduction/i);
    });

    it('warns (advisory) when recommended fields are missing', () => {
        const r = validateIssueMarkdown('# Title\n\n```\nrepro\n```\n');
        expect(r.ok).toBe(true);
        expect(r.warnings.length).toBeGreaterThan(0);
    });

    it('stays aligned with the shipped CLI verifier (scripts/verify-issue.mjs)', async () => {
        for (const draft of [GOOD_DRAFT, DEPENDENCY_DRAFT, NO_REPRO_DRAFT, '# x\n\n```\ny\n```\n']) {
            const module = validateIssueMarkdown(draft);
            const cliExit = await runCliExitCode(draft);
            expect(cliExit === 0).toBe(module.ok);
        }
    });
});

describe('governance constants', () => {
    it('surface the draftsman role and the human gate', () => {
        expect(GOVERNANCE_CONTRACT_SUMMARY).toMatch(/DRAFTSMAN/);
        expect(DRAFT_ISSUE_WORKFLOW).toMatch(/never submits/i);
        expect(IDENTITY_REMINDER).toMatch(/GitHub identity/i);
        expect(HUMAN_GATE).toMatch(/never opens/i);
    });
});

describe('repo governance artifacts', () => {
    it('.github/ai-governance.json encodes the non-negotiable HITL policy', async () => {
        const raw = await fs.readFile(path.join(ROOT, '.github', 'ai-governance.json'), 'utf8');
        const contract = JSON.parse(raw) as {
            policy: Record<string, unknown>;
            human_in_the_loop: Record<string, unknown>;
        };
        expect(contract.policy['automatic_issue_reporting']).toBe(false);
        expect(contract.policy['autonomous_github_writes_allowed']).toBe(false);
        expect(contract.policy['human_in_the_loop_mandatory']).toBe(true);
        expect(contract.policy['runtime_dependencies_allowed']).toBe(false);
        expect(contract.human_in_the_loop['role_of_agent']).toBe('draftsman');
        // v1.6.0 network policy: no egress by default; only operator-configured PKI endpoints.
        expect(contract.policy['outbound_network_allowed']).toBe(false);
        const net = contract.policy['outbound_network'] as Record<string, unknown>;
        expect(net['default']).toBe('none');
        expect(net['operator_configured_endpoints']).toEqual(['rfc3161_tsa', 'ocsp', 'crl']);
        expect(net['url_from_tool_arguments']).toBe('never');
        expect(net['github']).toBe('never');
        expect(net['telemetry']).toBe('never');
    });

    it('ships the AGENT_RULES.md protocol and a drafts staging area', async () => {
        const rules = await fs.readFile(path.join(ROOT, '.github', 'AGENT_RULES.md'), 'utf8');
        expect(rules).toMatch(/draftsman/i);
        expect(rules).toMatch(/human-in-the-loop/i);
        const draftsReadme = await fs.readFile(path.join(ROOT, '.github', 'drafts', 'README.md'), 'utf8');
        expect(draftsReadme).toMatch(/staging area/i);
    });
});
