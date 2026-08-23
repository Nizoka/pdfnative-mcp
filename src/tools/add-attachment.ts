/**
 * Tool: add_attachment
 *
 * Generates a PDF/A-3 document with one or more embedded files
 * (ISO 19005-3 §6.8). Primary use case: Factur-X / ZUGFeRD electronic
 * invoices, where a structured XML payload is attached to a human-readable
 * PDF invoice with `relationship: 'Source'`.
 *
 * Implementation:
 *   - Delegates to pdfnative's `buildDocumentPDFBytes` with the `attachments`
 *     option and `tagged: 'pdfa3b'`. pdfnative validates that attachments are
 *     only allowed under PDF/A-3.
 *   - PDF/A-3 is enforced (pdfnative throws otherwise); the input schema
 *     does not expose the pdfA flag for that reason.
 *
 * Limitations:
 *   - Only document generation (not "add attachment to existing PDF"). The
 *     latter requires page-tree manipulation primitives not exported by
 *     pdfnative v1.2 and is tracked for v1.1 of pdfnative-mcp.
 */
import {
    buildDocumentPDFBytes,
    type DocumentBlock,
    type PdfAttachment,
    type PdfAttachmentRelationship,
} from 'pdfnative';
import { z } from 'zod';

import { ToolError } from '../errors.js';
import { emitPdf, type OutputResult } from '../output.js';
import { PRINT_INPUT_PROPERTIES, PrintInputShape, toDocumentMetadata, toPrintLayout } from '../print.js';
import { DIAGNOSTIC_INPUT_PROPERTIES, DiagnosticInputShape, collectDiagnostics, latinFontEntries, mapBuildError, withDiagnostics } from '../diagnostics.js';

export const ADD_ATTACHMENT_NAME = 'add_attachment';

const RELATIONSHIPS: readonly PdfAttachmentRelationship[] = [
    'Source',
    'Data',
    'Alternative',
    'Supplement',
    'Unspecified',
];

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MiB per attachment.

export const ADD_ATTACHMENT_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'attachments'],
    properties: {
        title: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description: 'Document title (also written to the /Info dictionary).',
        },
        blocks: {
            type: 'array',
            description:
                'Optional human-readable document body (same block schema as generate_basic_pdf). When omitted, a minimal cover paragraph is emitted so the PDF is not empty.',
            maxItems: 200,
            items: { type: 'object' },
        },
        footerText: {
            type: 'string',
            maxLength: 200,
            description: 'Optional footer text rendered on every page.',
        },
        attachments: {
            type: 'array',
            description:
                'One or more files to embed. Auto-enables PDF/A-3 (ISO 19005-3). Factur-X invoices use a single attachment with relationship=Source and mimeType=application/xml.',
            minItems: 1,
            maxItems: 20,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['filename', 'mimeType', 'dataBase64'],
                properties: {
                    filename: { type: 'string', minLength: 1, maxLength: 255 },
                    mimeType: { type: 'string', minLength: 1, maxLength: 200 },
                    dataBase64: { type: 'string', minLength: 1 },
                    relationship: { type: 'string', enum: [...RELATIONSHIPS] },
                    description: { type: 'string', maxLength: 500 },
                },
            },
        },
        ...PRINT_INPUT_PROPERTIES,
        ...DIAGNOSTIC_INPUT_PROPERTIES,
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64' },
        outputPath: { type: 'string' },
    },
} as const;

const InputSchema = z.strictObject({
    title: z.string().min(1).max(200),
    blocks: z.array(z.unknown()).max(200).optional(),
    footerText: z.string().max(200).optional(),
    attachments: z
        .array(
            z.strictObject({
                filename: z.string().min(1).max(255),
                mimeType: z.string().min(1).max(200),
                dataBase64: z.string().min(1),
                relationship: z.enum(['Source', 'Data', 'Alternative', 'Supplement', 'Unspecified']).optional(),
                description: z.string().max(500).optional(),
            }),
        )
        .min(1)
        .max(20),
    ...PrintInputShape,
    ...DiagnosticInputShape,
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

function decodeAttachmentBytes(b64: string, filename: string): Uint8Array {
    let bytes: Uint8Array;
    try {
        bytes = new Uint8Array(Buffer.from(b64, 'base64'));
        /* v8 ignore next 3 */
    } catch {
        throw new ToolError('VALIDATION_ERROR', `attachment '${filename}': dataBase64 is not valid base64.`);
    }
    if (bytes.length === 0) {
        throw new ToolError('VALIDATION_ERROR', `attachment '${filename}': decoded payload is empty.`);
    }
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
        throw new ToolError(
            'ATTACHMENT_TOO_LARGE',
            `attachment '${filename}': ${bytes.length} bytes exceeds the ${MAX_ATTACHMENT_BYTES}-byte per-attachment cap.`,
        );
    }
    return bytes;
}

export async function addAttachment(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, blocks, footerText, attachments, print, outputIntent, metadata, creationDate, strict, includeDiagnostics, embedFonts, outputMode, outputPath } = parsed.data;

    const docBlocks: DocumentBlock[] =
        blocks !== undefined && blocks.length > 0
            ? (blocks as DocumentBlock[])
            : [{ type: 'paragraph', text: 'This PDF/A-3 document carries one or more embedded files. Open the attachments panel of your PDF reader to access them.' }];

    const pdfAttachments: PdfAttachment[] = attachments.map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        data: decodeAttachmentBytes(a.dataBase64, a.filename),
        ...(a.relationship !== undefined ? { relationship: a.relationship } : {}),
        ...(a.description !== undefined ? { description: a.description } : {}),
    }));

    const docMetadata = toDocumentMetadata(metadata);
    const fontEntries = await latinFontEntries(embedFonts);
    const collector = collectDiagnostics(strict);

    let bytes: Uint8Array;
    try {
        bytes = buildDocumentPDFBytes(
            {
                title,
                blocks: docBlocks,
                ...(footerText !== undefined ? { footerText } : {}),
                ...(docMetadata !== undefined ? { metadata: docMetadata } : {}),
                ...(fontEntries.length > 0 ? { fontEntries } : {}),
            },
            {
                tagged: 'pdfa3b',
                attachments: pdfAttachments,
                ...toPrintLayout({ print, outputIntent, creationDate }),
                ...collector.layout,
            },
        );
    } catch (err) {
        // PDF/A conformance and print-production failures keep their stable codes;
        // any other engine throw is an attachment build failure, as before.
        const mapped = mapBuildError(err, ADD_ATTACHMENT_NAME);
        if (mapped.code === 'PDF_A_COMPLIANCE_VIOLATION' || mapped.code === 'PRINT_ERROR') throw mapped;
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('ATTACHMENT_BUILD_FAILED', message);
    }

    return withDiagnostics(
        await emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) }),
        collector,
        includeDiagnostics,
    );
}
