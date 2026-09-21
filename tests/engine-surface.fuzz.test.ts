/**
 * Hostile-input suite for the pdfnative 1.8.0 surface (colour, typography,
 * print marks, ICC profiles, PDF/X, lang, creationDate, the operator pin,
 * validate_pdf on mutated files).
 *
 * The invariant, for every generated call:
 *
 *     the call succeeds, OR it fails with a ToolError that carries a stable code.
 *
 * A failure without a code is an unexpected throw that escaped a handler; a
 * GENERATION_FAILED on an input this suite built to be schema-valid means the
 * boundary let through something the engine then choked on. Both are findings.
 * Seeded (tests/_fuzz.ts): the same cases on every machine, no flakiness.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { buildSyntheticCmykProfile, buildSyntheticGrayProfile } from '../scripts/lib/synthetic-icc.js';
import { readPinnedCreationDate } from '../src/reproducible.js';
import { callToolDirect, ensureCompressionReady } from '../src/server.js';
import { FONT_FEATURE_TAGS } from '../src/typography.js';
import { HOSTILE_VALUES, errorCodeOf, mutate, rng, type Rng } from './_fuzz.js';

const PINNED = '2026-01-15T09:00:00Z';
const BLOCKS = [{ type: 'heading', text: 'Fuzz', level: 1 }, { type: 'paragraph', text: 'The quick brown fox jumps over the lazy dog, 150 € ; vraiment ? '.repeat(6) }];

/** Every ToolError code the agent contract documents: the only codes a call may fail with. */
const DOCUMENTED_CODES = ((): Set<string> => {
    const root = resolve(import.meta.dirname, '..');
    let contract: string;
    try {
        contract = readFileSync(resolve(root, 'docs', 'AGENT_CONTRACT.md'), 'utf8');
    } catch {
        contract = readFileSync(resolve(root, 'docs', 'AGENT_CONTRACT.md'), 'utf8');
    }
    return new Set([...contract.matchAll(/^\| `([A-Z][A-Z0-9_]+)` \|/gm)].map((m) => m[1]!));
})();

interface Outcome { readonly ok: boolean; readonly code: string | null }

async function attempt(tool: string, args: Record<string, unknown>): Promise<Outcome> {
    const result = await callToolDirect(tool, args);
    if (result.isError !== true) return { ok: true, code: null };
    const code = errorCodeOf(result as never);
    const text = (result.content.find((c) => c.type === 'text') as { text?: string } | undefined)?.text ?? '';
    expect(code, `a failure must carry a ToolError code — got: ${text.slice(0, 200)}\ninput: ${JSON.stringify(args).slice(0, 400)}`).not.toBeNull();
    expect(DOCUMENTED_CODES.has(code!), `${code} is not in the documented error table\ninput: ${JSON.stringify(args).slice(0, 400)}`).toBe(true);
    return { ok: false, code };
}

const validCmykString = (r: Rng): string => Array.from({ length: 4 }, () => String(Number(r.float(0, 1).toFixed(r.int(0, 4))))).join(' ');
const validCmykTuple = (r: Rng): number[] => Array.from({ length: 4 }, () => Number(r.float(0, 100).toFixed(r.int(0, 3))));
const validColor = (r: Rng): unknown => (r.bool() ? validCmykString(r) : validCmykTuple(r));

function validTypography(r: Rng): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (r.bool()) out['splitParagraphs'] = r.bool();
    if (r.bool()) out['orphans'] = r.int(1, 10);
    if (r.bool()) out['widows'] = r.int(1, 10);
    if (r.bool()) out['keepHeadingsWithNext'] = r.bool() ? r.bool() : r.bool() ? {} : { minLines: r.int(1, 10) };
    if (r.bool()) out['unitBinding'] = r.bool() ? r.bool() : { units: r.some(['€', 'kg', '%', 'personnes', 'km/h']) };
    if (r.bool()) out['bindShortWords'] = r.bool() ? r.bool() : r.bool() ? { maxLength: r.int(1, 3) } : { words: r.some(['a', 'w', 'i', 'z', 'the']) };
    if (r.bool()) {
        out['punctuationSpacing'] = r.bool()
            ? r.pick(['fr', 'fr-CA'])
            : Array.from({ length: r.int(0, 5) }, () => ({ char: r.pick([';', '!', '?', ':', '«', '»', '(', '\\', '.', '*']), side: r.pick(['before', 'after']), space: r.pick(['nbsp', 'narrow']) }));
    }
    if (r.bool()) out['opticalMargins'] = r.bool();
    if (r.bool()) out['metrics'] = r.pick(['approximate', 'exact']);
    if (r.bool()) out['fontFeatures'] = r.some(FONT_FEATURE_TAGS);
    if (r.bool()) out['kerning'] = r.bool();
    if (r.bool()) out['hyphenationLanguage'] = r.pick(['en', 'en-GB', 'fr-CA', 'de-DE-1996', 'zh-Hant']);
    return out;
}

