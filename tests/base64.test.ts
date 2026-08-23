/**
 * Boundary diagnostics for base64 inputs (review round 2, A-4 / F-4):
 * the classic agent mistakes — `data:` URI, PEM where DER is expected,
 * double-encoded base64 — must fail with a coded error and a remedy,
 * never with an opaque engine exception.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { CERT_REMEDY, decodeBase64Field, decodeDerBase64, decodePdfBase64, parseDerOrThrow } from '../src/base64.js';
import { ToolError } from '../src/errors.js';
import { ensureCompressionReady } from '../src/server.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { signPdf } from '../src/tools/sign-pdf.js';
import { verifyPdf } from '../src/tools/verify-pdf.js';
import { buildRsaSelfSignedCert } from './_cert-fixtures.js';

beforeAll(async () => {
    await ensureCompressionReady();
});

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

describe('decodeBase64Field / decodePdfBase64', () => {
    it('tolerates whitespace and a data: URI prefix', async () => {
        const pdf = (await generateBasicPdf({ title: 'b64', blocks: [{ type: 'paragraph', text: 'x' }] })).base64!;
        const viaDataUri = decodePdfBase64(`data:application/pdf;base64,${pdf.slice(0, 40)}\n${pdf.slice(40)}`);
        expect(Buffer.from(viaDataUri).toString('base64')).toBe(pdf);
    });

    it('rejects non-base64 characters and empty payloads with VALIDATION_ERROR', () => {
        expect(() => decodeBase64Field('not base64!', 'pdfBase64')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
        expect(() => decodePdfBase64('====')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });

    it('names the mistake for PEM text, nested data: URIs and double-encoded base64 (PDF_PARSE_FAILED)', () => {
        const cases: Array<[string, RegExp]> = [
            [Buffer.from(PEM).toString('base64'), /PEM text/],
            [Buffer.from('data:application/pdf;base64,JVBERi0=').toString('base64'), /nested data: URI/],
            [Buffer.from('JVBERi0xLjcK').toString('base64'), /encoded twice/],
        ];
        for (const [input, re] of cases) {
            let err: unknown;
            try {
                decodePdfBase64(input);
            } catch (e) {
                err = e;
            }
            expect(err).toBeInstanceOf(ToolError);
            expect((err as ToolError).code).toBe('PDF_PARSE_FAILED');
            expect((err as ToolError).message).toMatch(re);
        }
    });

    it('hands arbitrary bytes to the engine (no %PDF sniffing beyond the obvious mistakes)', () => {
        expect(() => decodePdfBase64(Buffer.from('this is not a pdf').toString('base64'))).not.toThrow();
    });
});

describe('decodeDerBase64 / parseDerOrThrow', () => {
    it('rejects PEM armour and non-SEQUENCE payloads with the openssl remedy', () => {
        expect(() => decodeDerBase64(Buffer.from(PEM).toString('base64'), 'certDerBase64', CERT_REMEDY)).toThrow(/PEM text; DER base64 is required.*openssl x509/);
        expect(() => decodeDerBase64(Buffer.from([0x01, 0x02]).toString('base64'), 'certDerBase64', CERT_REMEDY)).toThrow(/not DER.*openssl x509/);
    });

    it('wraps parser exceptions into VALIDATION_ERROR carrying the remedy', () => {
        let err: unknown;
        try {
            parseDerOrThrow('rsaKeyPkcs1DerBase64', 'openssl rsa …', () => {
                throw new Error('bad tag');
            });
        } catch (e) {
            err = e;
        }
        expect((err as ToolError).code).toBe('VALIDATION_ERROR');
        expect((err as ToolError).message).toMatch(/could not be parsed \(bad tag\).*openssl rsa/);
    });
});

describe('sign_pdf / verify_pdf surface DER mistakes with a remedy', () => {
    it('sign_pdf: PEM certificate → VALIDATION_ERROR with openssl x509 remedy; garbage key → VALIDATION_ERROR with openssl rsa remedy', async () => {
        const pdf = (await generateBasicPdf({ title: 's', blocks: [{ type: 'paragraph', text: 'x' }] })).base64!;
        const fx = buildRsaSelfSignedCert();
        const certDerBase64 = Buffer.from(fx.certDer).toString('base64');
        const rsaKeyPkcs1DerBase64 = Buffer.from(fx.privateKey.export({ format: 'der', type: 'pkcs1' })).toString('base64');
        await expect(signPdf({ pdfBase64: pdf, algorithm: 'rsa-sha256', certDerBase64: Buffer.from(PEM).toString('base64'), rsaKeyPkcs1DerBase64 })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
            message: expect.stringContaining('openssl x509'),
        });
        await expect(signPdf({ pdfBase64: pdf, algorithm: 'rsa-sha256', certDerBase64, rsaKeyPkcs1DerBase64: Buffer.from([0x30, 0x03, 0x02, 0x01]).toString('base64') })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
            message: expect.stringContaining('openssl rsa'),
        });
    });

    it('verify_pdf: PEM trusted root → VALIDATION_ERROR', async () => {
        const pdf = (await generateBasicPdf({ title: 'v', blocks: [{ type: 'paragraph', text: 'x' }] })).base64!;
        await expect(verifyPdf({ pdfBase64: pdf, trustedRootsDerBase64: [Buffer.from(PEM).toString('base64')] })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
            message: expect.stringContaining('trustedRootsDerBase64[0]'),
        });
    });
});
