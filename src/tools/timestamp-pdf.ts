/**
 * Tool: timestamp_pdf — PAdES B-LTA: append a document timestamp
 * (`/Type /DocTimeStamp`, `/SubFilter /ETSI.RFC3161`, ISO 32000-2 §12.8.5)
 * covering the whole document, obtained from the **operator-configured**
 * RFC 3161 authority (`PDFNATIVE_MCP_TSA_URL`). The token is verified
 * (imprint, nonce, status) by pdfnative before it is embedded; a rejected or
 * tampered response is never written.
 *
 * Re-run periodically (before the previous TSA certificate expires) to
 * extend the archival chain — when `fieldName` is omitted the engine
 * auto-suffixes (`DocTimeStamp1`, `DocTimeStamp2`, …). Fails fast with `TSA_NOT_CONFIGURED` when no TSA is
 * configured: the server never contacts the network otherwise.
 */
import { addDocumentTimestamp } from 'pdfnative';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { ToolError } from '../errors.js';
import { requireTimestampProvider } from '../network.js';
import { emitPdf, type OutputResult } from '../output.js';

export const TIMESTAMP_PDF_NAME = 'timestamp_pdf';

export const TIMESTAMP_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64'],
    properties: {
        pdfBase64: { type: 'string', minLength: 4, description: 'Base64-encoded PDF (unencrypted). Typically already signed (+ add_ltv) — a document timestamp on an unsigned PDF is allowed but proves only existence at that time.' },
        fieldName: {
            type: 'string',
            pattern: '^[A-Za-z0-9_.\\- ]{1,127}$',
            description: "Signature field name for the timestamp. Omit it to get 'DocTimeStamp1', 'DocTimeStamp2', … auto-suffixed on each re-timestamp; an explicit name that collides with an existing signed field fails.",
        },
        placeholderBytes: {
            type: 'integer',
            minimum: 4096,
            maximum: 65536,
            description: 'Room reserved for the TimeStampToken (default 12288). Raise it for TSAs that return large certificate chains.',
        },
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64' },
        outputPath: { type: 'string', description: "Relative path inside PDFNATIVE_MCP_OUTPUT_DIR (required when outputMode='file')." },
    },
} as const;

const InputSchema = z.strictObject({
    pdfBase64: z.string().min(4),
    fieldName: z.string().regex(/^[A-Za-z0-9_.\- ]{1,127}$/).optional(),
    placeholderBytes: z.number().int().min(4096).max(65536).optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

function mapTimestampError(err: unknown): ToolError {
    if (err instanceof ToolError) return err;
    const message = err instanceof Error ? err.message : String(err);
    if (/TSA rejected the request|TSA token message imprint|TSA token nonce mismatch|^RFC 3161:/.test(message)) {
        return new ToolError('TSA_REJECTED', `The timestamp authority's response was rejected: ${message}`);
    }
    if (/encrypt/i.test(message)) {
        return new ToolError('ENCRYPTED_SOURCE', 'timestamp_pdf does not support encrypted PDFs. Run decrypt_pdf first.');
    }
    if (/xref|startxref|trailer|%PDF|parse/i.test(message)) {
        return new ToolError('PDF_PARSE_FAILED', `Failed to parse PDF: ${message}`);
    }
    return new ToolError('LTV_ERROR', `Failed to add the document timestamp: ${message}`);
}

export async function timestampPdf(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const input = parsed.data;

    // Fail fast before touching the document when no TSA is configured.
    const timestampProvider = requireTimestampProvider();
    const pdf = new Uint8Array(Buffer.from(input.pdfBase64, 'base64'));

    let out: Uint8Array;
    try {
        out = await addDocumentTimestamp(pdf, {
            timestampProvider,
            timestampNonce: BigInt(`0x${randomBytes(8).toString('hex')}`),
            ...(input.fieldName !== undefined ? { fieldName: input.fieldName } : {}),
            ...(input.placeholderBytes !== undefined ? { placeholderBytes: input.placeholderBytes } : {}),
        });
    } catch (err) {
        throw mapTimestampError(err);
    }

    return emitPdf(out, {
        mode: input.outputMode,
        ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
    });
}
