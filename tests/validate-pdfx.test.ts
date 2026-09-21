/**
 * validate_pdf `standard: 'pdf-x-4'` (pdfnative 1.8.0 `validatePdfX()`) and the
 * inspect_pdf PDF/X claim.
 *
 * The contract that matters most: the default call is untouched. `standard`
 * defaults to the PDF/UA rule set the tool has always run, and `caveats` —
 * the honest statement of what a structural check leaves open — appears for
 * PDF/X only.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { callToolDirect, ensureCompressionReady, listToolsPayload } from '../src/server.js';
import { annotatePdf } from '../src/tools/annotate-pdf.js';
import { encryptPdf } from '../src/tools/encrypt-pdf.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { inspectPdf } from '../src/tools/inspect-pdf.js';
import { PDF_X_CAVEATS, VALIDATE_PDF_INPUT_SCHEMA, VALIDATE_PDF_OUTPUT_SCHEMA, VALIDATE_STANDARDS, validatePdf } from '../src/tools/validate-pdf.js';
import { CMYK_INTENT } from './_icc-fixtures.js';

const PINNED = '2026-01-15T09:00:00Z';
const DOC = { title: 'Print job', blocks: [{ type: 'heading', text: 'Brochure', level: 1 }, { type: 'paragraph', text: 'Body text.' }], creationDate: PINNED };

let pdfx: string;
let plain: string;
let tagged: string;

beforeAll(async () => {
    await ensureCompressionReady();
    pdfx = (await generateBasicPdf({ ...DOC, pdfx: 'pdfx4', outputIntent: CMYK_INTENT, embedFonts: true })).base64!;
    plain = (await generateBasicPdf(DOC)).base64!;
    tagged = (await generateBasicPdf({ ...DOC, pdfA: 'pdfa2b', embedFonts: true })).base64!;
});

describe('validate_pdf — schema', () => {
    it("adds `standard` with the historical rule set as its default, and 'pdf-x-4' to the output enum", () => {
        expect([...VALIDATE_STANDARDS]).toEqual(['pdf-ua-1', 'pdf-x-4']);
        expect(VALIDATE_PDF_INPUT_SCHEMA.properties.standard.default).toBe('pdf-ua-1');
        expect([...VALIDATE_PDF_INPUT_SCHEMA.properties.standard.enum]).toEqual([...VALIDATE_STANDARDS]);
        expect([...VALIDATE_PDF_OUTPUT_SCHEMA.properties.standard.enum]).toEqual([...VALIDATE_STANDARDS]);
        expect(VALIDATE_PDF_INPUT_SCHEMA.required).toEqual(['pdfBase64']);
        expect(VALIDATE_PDF_OUTPUT_SCHEMA.required).not.toContain('caveats');
    });

    it('rejects an unknown standard and unknown keys', async () => {
        await expect(validatePdf({ pdfBase64: pdfx, standard: 'pdf-x-1a' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(validatePdf({ pdfBase64: pdfx, profile: 'pdf-x-4' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('validate_pdf — the default call is unchanged', () => {
    it("omitting `standard` and passing 'pdf-ua-1' give the same PDF/UA result, without caveats", async () => {
        const implicit = await validatePdf({ pdfBase64: tagged });
        const explicit = await validatePdf({ pdfBase64: tagged, standard: 'pdf-ua-1' });
        expect(explicit).toEqual(implicit);
        expect(implicit.standard).toBe('pdf-ua-1');
        expect(implicit.valid).toBe(true);
        expect('caveats' in implicit).toBe(false);
        expect(implicit.summary).toMatch(/^PDF\/UA structural prerequisites hold/);
    });

    it('through tools/call the default structuredContent carries exactly the historical keys', async () => {
        const result = await callToolDirect('validate_pdf', { pdfBase64: tagged });
        expect(Object.keys(result.structuredContent ?? {}).sort()).toEqual(['errors', 'standard', 'summary', 'valid', 'warnings']);
    });
});

describe("validate_pdf — standard: 'pdf-x-4'", () => {
    it('accepts a file written with pdfx and says what the verdict does not establish', async () => {
        const result = await validatePdf({ pdfBase64: pdfx, standard: 'pdf-x-4' });
        expect(result).toMatchObject({ standard: 'pdf-x-4', valid: true, errors: [], summary: 'PDF/X-4 structural prerequisites hold.' });
        expect(result.caveats).toEqual([...PDF_X_CAVEATS]);
        expect(result.caveats?.[0]).toMatch(/not a certified preflight/);
        expect(result.caveats?.[0]).toMatch(/veraPDF does not cover PDF\/X/);
    });

    it('rejects a document that makes no PDF/X claim, with the reasons', async () => {
        const result = await validatePdf({ pdfBase64: plain, standard: 'pdf-x-4' });
        expect(result.valid).toBe(false);
        expect(result.errors.join('\n')).toMatch(/GTS_PDFXVersion|does not claim PDF\/X|OutputIntent/);
        expect(result.summary).toMatch(/^PDF\/X-4 validation failed with \d+ error\(s\)/);
        expect(result.caveats).toBeDefined();
    });

    it('transmits engine findings: an annotation added on the printed area voids the claim', async () => {
        const annotated = await annotatePdf({ pdfBase64: pdfx, annotations: [{ type: 'square', page: 0, rect: [100, 600, 300, 700] }] });
        const result = await validatePdf({ pdfBase64: annotated.base64!, standard: 'pdf-x-4' });
        expect(result.valid).toBe(false);
        expect(result.errors.join('\n')).toMatch(/annotation/i);
    });

    it('transmits engine findings: an encrypted copy is refused (PDF/X forbids encryption)', async () => {
        const encrypted = await encryptPdf({ pdfBase64: pdfx, ownerPassword: 'owner-secret' });
        const result = await validatePdf({ pdfBase64: encrypted.base64!, standard: 'pdf-x-4' });
        expect(result.valid).toBe(false);
    });

    it('raises PDF_PARSE_FAILED for bytes that are not a PDF, like every other read tool', async () => {
        const junk = Buffer.from('this is not a pdf at all, just some text').toString('base64');
        await expect(validatePdf({ pdfBase64: junk, standard: 'pdf-x-4' })).rejects.toMatchObject({ code: 'PDF_PARSE_FAILED', message: expect.stringMatching(/Pass the raw PDF bytes as base64/) });
        const headerOnly = Buffer.from('%PDF-1.6\n%%EOF\n').toString('base64');
        await expect(validatePdf({ pdfBase64: headerOnly, standard: 'pdf-x-4' })).rejects.toMatchObject({ code: 'PDF_PARSE_FAILED' });
    });

    it('summary verbosity and field projection compose as for PDF/UA', async () => {
        const summary = await callToolDirect('validate_pdf', { pdfBase64: pdfx, standard: 'pdf-x-4', verbosity: 'summary' });
        expect(summary.structuredContent).toEqual({ standard: 'pdf-x-4', valid: true, errorCount: 0, warningCount: 0, summary: 'PDF/X-4 structural prerequisites hold.' });
        const projected = await callToolDirect('validate_pdf', { pdfBase64: pdfx, standard: 'pdf-x-4', fields: ['valid', 'caveats'] });
        expect(projected.structuredContent).toEqual({ valid: true, caveats: [...PDF_X_CAVEATS] });
    });

    it('stays read-only and idempotent in the catalogue', () => {
        const tool = listToolsPayload().tools.find((t) => t.name === 'validate_pdf')!;
        expect(tool.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    });
});

describe('inspect_pdf — the PDF/X claim', () => {
    it('reports pdfX only when the document claims it; default output for other documents is unchanged', async () => {
        const claimed = await inspectPdf({ pdfBase64: pdfx });
        expect(claimed.pdfX).toMatch(/^PDF\/X-4/);
        expect(claimed.pdfA).toBeNull();
        expect(claimed.version).toBe('1.6');
        const unclaimed = await inspectPdf({ pdfBase64: plain });
        expect('pdfX' in unclaimed).toBe(false);
        expect('pdfX' in (await inspectPdf({ pdfBase64: tagged }))).toBe(false);
    });

    it("check:['pdfx'] asserts the claim in both directions and survives the summary", async () => {
        expect(await inspectPdf({ pdfBase64: pdfx, check: ['pdfx', 'trapped'] })).toMatchObject({ checks: { pdfx: true, trapped: true }, checksPassed: true });
        expect(await inspectPdf({ pdfBase64: plain, check: ['pdfx'] })).toMatchObject({ checks: { pdfx: false }, checksPassed: false });
        const summary = await callToolDirect('inspect_pdf', { pdfBase64: pdfx, verbosity: 'summary', check: ['pdfx'] });
        expect(summary.structuredContent).toMatchObject({ pdfX: expect.stringMatching(/^PDF\/X-4/), checksPassed: true });
    });

    it('accepts all ten check values at once', async () => {
        const all = ['pdfa', 'signed', 'encrypted', 'placeholder', 'attachments', 'dss', 'docTimestamp', 'trapped', 'annotations', 'pdfx'];
        const result = await inspectPdf({ pdfBase64: pdfx, check: all });
        expect(Object.keys(result.checks ?? {}).sort()).toEqual([...all].sort());
    });
});
