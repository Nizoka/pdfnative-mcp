import { describe, it, expect, beforeAll } from 'vitest';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { addBarcode } from '../src/tools/add-barcode.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MPC_OUTPUT_DIR'];
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
        expect(decode(result.base64!)).toBe(PDF_HEADER);
    });

    it('rejects invalid inputs', async () => {
        await expect(generateBasicPdf({ title: '', blocks: [] })).rejects.toThrow(ToolError);
        await expect(generateBasicPdf({ title: 'X' })).rejects.toThrow(ToolError);
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
        expect(decode(result.base64!)).toBe(PDF_HEADER);
    });

    it('validates EAN-13 length', async () => {
        await expect(addBarcode({ format: 'ean13', data: 'abc' })).rejects.toThrow(ToolError);
    });
});
