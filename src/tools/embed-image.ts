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
        imageBase64: {
            type: 'string',
            description: 'Base64-encoded image bytes. Supports JPEG and PNG formats.',
            minLength: 4,
        },
        mimeType: {
            type: 'string',
            enum: ['image/jpeg', 'image/png'],
            description: 'MIME type of the image. Must match the actual encoding of imageBase64.',
        },
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
        outputMode: {
            type: 'string',
            enum: ['base64', 'file'],
            default: 'base64',
            description:
                "Either 'base64' (returns the PDF inline) or 'file' (writes to a sandboxed path inside PDFNATIVE_MPC_OUTPUT_DIR).",
        },
        outputPath: {
            type: 'string',
            description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf.",
        },
    },
    required: ['title', 'imageBase64', 'mimeType'],
} as const;

const InputSchema = z.object({
    title: z.string().min(1).max(200),
    imageBase64: z.string().min(4),
    mimeType: z.enum(['image/jpeg', 'image/png']),
    caption: z.string().max(500).optional(),
    width: z.number().min(10).max(800).optional(),
    height: z.number().min(10).max(1000).optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function embedImage(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, imageBase64, mimeType, caption, width, height, outputMode, outputPath } = parsed.data;

    // Decode base64 to raw bytes
    let imageBytes: Uint8Array;
    try {
        const buf = Buffer.from(imageBase64, 'base64');
        // Validate the decoded length is non-trivial (base64 of valid image)
        if (buf.length < 8) {
            throw new Error('Decoded image is too small to be a valid JPEG or PNG.');
        }
        imageBytes = new Uint8Array(buf);
    } catch (err) {
        throw new ToolError(
            'VALIDATION_ERROR',
            `Failed to decode imageBase64: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    // Validate magic bytes match mimeType
    if (mimeType === 'image/jpeg') {
        if (imageBytes[0] !== 0xff || imageBytes[1] !== 0xd8) {
            throw new ToolError('VALIDATION_ERROR', "Image bytes do not match mimeType 'image/jpeg' (missing JPEG magic bytes FF D8).");
        }
    } else {
        // PNG: magic is 89 50 4E 47 0D 0A 1A 0A
        if (
            imageBytes[0] !== 0x89 ||
            imageBytes[1] !== 0x50 ||
            imageBytes[2] !== 0x4e ||
            imageBytes[3] !== 0x47
        ) {
            throw new ToolError('VALIDATION_ERROR', "Image bytes do not match mimeType 'image/png' (missing PNG magic bytes 89 50 4E 47).");
        }
    }

    let bytes: Uint8Array;
    try {
        bytes = buildDocumentPDFBytes({
            title,
            blocks: [
                {
                    type: 'image',
                    data: imageBytes,
                    ...(width !== undefined ? { width } : {}),
                    ...(height !== undefined ? { height } : {}),
                },
                ...(caption !== undefined
                    ? [{ type: 'paragraph' as const, text: caption }]
                    : []),
            ],
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ToolError('VALIDATION_ERROR', `Failed to embed image: ${msg}`);
    }

    return emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) });
}
