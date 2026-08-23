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
    estimateContentsSize,
    type AddSignaturePlaceholderOptions,
    type DocumentBlock,
    type SigDictMetadata,
} from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { PDF_A_ENUM, PDF_A_FIELD_DESCRIPTION, PdfASchema } from '../pdfa.js';
import { PRINT_INPUT_PROPERTIES, PrintInputShape, assertPrintPdfACompatible, toDocumentMetadata, toPrintLayout } from '../print.js';
import { LAYOUT_INPUT_PROPERTIES, LayoutInputShape, toLayoutOptions } from '../layout.js';

// Build-time encryption is not offered here: a signature placeholder must stay signable and a
// PDF/A-3 attachment container may not be encrypted (ISO 19005-1 §6.3.2).
const { encrypt: _encryptProperty, ...UNENCRYPTED_LAYOUT_PROPERTIES } = LAYOUT_INPUT_PROPERTIES;
const { encrypt: _encryptShape, ...UnencryptedLayoutShape } = LayoutInputShape;
void _encryptProperty;
void _encryptShape;
import { DIAGNOSTIC_INPUT_PROPERTIES, DiagnosticInputShape, collectDiagnostics, latinFontEntries, mapBuildError, withDiagnostics } from '../diagnostics.js';

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
        signingTime: {
            type: 'string',
            format: 'date-time',
            description: '/Sig /M — the claimed signing instant (ISO-8601), frozen into the placeholder dictionary. Omitted: the wall clock at placeholder time. Pin it (with creationDate) for byte-identical output across calls.',
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
            description: 'Reserved bytes for the future CMS /Contents blob (default 16384; 24576 when reserveTimestamp=true). Increase only for >4096-bit RSA, long chains or large TSA tokens.',
        },
        subFilter: {
            type: 'string',
            enum: ['adbe.pkcs7.detached', 'ETSI.CAdES.detached'],
            description: "Signature SubFilter baked into the /Sig dictionary (frozen at placeholder time). Use 'ETSI.CAdES.detached' for PAdES baseline signatures (sign_pdf profile='pades'). Default 'adbe.pkcs7.detached'.",
        },
        reserveTimestamp: {
            type: 'boolean',
            default: false,
            description: 'Reserve room for an RFC 3161 signature timestamp (sign_pdf timestamp=true): adds 8 KiB to the default placeholder size. Ignored when placeholderBytes is set explicitly.',
        },
        pageIndex: {
            type: 'integer',
            minimum: 0,
            description: 'Zero-based page index the (invisible) widget attaches to (default 0).',
        },
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: PDF_A_FIELD_DESCRIPTION + " The unsigned placeholder is NOT yet conformant (empty /Contents, ISO 19005-2 §6.4.3); it is once signed with sign_pdf profile:'pades'.",
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
        ...PRINT_INPUT_PROPERTIES,
        ...UNENCRYPTED_LAYOUT_PROPERTIES,
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
    required: ['title'],
} as const;

const BlockSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('heading'), text: z.string().min(1).max(500), level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
    z.strictObject({ type: z.literal('paragraph'), text: z.string().min(1).max(50000) }),
    z.strictObject({ type: z.literal('pageBreak') }),
    z.strictObject({ type: z.literal('spacer'), height: z.number().min(1).max(500) }),
]);

const InputSchema = z.strictObject({
    title: z.string().min(1).max(200),
    signerName: z.string().max(200).optional(),
    reason: z.string().max(500).optional(),
    location: z.string().max(200).optional(),
    contactInfo: z.string().max(200).optional(),
    signingTime: z.string().datetime({ offset: true }).optional(),
    fieldName: z.string().max(100).optional(),
    placeholderBytes: z.number().int().min(2048).max(65536).optional(),
    subFilter: z.enum(['adbe.pkcs7.detached', 'ETSI.CAdES.detached']).optional(),
    reserveTimestamp: z.boolean().default(false),
    pageIndex: z.number().int().min(0).optional(),
    pdfA: PdfASchema.optional(),
    blocks: z.array(BlockSchema).max(2000).optional(),
    ...PrintInputShape,
    ...UnencryptedLayoutShape,
    ...DiagnosticInputShape,
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
        signingTime,
        fieldName,
        placeholderBytes,
        subFilter,
        reserveTimestamp,
        pageIndex,
        pdfA,
        blocks,
        print,
        outputIntent,
        metadata,
        creationDate,
        pageSize,
        margins,
        headerTemplate,
        footerTemplate,
        compress,
        debug,
        strict,
        includeDiagnostics,
        embedFonts,
        outputMode,
        outputPath,
    } = parsed.data;
    assertPrintPdfACompatible(print, pdfA);

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

    const docMetadata = toDocumentMetadata(metadata);
    const fontEntries = await latinFontEntries(embedFonts);
    const collector = collectDiagnostics(strict);

    let baseBytes: Uint8Array;
    try {
        baseBytes = buildDocumentPDFBytes(
            {
                title,
                blocks: contentBlocks,
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
        throw mapBuildError(err, PREPARE_SIGNATURE_PLACEHOLDER_NAME);
    }

    // pdfnative 1.7: signer metadata is baked into the /Sig dictionary at
    // placeholder time (earlier engines silently dropped these values).
    const sigMetadata: SigDictMetadata = {
        ...(signerName !== undefined ? { name: signerName } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(contactInfo !== undefined ? { contactInfo } : {}),
        ...(signingTime !== undefined ? { signingTime: new Date(signingTime) } : {}),
        ...(subFilter !== undefined ? { subFilter } : {}),
    };
    const reserved = placeholderBytes ?? (reserveTimestamp ? estimateContentsSize([], 'rsa-sha256', { timestamp: true }) : undefined);
    const placeholderOptions: AddSignaturePlaceholderOptions = {
        ...(fieldName !== undefined ? { fieldName } : {}),
        ...(reserved !== undefined ? { placeholderBytes: reserved } : {}),
        ...(pageIndex !== undefined ? { pageIndex } : {}),
        ...(Object.keys(sigMetadata).length > 0 ? { metadata: sigMetadata } : {}),
    };

    const withPlaceholder = injectPlaceholderIntoBase(baseBytes, placeholderOptions);

    return withDiagnostics(
        await emitPdf(withPlaceholder, {
            mode: outputMode,
            ...(outputPath !== undefined ? { outputPath } : {}),
        }),
        collector,
        includeDiagnostics,
    );
}
