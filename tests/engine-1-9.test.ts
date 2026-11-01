/**
 * The pdfnative 1.9.0 surface, exercised through the tools (pdfnative-mcp
 * 1.8.0): spot colours, text direction and /ActualText, JPEG 2000, chart
 * series colours, link annotations, subset font tags, the layout fixes and
 * PDF text strings. The engine-surface matrix (tests/_fixtures/engine-surface.json)
 * names these tests bullet by bullet.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { callToolDirect, ensureCompressionReady, listToolsPayload } from '../src/server.js';
import { addChart } from '../src/tools/add-chart.js';
import { addForm } from '../src/tools/add-form.js';
import { addInternationalText } from '../src/tools/add-international-text.js';
import { annotatePdf } from '../src/tools/annotate-pdf.js';
import { embedImage } from '../src/tools/embed-image.js';
import { extractText } from '../src/tools/extract-text.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { inspectLayout } from '../src/tools/inspect-layout.js';
import { inspectPdf } from '../src/tools/inspect-pdf.js';
import { readFormFieldsTool as readFormFields } from '../src/tools/read-form-fields.js';
import { updateMetadata } from '../src/tools/update-metadata.js';
import { validatePdf } from '../src/tools/validate-pdf.js';
import type { OutputResult } from '../src/output.js';
import { j2kBase64, jp2Base64 } from './_jpx.js';
import { assertValidPdf } from './_pdf-assert.js';

const PINNED = '2026-01-15T09:00:00Z';
const latin1 = (out: { base64?: string }): string => Buffer.from(out.base64!, 'base64').toString('latin1');
const bytes = (out: OutputResult): Uint8Array => new Uint8Array(Buffer.from(out.base64!, 'base64'));
const squash = (s: string): string => s.normalize('NFC').replace(/[\s​‌‍­]/gu, '');
const TEXT = [{ type: 'paragraph', text: 'Body text.' }];
const INKS = { spotColours: [{ name: 'Brand Blue', alternate: [100, 60, 0, 10] }, { name: 'Varnish', alternate: [0, 0, 0, 15] }] };

beforeAll(async () => {
    await ensureCompressionReady();
});

describe('spot colours (pdfnative 1.9.0)', () => {
    it('paints a declared spot ink and an ink mix: /Separation and /DeviceN colour spaces reach the page', async () => {
        const out = await generateBasicPdf({
            title: 'S',
            creationDate: PINNED,
            print: INKS,
            headerTemplate: { left: 'x', color: { spot: 'Brand Blue' } },
            blocks: [{ type: 'table', headers: ['a'], rows: [['b']], cellBorders: { all: true, color: { inks: { 'Brand Blue': 1, Varnish: 0.3 } } } }],
        });
        const pdf = latin1(out);
        expect(pdf).toContain('/Separation');
        expect(pdf).toContain('/DeviceN');
        expect(pdf).toContain('Brand#20Blue');
        assertValidPdf(bytes(out));
    });

    it('a tint changes the bytes, and omitted spot inputs keep the document byte-identical', async () => {
        const doc = { title: 'S', creationDate: PINNED, print: INKS, blocks: TEXT };
        const plain = await generateBasicPdf({ title: 'S', creationDate: PINNED, blocks: TEXT });
        const declaredOnly = await generateBasicPdf(doc);
        // Declaring inks nobody paints adds nothing: the page is byte-identical.
        expect(declaredOnly.base64).toBe(plain.base64);
        const solid = await generateBasicPdf({ ...doc, headerTemplate: { left: 'x', color: { spot: 'Brand Blue' } } });
        const tinted = await generateBasicPdf({ ...doc, headerTemplate: { left: 'x', color: { spot: 'Brand Blue', tint: 0.4 } } });
        expect(solid.base64).not.toBe(tinted.base64);
    });

    it('an undeclared ink is refused by name with VALIDATION_ERROR, a duplicate declaration with PRINT_ERROR', async () => {
        await expect(generateBasicPdf({ title: 'S', blocks: TEXT, headerTemplate: { left: 'x', color: { spot: 'PANTONE 300 C' } } })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
            message: expect.stringContaining("Spot colour 'PANTONE 300 C' is not declared"),
        });
        await expect(generateBasicPdf({ title: 'S', blocks: TEXT, print: { spotColours: [{ name: 'V', alternate: [0, 0, 0, 1] }, { name: 'V', alternate: [1, 2, 3] }] } })).rejects.toMatchObject({ code: 'PRINT_ERROR' });
    });

    it('every colour site of the catalogue advertises the spot and ink-mix members, JSON Schema and Zod agreeing', async () => {
        let sites = 0;
        const walk = (node: unknown): void => {
            if (node === null || typeof node !== 'object') return;
            if (Array.isArray(node)) {
                node.forEach(walk);
                return;
            }
            const anyOf = (node as { anyOf?: unknown[] }).anyOf;
            if (Array.isArray(anyOf) && anyOf.some((m) => JSON.stringify(m).includes('"spot"')) && anyOf.some((m) => JSON.stringify(m).includes('"inks"'))) sites++;
            Object.values(node).forEach(walk);
        };
        for (const tool of listToolsPayload().tools) walk(tool.inputSchema);
        expect(sites).toBeGreaterThanOrEqual(40);
        // Zod: the same shapes are accepted or refused at the boundary.
        const bad = await callToolDirect('generate_basic_pdf', { title: 'S', blocks: TEXT, print: INKS, headerTemplate: { left: 'x', color: { spot: 'Brand Blue', tint: 2 } } });
        expect(bad.isError).toBe(true);
        expect((bad.content[0] as { text: string }).text).toContain('[VALIDATION_ERROR]');
    });
});

describe('text direction and /ActualText (pdfnative 1.9.0)', () => {
    const ARABIC = 'مرحبا بالعالم';

    it('direction:auto lays an Arabic paragraph out right-to-left and the untagged text extracts in logical order', async () => {
        const auto = await addInternationalText({ title: 'D', lang: 'ar', paragraphs: [ARABIC], direction: 'auto', creationDate: PINNED });
        const forcedLtr = await addInternationalText({ title: 'D', lang: 'ar', paragraphs: [ARABIC], direction: 'ltr', creationDate: PINNED });
        expect(auto.base64).not.toBe(forcedLtr.base64);
        expect(latin1(auto)).toContain('/ActualText');
        expect(squash((await extractText({ pdfBase64: auto.base64! })).fullText)).toContain(squash(ARABIC));
    });

    it('a paragraph direction overrides the document direction, and an omitted direction keeps the 1.7.0 bytes', async () => {
        const doc = { title: 'D', embedFonts: true, creationDate: PINNED };
        const omitted = await generateBasicPdf({ ...doc, blocks: TEXT });
        const again = await generateBasicPdf({ ...doc, blocks: TEXT });
        expect(omitted.base64).toBe(again.base64);
        const docRtl = await generateBasicPdf({ ...doc, blocks: TEXT, direction: 'rtl' });
        const paraLtr = await generateBasicPdf({ ...doc, blocks: [{ type: 'paragraph', text: 'Body text.', direction: 'ltr' }], direction: 'rtl' });
        expect(docRtl.base64).not.toBe(omitted.base64);
        expect(paraLtr.base64).not.toBe(docRtl.base64);
        expect(paraLtr.base64).toBe(omitted.base64);
    });

    it('actualText:false restores the bare glyph runs of 1.7.0 on untagged right-to-left output', async () => {
        const spans = await addInternationalText({ title: 'D', lang: 'ar', paragraphs: [ARABIC], creationDate: PINNED });
        const bare = await addInternationalText({ title: 'D', lang: 'ar', paragraphs: [ARABIC], actualText: false, creationDate: PINNED });
        expect(latin1(spans)).toContain('/ActualText');
        expect(latin1(bare)).not.toContain('/ActualText');
    });

    it('inspect_layout takes direction and actualText, the same inputs as generate_basic_pdf', async () => {
        const layout = await inspectLayout({ title: 'D', blocks: TEXT, direction: 'rtl', actualText: false });
        expect(layout.totalPages).toBe(1);
        const schema = listToolsPayload().tools.find((t) => t.name === 'inspect_layout')!.inputSchema as unknown as { properties: Record<string, unknown> };
        expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['direction', 'actualText']));
    });
});

describe('JPEG 2000 (pdfnative 1.9.0)', () => {
    it('embed_image accepts a JP2 file and a raw codestream as image/jp2 and writes /JPXDecode', async () => {
        for (const payload of [jp2Base64(3), j2kBase64(1)]) {
            const out = await embedImage({ title: 'J', imageBase64: payload, mimeType: 'image/jp2', creationDate: PINNED });
            expect(latin1(out)).toContain('/JPXDecode');
            assertValidPdf(bytes(out));
        }
    });

    it('rejects bytes that are not JPEG 2000 under image/jp2, and JP2 bytes declared as JPEG', async () => {
        await expect(embedImage({ title: 'J', imageBase64: Buffer.from('GIF89a-not-an-image!').toString('base64'), mimeType: 'image/jp2' })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
            message: expect.stringContaining("does not match mimeType 'image/jp2'"),
        });
        await expect(embedImage({ title: 'J', imageBase64: jp2Base64(3), mimeType: 'image/jpeg' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('an image block and an image watermark take JPEG 2000 too', async () => {
        const block = await generateBasicPdf({ title: 'J', creationDate: PINNED, blocks: [{ type: 'image', imageBase64: jp2Base64(3), mimeType: 'image/jp2', width: 40 }] });
        expect(latin1(block)).toContain('/JPXDecode');
        const watermark = await generateBasicPdf({ title: 'J', creationDate: PINNED, blocks: TEXT, watermark: { image: { imageBase64: jp2Base64(1), mimeType: 'image/jp2' } } });
        expect(latin1(watermark)).toContain('/JPXDecode');
    });
});

describe('chart series (pdfnative 1.9.0)', () => {
    it('colors gives one colour per bar and an unlabelled series renders as Series N', async () => {
        const out = await addChart({
            title: 'C',
            chartType: 'bar',
            categories: ['a', 'b', 'c'],
            series: [{ label: 'Named', values: [1, 2, 3], colors: ['#ff0000', '#00ff00', '#0000ff'] }, { values: [3, 2, 1] }],
            creationDate: PINNED,
        });
        assertValidPdf(bytes(out));
        const text = (await extractText({ pdfBase64: out.base64! })).fullText;
        expect(text).toContain('Series 2');
        const plain = await addChart({ title: 'C', chartType: 'bar', categories: ['a', 'b', 'c'], series: [{ label: 'Named', values: [1, 2, 3] }, { values: [3, 2, 1] }], creationDate: PINNED });
        expect(plain.base64).not.toBe(out.base64);
    });

    it('a colors array whose length differs from values is CHART_ERROR with the engine remedy', async () => {
        await expect(addChart({ title: 'C', chartType: 'bar', series: [{ values: [1, 2, 3], colors: ['#ff0000'] }] })).rejects.toMatchObject({ code: 'CHART_ERROR' });
    });
});

describe('link annotations (pdfnative 1.9.0)', () => {
    it('annotate_pdf type:link writes /Link + /URI, listed by inspect_pdf annotations:true', async () => {
        const source = await generateBasicPdf({ title: 'L', blocks: TEXT, creationDate: PINNED });
        const out = await annotatePdf({ pdfBase64: source.base64!, annotations: [{ page: 0, type: 'link', rect: [36, 700, 300, 720], url: 'https://pdfnative.dev/' }] });
        const pdf = latin1(out);
        expect(pdf).toContain('/Subtype /Link');
        expect(pdf).toContain('/URI');
        const inspected = await inspectPdf({ pdfBase64: out.base64!, annotations: true });
        expect((inspected as unknown as { annotations: Array<{ subtype: string }> }).annotations.map((a) => a.subtype)).toContain('Link');
    });

    it('a link without url, or with a scheme outside http(s) / mailto, is VALIDATION_ERROR', async () => {
        const source = await generateBasicPdf({ title: 'L', blocks: TEXT, creationDate: PINNED });
        await expect(annotatePdf({ pdfBase64: source.base64!, annotations: [{ page: 0, type: 'link', rect: [0, 0, 10, 10] }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(annotatePdf({ pdfBase64: source.base64!, annotations: [{ page: 0, type: 'link', rect: [0, 0, 10, 10], url: 'javascript:alert(1)' }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        // A scheme without an authority or an address is not a link either.
        for (const url of ['https:', 'http:foo', 'mailto:', 'mailto:nobody']) {
            await expect(annotatePdf({ pdfBase64: source.base64!, annotations: [{ page: 0, type: 'link', rect: [0, 0, 10, 10], url }] }), url).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        }
        await expect(annotatePdf({ pdfBase64: source.base64!, annotations: [{ page: 0, type: 'link', rect: [0, 0, 10, 10], url: 'mailto:someone@example.com' }] })).resolves.toBeDefined();
    });
});

describe('fonts and layout (pdfnative 1.9.0)', () => {
    it('an embedded subset carries the six-letter tag of ISO 32000-1 §9.6.4 (C21)', async () => {
        const out = await generateBasicPdf({ title: 'F', blocks: TEXT, embedFonts: true, creationDate: PINNED });
        expect(latin1(out)).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans/);
    });

    it('a table of contents longer than its page paginates, and inspect_layout agrees with the build', async () => {
        const blocks = [{ type: 'toc' as const }, ...Array.from({ length: 90 }, (_, i) => ({ type: 'heading' as const, text: `Section ${i + 1}`, level: 1 as const }))];
        const built = await generateBasicPdf({ title: 'T', blocks, creationDate: PINNED });
        const pages = (await inspectPdf({ pdfBase64: built.base64! })).pageCount;
        const layout = await inspectLayout({ title: 'T', blocks });
        expect(pages).toBeGreaterThan(2);
        expect(layout.totalPages).toBe(pages);
    });

    it('a table whose rows hold deep descenders builds, stays valid, and inspect_layout agrees with the build', async () => {
        // The row-height fix (#80) is the engine's; the server transmits the table block
        // unchanged, so the proof here is the path: the same rows through the build and
        // through the dry run give one page count, and the document stays valid.
        const rows = Array.from({ length: 60 }, (_, i) => [`Row ${i + 1}`, 'gjpqy — Çğş ÿ', 'Typography: descenders reserved']);
        const blocks = [{ type: 'table' as const, headers: ['#', 'Glyphs', 'Note'], rows }];
        const built = await generateBasicPdf({ title: 'R', blocks, creationDate: PINNED });
        assertValidPdf(bytes(built));
        const pages = (await inspectPdf({ pdfBase64: built.base64! })).pageCount;
        const layout = await inspectLayout({ title: 'R', blocks });
        expect(pages).toBeGreaterThan(1);
        expect(layout.totalPages).toBe(pages);
    });
});

describe('PDF text strings (pdfnative 1.9.0, #85)', () => {
    const VALUE = 'Zürich — Ωmega 漢字';

    // A non-Latin-1 FORM value does not round-trip yet (the engine writes the low
    // bytes under needAppearances): pinned in tests/upstream-limits.test.ts.

    it('add_form writes a non-Latin-1 field name (/T) that read_form_fields reads back', async () => {
        const form = await addForm({ title: 'F', fields: [{ fieldType: 'text', name: VALUE, label: 'City' }] });
        const fields = (await readFormFields({ pdfBase64: form.base64! })) as unknown as { fields: Array<{ name: string }> };
        expect(fields.fields.map((f) => f.name)).toContain(VALUE);
    });

    it('update_metadata writes a non-Latin-1 title that inspect_pdf reads back', async () => {
        const source = await generateBasicPdf({ title: 'M', blocks: TEXT, creationDate: PINNED });
        const updated = await updateMetadata({ pdfBase64: source.base64!, title: VALUE, modDate: PINNED });
        const info = (await inspectPdf({ pdfBase64: updated.base64! })) as { info: { Title?: string } };
        expect(info.info.Title).toBe(VALUE);
    });
});

describe('validate_pdf (pdfnative 1.9.0)', () => {
    it('the PDF/X caveats no longer claim that colour inside XObjects and images is unchecked', async () => {
        const source = await generateBasicPdf({ title: 'V', blocks: TEXT, creationDate: PINNED });
        const result = (await validatePdf({ pdfBase64: source.base64!, standard: 'pdf-x-4' })) as unknown as { caveats: string[] };
        expect(result.caveats.join(' ')).not.toMatch(/Not checked: colour inside Form XObjects/);
        expect(result.caveats.join(' ')).toContain('Separation / DeviceN');
    });
});
