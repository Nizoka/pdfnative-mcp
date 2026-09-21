// scripts/lib/mcp-surface.ts reads the server surface from text — scripts
// never import src/, and verify:docs runs before any build. Each parser is
// exercised with inline fixtures in both directions, then the real tree is
// compared with the live registry: a parser that silently stops matching
// (a reformatted TOOLS table) must fail here, not pass with a zero.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    changelogCompareLinks,
    changelogHeadings,
    checkChangelogLadder,
    computeDerived,
    contractCatalogueTools,
    contractErrorRows,
    envVarTokens,
    errorCodes,
    promptNames,
    registeredToolConstants,
    serverJsonEnvVars,
    snakeTokens,
    subclassErrorCodes,
    toolErrorCodes,
    toolNameConstant,
    toolNames,
} from '../../scripts/lib/mcp-surface.js';
import { listToolsPayload } from '../../src/server.js';
import { connectLegacy } from '../_mcp-harness.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('mcp-surface: pure parsers', () => {
    it('reads the <NAME>_NAME constant of a tool module', () => {
        expect(toolNameConstant("import x from 'y';\nexport const ADD_TABLE_NAME = 'add_table';\n")).toEqual(['ADD_TABLE_NAME', 'add_table']);
        expect(toolNameConstant("const ADD_TABLE_NAME = 'add_table';")).toBeNull();
        expect(toolNameConstant("export const SCHEMA_NAME = 'Not A Tool';")).toBeNull();
    });

    it('reads the registry constants in order, once each, from the TOOLS table only', () => {
        const server = [
            "const OTHER = [{\n    name: EARLIER_NAME,\n}];",
            'export const TOOLS: readonly ToolDefinition[] = [',
            '    {',
            '        name: GENERATE_BASIC_PDF_NAME,',
            "        description: 'x',",
            '    },',
            '    {',
            '        name: ADD_TABLE_NAME,',
            '    },',
            '];',
        ].join('\n');
        expect(registeredToolConstants(server)).toEqual(['GENERATE_BASIC_PDF_NAME', 'ADD_TABLE_NAME']);
        expect(registeredToolConstants('const NOTHING = 1;')).toEqual([]);
    });

    it('reads the prompt names up to the end of the PROMPTS table', () => {
        const server = "const PROMPTS: readonly PromptDefinition[] = [\n    {\n        name: 'print_ready',\n    },\n    {\n        name: 'typography',\n    },\n];\nconst AFTER = [\n    {\n        name: 'not_a_prompt',\n    },\n];";
        expect(promptNames(server)).toEqual(['print_ready', 'typography']);
        expect(promptNames('nothing')).toEqual([]);
    });

    it('collects ToolError codes across a line break, and the fixed codes of the subclasses', () => {
        expect(toolErrorCodes("throw new ToolError('VALIDATION_ERROR', m);\nthrow new ToolError(\n    'PDF_PARSE_FAILED',\n    m);")).toEqual(['VALIDATION_ERROR', 'PDF_PARSE_FAILED']);
        expect(toolErrorCodes('new ToolError(code, m)')).toEqual([]);
        expect(subclassErrorCodes("class SecurityError extends ToolError { constructor(m) { super('SECURITY_VIOLATION', m); } }")).toEqual(['SECURITY_VIOLATION']);
    });

    it('reads the first column of the §6 table only, several codes per cell included', () => {
        const contract = '## 5. Recipes\n\n`NOT_A_ROW`\n\n## 6. Error reference\n\n| Code | When | Do |\n|---|---|---|\n| `VALIDATION_ERROR` | bad `INPUT_THING` | fix |\n| `PASSWORD_REQUIRED` / `PASSWORD_INVALID` | x | y |\n\n## 7. Next\n\n| `LATER` | x | y |\n';
        expect(contractErrorRows(contract)).toEqual(['VALIDATION_ERROR', 'PASSWORD_REQUIRED', 'PASSWORD_INVALID']);
        expect(contractErrorRows('# no table')).toEqual([]);
    });

    it('reads the numbered rows of the §1 catalogue', () => {
        const contract = '## 1. Tool catalogue (2 tools)\n\n| # | Tool | Use |\n|---|---|---|\n| 1 | `generate_basic_pdf` | x `add_table` |\n| 2 | `add_table` | y |\n\n## 2. Decision tree\n\n| 3 | `not_in_catalogue` | z |\n';
        expect(contractCatalogueTools(contract)).toEqual(['generate_basic_pdf', 'add_table']);
    });

    it('tokenises tool-shaped names and operator variables', () => {
        expect(snakeTokens('Call `add_table`, then `inspect_pdf` — not `outputMode`, `pdfa2b` or add_chart.')).toEqual(['add_table', 'inspect_pdf']);
        expect(envVarTokens('Set PDFNATIVE_MCP_TSA_URL (and the old PDFNATIVE_MPC_OUTPUT_DIR); `PDFNATIVE_MCP_*` is the prefix. PDFNATIVE_MCP_TSA_URL again.')).toEqual(['PDFNATIVE_MCP_TSA_URL', 'PDFNATIVE_MPC_OUTPUT_DIR']);
    });

    it('lists the operator variables of server.json once each', () => {
        const text = JSON.stringify({ packages: [{ environmentVariables: [{ name: 'A' }, { name: 'B' }, { name: 'A' }, { description: 'nameless' }] }] });
        expect(serverJsonEnvVars(text)).toEqual(['A', 'B']);
        expect(serverJsonEnvVars('{}')).toEqual([]);
    });
});

