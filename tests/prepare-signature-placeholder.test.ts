import { describe, it, expect, beforeAll } from 'vitest';
import { prepareSignaturePlaceholder } from '../src/tools/prepare-signature-placeholder.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MPC_OUTPUT_DIR'];
    await ensureCompressionReady();
});

const PDF_HEADER = '%PDF-';

function decode(b64: string): string {
    return Buffer.from(b64, 'base64').toString('latin1').slice(0, 5);
}

function decodeAll(b64: string): string {
    return Buffer.from(b64, 'base64').toString('latin1');
}

describe('prepare_signature_placeholder', () => {
    it('produces a valid PDF with a /Sig placeholder', async () => {
        const result = await prepareSignaturePlaceholder({ title: 'Contract' });
        expect(result.mode).toBe('base64');
        expect(result.sizeBytes).toBeGreaterThan(200);
        expect(decode(result.base64!)).toBe(PDF_HEADER);

        // Must contain the /Contents hex placeholder required by signPdfBytes
        const pdfStr = decodeAll(result.base64!);
        expect(pdfStr).toContain('/Contents <');
        // Must contain the ByteRange placeholder
        expect(pdfStr).toContain('/ByteRange [');
        // Must contain the AcroForm entry
        expect(pdfStr).toContain('/AcroForm');
        // Must contain a Widget annotation
        expect(pdfStr).toContain('/Widget');
    });

    it('embeds signer metadata in the /Sig dict', async () => {
        const result = await prepareSignaturePlaceholder({
            title: 'Agreement',
            signerName: 'Alice',
            reason: 'Approved',
            location: 'Paris',
            contactInfo: 'alice@example.com',
        });
        const pdfStr = decodeAll(result.base64!);
        expect(pdfStr).toContain('Alice');
        expect(pdfStr).toContain('Approved');
        expect(pdfStr).toContain('Paris');
    });

    it('accepts optional document body blocks', async () => {
        const result = await prepareSignaturePlaceholder({
            title: 'Multi-section Contract',
            blocks: [
                { type: 'heading', text: 'Terms and Conditions', level: 1 },
                { type: 'paragraph', text: 'The parties agree to the following.' },
                { type: 'spacer', height: 20 },
            ],
        });
        expect(result.mode).toBe('base64');
        const pdfStr = decodeAll(result.base64!);
        expect(pdfStr).toContain('/Contents <');
    });

    it('produces a PDF usable by signPdfBytes (structural check)', async () => {
        const result = await prepareSignaturePlaceholder({ title: 'Sign Me' });
        const pdfBytes = Buffer.from(result.base64!, 'base64');
        const pdfLatin = pdfBytes.toString('latin1');

        // signPdfBytes needs: /Contents <hex>, /ByteRange [0 ...], /AcroForm
        expect(pdfLatin.indexOf('/Contents <')).toBeGreaterThan(-1);
        expect(pdfLatin.indexOf('/ByteRange [')).toBeGreaterThan(-1);
        // The SigFlags=3 in AcroForm indicates this document allows signing
        expect(pdfLatin).toContain('SigFlags');
    });

    it('rejects an empty title', async () => {
        await expect(prepareSignaturePlaceholder({ title: '' })).rejects.toThrow(ToolError);
    });

    it('rejects missing title', async () => {
        await expect(prepareSignaturePlaceholder({})).rejects.toThrow(ToolError);
    });
});
