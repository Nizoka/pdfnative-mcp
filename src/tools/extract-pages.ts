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
 *   - Encrypted sources are rejected → `ENCRYPTED_SOURCE`.
 *   - Signatures and the `/AcroForm` are dropped; self-contained URI links are
 *     kept unless `dropAnnotations` is set.
 *   - Page indices are 0-based; order is preserved.
 */
import { extractPages, type MergeOptions } from 'pdfnative';
import { z } from 'zod';

import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { mapPageTreeError } from '../pagetree.js';

export const EXTRACT_PAGES_NAME = 'extract_pages';

export const EXTRACT_PAGES_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64', 'pages'],
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded source PDF. Must not be encrypted.',
        },
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
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64' },
        outputPath: { type: 'string' },
    },
} as const;

const InputSchema = z.object({
    pdfBase64: z.string().min(4),
    pages: z.array(z.number().int().min(0)).min(1).max(5000),
    dropAnnotations: z.boolean().default(false),
    maxOutputSizeBytes: z.number().int().positive().optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

function decodeBase64(value: string, field: string): Uint8Array {
    try {
        return new Uint8Array(Buffer.from(value, 'base64'));
    } catch {
        throw new ToolError('VALIDATION_ERROR', `${field} is not valid base64.`);
    }
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
    };

    let extracted: Uint8Array;
    try {
        extracted = extractPages(source, input.pages, opts);
    } catch (err) {
        mapPageTreeError(err);
    }

    return emitPdf(extracted, {
        mode: input.outputMode,
        ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
    });
}