beforeAll(async () => {
    await ensureCompressionReady();
    expect(DOCUMENTED_CODES.size, 'the error table of the agent contract was parsed').toBeGreaterThan(40);
});

describe('fuzz — colour inputs', () => {
    it('any VALID CMYK colour builds on every colour site (no engine failure behind a valid schema)', async () => {
        const r = rng(0xc01054);
        for (let i = 0; i < 60; i++) {
            const outcome = await attempt('generate_basic_pdf', {
                title: 'F', creationDate: PINNED,
                watermark: { text: 'W', opacity: 1, color: validColor(r) },
                headerTemplate: { left: '{title}', color: validColor(r) },
                outline: [{ title: 'Fuzz', pageIndex: 0, color: validCmykTuple(r) }],
                blocks: [
                    ...BLOCKS,
                    { type: 'link', text: 'l', url: 'https://example.com', color: validColor(r) },
                    { type: 'svg', data: 'M0 0 L10 10 L0 10 Z', viewBox: [0, 0, 10, 10], width: 30, height: 30, fill: validColor(r), stroke: validColor(r) },
                    { type: 'table', headers: ['a'], rows: [['1']], cellBorders: { all: true, color: validCmykTuple(r) } },
                    { type: 'chart', chartType: 'bar', categories: ['a'], series: [{ label: 's', values: [1], color: validColor(r) }], colors: [validColor(r)] },
                ],
            });
            expect(outcome, `case ${i}`).toEqual({ ok: true, code: null });
        }
    }, 120_000);

    it('a hostile colour is refused with VALIDATION_ERROR, or accepted — never an uncoded failure', async () => {
        const r = rng(0xbad001);
        const sites: Array<(v: unknown) => Record<string, unknown>> = [
            (v) => ({ watermark: { text: 'W', color: v } }),
            (v) => ({ headerTemplate: { left: 'x', color: v } }),
            (v) => ({ outline: [{ title: 'F', pageIndex: 0, color: v }] }),
            (v) => ({ blocks: [...BLOCKS, { type: 'link', text: 'l', url: 'https://example.com', color: v }] }),
            (v) => ({ blocks: [...BLOCKS, { type: 'svg', data: 'M0 0 L1 1', fill: v }] }),
            (v) => ({ blocks: [...BLOCKS, { type: 'table', headers: ['a'], rows: [['1']], cellBorders: { all: true, color: v } }] }),
            (v) => ({ blocks: [...BLOCKS, { type: 'chart', chartType: 'bar', series: [{ label: 's', values: [1], color: v }] }] }),
        ];
        for (let i = 0; i < 140; i++) {
            const outcome = await attempt('generate_basic_pdf', { title: 'F', creationDate: PINNED, blocks: BLOCKS, ...r.pick(sites)(r.pick(HOSTILE_VALUES)) });
            if (!outcome.ok) expect(['VALIDATION_ERROR', 'GENERATION_FAILED'], `case ${i}: ${outcome.code}`).toContain(outcome.code);
        }
    }, 120_000);

    it('annotate_pdf colours: hostile values never escape as an uncoded failure', async () => {
        const r = rng(0xa11070);
        const source = await callToolDirect('generate_basic_pdf', { title: 'F', blocks: BLOCKS, creationDate: PINNED });
        const pdfBase64 = (source.content.find((c) => c.type === 'resource') as { resource: { blob: string } }).resource.blob;
        for (let i = 0; i < 60; i++) {
            await attempt('annotate_pdf', { pdfBase64, annotations: [{ type: 'square', page: 0, rect: [10, 10, 100, 100], color: r.pick(HOSTILE_VALUES), interiorColor: r.pick(HOSTILE_VALUES) }] });
        }
    }, 120_000);
});

