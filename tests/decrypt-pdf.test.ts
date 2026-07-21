/**
 * Tests for `decrypt_pdf` (pdfnative v1.6.0 Standard Security Handler reader).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { decryptPdf } from '../src/tools/decrypt-pdf.js';
import { inspectPdf } from '../src/tools/inspect-pdf.js';
import { ensureCompressionReady } from '../src/server.js';
import { assertValidPdf } from './_pdf-assert.js';
import { makeEncryptedPdfBase64 } from './_encrypted-fixtures.js';

describe('decrypt_pdf', () => {
    beforeAll(async () => {
        delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
        await ensureCompressionReady();
    });

    it('decrypts an AES-128 user-password PDF', async () => {
        const enc = makeEncryptedPdfBase64({ userPassword: 'open-me', algorithm: 'aes128' });
        const out = await decryptPdf({ pdfBase64: enc, password: 'open-me' });
        assertValidPdf(out.base64 as string, 1);
        const insp = await inspectPdf({ pdfBase64: out.base64! });
        expect(insp.encryption).toBe('none');
    });

    it('decrypts an AES-256 user-password PDF', async () => {
        const enc = makeEncryptedPdfBase64({ userPassword: 'open-me', algorithm: 'aes256' });
        const out = await decryptPdf({ pdfBase64: enc, password: 'open-me' });
        const insp = await inspectPdf({ pdfBase64: out.base64! });
        expect(insp.encryption).toBe('none');
    });

    it('decrypts an owner-only (empty user password) PDF without a password', async () => {
        const enc = makeEncryptedPdfBase64({ ownerPassword: 'owner-only' });
        const out = await decryptPdf({ pdfBase64: enc });
        const insp = await inspectPdf({ pdfBase64: out.base64! });
        expect(insp.encryption).toBe('none');
    });

    it('rejects a wrong password with PASSWORD_INVALID', async () => {
        const enc = makeEncryptedPdfBase64({ userPassword: 'open-me' });
        await expect(decryptPdf({ pdfBase64: enc, password: 'wrong' })).rejects.toMatchObject({ code: 'PASSWORD_INVALID' });
    });

    it('rejects a missing password with PASSWORD_REQUIRED', async () => {
        const enc = makeEncryptedPdfBase64({ userPassword: 'open-me' });
        await expect(decryptPdf({ pdfBase64: enc })).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    });

    it('rejects malformed input', async () => {
        await expect(decryptPdf({})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects an empty decoded buffer with VALIDATION_ERROR', async () => {
        await expect(decryptPdf({ pdfBase64: '====' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});
