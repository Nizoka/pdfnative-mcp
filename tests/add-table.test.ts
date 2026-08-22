import { describe, it, expect, beforeAll } from 'vitest';
import { addTable } from '../src/tools/add-table.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

const PDF_HEADER = '%PDF-';

function decode(b64: string): string {
    return Buffer.from(b64, 'base64').toString('latin1').slice(0, 5);
}

describe('add_table', () => {
    it('produces a valid PDF from minimal table data', async () => {
        const result = await addTable({
            title: 'Sales Report',
            headers: ['Product', 'Units', 'Revenue'],
            rows: [
                ['Widget A', '100', '$1,000'],
                ['Widget B', '200', '$2,500'],
            ],
        });
        expect(result.mode).toBe('base64');
        expect(result.sizeBytes).toBeGreaterThan(100);
        assertValidPdf(result.base64!);
    });

    it('includes infoItems and footerText', async () => {
        const result = await addTable({
            title: 'Inventory',
            headers: ['Item', 'Qty'],
            rows: [['Pen', '50']],
            infoItems: [
                { label: 'Date', value: '2025-01-01' },
                { label: 'Author', value: 'Alice' },
            ],
            footerText: 'Confidential',
        });
        expect(result.mode).toBe('base64');
        expect(decode(result.base64!)).toBe(PDF_HEADER);
    });

    it('rejects mismatched row length', async () => {
        await expect(
            addTable({
                title: 'Report',
                headers: ['A', 'B', 'C'],
                rows: [['x', 'y']], // only 2 cells, but 3 headers
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects empty headers', async () => {
        await expect(
            addTable({
                title: 'Report',
                headers: [],
                rows: [['x']],
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects empty rows', async () => {
        await expect(
            addTable({
                title: 'Report',
                headers: ['Col'],
                rows: [],
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects missing required fields', async () => {
        await expect(addTable({ title: 'Report' })).rejects.toThrow(ToolError);
        await expect(addTable({})).rejects.toThrow(ToolError);
    });

    it('switches to document backend when autoFitColumns/clipCells/pdfA are set', async () => {
        const result = await addTable({
            title: 'AutoFit',
            headers: ['A', 'B'],
            rows: [['1', '2']],
            infoItems: [{ label: 'Date', value: '2025-01-01' }],
            footerText: 'Footer',
            autoFitColumns: true,
            clipCells: true,
            pdfA: 'pdfa2b',
        });
        expect(result.mode).toBe('base64');
        expect(decode(result.base64!)).toBe(PDF_HEADER);
        expect(result.sizeBytes).toBeGreaterThan(100);
    });

    it('document backend with pdfA only and no infoItems/footerText', async () => {
        const result = await addTable({
            title: 'PdfA Only',
            headers: ['X'],
            rows: [['1']],
            pdfA: 'pdfa1b',
        });
        expect(result.mode).toBe('base64');
        expect(decode(result.base64!)).toBe(PDF_HEADER);
    });

    it('accepts smart-table v1.2 fields (wrap, repeatHeader, zebra, caption, minRowHeight, cellPadding)', async () => {
        const result = await addTable({
            title: 'Smart',
            headers: ['Col1', 'Col2'],
            rows: [
                ['a', 'b'],
                ['c', 'd'],
            ],
            wrap: 'auto',
            repeatHeader: true,
            zebra: true,
            caption: 'Quarterly report',
            minRowHeight: 18,
            cellPadding: 4,
        });
        expect(result.mode).toBe('base64');
        expect(decode(result.base64!)).toBe(PDF_HEADER);
        expect(result.sizeBytes).toBeGreaterThan(100);
    });

    it('rejects invalid wrap value', async () => {
        await expect(
            addTable({
                title: 'Bad',
                headers: ['A'],
                rows: [['1']],
                wrap: 'sometimes',
            }),
        ).rejects.toThrow(ToolError);
    });

    it('renders a text watermark (forces the document backend)', async () => {
        const result = await addTable({
            title: 'Watermarked',
            headers: ['A', 'B'],
            rows: [['1', '2']],
            watermark: { text: 'CONFIDENTIAL', fontSize: 48, opacity: 0.2, angle: -30, color: [0.8, 0.1, 0.1], position: 'foreground' },
        });
        expect(result.mode).toBe('base64');
        assertValidPdf(result.base64!);
        expect(result.sizeBytes).toBeGreaterThan(100);
    });

    it('rejects an out-of-range watermark opacity', async () => {
        await expect(
            addTable({
                title: 'Bad',
                headers: ['A'],
                rows: [['1']],
                watermark: { text: 'X', opacity: 2 },
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects a semi-transparent watermark under pdfA=pdfa1b with PDF_A_COMPLIANCE_VIOLATION', async () => {
        await expect(
            addTable({
                title: 'Bad',
                headers: ['A'],
                rows: [['1']],
                pdfA: 'pdfa1b',
                watermark: { text: 'CONFIDENTIAL', opacity: 0.2 },
            }),
        ).rejects.toMatchObject({ code: 'PDF_A_COMPLIANCE_VIOLATION' });
    });

    it('allows an opaque watermark under pdfA=pdfa1b', async () => {
        const result = await addTable({
            title: 'Opaque',
            headers: ['A', 'B'],
            rows: [['1', '2']],
            pdfA: 'pdfa1b',
            watermark: { text: 'CONFIDENTIAL', opacity: 1 },
        });
        assertValidPdf(result.base64!);
    });
});

describe('add_table print + diagnostics inputs (v1.6.0)', () => {
    const TABLE = { title: 'T', headers: ['Name', 'Qty'], rows: [['Widget', '3']] } as const;
    const latin1 = (b64: string): string => Buffer.from(b64, 'base64').toString('latin1');

    it('embedFonts + pdfA + includeDiagnostics yields a valid PDF with no font diagnostic (document backend)', async () => {
        const result = await addTable({ ...TABLE, embedFonts: true, pdfA: 'pdfa2b', includeDiagnostics: true });
        assertValidPdf(result.base64!);
        expect(result.diagnostics).toBeDefined();
        expect(result.diagnostics!.map((d) => d.code)).not.toContain('PDFA_NO_FONT_ENTRIES');
    });

    it('pdfA without embedFonts reports PDFA_NO_FONT_ENTRIES', async () => {
        const result = await addTable({ ...TABLE, pdfA: 'pdfa2b', includeDiagnostics: true });
        expect(result.diagnostics!.map((d) => d.code)).toContain('PDFA_NO_FONT_ENTRIES');
    });

    it('the default buildPDFBytes backend honours print, metadata and embedFonts', async () => {
        const result = await addTable({ ...TABLE, print: { bleed: 8.5, userUnit: 2 }, metadata: { author: 'A' }, embedFonts: true, includeDiagnostics: true });
        assertValidPdf(result.base64!);
        const text = latin1(result.base64!);
        expect(text).toContain('/TrimBox');
        expect(text).toContain('/UserUnit 2');
        expect(text).toContain('/Author (A)');
        expect(result.diagnostics).toEqual([]);
    });

    it('the document backend honours print and metadata too', async () => {
        const result = await addTable({ ...TABLE, zebra: true, print: { bleed: 8.5 }, metadata: { subject: 'S' } });
        assertValidPdf(result.base64!);
        const text = latin1(result.base64!);
        expect(text).toContain('/TrimBox');
        expect(text).toContain('/Subject (S)');
    });

    it('strict + pdfA without embedFonts is rejected with PDF_A_COMPLIANCE_VIOLATION', async () => {
        await expect(addTable({ ...TABLE, pdfA: 'pdfa2b', strict: true })).rejects.toMatchObject({ code: 'PDF_A_COMPLIANCE_VIOLATION' });
    });

    it('marks without a TrimBox is a PRINT_ERROR on the default backend', async () => {
        await expect(addTable({ ...TABLE, print: { marks: true } })).rejects.toMatchObject({ code: 'PRINT_ERROR' });
    });

    it('keeps the default output byte-identical when the new fields are absent', async () => {
        const a = await addTable(TABLE);
        const b = await addTable({ ...TABLE, includeDiagnostics: false });
        expect(a.base64).toBe(b.base64);
        expect(Object.keys(a)).not.toContain('diagnostics');
    });
});