describe('fuzz — typography', () => {
    it('any VALID typography object builds, with and without embedded fonts, and inspect_layout agrees on the page count', async () => {
        const r = rng(0x7e9004);
        for (let i = 0; i < 50; i++) {
            const typography = validTypography(r);
            const embedFonts = r.bool();
            const blocks = [...BLOCKS, ...Array.from({ length: r.int(0, 25) }, () => ({ type: 'paragraph', text: BLOCKS[1]!.text, align: r.pick(['left', 'right', 'center', 'justify']), ...(r.bool(0.3) ? { splittable: r.bool() } : {}), ...(r.bool(0.2) ? { keepWithNext: r.bool() } : {}) }))];
            const built = await callToolDirect('generate_basic_pdf', { title: 'F', creationDate: PINNED, embedFonts, typography, blocks });
            expect(built.isError, `case ${i}: ${JSON.stringify(typography)} → ${(built.content[0] as { text?: string }).text ?? ''}`).not.toBe(true);
            const pdf = Buffer.from((built.content.find((c) => c.type === 'resource') as { resource: { blob: string } }).resource.blob, 'base64').toString('latin1');
            const layout = await callToolDirect('inspect_layout', { title: 'F', embedFonts, typography, blocks, verbosity: 'summary' });
            expect(layout.isError, `case ${i}`).not.toBe(true);
            expect((layout.structuredContent as { totalPages: number }).totalPages, `case ${i}: ${JSON.stringify(typography)}`).toBe((pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length);
        }
    }, 180_000);

    it('a hostile typography object is refused with VALIDATION_ERROR', async () => {
        const r = rng(0x7e9bad);
        const keys = ['splitParagraphs', 'orphans', 'widows', 'keepHeadingsWithNext', 'unitBinding', 'bindShortWords', 'punctuationSpacing', 'opticalMargins', 'metrics', 'fontFeatures', 'kerning', 'hyphenationLanguage', '__proto__', 'constructor', 'unknown'];
        for (let i = 0; i < 120; i++) {
            const typography: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
            for (const key of r.some(keys).slice(0, 4)) typography[key] = r.pick(HOSTILE_VALUES);
            const outcome = await attempt('generate_basic_pdf', { title: 'F', creationDate: PINNED, blocks: BLOCKS, typography: r.bool(0.1) ? r.pick(HOSTILE_VALUES) : typography });
            if (!outcome.ok) expect(outcome.code, `case ${i}: ${JSON.stringify(typography)}`).toBe('VALIDATION_ERROR');
        }
    }, 120_000);
});

describe('fuzz — print marks, ICC profiles, PDF/X', () => {
    const profiles = [buildSyntheticCmykProfile(), buildSyntheticGrayProfile(), buildSyntheticGrayProfile({ version: 4 })];

    it('a mutated ICC profile is a coded error (PRINT_ERROR / VALIDATION_ERROR) or a success — under pdfA and under pdfx', async () => {
        const r = rng(0x1cc001);
        const seen = new Set<string>();
        for (let i = 0; i < 120; i++) {
            const icc = Buffer.from(mutate(r.pick(profiles), r)).toString('base64');
            const claim = r.bool() ? { pdfA: r.pick(['pdfa1b', 'pdfa2b', 'pdfa3b']) } : { pdfx: 'pdfx4' };
            const outcome = await attempt('generate_basic_pdf', { title: 'F', creationDate: PINNED, embedFonts: true, blocks: BLOCKS, ...claim, outputIntent: { iccProfileBase64: icc.length === 0 ? 'AA==' : icc, outputConditionIdentifier: 'fuzz' } });
            if (!outcome.ok) {
                seen.add(outcome.code!);
                expect(['PRINT_ERROR', 'VALIDATION_ERROR'], `case ${i}: ${outcome.code}`).toContain(outcome.code);
            }
        }
        expect([...seen]).toContain('PRINT_ERROR');
    }, 180_000);

    it('random PDF/X requests: a coherent one builds and validates, an incoherent one is VALIDATION_ERROR', async () => {
        const r = rng(0x9df004);
        const cmyk = Buffer.from(profiles[0]!).toString('base64');
        for (let i = 0; i < 60; i++) {
            const args: Record<string, unknown> = { title: 'F', creationDate: PINNED, blocks: BLOCKS, pdfx: 'pdfx4', embedFonts: true };
            const coherent = r.bool(0.4);
            args['outputIntent'] = { iccProfileBase64: cmyk, outputConditionIdentifier: 'fuzz' };
            args['print'] = r.bool() ? { bleed: r.float(1, 30), marks: r.bool() ? true : { colourBars: r.bool() ? true : { tints: r.bool(), size: r.float(4, 72) } } } : undefined;
            if (!coherent) {
                const breakIt = r.int(0, 4);
                if (breakIt === 0) args['pdfA'] = 'pdfa2b';
                if (breakIt === 1) args['encrypt'] = { ownerPassword: 'owner-secret' };
                if (breakIt === 2) delete args['outputIntent'];
                if (breakIt === 3) args['metadata'] = { trapped: 'Unknown' };
                if (breakIt === 4) args['print'] = { bleed: 9, artBox: [20, 20, 500, 700] };
            }
            const outcome = await attempt('generate_basic_pdf', args);
            if (coherent) expect(outcome, `case ${i}: ${JSON.stringify(args['print'])}`).toEqual({ ok: true, code: null });
            else expect(outcome.code, `case ${i}`).toBe('VALIDATION_ERROR');
        }
    }, 180_000);

    it('hostile colourBars values are refused with VALIDATION_ERROR', async () => {
        const r = rng(0xba5001);
        for (let i = 0; i < 60; i++) {
            const outcome = await attempt('generate_basic_pdf', { title: 'F', creationDate: PINNED, blocks: BLOCKS, print: { bleed: 14.17, marks: { colourBars: r.pick(HOSTILE_VALUES) } } });
            if (!outcome.ok) expect(outcome.code, `case ${i}`).toBe('VALIDATION_ERROR');
        }
    }, 120_000);
});

describe('fuzz — lang, creationDate and the operator pin', () => {
    it('lang: any string or array is a success or UNSUPPORTED_LANG / VALIDATION_ERROR', async () => {
        const r = rng(0x1a4900);
        const codes = ['lo', 'nod', 'khb', 'tdd', 'cjm', 'latin', 'ha', 'yo', 'ig', 'sw', 'emoji', 'xx', '', ' ', 'LO', 'lo ', ',', 'lo,,nod', '__proto__', 'constructor'];
        for (let i = 0; i < 60; i++) {
            const lang = r.bool() ? r.pick(codes) : r.bool() ? r.some(codes) : r.some(codes).join(',');
            const outcome = await attempt('add_international_text', { title: 'F', lang, paragraphs: ['ສະບາຍດີ ꨀꨇꩉ Ẹ káàárọ̀'], creationDate: PINNED });
            if (!outcome.ok) expect(['UNSUPPORTED_LANG', 'VALIDATION_ERROR'], `case ${i}: ${JSON.stringify(lang)} → ${outcome.code}`).toContain(outcome.code);
        }
    }, 180_000);

    it('creationDate: a hostile value is VALIDATION_ERROR, never a bad date in the file', async () => {
        const r = rng(0xda7e00);
        const dates = ['2026-01-01', '2026-01-01T00:00:00', '2026-13-01T00:00:00Z', '0000-00-00T00:00:00Z', '275760-09-13T00:00:00Z', '2026-01-01T00:00:00+25:00', 'now', '1767225600', ...HOSTILE_VALUES];
        for (let i = 0; i < 60; i++) {
            const outcome = await attempt('generate_basic_pdf', { title: 'F', blocks: BLOCKS, creationDate: r.pick(dates), footerTemplate: { left: '{date}' } });
            if (!outcome.ok) expect(outcome.code, `case ${i}`).toBe('VALIDATION_ERROR');
        }
    }, 120_000);

    it('the operator pin parser returns a valid Date, null, or throws an Error naming the variable — nothing else', () => {
        const r = rng(0x0e9001);
        const values = ['', ' ', '0', '1767225600', '-1', '1.5', '1e9', '9'.repeat(13), '2026-01-01T00:00:00Z', '2026-01-01', 'abc', '\u0000', '١٢٣', '0x10', '+1', ' 12 '];
        for (let i = 0; i < 200; i++) {
            const env = { PDFNATIVE_MCP_CREATION_DATE: r.bool() ? r.pick(values) : undefined, SOURCE_DATE_EPOCH: r.bool() ? r.pick(values) : undefined } as NodeJS.ProcessEnv;
            try {
                const pin = readPinnedCreationDate(env);
                if (pin !== null) expect(Number.isNaN(pin.date.getTime()), JSON.stringify(env)).toBe(false);
            } catch (err) {
                expect(err).toBeInstanceOf(Error);
                expect((err as Error).message).toMatch(/PDFNATIVE_MCP_CREATION_DATE|SOURCE_DATE_EPOCH/);
            }
        }
    });
});

describe('fuzz — read tools on mutated PDF/X files', () => {
    it('validate_pdf (both standards) and inspect_pdf answer or fail with a documented code', async () => {
        const r = rng(0x9df0ad);
        const source = await callToolDirect('generate_basic_pdf', { title: 'F', creationDate: PINNED, blocks: BLOCKS, pdfx: 'pdfx4', embedFonts: true, outputIntent: { iccProfileBase64: Buffer.from(buildSyntheticGrayProfile()).toString('base64'), outputConditionIdentifier: 'fuzz' } });
        const original = Buffer.from((source.content.find((c) => c.type === 'resource') as { resource: { blob: string } }).resource.blob, 'base64');
        for (let i = 0; i < 80; i++) {
            const mutated = Buffer.from(mutate(original, r));
            const pdfBase64 = mutated.length < 4 ? 'JVBERi0=' : mutated.toString('base64');
            for (const [tool, args] of [['validate_pdf', { standard: 'pdf-x-4' }], ['validate_pdf', {}], ['inspect_pdf', { check: ['pdfx', 'trapped'] }]] as const) {
                const outcome = await attempt(tool, { pdfBase64, ...args });
                if (!outcome.ok) expect(['PDF_PARSE_FAILED', 'VALIDATION_ERROR', 'PASSWORD_REQUIRED', 'ENCRYPTION_UNSUPPORTED'], `case ${i} ${tool}: ${outcome.code}`).toContain(outcome.code);
            }
        }
    }, 180_000);

    // pdfnative parses lazily, so a damaged file can throw from any accessor, long after openPdf().
    // Every tool that takes a PDF must turn that into a coded error — the rule the fuzz run above
    // first caught inspect_pdf breaking.
    it('every tool that takes a PDF survives a damaged one: success or a documented code, never an uncoded failure', async () => {
        const r = rng(0xda3a6e);
        const form = await callToolDirect('add_form', { title: 'F', creationDate: PINNED, fields: [{ fieldType: 'text', name: 'n', label: 'N', value: 'v' }] });
        const plain = await callToolDirect('generate_basic_pdf', { title: 'F', creationDate: PINNED, compress: true, blocks: [...BLOCKS, { type: 'pageBreak' }, ...BLOCKS] });
        const blobOf = (res: typeof form): Buffer => Buffer.from((res.content.find((c) => c.type === 'resource') as { resource: { blob: string } }).resource.blob, 'base64');
        const sources = [blobOf(form), blobOf(plain)];
        const tools: ReadonlyArray<readonly [string, (pdfBase64: string) => Record<string, unknown>]> = [
            ['inspect_pdf', (p) => ({ pdfBase64: p, pages: true, signatures: true, annotations: true })],
            ['extract_text', (p) => ({ pdfBase64: p, includeRuns: true })],
            ['extract_attachments', (p) => ({ pdfBase64: p, includeData: true })],
            ['read_form_fields', (p) => ({ pdfBase64: p })],
            ['verify_pdf', (p) => ({ pdfBase64: p })],
            ['validate_pdf', (p) => ({ pdfBase64: p })],
            ['fill_form', (p) => ({ pdfBase64: p, values: { n: 'x' }, onUnknownField: 'ignore' })],
            ['annotate_pdf', (p) => ({ pdfBase64: p, annotations: [{ type: 'square', page: 0, rect: [10, 10, 50, 50] }] })],
            ['update_metadata', (p) => ({ pdfBase64: p, title: 'T', modDate: PINNED })],
            ['merge_pdfs', (p) => ({ pdfsBase64: [p, p] })],
            ['split_pdf', (p) => ({ pdfBase64: p, ranges: [{ start: 0, end: 0 }] })],
            ['extract_pages', (p) => ({ pdfBase64: p, pages: [0] })],
            ['encrypt_pdf', (p) => ({ pdfBase64: p, ownerPassword: 'owner-secret' })],
            ['decrypt_pdf', (p) => ({ pdfBase64: p, password: 'x' })],
        ];
        for (let i = 0; i < 40; i++) {
            const mutated = Buffer.from(mutate(r.pick(sources), r));
            const pdfBase64 = mutated.length < 4 ? 'JVBERi0=' : mutated.toString('base64');
            for (const [tool, build] of tools) await attempt(tool, build(pdfBase64));
        }
    }, 300_000);
});
