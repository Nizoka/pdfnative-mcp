/**
 * Tests for `annotate_pdf` (pdfnative v1.5 annotation-writer wrapper).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { annotatePdf } from '../src/tools/annotate-pdf.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';
import { makePdfBase64, makeEncryptedPdfBase64 } from './_pagetree-fixtures.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

describe('annotate_pdf', () => {
    beforeAll(async () => {
        delete process.env[ENV_KEY];
        await ensureCompressionReady();
    });

    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it('adds a highlight annotation and keeps the page count', async () => {
        const src = await makePdfBase64(1, 'Doc');
        const result = await annotatePdf({
            pdfBase64: src,
            annotations: [{ page: 0, type: 'highlight', rect: [72, 700, 300, 720], color: '#ffe600', contents: 'note' }],
        });
        expect(result.mode).toBe('base64');
        assertValidPdf(result.base64 as string, 1);
        // Incremental update grows the file.
        expect(result.sizeBytes).toBeGreaterThan(0);
    });

    it('supports every annotation type in a single call', async () => {
        const src = await makePdfBase64(2, 'Doc');
        const result = await annotatePdf({
            pdfBase64: src,
            annotations: [
                { page: 0, type: 'text', rect: [520, 700, 540, 720], contents: 'note', icon: 'Note', open: false },
                { page: 0, type: 'highlight', rect: [72, 700, 300, 720], quadPoints: [72, 720, 300, 720, 72, 700, 300, 700] },
                { page: 0, type: 'underline', rect: [72, 680, 300, 690] },
                { page: 0, type: 'strikeout', rect: [72, 660, 300, 670] },
                { page: 0, type: 'squiggly', rect: [72, 640, 300, 650] },
                { page: 1, type: 'square', rect: [72, 500, 300, 560], color: [0.8, 0, 0], interiorColor: '#ffeeee', borderWidth: 2 },
                { page: 1, type: 'circle', rect: [72, 400, 300, 460] },
                { page: 1, type: 'line', rect: [72, 300, 300, 300], start: [72, 300], end: [300, 300], borderWidth: 1 },
                { page: 1, type: 'freetext', rect: [72, 200, 300, 240], contents: 'Free text', fontSize: 11 },
            ],
        });
        assertValidPdf(result.base64 as string, 2);
    });

    it('rejects an out-of-range page index with VALIDATION_ERROR', async () => {
        const src = await makePdfBase64(1, 'Doc');
        await expect(
            annotatePdf({ pdfBase64: src, annotations: [{ page: 5, type: 'highlight', rect: [0, 0, 10, 10] }] }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it("requires 'start' and 'end' for a line annotation", async () => {
        const src = await makePdfBase64(1, 'Doc');
        await expect(
            annotatePdf({ pdfBase64: src, annotations: [{ page: 0, type: 'line', rect: [0, 0, 10, 10] }] }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects an empty annotations array', async () => {
        const src = await makePdfBase64(1, 'Doc');
        await expect(annotatePdf({ pdfBase64: src, annotations: [] })).rejects.toThrow(ToolError);
    });

    it('rejects an encrypted source with ENCRYPTED_SOURCE', async () => {
        const enc = makeEncryptedPdfBase64();
        await expect(
            annotatePdf({ pdfBase64: enc, annotations: [{ page: 0, type: 'highlight', rect: [0, 0, 10, 10] }] }),
        ).rejects.toMatchObject({ code: 'ENCRYPTED_SOURCE' });
    });

    it('rejects a malformed PDF with PDF_PARSE_FAILED', async () => {
        const notPdf = Buffer.from('this is not a pdf at all').toString('base64');
        await expect(
            annotatePdf({ pdfBase64: notPdf, annotations: [{ page: 0, type: 'highlight', rect: [0, 0, 10, 10] }] }),
        ).rejects.toMatchObject({ code: 'PDF_PARSE_FAILED' });
    });

    it('writes to a sandboxed file when outputMode=file', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-annotate-'));
        process.env[ENV_KEY] = dir;
        const src = await makePdfBase64(1, 'Doc');
        const result = await annotatePdf({
            pdfBase64: src,
            annotations: [{ page: 0, type: 'highlight', rect: [72, 700, 300, 720] }],
            outputMode: 'file',
            outputPath: 'annotated.pdf',
        });
        expect(result.mode).toBe('file');
        expect(result.filePath?.startsWith(dir)).toBe(true);
        const bytes = await fs.readFile(result.filePath as string);
        assertValidPdf(new Uint8Array(bytes), 1);
    });
});
