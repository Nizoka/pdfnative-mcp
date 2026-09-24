import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
    MANIFEST_REL,
    OFFLINE_RULES,
    isSuppressed,
    lineOf,
    semverLess,
    verifyDocs,
    workflowJobs,
    type Problem,
} from '../../scripts/verify-docs.js';

// v1.7.0 — the documentation verifier. The helpers are unit-tested; the
// verifier itself runs twice: once against the real tree (the same run the
// gate's `verify:docs` step performs — zero errors is the release
// condition) and once against a sandbox copy that was corrupted on purpose,
// to prove the rules fire.

const ROOT = resolve(import.meta.dirname, '..', '..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', 'test-output', '.audit']);

describe('verify-docs — helpers', () => {
    it('computes 1-based line numbers from offsets', () => {
        expect(lineOf('a\nb\nc', 0)).toBe(1);
        expect(lineOf('a\nb\nc', 2)).toBe(2);
        expect(lineOf('a\nb\nc', 4)).toBe(3);
    });

    it('honours an allow marker on the line or the line above, for that rule only', () => {
        const lines = ['<!-- verify-docs:allow stale-token -->', '11 tools', 'x', 'y <!-- verify-docs:allow count-tokens -->'];
        expect(isSuppressed(lines, 2, 'stale-token')).toBe(true);
        expect(isSuppressed(lines, 2, 'count-tokens')).toBe(false);
        expect(isSuppressed(lines, 4, 'count-tokens')).toBe(true);
        expect(isSuppressed(lines, 3, 'stale-token')).toBe(false);
    });

    it('orders plain semver triples', () => {
        expect(semverLess('1.6.0', '1.7.0')).toBe(true);
        expect(semverLess('1.7.0', '1.6.9')).toBe(false);
        expect(semverLess('1.7.0', '1.7.0')).toBe(false);
        expect(semverLess('1.10.0', '1.9.0')).toBe(false);
    });

    it('reads job ids, display names and matrix values from workflows', () => {
        const ci = 'name: CI\non: push\njobs:\n  ci:\n    name: ci\n    strategy:\n      matrix:\n        node-version: [22, 24]\n    steps: []\n  windows:\n    runs-on: windows-latest\n';
        const { jobs, matrixValues } = workflowJobs([ci, 'jobs:\n  sample-regression:\n    steps: []\n']);
        expect([...jobs].sort()).toEqual(['ci', 'sample-regression', 'windows']);
        expect([...matrixValues.get('ci')!]).toEqual(['22', '24']);
    });
});

describe('verify-docs — the real tree', () => {
    it('declares the rule list the report prints', () => {
        for (const rule of ['tool-parity', 'error-parity', 'env-var-parity', 'changelog-ladder', 'agent-config-parity', 'prose-language']) {
            expect(OFFLINE_RULES).toContain(rule);
        }
        expect(new Set(OFFLINE_RULES).size).toBe(OFFLINE_RULES.length);
        expect(MANIFEST_REL).toBe('docs/assets/ecosystem.json');
    });

    it('passes every offline rule (the gate condition)', async () => {
        const { problems, files } = await verifyDocs(ROOT);
        const errors = problems.filter((p) => p.severity === 'error').map((p) => `${p.file}:${p.line} [${p.rule}] ${p.message}`);
        expect(files).toBeGreaterThan(10);
        expect(errors).toEqual([]);
    }, 60_000);
});

