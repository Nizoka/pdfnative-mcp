import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseCertificateMock = vi.fn(() => ({ serial: 'cert' }));
const parseRsaPrivateKeyMock = vi.fn(() => ({ n: 1n, d: 2n }));
const signPdfBytesMock = vi.fn(() => new Uint8Array([0x25, 0x50, 0x44, 0x46]));
const addSignaturePlaceholderMock = vi.fn((bytes: Uint8Array) => bytes);
// Default openPdf mock pretends the input already has a placeholder so we only
// exercise the signing path. Tests that want the auto-inject branch override.
const openPdfMock = vi.fn(() => ({
    getCatalog: () => new Map([
        ['AcroForm', { Fields: [{ FT: { __name: 'Sig', value: 'Sig' } }] }],
    ]),
}));

// Stub pdfnative `isRef` / `isName` / etc. helpers used by pdf-introspection.
vi.mock('pdfnative', () => ({
    parseCertificate: parseCertificateMock,
    parseRsaPrivateKey: parseRsaPrivateKeyMock,
    signPdfBytes: signPdfBytesMock,
    addSignaturePlaceholder: addSignaturePlaceholderMock,
    openPdf: openPdfMock,
    isRef: (v: unknown) => v !== null && typeof v === 'object' && 'num' in (v as object),
    isDict: (v: unknown) => v instanceof Map || (v !== null && typeof v === 'object' && 'get' in (v as object) && typeof (v as { get?: unknown }).get === 'function'),
    isArray: (v: unknown) => Array.isArray(v),
    isName: (v: unknown) => v !== null && typeof v === 'object' && '__name' in (v as object),
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
        addSignaturePlaceholderMock.mockClear();
        openPdfMock.mockClear();
        // Default: pretend placeholder is already present.
        openPdfMock.mockImplementation(() => {
            const dummy = (entries: [string, unknown][]): Map<string, unknown> => new Map(entries) as Map<string, unknown> & { get(key: string): unknown };
            return {
                getCatalog: () => dummy([
                    ['AcroForm', dummy([
                        ['Fields', [dummy([['FT', { __name: 'Sig', value: 'Sig' }]])]],
                    ])],
                ]),
            } as ReturnType<typeof openPdfMock>;
        });
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
        ).rejects.toThrow('ecPrivateScalarHex or ecPrivateKeyDerBase64 is required');
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

    it('auto-injects a placeholder when the input PDF lacks one (default)', async () => {
        openPdfMock.mockImplementationOnce(() => ({
            getCatalog: () => new Map(),
        }) as unknown as ReturnType<typeof openPdfMock>);
        const { signPdf } = await import('../src/tools/sign-pdf.js');
        await signPdf({
            pdfBase64: b64([1, 2, 3]),
            algorithm: 'rsa-sha256',
            certDerBase64: b64([4, 5, 6]),
            rsaKeyPkcs1DerBase64: b64([7, 8, 9]),
        });
        expect(addSignaturePlaceholderMock).toHaveBeenCalledTimes(1);
        expect(signPdfBytesMock).toHaveBeenCalledTimes(1);
    });

    it('rejects missing placeholder with MISSING_PLACEHOLDER when autoInjectPlaceholder=false', async () => {
        openPdfMock.mockImplementationOnce(() => ({
            getCatalog: () => new Map(),
        }) as unknown as ReturnType<typeof openPdfMock>);
        const { signPdf } = await import('../src/tools/sign-pdf.js');
        await expect(
            signPdf({
                pdfBase64: b64([1, 2, 3]),
                algorithm: 'rsa-sha256',
                certDerBase64: b64([4, 5, 6]),
                rsaKeyPkcs1DerBase64: b64([7, 8, 9]),
                autoInjectPlaceholder: false,
            }),
        ).rejects.toThrow(/MISSING_PLACEHOLDER|no \/Sig placeholder/);
        expect(addSignaturePlaceholderMock).not.toHaveBeenCalled();
    });

    it('rejects mutually-exclusive ec key inputs', async () => {
        const { signPdf } = await import('../src/tools/sign-pdf.js');
        await expect(
            signPdf({
                pdfBase64: b64([1, 2, 3]),
                algorithm: 'ecdsa-sha256',
                certDerBase64: b64([4, 5, 6]),
                ecPrivateScalarHex: '1'.repeat(64),
                ecPrivateKeyDerBase64: b64([7, 8, 9]),
            }),
        ).rejects.toThrow('mutually exclusive');
    });
});
