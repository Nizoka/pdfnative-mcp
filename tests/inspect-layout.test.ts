/**
 * inspect_layout — read-only pagination preview over the same `blocks`
 * generate_basic_pdf accepts. The headline contract: `totalPages` equals the
 * page count of the PDF generate_basic_pdf produces for the same inputs.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';

import { callToolDirect, ensureCompressionReady, listToolsPayload } from '../src/server.js';
import { inspectLayout, INSPECT_LAYOUT_NAME } from '../src/tools/inspect-layout.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';

const LONG_PARAGRAPH = 'The quick brown fox jumps over the lazy dog. '.repeat(40);

const SHORT = { title: 'Memo', blocks: [{ type: 'heading', text: 'Hello', level: 1 }, { type: 'paragraph', text: 'One short paragraph.' }] };

const LONG_TABLE = {
    title: 'Sites',
    blocks: [
        { type: 'paragraph', text: LONG_PARAGRAPH },
        {
            type: 'table',
            headers: ['Site', 'Headcount', 'Utilisation'],
            rows: Array.from({ length: 80 }, (_, i) => [`Site ${i + 1}`, String(20 + i), `${70 + (i % 30)} %`]),
        },
        { type: 'paragraph', text: 'Trailing note after the table.' },
    ],
};

const PAGE_BREAKS = {
    title: 'Sections',
    blocks: [
        { type: 'heading', text: 'Part A', level: 1 },
        { type: 'paragraph', text: LONG_PARAGRAPH },
        { type: 'pageBreak' },
        { type: 'heading', text: 'Part B', level: 1 },
        { type: 'list', style: 'numbered', items: ['one', 'two', 'three'] },
        { type: 'pageBreak' },
        { type: 'paragraph', text: 'Part C is a single line.\nAnd a second paragraph from an embedded newline.' },
    ],
};

interface LayoutSc {
    pageWidth: number;
    pageHeight: number;
    margins: { t: number; r: number; b: number; l: number };
    totalPages: number;
    pages: Array<{ index: number; blocks: Array<{ type: string; page: number; x: number; top: number; width: number; height: number }> }>;
    blockCount?: number;
}

async function callOk(args: Record<string, unknown>) {
    const r = await callToolDirect(INSPECT_LAYOUT_NAME, args);
    expect(r.isError, JSON.stringify(r.content?.[0]).slice(0, 300)).not.toBe(true);
    return r;
}

async function pdfPageCount(args: Record<string, unknown>): Promise<number> {
    const out = await generateBasicPdf(args);
    return assertValidPdf(out.base64!);
}

beforeAll(async () => {
    await ensureCompressionReady();
});

describe('inspect_layout — pagination matches generate_basic_pdf', () => {
    for (const [label, doc] of [
        ['short single page', SHORT],
        ['long table spanning pages', LONG_TABLE],
        ['explicit pageBreaks', PAGE_BREAKS],
    ] as const) {
        it(`${label}: totalPages equals the generated page count`, async () => {
            const layout = await inspectLayout(doc);
            expect(layout.totalPages).toBe(await pdfPageCount(doc));
            expect(layout.pages).toHaveLength(layout.totalPages);
            layout.pages.forEach((p, i) => {
                expect(p.index).toBe(i);
                for (const b of p.blocks) expect(b.page).toBe(i);
            });
        });
    }

    it('layout options move blocks exactly as in generate_basic_pdf (Letter, wide margins, header, footer)', async () => {
        const paragraphs = Array.from({ length: 60 }, (_, i) => ({ type: 'paragraph', text: `Paragraph ${i + 1} of a long document body that wraps over a few lines on the page.` }));
        const plain = { title: 'L', blocks: paragraphs };
        const styled = { ...plain, pageSize: 'Letter', margins: { top: 100, right: 100, bottom: 100, left: 100 }, headerTemplate: { left: '{title}' }, footerTemplate: { right: '{page}/{pages}' }, footerText: 'ignored when footerTemplate is set' };
        const a = await inspectLayout(plain);
        const b = await inspectLayout(styled);
        expect(b.pageWidth).toBe(612);
        expect(b.pageHeight).toBe(792);
        expect(b.margins).toEqual({ t: 100, r: 100, b: 100, l: 100 });
        expect(b.totalPages).toBeGreaterThanOrEqual(a.totalPages);
        expect(b.totalPages).toBe(await pdfPageCount(styled));
    });

    it('accepts every block kind (table, image, link, barcode, svg, formField, chart) and paginates like the generator', async () => {
        const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAARCAABAAEDASIA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=';
        const doc = {
            title: 'All kinds',
            blocks: [
                { type: 'heading', text: 'H', level: 1 },
                { type: 'table', headers: ['a'], rows: [['1']] },
                { type: 'image', imageBase64: JPEG, mimeType: 'image/jpeg', width: 40, height: 40 },
                { type: 'link', text: 'l', url: 'https://example.com' },
                { type: 'barcode', format: 'qr', data: 'x', width: 60 },
                { type: 'svg', data: 'M0 0 L10 10', viewBox: [0, 0, 10, 10], width: 50, height: 50 },
                { type: 'formField', fieldType: 'text', name: 'f' },
                { type: 'chart', chartType: 'bar', series: [{ label: 's', values: [1] }] },
            ],
        };
        const layout = await inspectLayout(doc);
        const kinds = layout.pages.flatMap((p) => p.blocks.map((b) => b.type));
        for (const k of ['heading', 'table', 'image', 'link', 'barcode', 'svg', 'formField', 'chart']) expect(kinds, k).toContain(k);
        expect(layout.totalPages).toBe(await pdfPageCount(doc));
    });

    it("engine gap: a 'toc' block is measured as 0 pt by the dry run (documented; flips when pdfnative passes the headings to estimateBlockHeight)", async () => {
        const doc = { title: 'T', blocks: [{ type: 'toc' }, { type: 'heading', text: 'One', level: 1 }, { type: 'heading', text: 'Two', level: 2 }] };
        const layout = await inspectLayout(doc);
        const toc = layout.pages[0]!.blocks.find((b) => b.type === 'toc');
        expect(toc).toBeDefined();
        // When this assertion starts failing the engine has fixed the gap: drop the caveat from the
        // inspect_layout description and the docs, and assert a positive height instead.
        expect(toc!.height).toBe(0);
    });

    it('the long table reports more than one page and one slice per page', async () => {
        const layout = await inspectLayout(LONG_TABLE);
        expect(layout.totalPages).toBeGreaterThan(1);
        const slices = layout.pages.flatMap((p) => p.blocks.filter((b) => b.type === 'table'));
        expect(slices.length).toBe(layout.totalPages);
    });

    it('pageBreak opens a new page and paragraphs split on embedded newlines', async () => {
        const layout = await inspectLayout(PAGE_BREAKS);
        expect(layout.totalPages).toBe(3);
        expect(layout.pages[0]!.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph']);
        expect(layout.pages[1]!.blocks.map((b) => b.type)).toEqual(['heading', 'list']);
        expect(layout.pages[2]!.blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    });

    it('geometry: A4 defaults, blocks inside the content box, monotonically descending tops, 2-decimal rounding', async () => {
        const layout = await inspectLayout(SHORT);
        expect(layout.pageWidth).toBe(595.28);
        expect(layout.pageHeight).toBe(841.89);
        const cw = layout.pageWidth - layout.margins.l - layout.margins.r;
        let prevTop = Infinity;
        for (const b of layout.pages[0]!.blocks) {
            expect(b.x).toBe(layout.margins.l);
            expect(b.width).toBeCloseTo(cw, 2);
            expect(b.top).toBeLessThan(prevTop);
            expect(b.top).toBeLessThanOrEqual(layout.pageHeight - layout.margins.t);
            expect(b.height).toBeGreaterThan(0);
            prevTop = b.top;
            for (const n of [b.x, b.top, b.width, b.height]) expect(Math.round(n * 100) / 100).toBe(n);
        }
    });

    it('embedFonts / pdfA / normalize are accepted and still agree with the generator', async () => {
        const doc = { ...PAGE_BREAKS, embedFonts: true, pdfA: 'pdfa2b', normalize: 'NFC' };
        const layout = await inspectLayout(doc);
        expect(layout.totalPages).toBe(await pdfPageCount(doc));
    });

    it('is deterministic', async () => {
        const a = await inspectLayout(LONG_TABLE);
        const b = await inspectLayout(LONG_TABLE);
        expect(a).toEqual(b);
    });
});

describe('inspect_layout — validation', () => {
    it('rejects an unknown top-level key', async () => {
        await expect(inspectLayout({ ...SHORT, outputMode: 'file' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(inspectLayout({ ...SHORT, watermark: { text: 'x' } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects a malformed block, a missing title and an empty block list', async () => {
        await expect(inspectLayout({ title: 'T', blocks: [{ type: 'heading', text: 'x', level: 9 }] })).rejects.toBeInstanceOf(ToolError);
        await expect(inspectLayout({ title: 'T', blocks: [{ type: 'nope' }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(inspectLayout({ blocks: SHORT.blocks })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(inspectLayout({ title: 'T', blocks: [] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('surfaces a VALIDATION_ERROR through tools/call as isError', async () => {
        const r = await callToolDirect(INSPECT_LAYOUT_NAME, { title: 'T', blocks: [{ type: 'spacer', height: 0 }] });
        expect(r.isError).toBe(true);
        expect((r.content?.[0] as { text: string }).text).toContain('VALIDATION_ERROR');
    });
});

describe('inspect_layout — MCP surface', () => {
    const validator = new AjvJsonSchemaValidator();
    const tool = listToolsPayload().tools.find((t) => t.name === INSPECT_LAYOUT_NAME)!;

    it('is registered read-only with an output schema and two executable examples', () => {
        expect(tool).toBeDefined();
        expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
        expect(tool.title).toBe('Inspect document layout (dry run)');
        expect(tool.description?.length ?? 0).toBeLessThanOrEqual(700);
        const examples = (tool._meta as { examples: Array<{ input: unknown }> }).examples;
        expect(examples).toHaveLength(2);
        for (const ex of examples) {
            expect(validator.getValidator(tool.inputSchema as never)(ex.input).valid).toBe(true);
        }
    });

    it('text line + full structuredContent that validates against the outputSchema', async () => {
        const r = await callOk(LONG_TABLE);
        const sc = r.structuredContent as unknown as LayoutSc;
        expect((r.content?.[0] as { text: string }).text).toBe(`inspect_layout: ${sc.totalPages} page(s), ${sc.pages.reduce((n, p) => n + p.blocks.length, 0)} block(s), 595.28x841.89 pt.`);
        expect(Object.keys(sc).sort()).toEqual(['margins', 'pageHeight', 'pageWidth', 'pages', 'totalPages']);
        const v = validator.getValidator(tool.outputSchema as never)(sc);
        expect(v.valid, v.errorMessage).toBe(true);
    });

    it("verbosity:'summary' collapses to the four scalars", async () => {
        const r = await callOk({ ...LONG_TABLE, verbosity: 'summary' });
        const sc = r.structuredContent as unknown as LayoutSc;
        expect(Object.keys(sc).sort()).toEqual(['blockCount', 'pageHeight', 'pageWidth', 'totalPages']);
        expect(sc.blockCount).toBeGreaterThan(2);
        expect(validator.getValidator(tool.outputSchema as never)(sc).valid).toBe(true);
    });

    it("fields:['totalPages'] projects to a single scalar; an unknown path is reported in _meta", async () => {
        const r = await callOk({ ...SHORT, fields: ['totalPages'] });
        expect(r.structuredContent).toEqual({ totalPages: 1 });
        expect(r._meta).toBeUndefined();

        const nested = await callOk({ ...SHORT, fields: ['pages.blocks.type', 'nope'] });
        expect(nested.structuredContent).toEqual({ pages: [{ blocks: [{ type: 'heading' }, { type: 'paragraph' }] }] });
        expect((nested._meta as { unmatchedFields: string[] }).unmatchedFields).toEqual(['nope']);
        expect(validator.getValidator(tool.outputSchema as never)(nested.structuredContent).valid).toBe(true);
    });
});

describe('inspect_layout — response cache', () => {
    let cacheDir: string;
    afterEach(() => {
        delete process.env['PDFNATIVE_MCP_CACHE_DIR'];
        rmSync(cacheDir, { recursive: true, force: true });
    });

    it('is cacheable: the second identical call is served with _meta.cached=true', async () => {
        cacheDir = mkdtempSync(join(tmpdir(), 'pdfnative-layout-cache-'));
        process.env['PDFNATIVE_MCP_CACHE_DIR'] = cacheDir;
        const fresh = await callOk(SHORT);
        expect((fresh._meta as Record<string, unknown> | undefined)?.['cached']).toBeUndefined();
        expect(readdirSync(cacheDir).filter((f) => f.endsWith('.json'))).toHaveLength(1);
        const hit = await callOk(SHORT);
        expect((hit._meta as Record<string, unknown>)['cached']).toBe(true);
        expect(hit.structuredContent).toEqual(fresh.structuredContent);
    });
});
