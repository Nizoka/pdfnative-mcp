/**
 * One minimal tool call per engine diagnostic code (pdfnative 1.9.0: thirteen).
 *
 * "Named means exercised": a code the documentation names is a code a test
 * TRIGGERS. tests/diagnostics-triggers.test.ts executes this table,
 * tests/engine-surface.test.ts holds its keys to `DIAGNOSTIC_CODES`
 * (src/diagnostics.ts), and the fuzz suite reuses the calls as seeds.
 */
import type { PdfDiagnosticCode } from 'pdfnative';

import { CMYK_INTENT, GRAY_INTENT, GRAY_V4_ICC_BASE64 } from './_icc-fixtures.js';
import { jp2Base64 } from './_jpx.js';

export interface DiagnosticTrigger {
    readonly tool: string;
    readonly args: Readonly<Record<string, unknown>>;
    /** The ToolError code `strict: true` turns this diagnostic into. */
    readonly strictCode: 'PDF_A_COMPLIANCE_VIOLATION' | 'PDF_X_COMPLIANCE_VIOLATION' | 'DIAGNOSTIC_ESCALATED';
}

/**
 * A 1×1 four-component (CMYK) JPEG, built here so no binary fixture is committed.
 * The engine embeds JPEG data as-is (/DCTDecode) and reads only the frame header
 * to learn the size and the component count — four means DeviceCMYK.
 */
function buildCmykJpegBase64(): string {
    const marker = (code: number, body: number[]): number[] => [0xff, code, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body];
    const bytes = [
        0xff, 0xd8, // SOI
        ...marker(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00]), // APP14 'Adobe', transform 0 = CMYK
        ...marker(0xdb, [0x00, ...Array.from({ length: 64 }, () => 1)]), // DQT
        ...marker(0xc0, [0x08, 0x00, 0x01, 0x00, 0x01, 0x04, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0x04, 0x11, 0x00]), // SOF0: 8 bit, 1×1, 4 components
        ...marker(0xda, [0x04, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00, 0x00, 0x3f, 0x00]), // SOS
        0x00,
        0xff, 0xd9, // EOI
    ];
    return Buffer.from(bytes).toString('base64');
}
const CMYK_JPEG_BASE64 = buildCmykJpegBase64();

const TEXT = [{ type: 'paragraph', text: 'Body text.' }];
const PINNED = { creationDate: '2026-01-15T09:00:00Z' };

