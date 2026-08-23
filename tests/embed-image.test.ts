import { describe, it, expect, beforeAll } from 'vitest';
import { embedImage } from '../src/tools/embed-image.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

/**
 * Minimal valid 1×1 white JPEG (generated offline, embedded as base64).
 * Magic bytes: FF D8 FF E0 ...
 */
const MINIMAL_JPEG_BASE64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAARC' +
    'AABAAEDASIA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/a' +
    'AAwDAQACEQMRAD8AJQAB/9k=';

/**
 * Minimal valid 1×1 red PNG.
 * Magic bytes: 89 50 4E 47 0D 0A 1A 0A
 */
const MINIMAL_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';

describe('embed_image', () => {
    it('embeds a JPEG image and produces a valid PDF', async () => {
        const result = await embedImage({
            title: 'Photo Report',
            imageBase64: MINIMAL_JPEG_BASE64,
            mimeType: 'image/jpeg',
            caption: 'A sample image',
        });
        expect(result.mode).toBe('base64');
        expect(result.sizeBytes).toBeGreaterThan(100);
        assertValidPdf(result.base64!);
    });

    it('wraps pdfnative image errors as ToolError (e.g. alpha-channel PNG not supported)', async () => {
        // The minimal PNG used here has an alpha channel (color type 6), which pdfnative does not support.
        // The tool must wrap this as a ToolError with a descriptive message.
        await expect(
            embedImage({
                title: 'PNG Report',
                imageBase64: MINIMAL_PNG_BASE64,
                mimeType: 'image/png',
                width: 100,
                height: 100,
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects JPEG bytes declared as PNG', async () => {
        await expect(
            embedImage({
                title: 'Bad mime',
                imageBase64: MINIMAL_JPEG_BASE64,
                mimeType: 'image/png',
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects PNG bytes declared as JPEG', async () => {
        await expect(
            embedImage({
                title: 'Bad mime',
                imageBase64: MINIMAL_PNG_BASE64,
                mimeType: 'image/jpeg',
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects invalid base64', async () => {
        await expect(
            embedImage({
                title: 'Invalid',
                imageBase64: '!!!not_base64!!!',
                mimeType: 'image/jpeg',
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects missing required fields', async () => {
        await expect(embedImage({ title: 'T', mimeType: 'image/jpeg' })).rejects.toThrow(ToolError);
        await expect(embedImage({ imageBase64: MINIMAL_JPEG_BASE64 })).rejects.toThrow(ToolError);
    });
});

describe('embed_image print + diagnostics inputs (v1.6.0)', () => {
    const IMG = { title: 'Img', imageBase64: MINIMAL_JPEG_BASE64, mimeType: 'image/jpeg' } as const;

    it('embedFonts + pdfA + includeDiagnostics yields a valid PDF with no font diagnostic', async () => {
        const result = await embedImage({ ...IMG, caption: 'A caption', embedFonts: true, pdfA: 'pdfa2b', includeDiagnostics: true });
        assertValidPdf(result.base64!);
        expect(result.diagnostics!.map((d) => d.code)).not.toContain('PDFA_NO_FONT_ENTRIES');
    });

    it('strict + pdfA without embedFonts keeps the PDF_A_COMPLIANCE_VIOLATION code (not VALIDATION_ERROR)', async () => {
        await expect(embedImage({ ...IMG, pdfA: 'pdfa2b', strict: true })).rejects.toMatchObject({ code: 'PDF_A_COMPLIANCE_VIOLATION' });
    });

    it('print bleed + metadata reach the output', async () => {
        const result = await embedImage({ ...IMG, print: { bleed: 8.5 }, metadata: { author: 'A' } });
        const text = Buffer.from(result.base64!, 'base64').toString('latin1');
        expect(text).toContain('/TrimBox');
        expect(text).toContain('/Author (A)');
    });

    it('marks without a TrimBox surfaces as PRINT_ERROR', async () => {
        await expect(embedImage({ ...IMG, print: { marks: true } })).rejects.toMatchObject({ code: 'PRINT_ERROR' });
    });
});
