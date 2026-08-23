/**
 * Tool: add_barcode
 *
 * Generates a single-page PDF containing a barcode or QR code (optionally
 * accompanied by a caption). Supports five formats: QR, Code 128, EAN-13,
 * Data Matrix, and PDF417.
 */
import { buildDocumentPDFBytes, type DocumentBlock } from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { PDF_A_ENUM, PDF_A_FIELD_DESCRIPTION, PdfASchema } from '../pdfa.js';
import { PRINT_INPUT_PROPERTIES, PrintInputShape, assertPrintPdfACompatible, toDocumentMetadata, toPrintLayout } from '../print.js';
import { LAYOUT_INPUT_PROPERTIES, LayoutInputShape, toLayoutOptions } from '../layout.js';
import { BARCODE_BODY_PROPERTIES, BarcodeBodyShape, assertBarcodePayload, toBarcodeBlock } from '../barcode.js';
import { DIAGNOSTIC_INPUT_PROPERTIES, DiagnosticInputShape, collectDiagnostics, latinFontEntries, mapBuildError, withDiagnostics } from '../diagnostics.js';

export const ADD_BARCODE_NAME = 'add_barcode';

export const ADD_BARCODE_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        ...BARCODE_BODY_PROPERTIES,
        caption: {
            type: 'string',
            maxLength: 500,
            description: 'Optional caption rendered above the barcode.',
        },
        title: {
            type: 'string',
            maxLength: 200,
            default: 'Barcode',
            description: 'PDF document title (also rendered as page heading).',
        },
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: PDF_A_FIELD_DESCRIPTION,
        },
        ...PRINT_INPUT_PROPERTIES,
        ...LAYOUT_INPUT_PROPERTIES,
        ...DIAGNOSTIC_INPUT_PROPERTIES,
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64', description: "'base64' (default) returns the PDF inline; 'file' writes it inside the PDFNATIVE_MCP_OUTPUT_DIR sandbox (SECURITY_VIOLATION when the sandbox is not configured)." },
        outputPath: { type: 'string', description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf (no absolute paths, no '..')." },
    },
    required: ['format', 'data'],
} as const;

const InputSchema = z.strictObject({
    ...BarcodeBodyShape,
    caption: z.string().max(500).optional(),
    title: z.string().max(200).default('Barcode'),
    pdfA: PdfASchema.optional(),
    ...PrintInputShape,
    ...LayoutInputShape,
    ...DiagnosticInputShape,
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function addBarcode(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { format, data, caption, title, width, height, ecLevel, pdfA, print, outputIntent, metadata, creationDate, pageSize, margins, headerTemplate, footerTemplate, compress, debug, strict, includeDiagnostics, embedFonts, outputMode, outputPath } = parsed.data;
    assertPrintPdfACompatible(print, pdfA);

    assertBarcodePayload({ format, data });

    const blocks: DocumentBlock[] = [];
    if (caption !== undefined) {
        blocks.push({ type: 'paragraph', text: caption });
    }
    blocks.push(toBarcodeBlock({ format, data, width, height, ecLevel }, 'center'));

    const docMetadata = toDocumentMetadata(metadata);
    const fontEntries = await latinFontEntries(embedFonts);
    const collector = collectDiagnostics(strict);
    let bytes: Uint8Array;
    try {
        bytes = buildDocumentPDFBytes(
            {
                title,
                blocks,
                ...(docMetadata !== undefined ? { metadata: docMetadata } : {}),
                ...(fontEntries.length > 0 ? { fontEntries } : {}),
            },
            {
                ...(pdfA !== undefined ? { tagged: pdfA } : {}),
                ...toPrintLayout({ print, outputIntent, creationDate }),
                ...toLayoutOptions({ pageSize, margins, headerTemplate, footerTemplate, compress, debug }),
                ...collector.layout,
            },
        );
    } catch (err) {
        throw mapBuildError(err, ADD_BARCODE_NAME);
    }
    return withDiagnostics(
        await emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) }),
        collector,
        includeDiagnostics,
    );
}
