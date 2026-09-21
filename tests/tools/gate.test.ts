// Contract of scripts/gate.ts: the STEPS table is the one place the quality
// gate is defined, so these tests hold it to the shape CI, CONTRIBUTING and
// the agent files rely on. No step is executed here; the two pure judges
// (`probeDist`, `judgeSmoke`) are fed hostile input directly.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DIST_FILES, STEPS, judgeSmoke, parseArgs, probeDist, selectSteps } from '../../scripts/gate.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string>; bin?: Record<string, string>; main?: string };

describe('gate: step table', () => {
    it('has unique ids', () => {
        const ids = STEPS.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every npm-script step names a script that exists in package.json', () => {
        for (const s of STEPS) {
            if (s.npmScript !== undefined) expect(pkg.scripts, s.id).toHaveProperty(s.npmScript);
        }
    });

    it('every step is either an npm script or an inline check, never both', () => {
        for (const s of STEPS) {
            expect(Boolean(s.npmScript) !== Boolean(s.inline), s.id).toBe(true);
        }
    });

    it('the fast profile is exactly typecheck:all, lint, test, server-json and verify:docs', () => {
        const fast = STEPS.filter((s) => s.profiles.includes('fast')).map((s) => s.id);
        expect(fast).toEqual(['typecheck:all', 'lint', 'test', 'server-json', 'verify:docs']);
    });

    it('the ci profile runs everything except validate:pdfa; publish runs everything', () => {
        const ci = STEPS.filter((s) => s.profiles.includes('ci')).map((s) => s.id);
        const publish = STEPS.filter((s) => s.profiles.includes('publish')).map((s) => s.id);
        expect(ci).not.toContain('validate:pdfa');
        expect(ci).not.toContain('test'); // coverage variant instead
        expect(publish).toEqual(STEPS.filter((s) => s.id !== 'test').map((s) => s.id));
    });

    it('the only skippable step is validate:pdfa (veraPDF is external); validate:pdfx never skips', () => {
        const skippable = STEPS.filter((s) => s.skipWhen !== undefined).map((s) => s.id);
        expect(skippable).toEqual(['validate:pdfa']);
    });

    it('builds before every step that drives dist/ — the coverage run included', () => {
        const order = STEPS.map((s) => s.id);
        const build = order.indexOf('build');
        for (const id of ['dist-check', 'dist-probe', 'smoke', 'verify:tool-shape', 'test:generate', 'test:coverage', 'corpus:pdfa', 'validate:pdfx', 'validate:pdfa']) {
            expect(order.indexOf(id), id).toBeGreaterThan(build);
        }
        expect(order.indexOf('corpus:pdfa')).toBeLessThan(order.indexOf('validate:pdfx'));
        expect(order.indexOf('corpus:pdfa')).toBeLessThan(order.indexOf('validate:pdfa'));
        expect(order.indexOf('test:generate')).toBeLessThan(order.indexOf('verify:samples'));
        expect(order.indexOf('smoke')).toBe(order.indexOf('dist-probe') + 1);
    });

    it('generates the samples before the coverage run, so the regression suite runs on CI', () => {
        const order = STEPS.map((s) => s.id);
        expect(order.indexOf('test:generate')).toBeLessThan(order.indexOf('test:coverage'));
    });

    it('the fast profile runs the tests without a build; the coverage run requires the artifacts', () => {
        expect(STEPS.find((s) => s.id === 'test')?.env).toEqual({ GATE: '1' });
        expect(STEPS.find((s) => s.id === 'test:coverage')?.env).toEqual({ GATE: '1', GATE_REQUIRE_ARTIFACTS: '1' });
    });

    it('the stdio smoke, the dist probe and the registry-schema check are inline steps', () => {
        for (const id of ['dist-check', 'dist-probe', 'smoke', 'server-json']) {
            expect(STEPS.find((s) => s.id === id)?.inline, id).toBeTypeOf('function');
        }
        expect(STEPS.find((s) => s.id === 'smoke')?.profiles).toEqual(['ci', 'publish']);
    });

    it('dist-check covers every entry point package.json publishes', () => {
        const published = [...Object.values(pkg.bin ?? {}), pkg.main ?? ''].filter((p) => p !== '').map((p) => p.replace(/^\.\//, ''));
        expect(published.length).toBeGreaterThan(0);
        for (const p of published) expect(DIST_FILES as readonly string[], p).toContain(p);
    });
});

describe('gate: dist probe', () => {
    it('passes an emitted tree that holds only src/ and logs to stderr', () => {
        expect(probeDist([
            { path: 'dist/cli.js', text: "process.stderr.write('ready\\n');" },
            { path: 'dist/tools/add-table.js', text: 'console.error("x");' },
            { path: 'dist/index.d.ts', text: '' },
        ])).toEqual([]);
    });

    it('fails on console.log in emitted JavaScript — stdout is the JSON-RPC channel', () => {
        const failures = probeDist([{ path: 'dist\\server.js', text: 'console.log ("debug")' }]);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatch(/dist\/server\.js: console\.log\(\) would corrupt the stdio JSON-RPC channel/);
    });

    it('ignores console.log in a declaration file, and fails on tests/ or scripts/ under dist/', () => {
        expect(probeDist([{ path: 'dist/index.d.ts', text: '/** console.log(x) */' }])).toEqual([]);
        expect(probeDist([{ path: 'dist/tests/a.test.js', text: '' }, { path: 'dist/scripts/gate.js', text: '' }])).toHaveLength(2);
    });
});

describe('gate: stdio smoke judge', () => {
    const frame = (o: object): string => JSON.stringify({ jsonrpc: '2.0', ...o });
    const INIT = frame({ id: 1, result: { serverInfo: { name: 'pdfnative-mcp', version: '1.7.0' } } });
    const LIST = frame({ id: 2, result: { tools: [{}, {}, {}] } });
    const EXPECT = { version: '1.7.0', tools: 3 };

    it('passes a clean session', () => {
        expect(judgeSmoke({ status: 0, stdout: `${INIT}\n${LIST}\n`, stderr: 'pdfnative-mcp ready\n' }, EXPECT)).toEqual([]);
    });

    it('fails on any stdout line that is not a JSON-RPC 2.0 frame', () => {
        const banner = judgeSmoke({ status: 0, stdout: `pdfnative-mcp ready\n${INIT}\n${LIST}\n`, stderr: '' }, EXPECT);
        expect(banner).toEqual([expect.stringMatching(/stdout purity.*pdfnative-mcp ready/)]);
        const bareJson = judgeSmoke({ status: 0, stdout: `{"level":"info"}\n${INIT}\n${LIST}\n`, stderr: '' }, EXPECT);
        expect(bareJson).toEqual([expect.stringMatching(/stdout purity/)]);
    });

    it('fails on a version or tool-count mismatch, an unanswered request and a non-zero exit', () => {
        expect(judgeSmoke({ status: 0, stdout: `${INIT}\n${LIST}\n`, stderr: '' }, { version: '1.7.1', tools: 3 })).toEqual([expect.stringMatching(/serverInfo\.version is "1\.7\.0"/)]);
        expect(judgeSmoke({ status: 0, stdout: `${INIT}\n${LIST}\n`, stderr: '' }, { version: '1.7.0', tools: 28 })).toEqual([expect.stringMatching(/returned 3 tools, source registers 28/)]);
        expect(judgeSmoke({ status: 0, stdout: `${INIT}\n`, stderr: '' }, EXPECT)).toEqual([expect.stringMatching(/tools\/list was not answered/)]);
        const errored = judgeSmoke({ status: 0, stdout: `${frame({ id: 1, error: { message: 'boom' } })}\n${LIST}\n`, stderr: '' }, EXPECT);
        expect(errored).toEqual([expect.stringMatching(/initialize was not answered: boom/)]);
        expect(judgeSmoke({ status: 1, stdout: `${INIT}\n${LIST}\n`, stderr: 'Error: x' }, EXPECT)).toEqual([expect.stringMatching(/server exited 1/)]);
    });
});

describe('gate: argument parsing and step selection', () => {
    it('defaults to the ci profile', () => {
        const opts = parseArgs([]);
        expect('error' in opts).toBe(false);
        if (!('error' in opts)) expect(opts.profile).toBe('ci');
    });

    it('rejects two profiles, unknown steps and unknown flags', () => {
        expect(parseArgs(['--fast', '--ci'])).toHaveProperty('error');
        expect(parseArgs(['--only', 'nope'])).toHaveProperty('error');
        expect(parseArgs(['--only'])).toHaveProperty('error');
        expect(parseArgs(['--bogus'])).toHaveProperty('error');
    });

    it('--only selects one step regardless of profile', () => {
        const opts = parseArgs(['--fast', '--only', 'validate:pdfa']);
        if ('error' in opts) throw new Error(opts.error);
        expect(selectSteps(opts).map((s) => s.id)).toEqual(['validate:pdfa']);
    });

    it('--from resumes the profile at the given step', () => {
        const opts = parseArgs(['--ci', '--from', 'build']);
        if ('error' in opts) throw new Error(opts.error);
        const ids = selectSteps(opts).map((s) => s.id);
        expect(ids[0]).toBe('build');
        expect(ids).not.toContain('lint');
    });

    it('--from a step outside the profile resumes at its table position', () => {
        const opts = parseArgs(['--fast', '--from', 'build']);
        if ('error' in opts) throw new Error(opts.error);
        expect(selectSteps(opts).map((s) => s.id)).toEqual(['server-json', 'verify:docs']);
        const fromTest = parseArgs(['--fast', '--from', 'test']);
        if ('error' in fromTest) throw new Error(fromTest.error);
        expect(selectSteps(fromTest).map((s) => s.id)).toEqual(['test', 'server-json', 'verify:docs']);
    });

    it('--require-all and --json are recognised', () => {
        const opts = parseArgs(['--publish', '--require-all', '--json']);
        if ('error' in opts) throw new Error(opts.error);
        expect(opts.requireAll).toBe(true);
        expect(opts.json).toBe(true);
        expect(opts.profile).toBe('publish');
    });
});

describe('gate: wiring', () => {
    it('CI and publish run the gate with --require-all', () => {
        const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
        expect(ci).toMatch(/scripts\/gate\.ts --ci --require-all/);
        const publish = readFileSync(resolve(ROOT, '.github/workflows/publish.yml'), 'utf8');
        expect(publish).toMatch(/scripts\/gate\.ts --publish --require-all/);
    });

    it('the pre-push hook runs the fast profile', () => {
        const hook = readFileSync(resolve(ROOT, '.githooks/pre-push'), 'utf8');
        expect(hook).toMatch(/npm run gate:fast/);
    });

    it('package.json routes gate and gate:fast to the script, and publishing through the build only', () => {
        expect(pkg.scripts['gate']).toMatch(/scripts\/gate\.ts/);
        expect(pkg.scripts['gate:fast']).toMatch(/scripts\/gate\.ts --fast/);
        expect(pkg.scripts['prepublishOnly']).toBe('npm run build');
        expect(pkg.scripts).not.toHaveProperty('prepare');
    });
});
