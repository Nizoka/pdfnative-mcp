/**
 * Tests for the `password` input on the read-only tools (pdfnative v1.6.0
 * transparent decryption): inspect_pdf, verify_pdf, extract_attachments.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { inspectPdf } from '../src/tools/inspect-pdf.js';
import { verifyPdf } from '../src/tools/verify-pdf.js';
import { extractAttachments } from '../src/tools/extract-attachments.js';
import { ensureCompressionReady } from '../src/server.js';
import { makeEncryptedPdfBase64 } from './_encrypted-fixtures.js';

describe('encrypted read-only tools', () => {
    beforeAll(async () => {
        delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
        await ensureCompressionReady();
    });

    describe('inspect_pdf', () => {
        it('surfaces precise encryptionInfo for an AES-256 document', async () => {
            const enc = makeEncryptedPdfBase64({ userPassword: 'open-me', algorithm: 'aes256' });
            const out = await inspectPdf({ pdfBase64: enc, password: 'open-me' });
            expect(out.encryption).toBe('aes-256');
            expect(out.encryptionInfo).toMatchObject({ algorithm: 'aes256', authenticatedAs: 'user' });
            expect(typeof out.encryptionInfo?.revision).toBe('number');
        });

        it('passes the encrypted CI check', async () => {
            const enc = makeEncryptedPdfBase64({ userPassword: 'open-me' });
            const out = await inspectPdf({ pdfBase64: enc, password: 'open-me', check: ['encrypted'] });
            expect(out.checksPassed).toBe(true);
        });

        it('rejects a missing password with PASSWORD_REQUIRED', async () => {
            const enc = makeEncryptedPdfBase64({ userPassword: 'open-me' });
            await expect(inspectPdf({ pdfBase64: enc })).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
        });

        it('omits encryptionInfo for an unencrypted PDF', async () => {
            const { generateBasicPdf } = await import('../src/tools/generate-basic-pdf.js');
            const doc = await generateBasicPdf({ title: 'Plain', blocks: [{ type: 'paragraph', text: 'hi' }] });
            const out = await inspectPdf({ pdfBase64: doc.base64! });
            expect(out.encryption).toBe('none');
            expect(out.encryptionInfo).toBeUndefined();
        });
    });

    describe('verify_pdf', () => {
        it('opens an encrypted (unsigned) PDF with a password and reports no signatures', async () => {
            const enc = makeEncryptedPdfBase64({ userPassword: 'open-me' });
            const out = await verifyPdf({ pdfBase64: enc, password: 'open-me' });
            expect(out.signatureCount).toBe(0);
            expect(out.allValid).toBe(false);
        });

        it('rejects a missing password with PASSWORD_REQUIRED', async () => {
            const enc = makeEncryptedPdfBase64({ userPassword: 'open-me' });
            await expect(verifyPdf({ pdfBase64: enc })).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
        });
    });

    describe('extract_attachments', () => {
        it('opens an encrypted PDF with a password (no attachments)', async () => {
            const enc = makeEncryptedPdfBase64({ userPassword: 'open-me' });
            const out = await extractAttachments({ pdfBase64: enc, password: 'open-me' });
            expect(out.attachmentCount).toBe(0);
        });

        it('rejects a missing password with PASSWORD_REQUIRED', async () => {
            const enc = makeEncryptedPdfBase64({ userPassword: 'open-me' });
            await expect(extractAttachments({ pdfBase64: enc })).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
        });
    });
});
