/**
 * Tool: embed_image
 *
 * Generates a PDF document with an embedded image (JPEG or PNG) using
 * pdfnative's document builder. The image is accepted as a base64-encoded
 * string and can optionally be wrapped in a titled document with a caption.
 */
import { buildDocumentPDFBytes } from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { PDF_A_ENUM, PDF_A_FIELD_DESCRIPTION, PdfASchema } from '../pdfa.js';
import { PRINT_INPUT_PROPERTIES, PrintInputShape, assertPrintPdfACompatible, toDocumentMetadata, toPrintLayout } from '../print.js';
import { LAYOUT_INPUT_PROPERTIES, LayoutInputShape, assertLayoutPdfACompatible, toLayoutOptions } from '../layout.js';
import { BLOCK_ALIGN_ENUM } from '../barcode.js';
import { IMAGE_PAYLOAD_PROPERTIES, ImagePayloadShape, decodeImageBase64 } from '../image.js';
import { DIAGNOSTIC_INPUT_PROPERTIES, DiagnosticInputShape, collectDiagnostics, latinFontEntries, mapBuildError, withDiagnostics } from '../diagnostics.js';

export const EMBED_IMAGE_NAME = 'embed_image';

export const EMBED_IMAGE_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: {
            type: 'string',
            description: 'Document title rendered at the top and used as PDF metadata title.',
            minLength: 1,
            maxLength: 200,
        },
        ...IMAGE_PAYLOAD_PROPERTIES,
        caption: {
            type: 'string',
            maxLength: 500,
            description: 'Optional caption rendered below the image.',
        },
        width: {
            type: 'number',
            minimum: 10,
            maximum: 800,
            description: 'Render width in points. If omitted, the image is auto-sized to fit the page.',
        },
        height: {
            type: 'number',
            minimum: 10,
            maximum: 1000,
            description: 'Render height in points. If omitted, aspect ratio is preserved.',
        },
        align: {
            type: 'string',
            enum: [...BLOCK_ALIGN_ENUM],
            default: 'left',
            description: 'Horizontal placement of the image inside the content width.',
        },
        alt: {
            type: 'string',
            maxLength: 500,
            description: 'Accessible description of the image (tagged /Figure /Alt). Provide it for non-decorative images under PDF/A or PDF/UA.',
        },
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: PDF_A_FIELD_DESCRIPTION,
        },
        ...PRINT_INPUT_PROPERTIES,
        ...LAYOUT_INPUT_PROPERTIES,
        ...DIAGNOSTIC_INPUT_PROPERTIES,
        outputMode: {
            type: 'string',
            enum: ['base64', 'file'],
            default: 'base64',
            description:
                "Either 'base64' (returns the PDF inline) or 'file' (writes to a sandboxed path inside PDFNATIVE_MCP_OUTPUT_DIR).",
        },
        outputPath: {
            type: 'string',
            description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf.",
        },
    },
    required: ['title', 'imageBase64', 'mimeType'],
} as const;

const InputSchema = z.strictObject({
    title: z.string().min(1).max(200),
    ...ImagePayloadShape,
    caption: z.string().max(500).optional(),
    width: z.number().min(10).max(800).optional(),
    height: z.number().min(10).max(1000).optional(),
    align: z.enum(BLOCK_ALIGN_ENUM).default('left'),
    alt: z.string().max(500).optional(),
    pdfA: PdfASchema.optional(),
    ...PrintInputShape,
    ...LayoutInputShape,
    ...DiagnosticInputShape,
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function embedImage(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, imageBase64, mimeType, caption, width, height, align, alt, pdfA, print, outputIntent, metadata, creationDate, pageSize, margins, headerTemplate, footerTemplate, compress, debug, encrypt, strict, includeDiagnostics, embedFonts, outputMode, outputPath } = parsed.data;
    assertPrintPdfACompatible(print, pdfA);
    assertLayoutPdfACompatible({ encrypt }, pdfA);

    const imageBytes = decodeImageBase64(imageBase64, mimeType);

    const docMetadata = toDocumentMetadata(metadata);
    const fontEntries = await latinFontEntries(embedFonts);
    const collector = collectDiagnostics(strict);

    let bytes: Uint8Array;
    try {
        bytes = buildDocumentPDFBytes(
            {
                title,
                blocks: [
                    {
                        type: 'image',
                        data: imageBytes,
                        ...(width !== undefined ? { width } : {}),
                        ...(height !== undefined ? { height } : {}),
                        ...(align !== 'left' ? { align } : {}),
                        ...(alt !== undefined ? { alt } : {}),
                    },
                    ...(caption !== undefined
                        ? [{ type: 'paragraph' as const, text: caption }]
                        : []),
                ],
                ...(docMetadata !== undefined ? { metadata: docMetadata } : {}),
                ...(fontEntries.length > 0 ? { fontEntries } : {}),
            },
            {
                ...(pdfA !== undefined ? { tagged: pdfA } : {}),
                ...toPrintLayout({ print, outputIntent, creationDate }),
                ...toLayoutOptions({ pageSize, margins, headerTemplate, footerTemplate, compress, debug, encrypt }),
                ...collector.layout,
            },
        );
    } catch (err) {
        // PDF/A conformance and print-production failures keep their stable codes;
        // any other engine throw is an image decoding problem, as before.
        const mapped = mapBuildError(err, EMBED_IMAGE_NAME);
        if (mapped.code === 'PDF_A_COMPLIANCE_VIOLATION' || mapped.code === 'PRINT_ERROR') throw mapped;
        /* v8 ignore start - buildDocumentPDFBytes only throws on internal pdfnative errors; defensive guard. */
        const msg = err instanceof Error ? err.message : String(err);
        throw new ToolError('VALIDATION_ERROR', `Failed to embed image: ${msg}`);
        /* v8 ignore stop */
    }

    return withDiagnostics(
        await emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) }),
        collector,
        includeDiagnostics,
    );
}
