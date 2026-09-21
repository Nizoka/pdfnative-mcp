/**
 * PDF/X-4 (`pdfx: 'pdfx4'`, pdfnative 1.8.0), CMYK / Gray OutputIntents and
 * colour control bars.
 *
 * Covers: success on each print-capable tool, every coherence error as
 * VALIDATION_ERROR, the three PDFX_* diagnostics and their strict escalation
 * to PDF_X_COMPLIANCE_VIOLATION, the new ICC boundary checks, file mode, and
 * the unchanged default output.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validatePdfX } from 'pdfnative';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PDFX_INPUT_PROPERTIES, PDF_X_ENUM, PdfXSchema, assertPdfXCompatible } from '../src/pdfx.js';
import { ensureCompressionReady, listToolsPayload } from '../src/server.js';
import { addBarcode } from '../src/tools/add-barcode.js';
import { addChart } from '../src/tools/add-chart.js';
import { addInternationalText } from '../src/tools/add-international-text.js';
import { addTable } from '../src/tools/add-table.js';
import { embedImage } from '../src/tools/embed-image.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import type { OutputResult } from '../src/output.js';
import { CMYK_INTENT, GRAY_INTENT, GRAY_V4_ICC_BASE64, RGB_MNTR_ICC_BASE64 } from './_icc-fixtures.js';
import { assertValidPdf } from './_pdf-assert.js';

const PINNED = '2026-01-15T09:00:00Z';
const bytesOf = (out: OutputResult): Uint8Array => new Uint8Array(Buffer.from(out.base64!, 'base64'));
const latin1 = (out: OutputResult): string => Buffer.from(out.base64!, 'base64').toString('latin1');

const JPEG =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAARC' +
    'AABAAEDASIA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/a' +
    'AAwDAQACEQMRAD8AJQAB/9k=';

/** The coherent PDF/X-4 request every positive test starts from. */
const PDFX = { pdfx: 'pdfx4', outputIntent: CMYK_INTENT, embedFonts: true, creationDate: PINNED } as const;
const DOC = { title: 'Print job', blocks: [{ type: 'heading', text: 'Brochure', level: 1 }, { type: 'paragraph', text: 'Body text in embedded Noto Sans.' }] };

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

