/**
 * Tests for `merge_pdfs` (pdfnative v1.4 page-tree API wrapper).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { mergePdfsTool } from '../src/tools/merge-pdfs.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';
import { makePdfBase64, makeEncryptedPdfBase64 } from './_pagetree-fixtures.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

describe('merge_pdfs', () => {
    beforeAll(async () => {
        delete process.env[ENV_KEY];
        await ensureCompressionReady();
    });

    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it('concatenates two PDFs into one with the combined page count', async () => {
        const a = await makePdfBase64(2, 'A');
        const b = await makePdfBase64(3, 'B');
        const result = await mergePdfsTool({ pdfsBase64: [a, b] });
        expect(result.mode).toBe('base64');
        const pages = assertValidPdf(result.base64 as string);
        expect(pages).toBe(5);
    });

    it('accepts dropAnnotations and still produces a valid PDF', async () => {
        const a = await makePdfBase64(1, 'A');
        const b = await makePdfBase64(1, 'B');
        const result = await mergePdfsTool({ pdfsBase64: [a, b], dropAnnotations: true });
        assertValidPdf(result.base64 as string, 2);
    });

    it('rejects fewer than two sources', async () => {
        const a = await makePdfBase64(1, 'A');
        await expect(mergePdfsTool({ pdfsBase64: [a] })).rejects.toThrow(ToolError);
    });

    it('rejects more than fifty sources', async () => {
        const a = await makePdfBase64(1, 'A');
        const many = Array.from({ length: 51 }, () => a);
        await expect(mergePdfsTool({ pdfsBase64: many })).rejects.toThrow(ToolError);
    });

    it('rejects an encrypted source with ENCRYPTED_SOURCE', async () => {
        const a = await makePdfBase64(1, 'A');
        const enc = makeEncryptedPdfBase64();
        await expect(mergePdfsTool({ pdfsBase64: [a, enc] })).rejects.toMatchObject({
            code: 'ENCRYPTED_SOURCE',
        });
    });

    it('enforces a tiny maxOutputSizeBytes with OUTPUT_TOO_LARGE', async () => {
        const a = await makePdfBase64(2, 'A');
        const b = await makePdfBase64(2, 'B');
        await expect(mergePdfsTool({ pdfsBase64: [a, b], maxOutputSizeBytes: 64 })).rejects.toMatchObject({
            code: 'OUTPUT_TOO_LARGE',
        });
    });

    it('writes to a sandboxed file when outputMode=file', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-merge-'));
        process.env[ENV_KEY] = dir;
        const a = await makePdfBase64(1, 'A');
        const b = await makePdfBase64(1, 'B');
        const result = await mergePdfsTool({ pdfsBase64: [a, b], outputMode: 'file', outputPath: 'merged.pdf' });
        expect(result.mode).toBe('file');
        expect(result.filePath?.startsWith(dir)).toBe(true);
        const bytes = await fs.readFile(result.filePath as string);
        assertValidPdf(new Uint8Array(bytes), 2);
    });
});
