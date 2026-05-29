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

export const ADD_BARCODE_NAME = 'add_barcode';

export const ADD_BARCODE_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        format: {
            type: 'string',
            enum: ['qr', 'code128', 'ean13', 'datamatrix', 'pdf417'],
            description: 'Barcode symbology to render.',
        },
        data: {
            type: 'string',
            minLength: 1,
            maxLength: 4296,
            description: 'Payload to encode. Length and character constraints depend on format (e.g. EAN-13 must be 12 or 13 digits).',
        },
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
        width: {
            type: 'number',
            minimum: 30,
            maximum: 500,
            default: 200,
            description: 'Barcode width in PDF points.',
        },
        height: {
            type: 'number',
            minimum: 30,
            maximum: 500,
            default: 200,
            description: 'Barcode height in PDF points (ignored for square symbologies like QR/Data Matrix).',
        },
        ecLevel: {
            type: 'string',
            enum: ['L', 'M', 'Q', 'H'],
            default: 'M',
            description: 'QR error correction level (L=7%, M=15%, Q=25%, H=30%). Ignored for non-QR formats.',
        },
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: PDF_A_FIELD_DESCRIPTION,
        },
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64' },
        outputPath: { type: 'string' },
    },
    required: ['format', 'data'],
} as const;

const InputSchema = z.object({
    format: z.enum(['qr', 'code128', 'ean13', 'datamatrix', 'pdf417']),
    data: z.string().min(1).max(4296),
    caption: z.string().max(500).optional(),
    title: z.string().max(200).default('Barcode'),
    width: z.number().min(30).max(500).default(200),
    height: z.number().min(30).max(500).default(200),
    ecLevel: z.enum(['L', 'M', 'Q', 'H']).default('M'),
    pdfA: PdfASchema.optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function addBarcode(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { format, data, caption, title, width, height, ecLevel, pdfA, outputMode, outputPath } = parsed.data;

    if (format === 'ean13' && !/^\d{12,13}$/.test(data)) {
        throw new ToolError('VALIDATION_ERROR', 'EAN-13 data must be 12 or 13 digits.');
    }

    const blocks: DocumentBlock[] = [];
    if (caption !== undefined) {
        blocks.push({ type: 'paragraph', text: caption });
    }
    blocks.push({
        type: 'barcode',
        format,
        data,
        width,
        height,
        align: 'center',
        ...(format === 'qr' ? { ecLevel } : {}),
    });

    const bytes = buildDocumentPDFBytes({ title, blocks }, pdfA !== undefined ? { tagged: pdfA } : {});
    return emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) });
}
