/**
 * Tests for `draft_governance_issue` — the MCP-native Human-In-The-Loop
 * embodiment of the pdfnative AI-governance contract. These tests assert the
 * server acts strictly as a DRAFTSMAN: it produces a compliant local draft plus
 * a compliance report and NEVER submits anything.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { draftGovernanceIssue } from '../src/tools/draft-governance-issue.js';
import { ToolError } from '../src/errors.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

const validInput = {
    title: 'add_table clips descenders on wrapped cells',
    summary: 'Wrapped table cells clip the descenders of g/j/p/q/y at the default cellPadding.',
    issueType: 'bug' as const,
    targetRepo: 'pdfnative',
    reproduction: { command: "add_table with a wrapped cell containing 'paragraphy'", result: 'Descenders are clipped.' },
    expectedBehavior: 'Descenders render fully within the cell.',
    affectedPackages: ['pdfnative'],
    duplicateSearchPerformed: true,
};

describe('draft_governance_issue', () => {
    beforeAll(() => {
        delete process.env[ENV_KEY];
    });
    afterEach(() => {
        delete process.env[ENV_KEY];
        vi.restoreAllMocks();
    });

    it('produces a compliant draft with a reproduction block and identity reminder', async () => {
        const result = await draftGovernanceIssue(validInput);
        expect(result.outputMode).toBe('inline');
        expect(result.draftMarkdown).toContain('# add_table clips descenders on wrapped cells');
        // Reproduction fenced block present.
        expect(/```[\s\S]*?```/.test(result.draftMarkdown)).toBe(true);
        // Identity + human gate surfaced.
        expect(result.draftMarkdown).toMatch(/GitHub identity/i);
        expect(result.draftMarkdown).toMatch(/DRAFT ONLY/i);
        expect(result.sizeBytes).toBeGreaterThan(0);
    });

    it('returns a complete, honest compliance report', async () => {
        const { compliance } = await draftGovernanceIssue(validInput);
        expect(compliance.zeroDependencyConfirmed).toBe(true);
        expect(compliance.duplicateSearchPerformed).toBe(true);
        expect(compliance.identityReminderShown).toBe(true);
        expect(compliance.reproductionCommand).toBe(validInput.reproduction.command);
        expect(compliance.reproductionResult).toBe(validInput.reproduction.result);
        expect(compliance.affectedPackages).toEqual(['pdfnative']);
        expect(compliance.humanGate).toMatch(/never opens/i);
        expect(compliance.environment.node).toBe(process.version);
        expect(compliance.environment.pdfnativeMcp).toBe('1.5.0');
        expect(typeof compliance.environment.os).toBe('string');
    });

    it('makes NO outbound network call (fetch is never invoked)', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        await draftGovernanceIssue(validInput);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects a draft that proposes a runtime dependency with GOVERNANCE_VIOLATION', async () => {
        await expect(
            draftGovernanceIssue({
                ...validInput,
                summary: 'We should run npm install left-pad to fix this quickly.',
            }),
        ).rejects.toMatchObject({ code: 'GOVERNANCE_VIOLATION' });
    });

    it('rejects duplicateSearchPerformed=false with GOVERNANCE_VIOLATION', async () => {
        await expect(
            draftGovernanceIssue({ ...validInput, duplicateSearchPerformed: false }),
        ).rejects.toMatchObject({ code: 'GOVERNANCE_VIOLATION' });
    });

    it('rejects invalid input with VALIDATION_ERROR', async () => {
        await expect(draftGovernanceIssue({ title: 'too short' })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
    });

    it("requires outputPath when outputMode='file'", async () => {
        await expect(
            draftGovernanceIssue({ ...validInput, outputMode: 'file' }),
        ).rejects.toThrow(ToolError);
    });

    it('writes a .md draft to the sandbox when outputMode=file', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-gov-'));
        process.env[ENV_KEY] = dir;
        const result = await draftGovernanceIssue({
            ...validInput,
            outputMode: 'file',
            outputPath: 'drafts/issue.md',
        });
        expect(result.outputMode).toBe('file');
        expect(result.filePath?.startsWith(dir)).toBe(true);
        const written = await fs.readFile(result.filePath as string, 'utf8');
        expect(written).toBe(result.draftMarkdown);
    });

    it("rejects a non-.md sandbox path with INVALID_EXTENSION", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-gov-'));
        process.env[ENV_KEY] = dir;
        await expect(
            draftGovernanceIssue({ ...validInput, outputMode: 'file', outputPath: 'issue.txt' }),
        ).rejects.toMatchObject({ code: 'INVALID_EXTENSION' });
    });

    it('rejects a path-traversal sandbox path with SECURITY_VIOLATION', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-gov-'));
        process.env[ENV_KEY] = dir;
        await expect(
            draftGovernanceIssue({ ...validInput, outputMode: 'file', outputPath: '../escape.md' }),
        ).rejects.toMatchObject({ code: 'SECURITY_VIOLATION' });
    });
});
