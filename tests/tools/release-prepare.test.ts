import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    isSemver,
    isIsoDate,
    todayUtc,
    stripTag,
    minorLine,
    bumpJsonVersion,
    bumpLockVersion,
    engineVersion,
    bumpVersionTs,
    bumpServerJson,
    bumpManifest,
    restampVerifiedOn,
    bumpCitation,
    bumpSecurityTable,
    bumpReadmeEngineBadge,
    bumpKnowledgeBaseHeader,
    bumpCurrentRelease,
    scaffoldFromTemplate,
    parseArgs,
    main,
} from '../../scripts/release-prepare.js';

// v1.7.0 — the pure half of scripts/release-prepare.ts: every edit is a
// targeted regex on the one field it owns, and these fixtures pin exactly
// which text each one may and may not touch. The last block runs main()
// against a sandbox tree (no git: --previous is passed).

describe('release-prepare: helpers', () => {
    it('accepts plain semver triples only', () => {
        expect(isSemver('1.7.0')).toBe(true);
        expect(isSemver('v1.7.0')).toBe(false);
        expect(isSemver('1.7')).toBe(false);
        expect(isSemver('1.7.0-rc.1')).toBe(false);
    });

    it('validates ISO dates and formats today in UTC', () => {
        expect(isIsoDate('2026-09-21')).toBe(true);
        expect(isIsoDate('21/09/2026')).toBe(false);
        expect(isIsoDate('2026-13-45')).toBe(false);
        expect(todayUtc(new Date(Date.UTC(2026, 8, 21, 23, 59)))).toBe('2026-09-21');
    });

    it('strips the tag prefix and derives the minor line', () => {
        expect(stripTag('v1.6.0')).toBe('1.6.0');
        expect(stripTag('1.6.0')).toBe('1.6.0');
        expect(minorLine('1.7.3')).toBe('1.7');
        expect(minorLine('2.0.0')).toBe('2.0');
    });
});

