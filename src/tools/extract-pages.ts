/**
 * Tool: extract_pages
 *
 * Extracts an arbitrary subset of pages from a PDF into a single new document,
 * in the order given, using pdfnative's page-tree manipulation API
 * (`extractPages`, new in pdfnative v1.4.0). The output is a fresh,
 * self-contained PDF.
 *
 * Use `split_pdf` instead when you need several output PDFs (one per range);
 * `extract_pages` always produces exactly one PDF.
 *
 * Faithful-wrapper notes (pdfnative semantics):
 *   - Encrypted sources open with `password`; missing / wrong password →
 *     `PASSWORD_REQUIRED` / `PASSWORD_INVALID`.
 *   - Signatures and the `/AcroForm` are dropped; self-contained URI links are
 *     kept unless `dropAnnotations` is set.
 *   - Page indices are 0-based; order is preserved.
 */
import { extractPages, type MergeOptions } from 'pdfnative';
import { z } from 'zod';

import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { decodePdfBase64 } from '../base64.js';
import { mapPageTreeError } from '../pagetree.js';
import {
    ENCRYPT_INPUT_SCHEMA,
    EncryptSchema,
    PASSWORD_INPUT_SCHEMA,
    PasswordSchema,
    toEncryptionOptions,
} from '../encryption.js';

export const EXTRACT_PAGES_NAME = 'extract_pages';

export const EXTRACT_PAGES_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64', 'pages'],
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded source PDF. Pass `password` for an encrypted source.',
        },
        password: PASSWORD_INPUT_SCHEMA,
        encrypt: ENCRYPT_INPUT_SCHEMA,
        pages: {
            type: 'array',
            description: '0-based page indices to keep, in output order. Duplicates and out-of-range indices are rejected.',
            minItems: 1,
            maxItems: 5000,
            items: { type: 'integer', minimum: 0 },
        },
        dropAnnotations: {
            type: 'boolean',
            default: false,
            description: 'When true, drop ALL annotations. Default keeps self-contained URI link annotations.',
        },
        maxOutputSizeBytes: {
            type: 'integer',
            minimum: 1,
            description: 'Maximum size, in bytes, of the produced PDF. Defaults to 268435456 (256 MiB).',
        },
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64', description: "'base64' (default) returns the PDF inline; 'file' writes it inside the PDFNATIVE_MCP_OUTPUT_DIR sandbox (SECURITY_VIOLATION when the sandbox is not configured)." },
        outputPath: { type: 'string', description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf (no absolute paths, no '..')." },
    },
} as const;

const InputSchema = z.strictObject({
    pdfBase64: z.string().min(4),
    password: PasswordSchema.optional(),
    encrypt: EncryptSchema.optional(),
    pages: z.array(z.number().int().min(0)).min(1).max(5000),
    dropAnnotations: z.boolean().default(false),
    maxOutputSizeBytes: z.number().int().positive().optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

function decodeBase64(value: string, field: string): Uint8Array {
    return decodePdfBase64(value, field);
}

export async function extractPagesTool(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const input = parsed.data;

    const source = decodeBase64(input.pdfBase64, 'pdfBase64');

    const opts: MergeOptions = {
        dropAnnotations: input.dropAnnotations,
        ...(input.maxOutputSizeBytes !== undefined ? { maxOutputSize: input.maxOutputSizeBytes } : {}),
        ...(input.password !== undefined ? { password: input.password } : {}),
        ...(input.encrypt !== undefined ? { encrypt: toEncryptionOptions(input.encrypt) } : {}),
    };

    let extracted: Uint8Array;
    try {
        extracted = extractPages(source, input.pages, opts);
    } catch (err) {
        mapPageTreeError(err, input.password !== undefined);
    }

    return emitPdf(extracted, {
        mode: input.outputMode,
        ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
    });
}
