/**
 * Tests for `split_pdf` (pdfnative v1.4 page-tree API wrapper, multi-output).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { splitPdfTool } from '../src/tools/split-pdf.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';
import { makePdfBase64, makeEncryptedPdfBase64 } from './_pagetree-fixtures.js';
import { makeEncryptedPdfBase64 as makeUserEncryptedPdfBase64 } from './_encrypted-fixtures.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

describe('split_pdf', () => {
    beforeAll(async () => {
        delete process.env[ENV_KEY];
        await ensureCompressionReady();
    });

    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it('splits a PDF into one document per range', async () => {
        const src = await makePdfBase64(4, 'Doc');
        const result = await splitPdfTool({ pdfBase64: src, ranges: [{ start: 0 }, { start: 1, end: 3 }] });
        expect(result.mode).toBe('base64');
        expect(result.count).toBe(2);
        expect(result.parts).toHaveLength(2);
        expect(assertValidPdf(result.parts[0]!.base64 as string)).toBe(1);
        expect(assertValidPdf(result.parts[1]!.base64 as string)).toBe(3);
        expect(result.totalBytes).toBeGreaterThan(0);
    });

    it('treats a range without end as a single page', async () => {
        const src = await makePdfBase64(3, 'Doc');
        const result = await splitPdfTool({ pdfBase64: src, ranges: [{ start: 2 }] });
        expect(result.count).toBe(1);
        expect(assertValidPdf(result.parts[0]!.base64 as string)).toBe(1);
    });

    it('rejects a range whose end precedes its start', async () => {
        const src = await makePdfBase64(3, 'Doc');
        await expect(splitPdfTool({ pdfBase64: src, ranges: [{ start: 2, end: 1 }] })).rejects.toThrow(ToolError);
    });

    it('rejects an empty ranges array', async () => {
        const src = await makePdfBase64(2, 'Doc');
        await expect(splitPdfTool({ pdfBase64: src, ranges: [] })).rejects.toThrow(ToolError);
    });

    it('processes an owner-only encrypted source (empty user password) transparently', async () => {
        const enc = makeEncryptedPdfBase64();
        const out = await splitPdfTool({ pdfBase64: enc, ranges: [{ start: 0 }] });
        expect(out.count).toBe(1);
    });

    it('rejects a password-protected source without a password (PASSWORD_REQUIRED)', async () => {
        const enc = makeUserEncryptedPdfBase64({ userPassword: 'open-me' });
        await expect(splitPdfTool({ pdfBase64: enc, ranges: [{ start: 0 }] })).rejects.toMatchObject({
            code: 'PASSWORD_REQUIRED',
        });
    });

    it('writes one indexed file per range when outputMode=file', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-split-'));
        process.env[ENV_KEY] = dir;
        const src = await makePdfBase64(3, 'Doc');
        const result = await splitPdfTool({
            pdfBase64: src,
            ranges: [{ start: 0 }, { start: 1, end: 2 }],
            outputMode: 'file',
            outputPath: 'part.pdf',
        });
        expect(result.mode).toBe('file');
        expect(result.count).toBe(2);
        expect(result.parts[0]!.filePath?.endsWith('part-1.pdf')).toBe(true);
        expect(result.parts[1]!.filePath?.endsWith('part-2.pdf')).toBe(true);
        for (const part of result.parts) {
            const bytes = await fs.readFile(part.filePath as string);
            assertValidPdf(new Uint8Array(bytes));
        }
    });

    it('preserves print page boxes and /UserUnit of the source pages (pdfnative 1.7)', async () => {
        const { generateBasicPdf } = await import('../src/tools/generate-basic-pdf.js');
        const src = await generateBasicPdf({
            title: 'Print',
            blocks: [{ type: 'paragraph', text: 'Page one.' }, { type: 'pageBreak' }, { type: 'paragraph', text: 'Page two.' }],
            print: { bleed: 8.5, userUnit: 2 },
        });
        const result = await splitPdfTool({ pdfBase64: src.base64 as string, ranges: [{ start: 0 }, { start: 1 }] });
        expect(result.count).toBe(2);
        for (const part of result.parts) {
            assertValidPdf(part.base64 as string);
            const text = Buffer.from(part.base64 as string, 'base64').toString('latin1');
            expect(text).toContain('/TrimBox');
            expect(text).toContain('/UserUnit');
        }
    });
});
