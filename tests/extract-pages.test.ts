/**
 * Tests for `extract_pages` (pdfnative v1.4 page-tree API wrapper, single output).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

import { extractPagesTool } from '../src/tools/extract-pages.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';
import { makePdfBase64, makeEncryptedPdfBase64 } from './_pagetree-fixtures.js';

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

    it('rejects an encrypted source with ENCRYPTED_SOURCE', async () => {
        const enc = makeEncryptedPdfBase64();
        await expect(extractPagesTool({ pdfBase64: enc, pages: [0] })).rejects.toMatchObject({
            code: 'ENCRYPTED_SOURCE',
        });
    });
});