describe('pdfx — schema', () => {
    it('follows the engine target list, JSON Schema and Zod together', () => {
        expect([...PDF_X_ENUM]).toEqual(['pdfx4']);
        expect([...PDFX_INPUT_PROPERTIES.pdfx.enum]).toEqual([...PDF_X_ENUM]);
        expect(PdfXSchema.options).toEqual([...PDF_X_ENUM]);
    });

    it('is offered by the six print-capable tools — not by forms, attachments (PDF/A-3) or signature placeholders', () => {
        const withPdfx = listToolsPayload().tools.filter((t) => 'pdfx' in ((t.inputSchema as { properties?: object }).properties ?? {})).map((t) => t.name).sort();
        expect(withPdfx).toEqual(['add_barcode', 'add_chart', 'add_international_text', 'add_table', 'embed_image', 'generate_basic_pdf']);
    });

    it('rejects an unknown target', async () => {
        await expect(generateBasicPdf({ ...DOC, ...PDFX, pdfx: 'pdfx1a' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('pdfx — success', () => {
    it('generate_basic_pdf writes a PDF/X-4 file validatePdfX() accepts: 1.6 header, GTS_PDFX intent, TrimBox, /Trapped', async () => {
        const out = await generateBasicPdf({ ...DOC, ...PDFX, strict: true });
        assertValidPdf(bytesOf(out));
        const pdf = latin1(out);
        expect(pdf.startsWith('%PDF-1.6')).toBe(true);
        expect(pdf).toContain('/GTS_PDFX');
        expect(pdf).toContain('GTS_PDFXVersion');
        expect(pdf).toMatch(/\/TrimBox\s*\[/);
        expect(pdf).toMatch(/\/Trapped\s*\/False/);
        expect(pdf).toMatch(/\/N 4\b/);
        expect(validatePdfX(bytesOf(out))).toMatchObject({ valid: true, errors: [] });
    });

    it('is reproducible: the pinned call is byte-identical, the XMP DocumentID included', async () => {
        const a = await generateBasicPdf({ ...DOC, ...PDFX });
        const b = await generateBasicPdf({ ...DOC, ...PDFX });
        expect(a.base64).toBe(b.base64);
    });

    it('accepts a Gray printing condition (/N 1) and metadata.trapped True', async () => {
        const out = await generateBasicPdf({ ...DOC, ...PDFX, outputIntent: GRAY_INTENT, metadata: { trapped: 'True' } });
        const pdf = latin1(out);
        expect(pdf).toMatch(/\/N 1\b/);
        expect(pdf).toMatch(/\/Trapped\s*\/True/);
        expect(validatePdfX(bytesOf(out)).valid).toBe(true);
    });

    it('bleed, crop marks and colour bars stay valid PDF/X-4; CMYK colours paint with k', async () => {
        const out = await generateBasicPdf({
            ...DOC,
            ...PDFX,
            print: { bleed: 14.17, marks: { colourBars: true } },
            watermark: { text: 'PROOF', opacity: 1, color: '0 1 1 0' },
        });
        const result = validatePdfX(bytesOf(out));
        expect(result.errors).toEqual([]);
        expect(latin1(out)).toMatch(/\b0 1 1 0 k\b/);
        expect(latin1(out)).toMatch(/\/Separation\s*\/All/);
    });

    const otherTools: Array<[string, (input: unknown) => Promise<OutputResult>, Record<string, unknown>]> = [
        ['add_table', addTable, { title: 'T', headers: ['Item', 'Qty'], rows: [['Widget', '2']] }],
        ['add_chart', addChart, { chartType: 'bar', categories: ['a', 'b'], series: [{ label: 's', values: [1, 2], color: '1 0 0 0' }] }],
        ['add_barcode', addBarcode, { format: 'code128', data: 'SKU-1', caption: 'Stock unit' }],
        ['embed_image', embedImage, { title: 'E', imageBase64: JPEG, mimeType: 'image/jpeg', caption: 'A 1x1 JPEG.' }],
    ];
    it.each(otherTools)('%s takes the same pdfx request and validates', async (_name, handler, input) => {
        const out = await handler({ ...input, ...PDFX });
        const result = validatePdfX(bytesOf(out));
        expect(result.errors).toEqual([]);
        expect(latin1(out)).toContain('/GTS_PDFX');
    });

    it('add_international_text (always-embedded Noto fonts) takes pdfx without embedFonts', async () => {
        const out = await addInternationalText({ title: 'I', lang: 'latin', paragraphs: ['Été à Zürich.'], pdfx: 'pdfx4', outputIntent: CMYK_INTENT, creationDate: PINNED });
        expect(validatePdfX(bytesOf(out)).errors).toEqual([]);
    });

    it('writes a PDF/X file in file mode', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-'));
        process.env['PDFNATIVE_MCP_OUTPUT_DIR'] = dir;
        try {
            const out = await generateBasicPdf({ ...DOC, ...PDFX, outputMode: 'file', outputPath: 'print/job.pdf' });
            expect(out.mode).toBe('file');
            const written = await fs.readFile(path.join(dir, 'print', 'job.pdf'));
            expect(validatePdfX(new Uint8Array(written)).valid).toBe(true);
        } finally {
            delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});

describe('pdfx — coherence errors are VALIDATION_ERROR, before the build', () => {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
        ['pdfx + pdfA', { pdfA: 'pdfa2b' }, /pdfx and pdfA are mutually exclusive/],
        ['pdfx + encrypt', { encrypt: { ownerPassword: 'owner-secret' } }, /pdfx and encrypt are mutually exclusive/],
        ['no outputIntent', { outputIntent: undefined }, /pdfx requires outputIntent/],
        ["metadata.trapped 'Unknown'", { metadata: { trapped: 'Unknown' } }, /known trapping state/],
        ['artBox + bleed', { print: { bleed: 9, artBox: [20, 20, 500, 700] } }, /TrimBox or an ArtBox, not both/],
        ['artBox + trimBox', { print: { trimBox: [10, 10, 580, 830], artBox: [20, 20, 500, 700] } }, /TrimBox or an ArtBox, not both/],
    ];
    it.each(cases)('%s', async (_label, extra, message) => {
        await expect(generateBasicPdf({ ...DOC, ...PDFX, ...extra })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(message) });
    });

    it("a display-class ('mntr') profile is refused by the engine and mapped to VALIDATION_ERROR (not PRINT_ERROR)", async () => {
        const outputIntent = { iccProfileBase64: RGB_MNTR_ICC_BASE64, outputConditionIdentifier: 'sRGB-like' };
        await expect(generateBasicPdf({ ...DOC, ...PDFX, outputIntent })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
            message: expect.stringMatching(/PDF\/X-4 requires an output \(printer\) profile/),
        });
    });

    it('assertPdfXCompatible is a no-op without pdfx', () => {
        expect(() => assertPdfXCompatible({ pdfA: 'pdfa2b', encrypt: {}, metadata: { trapped: 'Unknown' } })).not.toThrow();
    });
});

describe('pdfx — diagnostics and strict', () => {
    it('PDFX_NO_FONT_ENTRIES without embedFonts; strict → PDF_X_COMPLIANCE_VIOLATION', async () => {
        const request = { ...DOC, ...PDFX, embedFonts: false };
        const out = await generateBasicPdf({ ...request, includeDiagnostics: true });
        expect(out.diagnostics?.map((d) => d.code)).toContain('PDFX_NO_FONT_ENTRIES');
        expect(validatePdfX(bytesOf(out)).valid).toBe(false);
        await expect(generateBasicPdf({ ...request, strict: true })).rejects.toMatchObject({ code: 'PDF_X_COMPLIANCE_VIOLATION', message: expect.stringMatching(/PDF\/X/) });
    });

    it('PDFX_ANNOTATIONS for a link block on a print page; strict → PDF_X_COMPLIANCE_VIOLATION', async () => {
        const request = { ...DOC, ...PDFX, blocks: [...DOC.blocks, { type: 'link', text: 'site', url: 'https://example.com' }] };
        const out = await generateBasicPdf({ ...request, includeDiagnostics: true });
        expect(out.diagnostics?.map((d) => d.code)).toContain('PDFX_ANNOTATIONS');
        await expect(generateBasicPdf({ ...request, strict: true })).rejects.toMatchObject({ code: 'PDF_X_COMPLIANCE_VIOLATION' });
    });

    it('PDFX_DEVICE_CMYK for CMYK content under a Gray printing condition', async () => {
        const request = { ...DOC, ...PDFX, outputIntent: GRAY_INTENT, watermark: { text: 'PROOF', opacity: 1, color: [0, 100, 100, 0] } };
        const out = await generateBasicPdf({ ...request, includeDiagnostics: true });
        expect(out.diagnostics?.map((d) => d.code)).toContain('PDFX_DEVICE_CMYK');
        await expect(generateBasicPdf({ ...request, strict: true })).rejects.toMatchObject({ code: 'PDF_X_COMPLIANCE_VIOLATION' });
    });
});

describe('outputIntent — CMYK / Gray intents and the ICC boundary (pdfnative 1.8.0)', () => {
    it('a CMYK intent under pdfA is accepted; DeviceCMYK content matching it is clean', async () => {
        const out = await generateBasicPdf({ ...DOC, pdfA: 'pdfa2b', embedFonts: true, outputIntent: CMYK_INTENT, watermark: { text: 'CMYK', opacity: 1, color: '0 0 0 0.3' }, includeDiagnostics: true, creationDate: PINNED });
        expect(out.diagnostics).toEqual([]);
        expect(latin1(out)).toMatch(/\/N 4\b/);
    });

    it('PDFA_DEVICE_CMYK_CONTENT: CMYK content under the default sRGB intent; strict → PDF_A_COMPLIANCE_VIOLATION', async () => {
        const request = { ...DOC, pdfA: 'pdfa2b', embedFonts: true, watermark: { text: 'CMYK', opacity: 1, color: '0 1 1 0' }, creationDate: PINNED };
        const out = await generateBasicPdf({ ...request, includeDiagnostics: true });
        expect(out.diagnostics?.map((d) => d.code)).toContain('PDFA_DEVICE_CMYK_CONTENT');
        await expect(generateBasicPdf({ ...request, strict: true })).rejects.toMatchObject({ code: 'PDF_A_COMPLIANCE_VIOLATION' });
    });

    it('PDFA_ICC_PROFILE_VERSION: an ICC v4 profile under PDF/A-1', async () => {
        const outputIntent = { iccProfileBase64: GRAY_V4_ICC_BASE64, outputConditionIdentifier: 'Gray v4' };
        const out = await generateBasicPdf({ ...DOC, pdfA: 'pdfa1b', embedFonts: true, outputIntent, includeDiagnostics: true, creationDate: PINNED });
        expect(out.diagnostics?.map((d) => d.code)).toContain('PDFA_ICC_PROFILE_VERSION');
    });

    it("rejects a stub without the 'acsp' signature, and a truncated profile, with PRINT_ERROR", async () => {
        const stub = Buffer.alloc(256, 1).toString('base64');
        await expect(generateBasicPdf({ ...DOC, pdfA: 'pdfa2b', outputIntent: { iccProfileBase64: stub, outputConditionIdentifier: 'x' } })).rejects.toMatchObject({
            code: 'PRINT_ERROR',
            message: expect.stringMatching(/acsp/),
        });
        const truncated = Buffer.from(CMYK_INTENT.iccProfileBase64, 'base64').subarray(0, 4000).toString('base64');
        await expect(generateBasicPdf({ ...DOC, pdfA: 'pdfa2b', outputIntent: { iccProfileBase64: truncated, outputConditionIdentifier: 'x' } })).rejects.toMatchObject({
            code: 'PRINT_ERROR',
            message: expect.stringMatching(/truncated or corrupt/),
        });
    });

    it('rejects a data: URI or PEM armour in iccProfileBase64 with VALIDATION_ERROR (boundary helper)', async () => {
        const outputIntent = { iccProfileBase64: `data:application/vnd.iccprofile;base64,@@@`, outputConditionIdentifier: 'x' };
        await expect(generateBasicPdf({ ...DOC, pdfA: 'pdfa2b', outputIntent })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/outputIntent\.iccProfileBase64 is not valid base64/) });
    });
});

describe('print.marks.colourBars', () => {
    const base = { ...DOC, creationDate: PINNED, print: { bleed: 14.17, marks: true } };

    it('is off by default: marks:true and marks without colourBars build the same bytes', async () => {
        const plain = await generateBasicPdf(base);
        expect((await generateBasicPdf({ ...base, print: { bleed: 14.17, marks: { crop: true } } })).base64).toBe(plain.base64);
    });

    it('true and the object form add the control strip; size and tints change it', async () => {
        const plain = await generateBasicPdf(base);
        const bars = await generateBasicPdf({ ...base, print: { bleed: 14.17, marks: { colourBars: true } } });
        expect(bars.sizeBytes).toBeGreaterThan(plain.sizeBytes);
        const explicit = await generateBasicPdf({ ...base, print: { bleed: 14.17, marks: { colourBars: { tints: true, size: 12 } } } });
        expect(explicit.base64).toBe(bars.base64);
        const noTints = await generateBasicPdf({ ...base, print: { bleed: 14.17, marks: { colourBars: { tints: false } } } });
        expect(noTints.sizeBytes).toBeLessThan(bars.sizeBytes);
        const small = await generateBasicPdf({ ...base, print: { bleed: 14.17, marks: { colourBars: { size: 6 } } } });
        expect(small.base64).not.toBe(bars.base64);
    });

    it('rejects out-of-range sizes and unknown keys', async () => {
        for (const colourBars of [{ size: 3 }, { size: 73 }, { tint: true }]) {
            await expect(generateBasicPdf({ ...base, print: { bleed: 14.17, marks: { colourBars } } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        }
    });
});

describe('pdfx — untouched defaults', () => {
    it('a call without pdfx builds exactly what it built before', async () => {
        const plain = await generateBasicPdf({ ...DOC, creationDate: PINNED });
        expect(latin1(plain)).not.toContain('GTS_PDFX');
        expect(latin1(plain).startsWith('%PDF-1.6')).toBe(false);
    });
});

afterAll(() => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
});
