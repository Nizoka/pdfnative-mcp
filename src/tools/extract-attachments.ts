/**
 * Tool: extract_attachments
 *
 * Read-only extraction of embedded files from an existing PDF. Walks the
 * catalog name tree (`/Names → /EmbeddedFiles → Names[]`) via pdfnative's
 * hardened `openPdf()` reader and returns each attachment's metadata plus,
 * by default, its decoded payload as base64.
 *
 * Primary use case: the **Factur-X / ZUGFeRD round-trip** — pull the structured
 * XML back out of an invoice produced by `add_attachment` (and confirmed by
 * `inspect_pdf`) for downstream parsing or archival.
 *
 * Design:
 *   - Shares the `collectEmbeddedFiles()` collector with `inspect_pdf` so the
 *     reported metadata is byte-for-byte consistent between the two tools.
 *   - `includeData` (default true) toggles whether the decoded bytes are
 *     returned. Set it false for a cheap "what is attached?" probe.
 *   - `filename` filters to a single attachment by exact name.
 *   - Encrypted PDFs are rejected with `EXTRACTION_UNSUPPORTED` (the reader
 *     cannot decrypt; consistent with `extract_text`).
 *   - Each returned payload is capped at 16 MiB; the aggregate at 32 MiB.
 */
import { openPdf, type PdfReader } from 'pdfnative';
import { z } from 'zod';

import { ToolError } from '../errors.js';
import { decodePdfBase64 } from '../base64.js';
import { collectEmbeddedFiles } from '../pdf-introspection.js';
import { mapDecryptError, PASSWORD_INPUT_SCHEMA, PasswordSchema } from '../encryption.js';

export const EXTRACT_ATTACHMENTS_NAME = 'extract_attachments';

/** Per-attachment payload cap (decoded bytes). */
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
/** Aggregate payload cap across all returned attachments. */
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

export const EXTRACT_ATTACHMENTS_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64'],
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded PDF bytes to read embedded files from.',
        },
        password: PASSWORD_INPUT_SCHEMA,
        filename: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            description: 'Optional exact attachment name to extract. When omitted, every embedded file is returned.',
        },
        includeData: {
            type: 'boolean',
            default: true,
            description:
                'When true (default) each attachment carries its decoded payload as dataBase64. Set false for a metadata-only probe (names, sizes, relationships) with no payload bytes.',
        },
        verbosity: {
            type: 'string',
            enum: ['summary', 'full'],
            default: 'full',
            description:
                "Response verbosity. 'full' (default) returns the attachments[] array; 'summary' returns a token-frugal { attachmentCount } and drops the array.",
        },
        fields: {
            type: 'array',
            description:
                "Optional dot-path projection applied to the structured result (e.g. ['attachments.name']). Composes after verbosity. Unknown paths are omitted.",
            maxItems: 16,
            items: { type: 'string', minLength: 1 },
        },
    },
} as const;

export const EXTRACT_ATTACHMENTS_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['attachmentCount', 'attachments'],
    properties: {
        attachmentCount: { type: 'integer', minimum: 0 },
        attachments: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['name'],
                properties: {
                    name: { type: 'string' },
                    sizeBytes: { type: 'integer', minimum: 0 },
                    mimeType: { type: 'string' },
                    relationship: { type: 'string' },
                    description: { type: 'string' },
                    dataBase64: {
                        type: 'string',
                        description: 'Decoded file bytes, base64-encoded. Present only when includeData is true.',
                    },
                },
            },
        },
    },
} as const;

const InputSchema = z.object({
    pdfBase64: z.string().min(4),
    password: PasswordSchema.optional(),
    filename: z.string().min(1).max(255).optional(),
    includeData: z.boolean().default(true),
    verbosity: z.enum(['summary', 'full']).optional(),
    fields: z.array(z.string().min(1)).max(16).optional(),
});

export interface ExtractedAttachment {
    readonly name: string;
    readonly sizeBytes?: number;
    readonly mimeType?: string;
    readonly relationship?: string;
    readonly description?: string;
    readonly dataBase64?: string;
}

export interface ExtractAttachmentsResult {
    readonly attachmentCount: number;
    readonly attachments: readonly ExtractedAttachment[];
}

function decodeBase64(value: string): Uint8Array {
    return decodePdfBase64(value, 'pdfBase64');
}

export async function extractAttachments(rawInput: unknown): Promise<ExtractAttachmentsResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { filename, includeData, password } = parsed.data;

    const pdfBytes = decodeBase64(parsed.data.pdfBase64);
    if (pdfBytes.length === 0) {
        throw new ToolError('VALIDATION_ERROR', 'pdfBase64 decoded to an empty buffer.');
    }

    // pdfnative v1.6.0 decrypts transparently — encrypted sources are now
    // supported via `password` (empty-user-password docs open without one).
    let reader: PdfReader;
    try {
        reader = openPdf(pdfBytes, password !== undefined ? { password } : undefined);
    } catch (err) {
        mapDecryptError(err, password !== undefined);
    }

    const files = collectEmbeddedFiles(reader, { includeData });
    const selected = filename !== undefined ? files.filter((f) => f.name === filename) : files;

    if (filename !== undefined && selected.length === 0) {
        throw new ToolError('ATTACHMENT_NOT_FOUND', `No embedded file named '${filename}' was found.`);
    }

    let total = 0;
    const attachments: ExtractedAttachment[] = selected.map((f) => {
        const att: {
            -readonly [K in keyof ExtractedAttachment]: ExtractedAttachment[K];
        } = { name: f.name };
        if (f.sizeBytes !== undefined) att.sizeBytes = f.sizeBytes;
        if (f.mimeType !== undefined) att.mimeType = f.mimeType;
        if (f.relationship !== undefined) att.relationship = f.relationship;
        if (f.description !== undefined) att.description = f.description;
        if (includeData && f.data !== undefined) {
            if (f.data.length > MAX_ATTACHMENT_BYTES) {
                throw new ToolError(
                    'OUTPUT_TOO_LARGE',
                    `attachment '${f.name}' (${f.data.length} bytes) exceeds the per-file extraction cap (${MAX_ATTACHMENT_BYTES} bytes).`,
                );
            }
            total += f.data.length;
            if (total > MAX_TOTAL_BYTES) {
                throw new ToolError(
                    'OUTPUT_TOO_LARGE',
                    `total extracted payload exceeds the aggregate cap (${MAX_TOTAL_BYTES} bytes). Use the filename filter or includeData:false.`,
                );
            }
            att.dataBase64 = Buffer.from(f.data).toString('base64');
        }
        return att;
    });

    return { attachmentCount: attachments.length, attachments };
}
