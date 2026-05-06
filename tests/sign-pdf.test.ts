import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseCertificateMock = vi.fn(() => ({ serial: 'cert' }));
const parseRsaPrivateKeyMock = vi.fn(() => ({ n: 1n, d: 2n }));
const signPdfBytesMock = vi.fn(() => new Uint8Array([0x25, 0x50, 0x44, 0x46]));

vi.mock('pdfnative', () => ({
    parseCertificate: parseCertificateMock,
    parseRsaPrivateKey: parseRsaPrivateKeyMock,
    signPdfBytes: signPdfBytesMock,
}));

function b64(bytes: number[]): string {
    return Buffer.from(new Uint8Array(bytes)).toString('base64');
}

describe('sign_pdf tool', () => {
    beforeEach(() => {
        parseCertificateMock.mockClear();
        parseRsaPrivateKeyMock.mockClear();
        signPdfBytesMock.mockClear();
        signPdfBytesMock.mockImplementation(() => new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    });

    it('signs with rsa-sha256', async () => {
        const { signPdf } = await import('../src/tools/sign-pdf.js');

        const result = await signPdf({
            pdfBase64: b64([1, 2, 3]),
            algorithm: 'rsa-sha256',
            certDerBase64: b64([4, 5, 6]),
            rsaKeyPkcs1DerBase64: b64([7, 8, 9]),
            signerName: 'Alice',
        });

        expect(result.mode).toBe('base64');
        expect(typeof result.base64).toBe('string');
        expect(parseCertificateMock).toHaveBeenCalledTimes(1);
        expect(parseRsaPrivateKeyMock).toHaveBeenCalledTimes(1);
        expect(signPdfBytesMock).toHaveBeenCalledTimes(1);
        const firstCall = signPdfBytesMock.mock.calls[0];
        expect(firstCall).toBeDefined();
        const options = (firstCall as unknown as [Uint8Array, { algorithm: string }])[1];
        expect(options.algorithm).toBe('rsa-sha256');
    });

    it('signs with ecdsa-sha256', async () => {
        const { signPdf } = await import('../src/tools/sign-pdf.js');

        const result = await signPdf({
            pdfBase64: b64([1, 2, 3]),
            algorithm: 'ecdsa-sha256',
            certDerBase64: b64([4, 5, 6]),
            ecPrivateScalarHex: '1'.repeat(64),
        });

        expect(result.mode).toBe('base64');
        expect(signPdfBytesMock).toHaveBeenCalledTimes(1);
        const firstCall = signPdfBytesMock.mock.calls[0];
        expect(firstCall).toBeDefined();
        const options = (firstCall as unknown as [Uint8Array, { algorithm: string; ecKey?: { d: bigint } }])[1];
        expect(options.algorithm).toBe('ecdsa-sha256');
        expect(typeof options.ecKey?.d).toBe('bigint');
    });

    it('rejects missing rsa key for rsa-sha256', async () => {
        const { signPdf } = await import('../src/tools/sign-pdf.js');

        await expect(
            signPdf({
                pdfBase64: b64([1, 2, 3]),
                algorithm: 'rsa-sha256',
                certDerBase64: b64([4, 5, 6]),
            }),
        ).rejects.toThrow('rsaKeyPkcs1DerBase64 is required');
    });

    it('rejects missing ec key for ecdsa-sha256', async () => {
        const { signPdf } = await import('../src/tools/sign-pdf.js');

        await expect(
            signPdf({
                pdfBase64: b64([1, 2, 3]),
                algorithm: 'ecdsa-sha256',
                certDerBase64: b64([4, 5, 6]),
            }),
        ).rejects.toThrow('ecPrivateScalarHex is required');
    });

    it('converts signing exceptions into SIGNING_FAILED', async () => {
        const { signPdf } = await import('../src/tools/sign-pdf.js');
        signPdfBytesMock.mockImplementation(() => {
            throw new Error('bad signature state');
        });

        await expect(
            signPdf({
                pdfBase64: b64([1, 2, 3]),
                algorithm: 'rsa-sha256',
                certDerBase64: b64([4, 5, 6]),
                rsaKeyPkcs1DerBase64: b64([7, 8, 9]),
            }),
        ).rejects.toThrow('Failed to sign PDF: bad signature state');
    });

    it('includes optional metadata fields in the signing options', async () => {
        const { signPdf } = await import('../src/tools/sign-pdf.js');
        await signPdf({
            pdfBase64: b64([1, 2, 3]),
            algorithm: 'rsa-sha256',
            certDerBase64: b64([4, 5, 6]),
            rsaKeyPkcs1DerBase64: b64([7, 8, 9]),
            signerName: 'Bob',
            reason: 'Reviewed and approved',
            location: 'Berlin, DE',
            contactInfo: 'bob@example.com',
            signingTime: '2026-01-15T10:30:00Z',
        });
        const firstCall = signPdfBytesMock.mock.calls[0] as unknown as [Uint8Array, Record<string, unknown>];
        expect(firstCall[1]['reason']).toBe('Reviewed and approved');
        expect(firstCall[1]['location']).toBe('Berlin, DE');
        expect(firstCall[1]['contactInfo']).toBe('bob@example.com');
        expect(firstCall[1]['signingTime']).toBeInstanceOf(Date);
    });
});
