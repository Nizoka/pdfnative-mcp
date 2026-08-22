/**
 * Tests for `add_barcode` — dedicated coverage across all five symbologies
 * (previously only folded into tools.test.ts).
 */
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { addBarcode } from '../src/tools/add-barcode.js';
import { ensureCompressionReady } from '../src/server.js';
import { assertValidPdf } from './_pdf-assert.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

describe('add_barcode', () => {
    beforeAll(async () => {
        delete process.env[ENV_KEY];
        await ensureCompressionReady();
    });
    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it('renders a QR code from a URL', async () => {
        const out = await addBarcode({ format: 'qr', data: 'https://example.com', caption: 'Scan me' });
        expect(out.mode).toBe('base64');
        assertValidPdf(out.base64 as string, 1);
    });

    it('renders a QR code with high error correction', async () => {
        const out = await addBarcode({ format: 'qr', data: 'https://example.com/x', ecLevel: 'H' });
        assertValidPdf(out.base64 as string, 1);
    });

    it('renders a Code 128 barcode', async () => {
        const out = await addBarcode({ format: 'code128', data: 'SKU-2025-001', title: 'Label' });
        assertValidPdf(out.base64 as string, 1);
    });

    it('renders an EAN-13 barcode (12 digits, check digit auto-computed)', async () => {
        const out = await addBarcode({ format: 'ean13', data: '400638133393' });
        assertValidPdf(out.base64 as string, 1);
    });

    it('renders a Data Matrix barcode', async () => {
        const out = await addBarcode({ format: 'datamatrix', data: 'AER-123-XYZ' });
        assertValidPdf(out.base64 as string, 1);
    });

    it('renders a PDF417 barcode', async () => {
        const out = await addBarcode({ format: 'pdf417', data: 'BOARDING-PASS-DATA' });
        assertValidPdf(out.base64 as string, 1);
    });

    it('renders a PDF/A-2b barcode document', async () => {
        const out = await addBarcode({ format: 'qr', data: 'https://example.com', pdfA: 'pdfa2b' });
        assertValidPdf(out.base64 as string, 1);
    });

    it('rejects a bad EAN-13 payload', async () => {
        await expect(addBarcode({ format: 'ean13', data: 'not-digits' })).rejects.toBeTruthy();
    });

    it('rejects a missing format with VALIDATION_ERROR', async () => {
        await expect(addBarcode({ data: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('writes to a sandboxed file when outputMode=file', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-barcode-'));
        process.env[ENV_KEY] = dir;
        const out = await addBarcode({ format: 'qr', data: 'https://example.com', outputMode: 'file', outputPath: 'qr.pdf' });
        expect(out.mode).toBe('file');
        const bytes = await fs.readFile(out.filePath as string);
        assertValidPdf(new Uint8Array(bytes), 1);
    });
});

describe('add_barcode print + diagnostics inputs (v1.6.0)', () => {
    it('embedFonts + pdfA + includeDiagnostics yields a valid PDF with no font diagnostic', async () => {
        const result = await addBarcode({ format: 'qr', data: 'https://example.com', caption: 'Scan me', embedFonts: true, pdfA: 'pdfa2b', includeDiagnostics: true });
        assertValidPdf(result.base64 as string);
        expect(result.diagnostics!.map((d) => d.code)).not.toContain('PDFA_NO_FONT_ENTRIES');
    });

    it('strict + pdfA without embedFonts is rejected with PDF_A_COMPLIANCE_VIOLATION', async () => {
        await expect(addBarcode({ format: 'qr', data: 'x', pdfA: 'pdfa2b', strict: true })).rejects.toMatchObject({ code: 'PDF_A_COMPLIANCE_VIOLATION' });
    });

    it('print bleed + metadata reach the output', async () => {
        const result = await addBarcode({ format: 'qr', data: 'x', print: { bleed: 8.5 }, metadata: { keywords: 'qr' } });
        const text = Buffer.from(result.base64 as string, 'base64').toString('latin1');
        expect(text).toContain('/TrimBox');
        expect(text).toContain('/Keywords (qr)');
    });
});
