import { describe, it, expect, beforeAll } from 'vitest';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { addBarcode } from '../src/tools/add-barcode.js';
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

describe('generate_basic_pdf', () => {
    it('produces a valid PDF from minimal blocks', async () => {
        const result = await generateBasicPdf({
            title: 'Hello',
            blocks: [
                { type: 'heading', text: 'Hello world', level: 1 },
                { type: 'paragraph', text: 'This is a test PDF.' },
            ],
        });
        expect(result.mode).toBe('base64');
        expect(result.sizeBytes).toBeGreaterThan(100);
        assertValidPdf(result.base64!);
    });

    it('rejects invalid inputs', async () => {
        await expect(generateBasicPdf({ title: '', blocks: [] })).rejects.toThrow(ToolError);
        await expect(generateBasicPdf({ title: 'X' })).rejects.toThrow(ToolError);
    });

    it('handles all supported block variants', async () => {
        const result = await generateBasicPdf({
            title: 'Variants',
            blocks: [
                { type: 'heading', text: 'Top', level: 1 },
                { type: 'list', style: 'numbered', items: ['a', 'b'] },
                { type: 'spacer', height: 24 },
                { type: 'pageBreak' },
                { type: 'paragraph', text: 'after break' },
            ],
            footerText: 'footer',
        });

        expect(result.mode).toBe('base64');
        expect(decode(result.base64!)).toBe(PDF_HEADER);
    });

    it('auto-splits paragraphs containing embedded newlines (Safe PDF/A)', async () => {
        const result = await generateBasicPdf({
            title: 'Address',
            blocks: [{ type: 'paragraph', text: 'Acme Corp\n123 Main St\nSpringfield' }],
            pdfA: 'pdfa2b',
        });
        expect(result.mode).toBe('base64');
        expect(decode(result.base64!)).toBe(PDF_HEADER);
        expect(result.sizeBytes).toBeGreaterThan(100);
    });

    it('rejects input that sanitises to zero renderable blocks', async () => {
        await expect(
            generateBasicPdf({ title: 'Empty', blocks: [{ type: 'paragraph', text: '\n\n' }] }),
        ).rejects.toThrow(ToolError);
    });
});

describe('add_barcode', () => {
    it('produces a QR PDF', async () => {
        const result = await addBarcode({
            format: 'qr',
            data: 'https://example.com',
            caption: 'Scan me',
        });
        expect(result.mode).toBe('base64');
        assertValidPdf(result.base64!);
    });

    it('validates EAN-13 length', async () => {
        await expect(addBarcode({ format: 'ean13', data: 'abc' })).rejects.toThrow(ToolError);
    });

    it('produces a PDF for a non-QR format without a caption', async () => {
        const result = await addBarcode({ format: 'code128', data: 'HELLO-123' });
        expect(result.mode).toBe('base64');
        expect(decode(result.base64!)).toBe(PDF_HEADER);
    });

    it('applies pdfA flag to barcode documents', async () => {
        const result = await addBarcode({ format: 'qr', data: 'pdfA test', pdfA: 'pdfa2b' });
        expect(result.mode).toBe('base64');
        expect(decode(result.base64!)).toBe(PDF_HEADER);
    });
});
