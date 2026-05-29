/**
 * Tool: prepare_signature_placeholder
 *
 * Creates a PDF document with an embedded /Sig placeholder (AcroForm + Widget annotation)
 * that is ready to be signed with the `sign_pdf` tool. The produced PDF conforms to the
 * PAdES structure expected by pdfnative's `signPdfBytes`.
 *
 * Workflow:
 *   1. Call prepare_signature_placeholder → outputs a .pdf with /Contents and /ByteRange placeholders
 *   2. Pass that PDF to sign_pdf together with a certificate and private key → signed PDF
 *
 * v1.0.0 — collapsed onto pdfnative v1.2.0's `addSignaturePlaceholder()` API
 * (closes upstream issue https://github.com/Nizoka/pdfnative/issues/45).
 * The previous local incremental-update implementation has been removed:
 * the upstream primitive is byte-stable, idempotent on already-signed PDFs,
 * and centralises a class of fragile xref / /ByteRange bookkeeping.
 */
import {
    addSignaturePlaceholder,
    buildDocumentPDFBytes,
    type AddSignaturePlaceholderOptions,
    type DocumentBlock,
} from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { PDF_A_ENUM, PDF_A_FIELD_DESCRIPTION, PdfASchema } from '../pdfa.js';

export const PREPARE_SIGNATURE_PLACEHOLDER_NAME = 'prepare_signature_placeholder';

export const PREPARE_SIGNATURE_PLACEHOLDER_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: {
            type: 'string',
            description: 'Document title. Used as the PDF metadata title and rendered at the top of page 1.',
            minLength: 1,
            maxLength: 200,
        },
        signerName: {
            type: 'string',
            maxLength: 200,
            description: 'Name of the intended signer, embedded in the /Sig dictionary.',
        },
        reason: {
            type: 'string',
            maxLength: 500,
            description: 'Reason for signing (e.g. "Approved", "I agree to the terms").',
        },
        location: {
            type: 'string',
            maxLength: 200,
            description: 'Signing location (city / country).',
        },
        contactInfo: {
            type: 'string',
            maxLength: 200,
            description: 'Contact information for the signer.',
        },
        fieldName: {
            type: 'string',
            maxLength: 100,
            description: "Optional AcroForm field name for the signature widget (default 'Signature1').",
        },
        placeholderBytes: {
            type: 'integer',
            minimum: 2048,
            maximum: 65536,
            description: 'Reserved bytes for the future CMS /Contents blob (default 16384). Increase only for >4096-bit RSA or PAdES-B-LT.',
        },
        pageIndex: {
            type: 'integer',
            minimum: 0,
            description: 'Zero-based page index the (invisible) widget attaches to (default 0).',
        },
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: PDF_A_FIELD_DESCRIPTION + ' Note: PDF/A + signatures requires PAdES-A; verify with inspect_pdf.',
        },
        blocks: {
            type: 'array',
            description: 'Optional document body blocks rendered before the signature field.',
            maxItems: 2000,
            items: {
                oneOf: [
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'text', 'level'],
                        properties: {
                            type: { const: 'heading' },
                            text: { type: 'string', minLength: 1, maxLength: 500 },
                            level: { type: 'integer', enum: [1, 2, 3] },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'text'],
                        properties: {
                            type: { const: 'paragraph' },
                            text: { type: 'string', minLength: 1, maxLength: 50000 },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type'],
                        properties: {
                            type: { const: 'pageBreak' },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'height'],
                        properties: {
                            type: { const: 'spacer' },
                            height: { type: 'number', minimum: 1, maximum: 500 },
                        },
                    },
                ],
            },
        },
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
    required: ['title'],
} as const;

const BlockSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('heading'), text: z.string().min(1).max(500), level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
    z.object({ type: z.literal('paragraph'), text: z.string().min(1).max(50000) }),
    z.object({ type: z.literal('pageBreak') }),
    z.object({ type: z.literal('spacer'), height: z.number().min(1).max(500) }),
]);

const InputSchema = z.object({
    title: z.string().min(1).max(200),
    signerName: z.string().max(200).optional(),
    reason: z.string().max(500).optional(),
    location: z.string().max(200).optional(),
    contactInfo: z.string().max(200).optional(),
    fieldName: z.string().max(100).optional(),
    placeholderBytes: z.number().int().min(2048).max(65536).optional(),
    pageIndex: z.number().int().min(0).optional(),
    pdfA: PdfASchema.optional(),
    blocks: z.array(BlockSchema).max(2000).optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

/**
 * Build the (unsigned) base document and inject a `/Sig` placeholder via
 * pdfnative's `addSignaturePlaceholder()`. Exported for re-use by `sign_pdf`'s
 * `autoInjectPlaceholder` code path.
 */
export function injectPlaceholderIntoBase(
    baseBytes: Uint8Array,
    opts: AddSignaturePlaceholderOptions,
): Uint8Array {
    try {
        return addSignaturePlaceholder(baseBytes, opts);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('PLACEHOLDER_FAILED', `Failed to inject signature placeholder: ${message}`);
    }
}

export async function prepareSignaturePlaceholder(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const {
        title,
        signerName,
        reason,
        location,
        contactInfo,
        fieldName,
        placeholderBytes,
        pageIndex,
        pdfA,
        blocks,
        outputMode,
        outputPath,
    } = parsed.data;

    const contentBlocks: DocumentBlock[] = (blocks ?? []).map((b): DocumentBlock => {
        switch (b.type) {
            case 'heading': return { type: 'heading', text: b.text, level: b.level };
            case 'paragraph': return { type: 'paragraph', text: b.text };
            case 'pageBreak': return { type: 'pageBreak' };
            case 'spacer': return { type: 'spacer', height: b.height };
        }
    });

    if (contentBlocks.length === 0) {
        contentBlocks.push({ type: 'paragraph', text: 'This document contains a digital signature field.' });
    }

    const baseBytes = buildDocumentPDFBytes(
        { title, blocks: contentBlocks },
        pdfA !== undefined ? { tagged: pdfA } : {},
    );

    const placeholderOptions: AddSignaturePlaceholderOptions = {
        ...(fieldName !== undefined ? { fieldName } : {}),
        ...(placeholderBytes !== undefined ? { placeholderBytes } : {}),
        ...(pageIndex !== undefined ? { pageIndex } : {}),
        ...(signerName !== undefined ? { name: signerName } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(contactInfo !== undefined ? { contactInfo } : {}),
    };

    const withPlaceholder = injectPlaceholderIntoBase(baseBytes, placeholderOptions);

    return emitPdf(withPlaceholder, {
        mode: outputMode,
        ...(outputPath !== undefined ? { outputPath } : {}),
    });
}
