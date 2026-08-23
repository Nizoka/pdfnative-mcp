/**
 * The seven composable blocks `generate_basic_pdf` gained so that one call can
 * produce a document mixing prose with tables, images, links, a printed table
 * of contents, barcodes, SVG drawings and form fields — every DocumentBlock
 * kind the engine offers. Each block shares its schema with the dedicated tool
 * (add_table, embed_image, add_barcode, add_form), so the assertions here are
 * about composition, boundary validation and PDF/A interactions.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { openPdf } from 'pdfnative';

import { IMAGE_BYTE_BUDGET } from '../src/image.js';
import { ensureCompressionReady, listToolsPayload } from '../src/server.js';
import { addForm } from '../src/tools/add-form.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { assertValidPdf } from './_pdf-assert.js';

const JPEG =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAARC' +
    'AABAAEDASIA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/a' +
    'AAwDAQACEQMRAD8AJQAB/9k=';

function latin1(base64: string | undefined): string {
    return Buffer.from(base64 ?? '', 'base64').toString('latin1');
}

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

describe('generate_basic_pdf — extended blocks (catalogue)', () => {
    it('advertises all thirteen block kinds and keeps additionalProperties:false on each', () => {
        const tool = listToolsPayload().tools.find((t) => t.name === 'generate_basic_pdf')!;
        const items = (tool.inputSchema as unknown as { properties: { blocks: { items: { oneOf: Array<{ properties: { type: { const: string } }; additionalProperties: boolean }> } } } }).properties.blocks.items.oneOf;
        expect(items.map((m) => m.properties.type.const).sort()).toEqual(
            ['barcode', 'chart', 'formField', 'heading', 'image', 'link', 'list', 'pageBreak', 'paragraph', 'spacer', 'svg', 'table', 'toc'].sort(),
        );
        expect(items.every((m) => m.additionalProperties === false)).toBe(true);
    });

    it('rejects unknown keys inside any block (strict Zod ⇔ additionalProperties:false)', async () => {
        await expect(generateBasicPdf({ title: 'T', blocks: [{ type: 'link', text: 'x', url: 'https://a.b', colour: '#000' }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('generate_basic_pdf — one document mixing every block kind', () => {
    it('renders prose + table + image + link + toc + barcode + svg + formField + chart in one PDF', async () => {
        const out = await generateBasicPdf({
            title: 'Composite',
            blocks: [
                { type: 'toc', title: 'Contents', maxLevel: 2 },
                { type: 'heading', text: 'Figures', level: 1 },
                { type: 'paragraph', text: 'A document that mixes everything.' },
                { type: 'table', headers: ['Item', 'Qty'], rows: [['Widget', '2'], ['Gadget', '5']], zebra: true, caption: 'Stock' },
                { type: 'image', imageBase64: JPEG, mimeType: 'image/jpeg', width: 60, height: 60, align: 'center', alt: 'A dot' },
                { type: 'link', text: 'Project home', url: 'https://github.com/Nizoka/pdfnative-mcp', color: '#1a73e8' },
                { type: 'heading', text: 'Codes', level: 2 },
                { type: 'barcode', format: 'qr', data: 'https://example.com', width: 120, align: 'right' },
                { type: 'svg', data: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#ff0000"/></svg>', width: 80, height: 80, alt: 'Red disc' },
                { type: 'formField', fieldType: 'text', name: 'reader', label: 'Your name' },
                { type: 'chart', chartType: 'bar', series: [{ label: 's', values: [1, 2, 3] }] },
            ],
            creationDate: '2026-01-15T09:00:00Z',
        });
        assertValidPdf(out.base64!);
        const text = latin1(out.base64);
        expect(text).toContain('/URI');                 // link annotation
        expect(text).toContain('/Subtype /Image');      // image XObject
        expect(text).toContain('/AcroForm');            // form field
        expect(text).toContain('/Dests');               // toc destinations
        expect(text).toMatch(/toc_h_0/);
        // Byte-identical for identical inputs once the clock is pinned.
        const again = await generateBasicPdf({ title: 'Composite', blocks: [{ type: 'table', headers: ['a'], rows: [['1']] }, { type: 'link', text: 'x', url: 'mailto:a@b.c' }], creationDate: '2026-01-15T09:00:00Z' });
        const again2 = await generateBasicPdf({ title: 'Composite', blocks: [{ type: 'table', headers: ['a'], rows: [['1']] }, { type: 'link', text: 'x', url: 'mailto:a@b.c' }], creationDate: '2026-01-15T09:00:00Z' });
        expect(again.base64).toBe(again2.base64);
    });

    it('paginates a long inline table across pages and keeps the document valid', async () => {
        const rows = Array.from({ length: 120 }, (_, i) => [`Row ${i}`, String(i * 2)]);
        const out = await generateBasicPdf({ title: 'Long', blocks: [{ type: 'paragraph', text: 'Intro' }, { type: 'table', headers: ['Name', 'Value'], rows, repeatHeader: true }] });
        const pages = assertValidPdf(out.base64!, 2);
        expect(pages).toBeGreaterThanOrEqual(2);
    });
});

describe('generate_basic_pdf — block boundary validation (every failure names the block)', () => {
    const base = { title: 'V' };

    it('table: row length mismatch → VALIDATION_ERROR naming blocks[i]', async () => {
        await expect(generateBasicPdf({ ...base, blocks: [{ type: 'paragraph', text: 'x' }, { type: 'table', headers: ['a', 'b'], rows: [['1']] }] })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
            message: expect.stringMatching(/blocks\[1\].*Row 0 has 1 cell\(s\) but headers defines 2/),
        });
    });

    it('link: only http(s) and mailto are accepted, before the engine runs', async () => {
        for (const url of ['javascript:alert(1)', 'ftp://x/y', 'file:///etc/passwd', 'https://ok.example/bell']) {
            await expect(generateBasicPdf({ ...base, blocks: [{ type: 'link', text: 'x', url }] }), url).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('blocks[0]') });
        }
    });

    it('barcode: EAN-13 payload rule is applied per block', async () => {
        await expect(generateBasicPdf({ ...base, blocks: [{ type: 'barcode', format: 'ean13', data: 'abc' }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('12 or 13 digits') });
    });

    it('image: MIME/magic mismatch and the per-call byte budget', async () => {
        await expect(generateBasicPdf({ ...base, blocks: [{ type: 'image', imageBase64: JPEG, mimeType: 'image/png' }] })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
            message: expect.stringContaining("blocks[0].imageBase64 does not match mimeType 'image/png'"),
        });
        // Three fake JPEG bodies (valid magic bytes, otherwise zeros) of ~8.5 MiB each: the third
        // one crosses the 24 MiB per-call budget while every single one stays under the field cap.
        const big = Buffer.alloc(Math.floor(IMAGE_BYTE_BUDGET / 3) + 512 * 1024);
        big[0] = 0xff;
        big[1] = 0xd8;
        const img = { type: 'image', imageBase64: big.toString('base64'), mimeType: 'image/jpeg' };
        await expect(generateBasicPdf({ ...base, blocks: [img, img, img] })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
            message: expect.stringMatching(/blocks\[2\]\.imageBase64.*over the \d+-byte budget/),
        });
    }, 60_000);

    it('formField: choice fields need options; unknown fieldType rejected', async () => {
        await expect(generateBasicPdf({ ...base, blocks: [{ type: 'formField', fieldType: 'dropdown', name: 'd' }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining("requires at least one option") });
        await expect(generateBasicPdf({ ...base, blocks: [{ type: 'formField', fieldType: 'signature', name: 's' }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('svg: data length cap and colour syntax are enforced by the schema', async () => {
        await expect(generateBasicPdf({ ...base, blocks: [{ type: 'svg', data: 'M0 0L1 1'.repeat(20_000) }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(generateBasicPdf({ ...base, blocks: [{ type: 'svg', data: 'M0 0L1 1', fill: 'red' }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('generate_basic_pdf — PDF/A interactions of the new blocks', () => {
    it('formField under pdfA reports PDFA_UNEMBEDDED_FORM_FONT and strict:true fails the call', async () => {
        const out = await generateBasicPdf({ title: 'F', blocks: [{ type: 'formField', fieldType: 'text', name: 'n' }], pdfA: 'pdfa2b', embedFonts: true, includeDiagnostics: true });
        expect(out.diagnostics?.some((d) => d.code === 'PDFA_UNEMBEDDED_FORM_FONT')).toBe(true);
        await expect(generateBasicPdf({ title: 'F', blocks: [{ type: 'formField', fieldType: 'text', name: 'n' }], pdfA: 'pdfa2b', embedFonts: true, strict: true })).rejects.toMatchObject({ code: 'PDF_A_COMPLIANCE_VIOLATION' });
    });

    it('svg, toc, link, barcode and table are clean under pdfa2b + embedFonts (no diagnostics)', async () => {
        const out = await generateBasicPdf({
            title: 'Clean',
            blocks: [
                { type: 'heading', text: 'H', level: 1 },
                { type: 'toc' },
                { type: 'table', headers: ['a'], rows: [['1']], clipCells: true },
                { type: 'link', text: 'l', url: 'https://example.com' },
                { type: 'barcode', format: 'code128', data: 'SKU-1' },
                { type: 'svg', data: 'M0 0 L10 0 L10 10 Z', viewBox: [0, 0, 10, 10], alt: 'triangle' },
            ],
            pdfA: 'pdfa2b',
            embedFonts: true,
            includeDiagnostics: true,
            strict: true,
        });
        expect(out.diagnostics).toEqual([]);
        const reader = openPdf(Buffer.from(out.base64!, 'base64'));
        expect(reader.pageCount).toBeGreaterThanOrEqual(1);
    });
});

describe('add_form — textarea maps to the engine multiline field', () => {
    it("sets the /Ff multiline bit for fieldType:'textarea' (previously passed through unmapped)", async () => {
        const out = await addForm({ title: 'F', fields: [{ fieldType: 'textarea', name: 'notes', label: 'Notes' }] });
        const text = latin1(out.base64);
        // FF_MULTILINE is bit 13 (value 4096); the engine ORs it into /Ff for multilineText.
        expect(text).toMatch(/\/Ff\s+4096/);
    });

    it('accepts listbox and placeholder on the shared field fragment', async () => {
        const out = await addForm({ title: 'F', fields: [{ fieldType: 'listbox', name: 'l', options: ['a', 'b'], placeholder: 'pick' }] });
        assertValidPdf(out.base64!);
    });
});