describe('release-prepare: package manifests', () => {
    const PKG = '{\n  "name": "pdfnative-mcp",\n  "version": "1.6.0",\n  "dependencies": {\n    "pdfnative": "^1.8.0"\n  },\n  "devDependencies": {\n    "tsx": {\n      "version": "4.0.0"\n    }\n  }\n}\n';

    it('bumps the top-level version and nothing nested', () => {
        const r = bumpJsonVersion(PKG, '1.7.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain('  "version": "1.7.0",');
        expect(r.text).toContain('      "version": "4.0.0"');
        expect(r.text).not.toContain('1.6.0');
    });

    it('reports matched=1 with unchanged text when already at the version', () => {
        const r = bumpJsonVersion(PKG.replace('1.6.0', '1.7.0'), '1.7.0');
        expect(r.matched).toBe(1);
        expect(r.text).toBe(PKG.replace('1.6.0', '1.7.0'));
    });

    it('reports matched=0 when there is no top-level version', () => {
        expect(bumpJsonVersion('{\n  "name": "x"\n}\n', '1.7.0').matched).toBe(0);
    });

    it('bumps the lockfile root and packages[""] but no dependency — at the four-space indent this repository uses', () => {
        const LOCK =
            '{\n    "name": "pdfnative-mcp",\n    "version": "1.6.0",\n    "lockfileVersion": 3,\n    "packages": {\n        "": {\n            "name": "pdfnative-mcp",\n            "version": "1.6.0",\n            "bin": {\n                "x": "y"\n            }\n        },\n        "node_modules/a": {\n            "version": "1.6.0"\n        }\n    }\n}\n';
        const r = bumpLockVersion(LOCK, '1.7.0');
        expect(r.matched).toBe(2);
        expect(r.text.match(/"version": "1\.7\.0"/g)).toHaveLength(2);
        expect(r.text).toContain('"node_modules/a": {\n            "version": "1.6.0"');
    });

    it('reads the pdfnative dependency floor as the engine version', () => {
        expect(engineVersion(PKG)).toBe('1.8.0');
        expect(engineVersion(PKG.replace('^1.8.0', '~1.8.2'))).toBe('1.8.2');
        expect(engineVersion('{ "devDependencies": { "pdfnative": "^1.8.0" } }')).toBeNull();
    });
});

describe('release-prepare: the version lock-step', () => {
    it('bumps the version constant of src/version.ts and nothing else', () => {
        const ts = "/** Kept in lock-step with package.json 1.6.0. */\nexport const PDFNATIVE_MCP_VERSION = '1.6.0';\n";
        const r = bumpVersionTs(ts, '1.7.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain("export const PDFNATIVE_MCP_VERSION = '1.7.0';");
        expect(r.text).toContain('package.json 1.6.0');
        expect(bumpVersionTs('export const OTHER = 1;', '1.7.0').matched).toBe(0);
    });

    it('bumps both versions of server.json and leaves the schema date and the runtime hint alone', () => {
        const server =
            '{\n  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",\n  "name": "io.github.nizoka/pdfnative-mcp",\n  "version": "1.6.0",\n  "packages": [\n    {\n      "registryType": "npm",\n      "identifier": "pdfnative-mcp",\n      "version": "1.6.0",\n      "runtimeHint": "npx"\n    }\n  ]\n}\n';
        const r = bumpServerJson(server, '1.7.0');
        expect(r.matched).toBe(2);
        expect(r.text.match(/"version": "1\.7\.0"/g)).toHaveLength(2);
        expect(r.text).toContain('schemas/2025-12-11/server.schema.json');
        expect(bumpServerJson('{ "name": "x" }', '1.7.0').matched).toBe(0);
    });
});

describe('release-prepare: ecosystem manifest and stamps', () => {
    const MANIFEST =
        '{\n  "$comment": "x",\n  "verifiedOn": "2026-08-23",\n  "packages": {\n    "pdfnative-mcp": {\n      "version": "1.6.0",\n      "pin": null\n    },\n    "pdfnative": {\n      "version": "1.8.0"\n    }\n  }\n}\n';

    it('bumps only the pdfnative-mcp package version and the verifiedOn date', () => {
        const r = bumpManifest(MANIFEST, '1.7.0', '2026-09-21');
        expect(r.matched).toBe(2);
        expect(r.text).toContain('"verifiedOn": "2026-09-21"');
        expect(r.text).toContain('"pdfnative-mcp": {\n      "version": "1.7.0"');
        expect(r.text).toContain('"pdfnative": {\n      "version": "1.8.0"');
    });

    it('re-stamps the prose and JSON forms of the verified-on marker', () => {
        const prose = restampVerifiedOn('_Verified on 2026-08-23 against the source tree._', '2026-09-21');
        expect(prose.matched).toBe(1);
        expect(prose.text).toBe('_Verified on 2026-09-21 against the source tree._');
        const json = restampVerifiedOn('{\n  "verifiedOn": "2026-08-23",\n  "x": 1\n}', '2026-09-21');
        expect(json.text).toContain('"verifiedOn": "2026-09-21"');
        expect(restampVerifiedOn('no stamp here', '2026-09-21').matched).toBe(0);
    });
});

describe('release-prepare: CITATION.cff', () => {
    const CFF = 'cff-version: 1.2.0\ntitle: "pdfnative-mcp"\nlicense: MIT\nversion: 1.6.0\nkeywords:\n  - pdf\n';

    it('bumps version, never cff-version, and adds date-released when absent', () => {
        const r = bumpCitation(CFF, '1.7.0', '2026-09-21');
        expect(r.matched).toBe(2);
        expect(r.text).toContain('cff-version: 1.2.0\n');
        expect(r.text).toContain('license: MIT\nversion: 1.7.0\ndate-released: 2026-09-21\nkeywords:');
    });

    it('rewrites an existing date-released in place, keeping its quoting style', () => {
        const quoted = bumpCitation(CFF.replace('version: 1.6.0\n', 'version: 1.6.0\ndate-released: "2026-08-23"\n'), '1.7.0', '2026-09-21');
        expect(quoted.matched).toBe(2);
        expect(quoted.text).toContain('version: 1.7.0\ndate-released: "2026-09-21"\n');
        expect(quoted.text.match(/date-released/g)).toHaveLength(1);
        const bare = bumpCitation(CFF.replace('version: 1.6.0\n', 'version: 1.6.0\ndate-released: 2026-08-23\n'), '1.7.0', '2026-09-21');
        expect(bare.text).toContain('date-released: 2026-09-21\n');
    });

    it('reports matched=0 on a file without a version key', () => {
        expect(bumpCitation('cff-version: 1.2.0\ntitle: x\n', '1.7.0', '2026-09-21').matched).toBe(0);
    });
});

describe('release-prepare: SECURITY.md table', () => {
    const TABLE =
        '## Supported Versions\n\n| Version  | Supported          |\n| -------- | ------------------ |\n| `1.6.x`  | :white_check_mark: |\n| `< 1.6`  | :x:                |\n\n## Reporting\n';

    it('moves the supported line and the cut-off to the new minor', () => {
        const r = bumpSecurityTable(TABLE, '1.7.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain('| `1.7.x`  | :white_check_mark: |\n| `< 1.7`  | :x:                |');
        expect(r.text).not.toContain('1.6');
    });

    it('leaves the table alone on a patch release', () => {
        const r = bumpSecurityTable(TABLE, '1.6.4');
        expect(r.matched).toBe(1);
        expect(r.text).toBe(TABLE);
    });

    it('follows the same rule on a major bump', () => {
        expect(bumpSecurityTable(TABLE, '2.0.0').text).toContain('| `2.0.x`  | :white_check_mark: |\n| `< 2.0`  | :x:');
    });

    it('reports matched=0 when the table shape is unrecognised', () => {
        expect(bumpSecurityTable('| 1.6 | yes |\n', '1.7.0').matched).toBe(0);
    });
});

describe('release-prepare: README badge, knowledge-base header and llms.txt', () => {
    it('moves the engine badge to the minor line of the dependency floor', () => {
        const readme = '[![pdfnative](https://img.shields.io/badge/pdfnative-1.7-0a7e8c.svg)](https://github.com/Nizoka/pdfnative)\n[![MCP](https://img.shields.io/badge/MCP-2026--07--28-6f42c1.svg)](x)\n';
        const r = bumpReadmeEngineBadge(readme, '1.8.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain('badge/pdfnative-1.8-0a7e8c.svg');
        expect(r.text).toContain('badge/MCP-2026--07--28-6f42c1.svg');
        expect(bumpReadmeEngineBadge('# nothing', '1.8.0').matched).toBe(0);
    });

    it('bumps the knowledge-base header and leaves historical prose alone', () => {
        const kb = '# KB\n\n> pdfnative-mcp **v1.6.0** without reading every source file.\n\nIntroduced in pdfnative-mcp v1.5.0.\n';
        const r = bumpKnowledgeBaseHeader(kb, '1.7.0');
        expect(r.matched).toBe(1);
        expect(r.text).toContain('pdfnative-mcp **v1.7.0** without');
        expect(r.text).toContain('Introduced in pdfnative-mcp v1.5.0.');
    });

    it('bumps the Current release line, bold or plain', () => {
        expect(bumpCurrentRelease('Current release: 1.6.0 (on pdfnative 1.7.0)\n', '1.7.0').text).toBe('Current release: 1.7.0 (on pdfnative 1.7.0)\n');
        expect(bumpCurrentRelease('Current release: **1.6.0** (on pdfnative 1.7.0).', '1.7.0').text).toBe('Current release: **1.7.0** (on pdfnative 1.7.0).');
        expect(bumpCurrentRelease('Current version: v1.6.0', '1.7.0').text).toBe('Current version: v1.7.0');
        expect(bumpCurrentRelease('no line', '1.7.0').matched).toBe(0);
    });
});

describe('release-prepare: scaffolds', () => {
    const TEMPLATE = [
        '# Release Notes Template',
        '',
        '```markdown',
        '# pdfnative-mcp vX.Y.Z',
        '',
        '_Released YYYY-MM-DD_',
        '',
        '## Install',
        '',
        '\\`\\`\\`bash',
        'npm install -g pdfnative-mcp@X.Y.Z',
        '\\`\\`\\`',
        '',
        'Drop-in replacement for vX.Y.Z-1.',
        '- [Full diff](https://github.com/Nizoka/pdfnative-mcp/compare/vX.Y.Z-1...vX.Y.Z)',
        '```',
        '',
        '## Conventions',
    ].join('\n');

    it('extracts the fenced block, resolves the placeholders and unescapes the fences', () => {
        const note = scaffoldFromTemplate(TEMPLATE, '1.7.0', '2026-09-21', 'v1.6.0');
        expect(note).toBe(
            [
                '# pdfnative-mcp v1.7.0',
                '',
                '_Released 2026-09-21_',
                '',
                '## Install',
                '',
                '```bash',
                'npm install -g pdfnative-mcp@1.7.0',
                '```',
                '',
                'Drop-in replacement for v1.6.0.',
                '- [Full diff](https://github.com/Nizoka/pdfnative-mcp/compare/v1.6.0...v1.7.0)',
                '',
            ].join('\n'),
        );
    });

    it('refuses a template without a markdown block, naming it', () => {
        expect(() => scaffoldFromTemplate('# nothing here', '1.7.0', '2026-09-21', 'v1.6.0', 'release-notes/PR_TEMPLATE.md')).toThrow(/PR_TEMPLATE\.md has no/);
    });
});

describe('release-prepare: argument parsing', () => {
    it('requires --version and validates it', () => {
        expect(parseArgs([])).toMatch(/--version is required/);
        expect(parseArgs(['--version', '1.7'])).toMatch(/not a plain semver/);
        expect(parseArgs(['--version', 'v1.7.0'])).toMatch(/not a plain semver/);
    });

    it('defaults the date to today (UTC) and the previous tag to git', () => {
        const opts = parseArgs(['--version', '1.7.0']);
        expect(opts).toMatchObject({ version: '1.7.0', previous: null, dryRun: false });
        expect(typeof opts === 'string' ? '' : opts.date).toBe(todayUtc());
    });

    it('accepts explicit date, previous (with or without v) and --dry-run in either form', () => {
        expect(parseArgs(['--version=1.7.0', '--date=2026-09-21', '--previous=1.6.0', '--dry-run'])).toEqual({
            version: '1.7.0',
            date: '2026-09-21',
            previous: 'v1.6.0',
            dryRun: true,
        });
        expect(parseArgs(['--version', '1.7.0', '--previous', 'v1.6.0'])).toMatchObject({ previous: 'v1.6.0' });
    });

    it('rejects bad dates, bad tags and unknown flags', () => {
        expect(parseArgs(['--version', '1.7.0', '--date', '21/09/2026'])).toMatch(/not an ISO date/);
        expect(parseArgs(['--version', '1.7.0', '--previous', 'latest'])).toMatch(/not a tag/);
        expect(parseArgs(['--version', '1.7.0', '--force'])).toMatch(/unknown argument "--force"/);
    });
});

describe('release-prepare: main() over a sandbox tree', () => {
    let sandbox = '';
    beforeEach(() => {
        // main() reports every edit on stdout; the assertions read the files.
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        if (sandbox) rmSync(sandbox, { recursive: true, force: true });
        sandbox = '';
    });

    const TEMPLATE = '# T\n\n```markdown\n# pdfnative-mcp vX.Y.Z\n\n_Released YYYY-MM-DD_ — after vX.Y.Z-1\n```\n';

    function seed(): string {
        const root = mkdtempSync(join(tmpdir(), 'pdfnative-mcp-release-'));
        const put = (rel: string, text: string): void => {
            mkdirSync(join(root, rel, '..'), { recursive: true });
            writeFileSync(join(root, rel), text);
        };
        put('package.json', '{\n  "name": "pdfnative-mcp",\n  "version": "1.6.0",\n  "dependencies": {\n    "pdfnative": "^1.8.0"\n  }\n}\n');
        put('package-lock.json', '{\n    "name": "pdfnative-mcp",\n    "version": "1.6.0",\n    "packages": {\n        "": {\n            "version": "1.6.0"\n        }\n    }\n}\n');
        put('src/version.ts', "export const PDFNATIVE_MCP_VERSION = '1.6.0';\n");
        put('server.json', '{\n  "version": "1.6.0",\n  "packages": [\n    {\n      "version": "1.6.0"\n    }\n  ]\n}\n');
        put('docs/assets/ecosystem.json', '{\n  "verifiedOn": "2026-08-23",\n  "packages": {\n    "pdfnative-mcp": {\n      "version": "1.6.0"\n    }\n  }\n}\n');
        put('llms.txt', '# pdfnative-mcp\n\nCurrent release: 1.6.0. Verified on 2026-08-23.\n');
        put('docs/KNOWLEDGE_BASE.md', '# KB\n\n> pdfnative-mcp **v1.6.0** reference. Verified on 2026-08-23.\n');
        put('docs/AGENT_CONTRACT.md', '# Contract\n\nVerified on 2026-08-23.\n');
        put('CITATION.cff', 'cff-version: 1.2.0\nversion: 1.6.0\ndate-released: "2026-08-23"\n');
        put('SECURITY.md', '| `1.6.x`  | :white_check_mark: |\n| `< 1.6`  | :x:                |\n');
        put('README.md', '[![pdfnative](https://img.shields.io/badge/pdfnative-1.7-0a7e8c.svg)](x)\n');
        put('release-notes/TEMPLATE.md', TEMPLATE);
        put('release-notes/PR_TEMPLATE.md', TEMPLATE.replace('# pdfnative-mcp vX.Y.Z', '# release: vX.Y.Z'));
        mkdirSync(join(root, '.github', 'drafts'), { recursive: true });
        return root;
    }

    it('applies every edit and scaffolds the note and the PR draft', () => {
        sandbox = seed();
        expect(main(['--version', '1.7.0', '--date', '2026-09-21', '--previous', 'v1.6.0'], sandbox)).toBe(0);
        const read = (rel: string): string => readFileSync(join(sandbox, rel), 'utf8');
        expect(read('package.json')).toContain('"version": "1.7.0"');
        expect(read('package-lock.json').match(/"version": "1\.7\.0"/g)).toHaveLength(2);
        expect(read('src/version.ts')).toContain("'1.7.0'");
        expect(read('server.json').match(/"version": "1\.7\.0"/g)).toHaveLength(2);
        expect(read('docs/assets/ecosystem.json')).toContain('"verifiedOn": "2026-09-21"');
        for (const stamped of ['llms.txt', 'docs/KNOWLEDGE_BASE.md', 'docs/AGENT_CONTRACT.md']) expect(read(stamped)).toContain('Verified on 2026-09-21');
        expect(read('llms.txt')).toContain('Current release: 1.7.0');
        expect(read('docs/KNOWLEDGE_BASE.md')).toContain('**v1.7.0**');
        expect(read('CITATION.cff')).toContain('version: 1.7.0\ndate-released: "2026-09-21"');
        expect(read('SECURITY.md')).toContain('`1.7.x`');
        expect(read('README.md')).toContain('badge/pdfnative-1.8-');
        expect(read('release-notes/v1.7.0.md')).toBe('# pdfnative-mcp v1.7.0\n\n_Released 2026-09-21_ — after v1.6.0\n');
        expect(read('.github/drafts/pr-v1.7.0.md')).toContain('# release: v1.7.0');
    });

    it('writes nothing under --dry-run, and is idempotent on a second real run', () => {
        sandbox = seed();
        const before = readFileSync(join(sandbox, 'package.json'), 'utf8');
        expect(main(['--version', '1.7.0', '--date', '2026-09-21', '--previous', 'v1.6.0', '--dry-run'], sandbox)).toBe(0);
        expect(readFileSync(join(sandbox, 'package.json'), 'utf8')).toBe(before);
        expect(main(['--version', '1.7.0', '--date', '2026-09-21', '--previous', 'v1.6.0'], sandbox)).toBe(0);
        const after = readFileSync(join(sandbox, 'server.json'), 'utf8');
        expect(main(['--version', '1.7.0', '--date', '2026-09-21', '--previous', 'v1.6.0'], sandbox)).toBe(0);
        expect(readFileSync(join(sandbox, 'server.json'), 'utf8')).toBe(after);
    });

    it('returns 1 when a file it owns is missing, and 2 on bad usage', () => {
        sandbox = seed();
        rmSync(join(sandbox, 'CITATION.cff'));
        expect(main(['--version', '1.7.0', '--previous', 'v1.6.0'], sandbox)).toBe(1);
        expect(main(['--version', 'nope'], sandbox)).toBe(2);
    });
});
