/**
 * Tests for `extract_pages` (pdfnative v1.4 page-tree API wrapper, single output).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

import { extractPagesTool } from '../src/tools/extract-pages.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';
import { makePdfBase64, makeEncryptedPdfBase64 } from './_pagetree-fixtures.js';
import { makeEncryptedPdfBase64 as makeUserEncryptedPdfBase64 } from './_encrypted-fixtures.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

describe('extract_pages', () => {
    beforeAll(async () => {
        delete process.env[ENV_KEY];
        await ensureCompressionReady();
    });

    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it('extracts an arbitrary page subset into a single PDF', async () => {
        const src = await makePdfBase64(5, 'Doc');
        const result = await extractPagesTool({ pdfBase64: src, pages: [0, 2, 4] });
        expect(result.mode).toBe('base64');
        expect(assertValidPdf(result.base64 as string)).toBe(3);
    });

    it('preserves the requested page order (still a valid single PDF)', async () => {
        const src = await makePdfBase64(3, 'Doc');
        const result = await extractPagesTool({ pdfBase64: src, pages: [2, 0] });
        expect(assertValidPdf(result.base64 as string)).toBe(2);
    });

    it('rejects an empty pages array', async () => {
        const src = await makePdfBase64(2, 'Doc');
        await expect(extractPagesTool({ pdfBase64: src, pages: [] })).rejects.toThrow(ToolError);
    });

    it('rejects an out-of-range page index', async () => {
        const src = await makePdfBase64(2, 'Doc');
        await expect(extractPagesTool({ pdfBase64: src, pages: [99] })).rejects.toThrow(ToolError);
    });

    it('processes an owner-only encrypted source (empty user password) transparently', async () => {
        const enc = makeEncryptedPdfBase64();
        const out = await extractPagesTool({ pdfBase64: enc, pages: [0] });
        expect(out.mode).toBe('base64');
        expect(out.sizeBytes).toBeGreaterThan(0);
    });

    it('rejects a password-protected source without a password (PASSWORD_REQUIRED)', async () => {
        const enc = makeUserEncryptedPdfBase64({ userPassword: 'open-me' });
        await expect(extractPagesTool({ pdfBase64: enc, pages: [0] })).rejects.toMatchObject({
            code: 'PASSWORD_REQUIRED',
        });
    });

    it('preserves print page boxes and /UserUnit of the source pages (pdfnative 1.7)', async () => {
        const { generateBasicPdf } = await import('../src/tools/generate-basic-pdf.js');
        const src = await generateBasicPdf({
            title: 'Print',
            blocks: [{ type: 'paragraph', text: 'Page one.' }, { type: 'pageBreak' }, { type: 'paragraph', text: 'Page two.' }],
            print: { bleed: 8.5, userUnit: 2 },
        });
        const result = await extractPagesTool({ pdfBase64: src.base64 as string, pages: [1] });
        expect(assertValidPdf(result.base64 as string)).toBe(1);
        const text = Buffer.from(result.base64 as string, 'base64').toString('latin1');
        expect(text).toContain('/TrimBox');
        expect(text).toContain('/UserUnit');
    });
});
