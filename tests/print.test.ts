/**
 * Tests for the shared print-production module (`src/print.ts`, pdfnative 1.7):
 * unit coverage of the mapping helpers plus end-to-end coverage through
 * `generate_basic_pdf` (page boxes, printer's marks, /UserUnit, /Info
 * metadata, OutputIntent and the print-dialog viewer preferences).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { assertPrintPdfACompatible, toDocumentMetadata, toOutputIntent, toPrintOptions } from '../src/print.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

const BASE = { title: 'Doc', blocks: [{ type: 'paragraph', text: 'Hello world.' }] } as const;

function latin1(base64: string): string {
    return Buffer.from(base64, 'base64').toString('latin1');
}

describe('print helpers (unit)', () => {
    it('toPrintOptions forwards the bleed shorthand and boolean marks verbatim', () => {
        expect(toPrintOptions({ bleed: 8.5, marks: true })).toEqual({ bleed: 8.5, marks: true });
    });

    it('toPrintOptions copies explicit boxes and a marks object without undefined keys', () => {
        const out = toPrintOptions({
            trimBox: [10, 10, 500, 800],
            artBox: [20, 20, 480, 780],
            marks: { crop: true, length: 20 },
            userUnit: 2,
        });
        expect(out).toEqual({ trimBox: [10, 10, 500, 800], artBox: [20, 20, 480, 780], marks: { crop: true, length: 20 }, userUnit: 2 });
        expect(Object.keys(out)).not.toContain('bleedBox');
    });

    it('toPrintOptions returns an empty object for an empty input', () => {
        expect(toPrintOptions({})).toEqual({});
    });

    it('toOutputIntent decodes the ICC profile and forwards the condition strings', () => {
        const out = toOutputIntent({ iccProfileBase64: Buffer.from('abcd').toString('base64'), outputConditionIdentifier: 'sRGB', info: 'x' });
        expect(Array.from(out.iccProfile)).toEqual([97, 98, 99, 100]);
        expect(out.outputConditionIdentifier).toBe('sRGB');
        expect(out.info).toBe('x');
        expect(Object.keys(out)).not.toContain('registryName');
    });

    it('toOutputIntent rejects a payload that decodes to zero bytes', () => {
        expect(() => toOutputIntent({ iccProfileBase64: '====', outputConditionIdentifier: 'x' })).toThrow(ToolError);
    });

    it('toDocumentMetadata returns undefined for absent or empty input', () => {
        expect(toDocumentMetadata(undefined)).toBeUndefined();
        expect(toDocumentMetadata({})).toBeUndefined();
    });

    it('toDocumentMetadata keeps only the supplied keys', () => {
        expect(toDocumentMetadata({ author: 'A', trapped: 'Unknown' })).toEqual({ author: 'A', trapped: 'Unknown' });
    });

    it('assertPrintPdfACompatible rejects userUnit under pdfa1b only', () => {
        expect(() => assertPrintPdfACompatible({ userUnit: 2 }, 'pdfa1b')).toThrow(ToolError);
        expect(() => assertPrintPdfACompatible({ userUnit: 2 }, 'pdfa2b')).not.toThrow();
        expect(() => assertPrintPdfACompatible({ bleed: 8.5 }, 'pdfa1b')).not.toThrow();
        expect(() => assertPrintPdfACompatible(undefined, 'pdfa1b')).not.toThrow();
    });
});

describe('generate_basic_pdf print-production inputs', () => {
    it('bleed + marks emits /TrimBox and /BleedBox on the page', async () => {
        const result = await generateBasicPdf({ ...BASE, print: { bleed: 8.5, marks: true } });
        assertValidPdf(result.base64 as string);
        const text = latin1(result.base64 as string);
        expect(text).toContain('/TrimBox');
        expect(text).toContain('/BleedBox');
    });

    it('an explicit trimBox with a marks object is accepted', async () => {
        const result = await generateBasicPdf({
            ...BASE,
            print: { trimBox: [20, 20, 575, 820], marks: { crop: true, registration: false, length: 10 } },
        });
        assertValidPdf(result.base64 as string);
        expect(latin1(result.base64 as string)).toContain('/TrimBox');
    });

    it('userUnit emits /UserUnit and raises the header to PDF 1.7', async () => {
        const result = await generateBasicPdf({ ...BASE, print: { userUnit: 2 } });
        assertValidPdf(result.base64 as string);
        const text = latin1(result.base64 as string);
        expect(text).toContain('/UserUnit 2');
        expect(text.startsWith('%PDF-1.7')).toBe(true);
    });

    it('userUnit under pdfa1b is rejected with PDF_A_COMPLIANCE_VIOLATION', async () => {
        await expect(generateBasicPdf({ ...BASE, pdfA: 'pdfa1b', print: { userUnit: 2 } })).rejects.toMatchObject({
            code: 'PDF_A_COMPLIANCE_VIOLATION',
        });
    });

    it('bleed and trimBox together are rejected with VALIDATION_ERROR', async () => {
        await expect(
            generateBasicPdf({ ...BASE, print: { bleed: 8.5, trimBox: [10, 10, 500, 800] } }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('marks without a TrimBox is rejected by the engine with PRINT_ERROR', async () => {
        await expect(generateBasicPdf({ ...BASE, print: { marks: true } })).rejects.toMatchObject({ code: 'PRINT_ERROR' });
    });

    it('rejects an out-of-range bleed', async () => {
        await expect(generateBasicPdf({ ...BASE, print: { bleed: 500 } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('metadata writes /Author, /Subject, /Keywords and /Trapped into /Info', async () => {
        const result = await generateBasicPdf({
            ...BASE,
            metadata: { author: 'A', subject: 'S', keywords: 'k', trapped: 'True' },
        });
        assertValidPdf(result.base64 as string);
        const text = latin1(result.base64 as string);
        expect(text).toContain('/Author (A)');
        expect(text).toContain('/Subject (S)');
        expect(text).toContain('/Keywords (k)');
        expect(text).toContain('/Trapped /True');
    });

    it('an empty metadata object keeps the output byte-identical', async () => {
        const a = await generateBasicPdf(BASE);
        const b = await generateBasicPdf({ ...BASE, metadata: {} });
        expect(b.base64).toBe(a.base64);
    });

    it('a non-ICC outputIntent payload under PDF/A is rejected by the engine with PRINT_ERROR', async () => {
        // The engine validates the 128-byte ICC header before any bytes are produced;
        // mapBuildError surfaces that "outputIntent.iccProfile ..." message as PRINT_ERROR.
        await expect(
            generateBasicPdf({
                ...BASE,
                pdfA: 'pdfa2b',
                outputIntent: { iccProfileBase64: Buffer.from('not an icc profile').toString('base64'), outputConditionIdentifier: 'x' },
            }),
        ).rejects.toMatchObject({ code: 'PRINT_ERROR' });
    });

    it('outputIntent without a required condition identifier is a VALIDATION_ERROR', async () => {
        await expect(
            generateBasicPdf({ ...BASE, pdfA: 'pdfa2b', outputIntent: { iccProfileBase64: 'AAAA' } }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('print-dialog viewer preferences emit /Duplex, /PrintPageRange, /NumCopies and /PickTrayByPDFSize', async () => {
        const result = await generateBasicPdf({
            ...BASE,
            viewerPreferences: { duplex: 'duplexFlipLongEdge', printPageRange: [[1, 1]], numCopies: 2, pickTrayByPDFSize: true },
        });
        assertValidPdf(result.base64 as string);
        const text = latin1(result.base64 as string);
        expect(text).toContain('/Duplex');
        expect(text).toContain('/PrintPageRange');
        expect(text).toContain('/NumCopies');
        expect(text).toContain('/PickTrayByPDFSize');
    });

    it('rejects an unknown duplex value', async () => {
        await expect(generateBasicPdf({ ...BASE, viewerPreferences: { duplex: 'both' } })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
    });

    it('the default response shape carries no diagnostics key', async () => {
        const result = await generateBasicPdf({ ...BASE, print: { bleed: 8.5 } });
        expect(Object.keys(result)).not.toContain('diagnostics');
    });
});
