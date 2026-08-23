/**
 * `update_metadata` — rewrite the document-information dictionary (`/Info`)
 * of an existing PDF as a non-destructive incremental update, keeping the XMP
 * packet in sync (ISO 19005 §6.7.3 parity) via pdfnative 1.7's
 * `PdfModifier.updateMetadata()`.
 *
 * Notes for agents:
 *   - Incremental: earlier bytes (and any existing signatures over them) are
 *     preserved verbatim; the new revision itself is unsigned, so re-run
 *     `sign_pdf` / `timestamp_pdf` afterwards if the document must stay
 *     signed at the latest revision.
 *   - `/ModDate` is always refreshed (defaults to now — pass `modDate` for
 *     reproducible bytes).
 *   - Encrypted sources are rejected (`ENCRYPTED_SOURCE`): decrypt first with
 *     `decrypt_pdf`, update, then `encrypt_pdf` again.
 */
import { createModifier, openPdf, PdfEncryptionUnsupportedError, PdfPasswordError, type PdfMetadataUpdate, type PdfReader } from 'pdfnative';
import { z } from 'zod';

import { ToolError } from '../errors.js';
import { decodePdfBase64 } from '../base64.js';
import { emitPdf, type OutputResult } from '../output.js';

export const UPDATE_METADATA_NAME = 'update_metadata';

const TEXT_FIELD = { type: 'string', maxLength: 1000 } as const;

export const UPDATE_METADATA_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64'],
    properties: {
        pdfBase64: { type: 'string', minLength: 1, description: 'Base64-encoded PDF to update (unencrypted).' },
        title: { ...TEXT_FIELD, description: 'New /Info /Title (mirrored to XMP dc:title when the document carries XMP).' },
        author: { ...TEXT_FIELD, description: 'New /Info /Author (XMP dc:creator).' },
        subject: { ...TEXT_FIELD, description: 'New /Info /Subject (XMP dc:description).' },
        keywords: { ...TEXT_FIELD, description: 'New /Info /Keywords (XMP pdf:Keywords).' },
        modDate: {
            type: 'string',
            format: 'date-time',
            description: 'ISO-8601 modification instant for /ModDate and xmp:ModifyDate. Defaults to now; pin it for reproducible output.',
        },
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64', description: "'base64' (default) returns the PDF inline; 'file' writes it inside the PDFNATIVE_MCP_OUTPUT_DIR sandbox (SECURITY_VIOLATION when the sandbox is not configured)." },
        outputPath: { type: 'string', description: "Relative path inside PDFNATIVE_MCP_OUTPUT_DIR (required when outputMode='file')." },
    },
} as const;

const InputSchema = z
    .strictObject({
        pdfBase64: z.string().min(1),
        title: z.string().max(1000).optional(),
        author: z.string().max(1000).optional(),
        subject: z.string().max(1000).optional(),
        keywords: z.string().max(1000).optional(),
        modDate: z.string().datetime({ offset: true }).optional(),
        outputMode: z.enum(['base64', 'file']).default('base64'),
        outputPath: z.string().optional(),
    })
    .refine((v) => v.title !== undefined || v.author !== undefined || v.subject !== undefined || v.keywords !== undefined, {
        message: 'At least one of title, author, subject or keywords is required.',
    });

function decodeBase64(b64: string): Uint8Array {
    return decodePdfBase64(b64, 'pdfBase64');
}

export async function updateMetadata(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const input = parsed.data;

    const bytes = decodeBase64(input.pdfBase64);
    let reader: PdfReader;
    try {
        reader = openPdf(bytes);
    } catch (err) {
        if (err instanceof PdfPasswordError || err instanceof PdfEncryptionUnsupportedError) {
            throw new ToolError('ENCRYPTED_SOURCE', 'update_metadata does not support encrypted PDFs. Run decrypt_pdf first, update, then encrypt_pdf again.');
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('PDF_PARSE_FAILED', `Failed to parse PDF: ${message}`);
    }
    if (reader.trailer.get('Encrypt') !== undefined) {
        throw new ToolError(
            'ENCRYPTED_SOURCE',
            'update_metadata does not support encrypted PDFs. Run decrypt_pdf first, update, then encrypt_pdf again.',
        );
    }

    const update: PdfMetadataUpdate = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.author !== undefined ? { author: input.author } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.keywords !== undefined ? { keywords: input.keywords } : {}),
        ...(input.modDate !== undefined ? { modDate: new Date(input.modDate) } : {}),
    };

    let out: Uint8Array;
    try {
        const modifier = createModifier(reader);
        modifier.updateMetadata(update);
        out = modifier.save();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('METADATA_ERROR', `Failed to update metadata: ${message}`);
    }

    return emitPdf(out, {
        mode: input.outputMode,
        ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
    });
}
