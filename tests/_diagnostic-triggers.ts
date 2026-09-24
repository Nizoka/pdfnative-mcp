/**
 * One minimal tool call per engine diagnostic code (pdfnative 1.8.0: nine).
 *
 * "Named means exercised": a code the documentation names is a code a test
 * TRIGGERS. tests/diagnostics-triggers.test.ts executes this table,
 * tests/engine-surface.test.ts holds its keys to `DIAGNOSTIC_CODES`
 * (src/diagnostics.ts), and the fuzz suite reuses the calls as seeds.
 */
import type { PdfDiagnosticCode } from 'pdfnative';

import { CMYK_INTENT, GRAY_INTENT, GRAY_V4_ICC_BASE64 } from './_icc-fixtures.js';

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
};