export const DIAGNOSTIC_TRIGGERS: Readonly<Record<PdfDiagnosticCode, DiagnosticTrigger>> = {
    PDFA_NO_FONT_ENTRIES: {
        tool: 'generate_basic_pdf',
        args: { title: 'T', blocks: TEXT, pdfA: 'pdfa2b', ...PINNED },
        strictCode: 'PDF_A_COMPLIANCE_VIOLATION',
    },
    PDFA_UNEMBEDDED_FORM_FONT: {
        tool: 'add_form',
        args: { title: 'T', pdfA: 'pdfa2b', fields: [{ fieldType: 'text', name: 'n', label: 'N' }], ...PINNED },
        strictCode: 'PDF_A_COMPLIANCE_VIOLATION',
    },
    PDFA_DEVICE_CMYK_IMAGE: {
        tool: 'embed_image',
        args: { title: 'T', imageBase64: CMYK_JPEG_BASE64, mimeType: 'image/jpeg', pdfA: 'pdfa2b', embedFonts: true, ...PINNED },
        strictCode: 'PDF_A_COMPLIANCE_VIOLATION',
    },
    PDFA_DEVICE_CMYK_CONTENT: {
        tool: 'generate_basic_pdf',
        args: { title: 'T', blocks: TEXT, pdfA: 'pdfa2b', embedFonts: true, watermark: { text: 'CMYK', opacity: 1, color: '0 1 1 0' }, ...PINNED },
        strictCode: 'PDF_A_COMPLIANCE_VIOLATION',
    },
    PDFA_ICC_PROFILE_VERSION: {
        tool: 'generate_basic_pdf',
        args: { title: 'T', blocks: TEXT, pdfA: 'pdfa1b', embedFonts: true, outputIntent: { iccProfileBase64: GRAY_V4_ICC_BASE64, outputConditionIdentifier: 'Gray v4' }, ...PINNED },
        strictCode: 'PDF_A_COMPLIANCE_VIOLATION',
    },
    PDFX_NO_FONT_ENTRIES: {
        tool: 'generate_basic_pdf',
        args: { title: 'T', blocks: TEXT, pdfx: 'pdfx4', outputIntent: CMYK_INTENT, ...PINNED },
        strictCode: 'PDF_X_COMPLIANCE_VIOLATION',
    },
    PDFX_DEVICE_CMYK: {
        tool: 'generate_basic_pdf',
        args: { title: 'T', blocks: TEXT, pdfx: 'pdfx4', embedFonts: true, outputIntent: GRAY_INTENT, watermark: { text: 'CMYK', opacity: 1, color: [0, 100, 100, 0] }, ...PINNED },
        strictCode: 'PDF_X_COMPLIANCE_VIOLATION',
    },
    PDFX_ANNOTATIONS: {
        tool: 'generate_basic_pdf',
        args: { title: 'T', blocks: [{ type: 'link', text: 'site', url: 'https://example.com' }], pdfx: 'pdfx4', embedFonts: true, outputIntent: CMYK_INTENT, ...PINNED },
        strictCode: 'PDF_X_COMPLIANCE_VIOLATION',
    },
    TYPOGRAPHY_FEATURE_INEFFECTIVE: {
        tool: 'generate_basic_pdf',
        args: { title: 'T', blocks: TEXT, embedFonts: true, typography: { fontFeatures: ['tnum'] }, ...PINNED },
        strictCode: 'DIAGNOSTIC_ESCALATED',
    },
    // pdfnative 1.9.0 — JPEG 2000 is PDF 1.5: PDF/A-1 (PDF 1.4) has no JPXDecode filter.
    PDFA1_JPX_IMAGE: {
        tool: 'embed_image',
        args: { title: 'T', imageBase64: jp2Base64(1), mimeType: 'image/jp2', pdfA: 'pdfa1b', embedFonts: true, ...PINNED },
        strictCode: 'PDF_A_COMPLIANCE_VIOLATION',
    },
    // A JP2 whose cdef box declares an opacity channel (ISO 19005-2 §6.2.8.3 forbids /SMaskInData).
    PDFA_JPX_IMAGE: {
        tool: 'embed_image',
        args: { title: 'T', imageBase64: jp2Base64(4, { alpha: true }), mimeType: 'image/jp2', pdfA: 'pdfa2b', embedFonts: true, ...PINNED },
        strictCode: 'PDF_A_COMPLIANCE_VIOLATION',
    },
    // Level U: a character the embedded Latin font does not cover is drawn as glyph 0, which no
    // ToUnicode entry names. Every bundled shaper reports its glyphs since 1.9.0, so this is the
    // only trigger left — and the engine reports the ROOT CAUSE first (TEXT_GLYPH_NOT_COVERED names
    // the character), then the level-U consequence: `strict` stops at the first, so it escalates to
    // DIAGNOSTIC_ESCALATED; `includeDiagnostics` lists both, in that order.
    PDFA_GLYPH_WITHOUT_UNICODE: {
        tool: 'generate_basic_pdf',
        args: { title: 'T', blocks: [{ type: 'paragraph', text: 'Level U with a CJK character: 漢' }], pdfA: 'pdfa2u', embedFonts: true, ...PINNED },
        strictCode: 'DIAGNOSTIC_ESCALATED',
    },
    // Base-14 Helvetica cannot write a character outside WinAnsiEncoding: the engine writes '?' and says so.
    TEXT_GLYPH_NOT_COVERED: {
        tool: 'generate_basic_pdf',
        args: { title: 'T', blocks: [{ type: 'paragraph', text: 'An arrow → outside WinAnsi' }], ...PINNED },
        strictCode: 'DIAGNOSTIC_ESCALATED',
    },
};
