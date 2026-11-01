/**
 * pdfnative://governance/policy and pdfnative://governance/rules (1.8.0): the
 * AI-governance contract served as resources, byte-identical to the files the
 * repository holds, listed whether or not file output is enabled.
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_RULES_TEXT, AI_GOVERNANCE_POLICY, AI_GOVERNANCE_POLICY_JSON } from '../src/governance-embed.js';
import { GOVERNANCE_RESOURCES, listResources, readResource } from '../src/resources.js';
import { renderGovernanceEmbed } from '../scripts/build-governance-embed.js';

const lf = (p: string): string => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

afterEach(() => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
});

describe('the embedded contract', () => {
    it('equals the repository files byte for byte, and the generator reproduces the module', () => {
        expect(AI_GOVERNANCE_POLICY_JSON).toBe(lf('.github/ai-governance.json'));
        expect(AGENT_RULES_TEXT).toBe(lf('.github/AGENT_RULES.md'));
        expect(lf('src/governance-embed.ts')).toBe(renderGovernanceEmbed(AI_GOVERNANCE_POLICY_JSON, AGENT_RULES_TEXT));
    });

    it('parses, and names the validator test that covers it', () => {
        expect(AI_GOVERNANCE_POLICY['version']).toBeDefined();
        expect((AI_GOVERNANCE_POLICY['verification'] as { validator_covered_by: string }).validator_covered_by).toBe('tests/governance.test.ts');
    });
});

describe('the governance resources', () => {
    it('are listed first, with and without an output sandbox', async () => {
        const without = await listResources();
        expect(without.map((r) => r.uri)).toEqual(['pdfnative://governance/policy', 'pdfnative://governance/rules']);
        expect(without[0]!.mimeType).toBe('application/json');
        expect(without[1]!.mimeType).toBe('text/markdown');
        expect(without.every((r) => r.size > 1000)).toBe(true);
        expect(GOVERNANCE_RESOURCES).toHaveLength(2);
    });

    it('read back as text, never as a blob', async () => {
        const policy = await readResource('pdfnative://governance/policy');
        expect('text' in policy && policy.text).toBe(AI_GOVERNANCE_POLICY_JSON);
        expect('blob' in policy).toBe(false);
        const rules = await readResource('pdfnative://governance/rules');
        expect('text' in rules && rules.text).toBe(AGENT_RULES_TEXT);
        expect(rules.mimeType).toBe('text/markdown');
    });

    it('any other governance URI is UNKNOWN_RESOURCE', async () => {
        await expect(readResource('pdfnative://governance/other')).rejects.toMatchObject({ code: 'UNKNOWN_RESOURCE' });
    });
});
