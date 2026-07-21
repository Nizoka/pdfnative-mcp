/**
 * Tests for the encrypted round-trip on the page-tree tools (pdfnative v1.6.0):
 * merge / split / extract now ingest encrypted sources (`password`) and can
 * re-encrypt their output (`encrypt`).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { mergePdfsTool } from '../src/tools/merge-pdfs.js';
import { splitPdfTool } from '../src/tools/split-pdf.js';
import { extractPagesTool } from '../src/tools/extract-pages.js';
import { inspectPdf } from '../src/tools/inspect-pdf.js';
import { ensureCompressionReady } from '../src/server.js';
import { assertValidPdf } from './_pdf-assert.js';
import { makePdfBase64 } from './_pagetree-fixtures.js';
import { makeEncryptedPdfBase64 } from './_encrypted-fixtures.js';

describe('page-tree encrypted round-trip', () => {
    beforeAll(async () => {
        delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
        await ensureCompressionReady();
    });

    it('merges encrypted sources when the password is supplied', async () => {
        const a = makeEncryptedPdfBase64({ userPassword: 'shared', text: 'Doc A' });
        const b = makeEncryptedPdfBase64({ userPassword: 'shared', text: 'Doc B' });
        const out = await mergePdfsTool({ pdfsBase64: [a, b], password: 'shared' });
        // Merged output is unencrypted.
        const insp = await inspectPdf({ pdfBase64: out.base64! });
        expect(insp.encryption).toBe('none');
        expect(insp.pageCount).toBe(2);
    });

    it('re-encrypts merged output with the encrypt option', async () => {
        const a = await makePdfBase64(1, 'A');
        const b = await makePdfBase64(1, 'B');
        const out = await mergePdfsTool({ pdfsBase64: [a, b], encrypt: { ownerPassword: 'owner', userPassword: 'user', algorithm: 'aes256' } });
        const insp = await inspectPdf({ pdfBase64: out.base64!, password: 'user' });
        expect(insp.encryption).toBe('aes-256');
        expect(insp.pageCount).toBe(2);
    });

    it('rejects an encrypted merge source without a password (PASSWORD_REQUIRED)', async () => {
        const a = makeEncryptedPdfBase64({ userPassword: 'shared' });
        const b = makeEncryptedPdfBase64({ userPassword: 'shared' });
        await expect(mergePdfsTool({ pdfsBase64: [a, b] })).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    });

    it('extract_pages ingests an encrypted source and re-encrypts the result', async () => {
        const src = makeEncryptedPdfBase64({ userPassword: 'p', text: 'Encrypted source' });
        const out = await extractPagesTool({ pdfBase64: src, password: 'p', pages: [0], encrypt: { ownerPassword: 'o', userPassword: 'u' } });
        const insp = await inspectPdf({ pdfBase64: out.base64!, password: 'u' });
        expect(insp.encryption).not.toBe('none');
    });

    it('split_pdf ingests an encrypted source with a password', async () => {
        const src = makeEncryptedPdfBase64({ userPassword: 'p' });
        const out = await splitPdfTool({ pdfBase64: src, password: 'p', ranges: [{ start: 0 }] });
        expect(out.count).toBe(1);
        assertValidPdf(out.parts[0]!.base64 as string, 1);
    });
});
