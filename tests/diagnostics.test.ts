/**
 * Tests for the shared PDF/A diagnostics module (`src/diagnostics.ts`,
 * pdfnative 1.7) through `generate_basic_pdf`: the always-installed sink
 * (no console.warn), `includeDiagnostics`, `strict` escalation, `embedFonts`
 * and the byte-identical default path.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { collectDiagnostics, mapBuildError, withDiagnostics } from '../src/diagnostics.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

afterEach(() => {
    vi.restoreAllMocks();
});

const BASE = { title: 'Doc', blocks: [{ type: 'paragraph', text: 'Hello world.' }] } as const;

describe('diagnostics helpers (unit)', () => {
    it('collectDiagnostics only forwards strict when true', () => {
        expect(Object.keys(collectDiagnostics(undefined).layout)).toEqual(['onDiagnostic']);
        expect(Object.keys(collectDiagnostics(false).layout)).toEqual(['onDiagnostic']);
        expect(collectDiagnostics(true).layout.strict).toBe(true);
    });

    it('the sink records diagnostics in emission order', () => {
        const c = collectDiagnostics(undefined);
        c.layout.onDiagnostic({ code: 'PDFA_NO_FONT_ENTRIES', message: 'a', severity: 'warning' });
        c.layout.onDiagnostic({ code: 'PDFA_UNEMBEDDED_FORM_FONT', message: 'b', severity: 'warning' });
        expect(c.diagnostics.map((d) => d.code)).toEqual(['PDFA_NO_FONT_ENTRIES', 'PDFA_UNEMBEDDED_FORM_FONT']);
    });

    it('withDiagnostics returns the same object unless opted in', () => {
        const c = collectDiagnostics(undefined);
        const out = { mode: 'base64' as const, sizeBytes: 1 };
        expect(withDiagnostics(out, c, undefined)).toBe(out);
        expect(withDiagnostics(out, c, false)).toBe(out);
        expect(withDiagnostics(out, c, true)).toEqual({ ...out, diagnostics: [] });
    });

    it('mapBuildError maps engine messages to stable codes', () => {
        expect(mapBuildError(new Error("pdfnative: tagged: 'pdfa2b' ... PDF/A conformance"), 't').code).toBe('PDF_A_COMPLIANCE_VIOLATION');
        expect(mapBuildError(new Error('chart: series is empty'), 't').code).toBe('CHART_ERROR');
        expect(mapBuildError(new Error('print.marks requires a TrimBox'), 't').code).toBe('PRINT_ERROR');
        expect(mapBuildError(new Error('outputIntent.iccProfile is too short to be an ICC profile'), 't').code).toBe('PRINT_ERROR');
        expect(mapBuildError(new Error('boom'), 'my_tool')).toMatchObject({ code: 'GENERATION_FAILED', message: 'my_tool: boom' });
        expect(mapBuildError('string throw', 't').code).toBe('GENERATION_FAILED');
        const passthrough = new ToolError('X', 'x');
        expect(mapBuildError(passthrough, 't')).toBe(passthrough);
    });
});

describe('generate_basic_pdf diagnostics', () => {
    it('pdfA without embedFonts reports PDFA_NO_FONT_ENTRIES when includeDiagnostics is set', async () => {
        const result = await generateBasicPdf({ ...BASE, pdfA: 'pdfa2b', includeDiagnostics: true });
        assertValidPdf(result.base64 as string);
        expect(result.diagnostics?.map((d) => d.code)).toContain('PDFA_NO_FONT_ENTRIES');
        expect(result.diagnostics?.[0]?.severity).toBe('warning');
    });

    it('strict escalates the diagnostic to PDF_A_COMPLIANCE_VIOLATION', async () => {
        await expect(generateBasicPdf({ ...BASE, pdfA: 'pdfa2b', strict: true })).rejects.toMatchObject({
            code: 'PDF_A_COMPLIANCE_VIOLATION',
        });
    });

    it('embedFonts + strict succeeds with an empty diagnostics list', async () => {
        const result = await generateBasicPdf({ ...BASE, pdfA: 'pdfa2b', strict: true, embedFonts: true, includeDiagnostics: true });
        assertValidPdf(result.base64 as string);
        expect(result.diagnostics).toEqual([]);
    });

    it('never writes diagnostics to console.warn (stdio transport stays clean)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const result = await generateBasicPdf({ ...BASE, pdfA: 'pdfa2b' });
        assertValidPdf(result.base64 as string);
        expect(warn).not.toHaveBeenCalled();
        expect(Object.keys(result)).not.toContain('diagnostics');
    });

    it('embedFonts changes the output bytes and remains a valid PDF', async () => {
        const plain = await generateBasicPdf(BASE);
        const embedded = await generateBasicPdf({ ...BASE, embedFonts: true });
        assertValidPdf(embedded.base64 as string);
        expect(embedded.base64).not.toBe(plain.base64);
        expect(embedded.sizeBytes).toBeGreaterThan(plain.sizeBytes);
    });

    it('absent diagnostic options keep the bytes identical to a call without the fields', async () => {
        // Strip the wall-clock /CreationDate (+ XMP dates) so a second boundary between the two calls cannot flake.
        const norm = (b64: string | undefined): string =>
            Buffer.from(b64 ?? '', 'base64').toString('latin1').replace(/D:\d{14}[^)]*\)/g, 'D:X)').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^<]*/g, 'T');
        const a = await generateBasicPdf(BASE);
        const b = await generateBasicPdf({ ...BASE, strict: false, includeDiagnostics: false, embedFonts: false });
        expect(norm(b.base64)).toBe(norm(a.base64));
        expect(Object.keys(b)).not.toContain('diagnostics');
    });

    it('includeDiagnostics on a non-PDF/A document returns an empty list', async () => {
        const result = await generateBasicPdf({ ...BASE, includeDiagnostics: true });
        expect(result.diagnostics).toEqual([]);
    });

    it('rejects a non-boolean strict flag', async () => {
        await expect(generateBasicPdf({ ...BASE, strict: 'yes' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});
