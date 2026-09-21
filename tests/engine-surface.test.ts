/**
 * The engine-surface traceability matrix (tests/_fixtures/engine-surface.json).
 *
 * pdfnative-mcp wraps an engine: a release of the engine that the server's
 * tests and samples do not exercise is a release the server has not really
 * adopted. This suite holds the matrix to the tree, so coverage cannot rot
 * silently:
 *
 *   - every reference is real (the test file holds that test name, the sample
 *     is an entry of the byte baseline, the transmission suite exists);
 *   - a diagnostic code the engine can raise is a code a test TRIGGERS and the
 *     agent contract documents;
 *   - every typography key and every script code is set by an executed example;
 *   - moving the pdfnative pin fails the suite until the matrix follows.
 *
 * Ported from pdfnative-cli 1.5.0 (tests/regression/engine-surface.test.ts);
 * the item ids are shared, so the two wrappers can be compared line by line.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DIAGNOSTIC_CODES } from '../src/diagnostics.js';
import { LANG_ALIASES, SCRIPT_CODES } from '../src/tools/add-international-text.js';
import { TYPOGRAPHY_KEYS } from '../src/typography.js';
import { DIAGNOSTIC_TRIGGERS } from './_diagnostic-triggers.js';
import { ALIAS_SAMPLES, SCRIPT_SAMPLES } from './_script-text.js';

const ROOT = resolve(import.meta.dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

interface TestRef { readonly file: string; readonly name: string }
interface Waiver { readonly kind: string; readonly reason: string; readonly transmission?: string }
interface Item {
    readonly id: string;
    readonly kind: string;
    readonly changelog: string;
    readonly tests?: readonly TestRef[];
    readonly samples?: readonly string[];
    readonly waiver?: Waiver;
    readonly note?: string;
}
interface UpstreamLimit { readonly id: string; readonly summary: string; readonly pinnedBy: TestRef; readonly roadmap: string }
interface Matrix { readonly engine: string; readonly items: readonly Item[]; readonly upstreamLimits: readonly UpstreamLimit[] }

const matrix = JSON.parse(read('tests/_fixtures/engine-surface.json')) as Matrix;
const baseline = JSON.parse(read('tests/_fixtures/samples.sha256.json')) as { entries: Record<string, unknown> };
const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
const installed = JSON.parse(read('node_modules/pdfnative/package.json')) as { version: string };

const WAIVER_KINDS = ['LIB', 'TOOLING', 'DOCS', 'tested-upstream', 'upstream-limit'];
const ITEM_KINDS = ['feature', 'change', 'fix', 'docs'];

describe('engine-surface matrix: shape', () => {
    it('describes the pdfnative release the server is pinned to — moving the pin fails until the matrix follows', () => {
        expect(pkg.dependencies['pdfnative']).toBe(`^${matrix.engine}`);
        // Same minor: a patch release of the engine adds no surface to adopt.
        expect(installed.version.split('.').slice(0, 2)).toEqual(matrix.engine.split('.').slice(0, 2));
    });

    it('has unique ids, known kinds, and exactly one of tests / waiver per item', () => {
        const ids = matrix.items.map((i) => i.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const item of matrix.items) {
            expect(ITEM_KINDS, item.id).toContain(item.kind);
            expect(item.changelog.length, item.id).toBeGreaterThan(8);
            const tested = (item.tests?.length ?? 0) > 0;
            expect(tested !== (item.waiver !== undefined), `${item.id}: tests XOR waiver`).toBe(true);
            if (item.waiver !== undefined) {
                expect(WAIVER_KINDS, item.id).toContain(item.waiver.kind);
                expect(item.waiver.reason.length, `${item.id}: a waiver states its reason`).toBeGreaterThan(20);
                expect(item.samples, `${item.id}: a waived item lists no sample`).toBeUndefined();
            }
        }
    });

    it('a user-facing feature or fix is never waived as documentation', () => {
        for (const item of matrix.items) {
            if (item.waiver?.kind === 'DOCS') expect(item.kind, item.id).toBe('docs');
        }
    });

    it('every engine feature a JSON tool call can reach is tested, not waived', () => {
        // The headline features of the release, by id: none may drift into a waiver.
        const mustBeTested = ['typography', 'five-new-scripts', 'cmyk-colours', 'cmyk-gray-output-intents', 'pdfx4', 'validate-pdfx', 'colour-bars', 'utc-dates', 'actualtext', 'latin-marks', 'skin-tones', 'deterministic-samples', 'fix-acroform-pdfa', 'fix-inspect-layout-toc'];
        for (const id of mustBeTested) {
            const item = matrix.items.find((i) => i.id === id);
            expect(item, id).toBeDefined();
            expect(item!.waiver, `${id} must be exercised through the server`).toBeUndefined();
        }
    });
});

describe('engine-surface matrix: every reference is real', () => {
    const sources = new Map<string, string>();
    const source = (file: string): string => {
        let text = sources.get(file);
        if (text === undefined) {
            expect(existsSync(join(ROOT, file)), `${file} exists`).toBe(true);
            text = read(file);
            sources.set(file, text);
        }
        return text;
    };

    it('each named test exists in the file that is said to hold it', () => {
        for (const item of matrix.items) {
            for (const ref of item.tests ?? []) {
                expect(ref.file, item.id).toMatch(/^tests\/.+\.test\.ts$/);
                expect(source(ref.file).includes(ref.name), `${item.id}: "${ref.name}" in ${ref.file}`).toBe(true);
            }
        }
    });

    it('each sample is an entry of the byte baseline', () => {
        for (const item of matrix.items) {
            for (const sample of item.samples ?? []) {
                expect(Object.hasOwn(baseline.entries, sample), `${item.id}: ${sample}`).toBe(true);
            }
        }
    });

    it('a tested-upstream waiver names the suite that proves the transmission', () => {
        for (const item of matrix.items) {
            if (item.waiver?.kind !== 'tested-upstream') continue;
            expect(item.waiver.transmission, item.id).toBeDefined();
            expect(existsSync(join(ROOT, item.waiver.transmission!)), `${item.id}: ${item.waiver.transmission}`).toBe(true);
        }
    });

    it('every upstream limit is pinned in the tree and listed in ROADMAP.md', () => {
        const roadmap = read('ROADMAP.md');
        expect(matrix.upstreamLimits.length).toBeGreaterThanOrEqual(4);
        for (const limit of matrix.upstreamLimits) {
            expect(limit.summary.length, limit.id).toBeGreaterThan(40);
            expect(source(limit.pinnedBy.file).includes(limit.pinnedBy.name), `${limit.id}: "${limit.pinnedBy.name}" in ${limit.pinnedBy.file}`).toBe(true);
            expect(roadmap.includes(limit.roadmap), `${limit.id}: ROADMAP.md mentions "${limit.roadmap}"`).toBe(true);
        }
        // The pins that are tests are it.fails markers: they go red the day the engine lifts the limit.
        expect(read('tests/upstream-limits.test.ts').match(/it\.fails\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    });
});

describe('engine-surface: named means exercised', () => {
    it('every diagnostic code has a trigger a test executes, and a row in the agent contract', () => {
        expect(Object.keys(DIAGNOSTIC_TRIGGERS).sort()).toEqual([...DIAGNOSTIC_CODES].sort());
        expect(DIAGNOSTIC_CODES).toHaveLength(9);
        // The table is executed, not just declared.
        expect(read('tests/diagnostics-triggers.test.ts')).toContain('it.each(Object.entries(DIAGNOSTIC_TRIGGERS))');
        const contract = read('docs/AGENT_CONTRACT.md');
        for (const code of DIAGNOSTIC_CODES) expect(contract.includes(`\`${code}\``), `the agent contract documents ${code}`).toBe(true);
    });

    it('every TypographyOptions key is set by an executed example', () => {
        const used = new Set<string>();
        for (const file of readdirSync(join(ROOT, 'examples')).filter((f) => f.endsWith('.json'))) {
            const example = JSON.parse(read(`examples/${file}`)) as { arguments?: { typography?: Record<string, unknown> }; steps?: Array<{ arguments?: { typography?: Record<string, unknown> } }> };
            for (const args of [example.arguments, ...(example.steps ?? []).map((s) => s.arguments)]) {
                for (const key of Object.keys(args?.typography ?? {})) used.add(key);
            }
        }
        expect(TYPOGRAPHY_KEYS).toHaveLength(12);
        expect(TYPOGRAPHY_KEYS.filter((key) => !used.has(key)), 'typography keys no example sets').toEqual([]);
        expect([...used].filter((k) => !(TYPOGRAPHY_KEYS as readonly string[]).includes(k)), 'no example sets a key the engine does not have').toEqual([]);
    });

    it('every script code and alias has a native test string, and the five new scripts reach a fingerprinted sample', () => {
        expect(SCRIPT_CODES).toHaveLength(27);
        expect(SCRIPT_CODES.filter((code) => SCRIPT_SAMPLES[code] === undefined), 'script codes without a test string').toEqual([]);
        expect(Object.keys(LANG_ALIASES).filter((code) => ALIAS_SAMPLES[code] === undefined), 'aliases without a test string').toEqual([]);
        // Rendered for real, for every code: the parametrised suite walks the same table.
        expect(read('tests/scripts-27.test.ts')).toContain('it.each(Object.entries(SCRIPT_SAMPLES))');
        const example = JSON.parse(read('examples/scripts-lao-tai-cham.json')) as { arguments: { lang: string[] } };
        for (const code of ['lo', 'nod', 'khb', 'tdd', 'cjm']) expect(example.arguments.lang, code).toContain(code);
        expect(Object.hasOwn(baseline.entries, 'examples/scripts-lao-tai-cham/01-add_international_text.pdf')).toBe(true);
    });
});

// The engine ships no CHANGELOG in its npm package: this check runs where the
// sibling checkout exists (the maintainer's machine), never on a CI runner.
const ENGINE_CHANGELOG = resolve(ROOT, '..', 'pdfnative', 'CHANGELOG.md');

describe.skipIf(!existsSync(ENGINE_CHANGELOG))('engine-surface matrix: complete against the engine changelog', () => {
    it('maps every bullet of the release entry to exactly one item', () => {
        const text = readFileSync(ENGINE_CHANGELOG, 'utf8').replace(/\r\n/g, '\n');
        const start = text.indexOf(`## [${matrix.engine}]`);
        expect(start, `the changelog has a [${matrix.engine}] entry`).toBeGreaterThan(-1);
        const next = text.indexOf('\n## [', start + 1);
        const entry = text.slice(start, next === -1 ? undefined : next);
        const titles = [...entry.matchAll(/^- \*\*(.+?)(?:\*\*|$)/gm)].map((m) => m[1]!.trim());
        expect(titles.length).toBeGreaterThan(40);

        const used = new Map<string, string>();
        const unmatched: string[] = [];
        for (const title of titles) {
            const candidates = matrix.items.filter((i) => title.startsWith(i.changelog)).sort((a, b) => b.changelog.length - a.changelog.length);
            const item = candidates[0];
            if (item === undefined) {
                unmatched.push(title);
                continue;
            }
            expect(used.get(item.id), `${item.id} matched twice ("${used.get(item.id) ?? ''}" and "${title}")`).toBeUndefined();
            used.set(item.id, title);
        }
        expect(unmatched, 'changelog bullets without a matrix item').toEqual([]);
        expect(matrix.items.filter((i) => !used.has(i.id)).map((i) => i.id), 'matrix items matching no changelog bullet').toEqual([]);
    });
});