describe('mcp-surface: changelog ladder', () => {
    const GOOD = [
        '# Changelog', '', '## [Unreleased]', '', '## [1.7.0] - 2026-09-21', '', '## [1.6.0] - 2026-08-23', '', '## [1.5.0] - 2026-07-30', '',
        '[Unreleased]: https://github.com/Nizoka/pdfnative-mcp/compare/v1.7.0...HEAD',
        '[1.7.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v1.6.0...v1.7.0',
        '[1.6.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v1.5.0...v1.6.0',
        '[1.5.0]: https://github.com/Nizoka/pdfnative-mcp/releases/tag/v1.5.0',
    ].join('\n');

    it('parses headings, compare links and the tag link of the first release', () => {
        expect(changelogHeadings(GOOD).map((h) => h.label)).toEqual(['Unreleased', '1.7.0', '1.6.0', '1.5.0']);
        const links = changelogCompareLinks(GOOD);
        expect(links.map((l) => l.label)).toEqual(['Unreleased', '1.7.0', '1.6.0', '1.5.0']);
        expect(links[0]).toMatchObject({ from: 'v1.7.0', to: 'HEAD' });
        expect(links[3]).toMatchObject({ from: null, to: 'v1.5.0' });
    });

    it('passes a complete ladder', () => {
        expect(checkChangelogLadder(GOOD)).toEqual([]);
    });

    it('fails on a missing rung, a rung comparing the wrong tags, a stale Unreleased and an orphan link', () => {
        expect(checkChangelogLadder(GOOD.replace(/^\[1\.6\.0\]:.*\n/m, '')).map((f) => f.message)).toEqual([expect.stringMatching(/\[1\.6\.0\] has no link definition/)]);
        expect(checkChangelogLadder(GOOD.replace('compare/v1.6.0...v1.7.0', 'compare/v1.5.0...v1.7.0')).map((f) => f.message)).toEqual([expect.stringMatching(/must compare v1\.6\.0\.\.\.v1\.7\.0/)]);
        expect(checkChangelogLadder(GOOD.replace('compare/v1.7.0...HEAD', 'compare/v1.6.0...HEAD')).map((f) => f.message)).toEqual([expect.stringMatching(/\[Unreleased\] must compare v1\.7\.0\.\.\.HEAD/)]);
        expect(checkChangelogLadder(`${GOOD}\n[1.4.0]: https://github.com/Nizoka/pdfnative-mcp/releases/tag/v1.4.0`).map((f) => f.message)).toEqual([expect.stringMatching(/\[1\.4\.0\] has no heading/)]);
    });
});

describe('mcp-surface: the real tree agrees with the live server', () => {
    it('resolves the same tools, in the same order, as tools/list', () => {
        const live = listToolsPayload().tools.map((t) => t.name);
        expect(toolNames(ROOT)).toEqual(live);
        expect(live.length).toBeGreaterThanOrEqual(28);
    });

    it('resolves the same prompts as prompts/list', async () => {
        const client = await connectLegacy();
        const live = (await client.request<{ prompts: Array<{ name: string }> }>('prompts/list')).prompts.map((p) => p.name);
        await client.close();
        expect(promptNames(readFileSync(resolve(ROOT, 'src', 'server.ts'), 'utf8'))).toEqual(live);
    });

    it('finds every error code, and every one has a §6 row in the agent contract', () => {
        const codes = errorCodes(ROOT);
        expect(codes).toContain('VALIDATION_ERROR');
        expect(codes).toContain('SECURITY_VIOLATION');
        expect(codes).toContain('PDF_X_COMPLIANCE_VIOLATION');
        const rows = contractErrorRows(readFileSync(resolve(ROOT, 'docs', 'AGENT_CONTRACT.md'), 'utf8'));
        expect(codes.filter((c) => !rows.includes(c))).toEqual([]);
    });

    it('derives non-zero figures for every counter', () => {
        const derived = computeDerived(ROOT);
        for (const [key, value] of Object.entries(derived)) expect(value, key).toBeGreaterThan(0);
        expect(derived.pdfaSamples + derived.pdfxSamples).toBeLessThanOrEqual(derived.corpusFiles);
    });
});
