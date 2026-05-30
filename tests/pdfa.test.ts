import { describe, expect, it } from 'vitest';
import { PDF_A_CONFORMANCE_TARGETS } from 'pdfnative';
import { PDF_A_ENUM, PdfASchema } from '../src/pdfa.js';

describe('pdfa helper', () => {
    it('mirrors PDF_A_CONFORMANCE_TARGETS from pdfnative (single source of truth)', () => {
        expect([...PDF_A_ENUM]).toEqual([...PDF_A_CONFORMANCE_TARGETS]);
        expect(PDF_A_ENUM.length).toBeGreaterThanOrEqual(4);
    });

    it('PdfASchema accepts every conformance target and rejects unknown values', () => {
        for (const target of PDF_A_ENUM) {
            expect(PdfASchema.safeParse(target).success).toBe(true);
        }
        expect(PdfASchema.safeParse('pdfa9z').success).toBe(false);
        expect(PdfASchema.safeParse('').success).toBe(false);
    });
});