describe('verify-docs — a corrupted sandbox', () => {
    let sandbox = '';
    let problems: Problem[] = [];

    beforeAll(async () => {
        sandbox = mkdtempSync(join(tmpdir(), 'pdfnative-mcp-verify-docs-'));
        cpSync(ROOT, sandbox, {
            recursive: true,
            filter: (src) => !SKIP.has(basename(src)),
        });
        const edit = (rel: string, fn: (text: string) => string): void => {
            const p = join(sandbox, rel);
            writeFileSync(p, fn(readFileSync(p, 'utf8')));
        };
        edit(MANIFEST_REL, (text) => {
            const manifest = JSON.parse(text) as {
                derived: Record<string, unknown>;
                declared: Record<string, unknown>;
                packages: Record<string, { version: string }>;
            };
            manifest.derived['prompts'] = 99;
            manifest.derived['typoKey'] = 1;
            manifest.declared['pdfaSamples'] = 1;
            (manifest.derived['toolGroups'] as Record<string, string[]>)['Generate'].push('render_pdf');
            manifest.packages['pdfnative-mcp'].version = '9.9.9';
            return JSON.stringify(manifest, null, 2);
        });
        edit('README.md', (text) => `${text}\n\nStale: pdfnative-mcp v0.0.1 has 11 tools; call \`convert_pdf\` and set PDFNATIVE_MCP_NOPE. A 3-sample baseline over 4 corpus files.\n\nBroken anchors: [same](#no-such-heading), [cross](docs/KNOWLEDGE_BASE.md#nope-either), [fine](#-installation).\n\n[allowed](#also-missing) <!-- verify-docs:allow anchor-parity -->\n\nPlanned: \`redact_everything\` <!-- verify-docs:allow tool-parity -->\n\n[gone](docs/NOT_THERE.md)\n`);
        // A documented code the source never emits, and a code the source emits with its row removed.
        edit('docs/AGENT_CONTRACT.md', (text) => text
            .replace(/^\| `GOVERNANCE_VIOLATION` \|.*\n/m, '')
            .replace(/^(\| `VALIDATION_ERROR` \|.*\n)/m, '$1| `INVENTED_CODE` | never | nothing |\n'));
        // A rung of the compare-link ladder goes missing.
        edit('CHANGELOG.md', (text) => text.replace(/^\[1\.6\.0\]:.*\r?\n/m, ''));
        // The source reads a variable server.json does not declare.
        edit('src/version.ts', (text) => `${text}\nexport const SECRET_KNOB = process.env['PDFNATIVE_MCP_UNDECLARED'];\n`);
        // A third runtime dependency.
        edit('package.json', (text) => text.replace('"zod":', '"left-pad": "^1.3.0",\n    "zod":'));
        // A governance source that does not exist.
        edit('.github/ai-governance.json', (text) => text.replace('"ROADMAP.md"', '"ROADMAP_GONE.md"'));
        // The guard loses its PowerShell matcher.
        edit('.claude/settings.json', (text) => text.replace('"matcher": "PowerShell"', '"matcher": "Pwsh"'));
        // A rule edited by hand.
        edit('.claude/rules/testing.md', (text) => `${text}\n- Edited by hand.\n`);
        problems = (await verifyDocs(sandbox)).problems;
    }, 120_000);

    afterAll(() => {
        if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    });

    const messages = (rule: string): string[] => problems.filter((p) => p.rule === rule && p.severity === 'error').map((p) => `${p.file}:${p.line} ${p.message}`);

    it('fails derived-counts and manifest-shape on the corrupted manifest and the third dependency', () => {
        expect(messages('derived-counts')).toEqual(expect.arrayContaining([expect.stringContaining('derived.prompts says 99'), expect.stringContaining('declared.pdfaSamples says 1')]));
        expect(messages('manifest-shape')).toEqual(expect.arrayContaining([
            expect.stringContaining('derived.typoKey'),
            expect.stringContaining('package.json says'),
            expect.stringContaining('left-pad'),
            expect.stringMatching(/src\/version\.ts:1 says \d+\.\d+\.\d+ but the manifest says 9\.9\.9/),
            expect.stringMatching(/server\.json:1 carries version/),
        ]));
    });

    it('fails stale-token, version-token and count-tokens on the appended README line', () => {
        expect(messages('stale-token')).toEqual(expect.arrayContaining([expect.stringMatching(/README\.md:\d+ "11 tools"/)]));
        expect(messages('version-token')).toEqual(expect.arrayContaining([expect.stringContaining('pdfnative-mcp v0.0.1')]));
        expect(messages('count-tokens')).toEqual(expect.arrayContaining([
            expect.stringContaining('"3-sample baseline"'),
            expect.stringContaining('"4 corpus files"'),
        ]));
    });

    it('fails tool-parity on an invented tool in the docs and in the manifest groups, and honours the allow marker', () => {
        const found = messages('tool-parity');
        expect(found).toEqual(expect.arrayContaining([
            expect.stringMatching(/README\.md:\d+ `convert_pdf` reads like a tool name/),
            expect.stringContaining('derived.toolGroups differs from the TOOLS registry — unknown: render_pdf'),
        ]));
        expect(found.some((m) => m.includes('redact_everything'))).toBe(false);
    });

    it('fails error-parity in both directions', () => {
        expect(messages('error-parity')).toEqual(expect.arrayContaining([
            expect.stringContaining('§6 has no row for GOVERNANCE_VIOLATION'),
            expect.stringMatching(/AGENT_CONTRACT\.md:\d+ §6 documents `INVENTED_CODE`/),
        ]));
        expect(messages('error-parity').some((m) => m.includes('EXTRACTION_UNSUPPORTED'))).toBe(false);
    });

    it('fails env-var-parity on an undeclared variable in the docs and in the source', () => {
        expect(messages('env-var-parity')).toEqual(expect.arrayContaining([
            expect.stringMatching(/README\.md:\d+ PDFNATIVE_MCP_NOPE is not an operator variable/),
            expect.stringMatching(/src\/version\.ts:\d+ PDFNATIVE_MCP_UNDECLARED is read by the source/),
        ]));
    });

    it('fails changelog-ladder on the missing rung', () => {
        expect(messages('changelog-ladder')).toEqual(expect.arrayContaining([expect.stringContaining('heading [1.6.0] has no link definition')]));
    });

    it('fails internal-links and anchor-parity, and honours the allow marker', () => {
        expect(messages('internal-links')).toEqual(expect.arrayContaining([expect.stringMatching(/README\.md:\d+ "docs\/NOT_THERE\.md" does not resolve/)]));
        const found = messages('anchor-parity');
        expect(found).toEqual(expect.arrayContaining([
            expect.stringMatching(/README\.md:\d+ "#no-such-heading" is not a heading anchor of README\.md/),
            expect.stringMatching(/README\.md:\d+ "#nope-either" is not a heading anchor of docs\/KNOWLEDGE_BASE\.md/),
        ]));
        expect(found.some((m) => m.includes('#-installation'))).toBe(false);
        expect(found.some((m) => m.includes('#also-missing'))).toBe(false);
    });

    it('fails governance-sources, agent-config-parity and claude-rules-sync on the agent layer', () => {
        expect(messages('governance-sources')).toEqual(expect.arrayContaining([expect.stringContaining('"ROADMAP_GONE.md", which does not exist')]));
        expect(messages('agent-config-parity')).toEqual(expect.arrayContaining([expect.stringContaining('no PowerShell matcher')]));
        expect(messages('claude-rules-sync')).toEqual(expect.arrayContaining([expect.stringMatching(/\.claude\/rules\/testing\.md:1 differs from its instruction file/)]));
    });

    it('never runs eol-lf outside a git checkout', () => {
        expect(problems.filter((p) => p.rule === 'eol-lf')).toEqual([]);
    });
});
