/**
 * Tool: split_pdf
 *
 * Splits a single PDF into several documents — one per requested page range —
 * using pdfnative's page-tree manipulation API (`splitPdf`, new in pdfnative
 * v1.4.0). Each output is a fresh, self-contained PDF.
 *
 * Multi-output: in base64 mode every produced PDF is returned inline (one
 * `resource` block each); in file mode each PDF is written to a 1-based indexed
 * sibling of `outputPath` (`out.pdf` → `out-1.pdf`, `out-2.pdf`, …).
 *
 * Faithful-wrapper notes (pdfnative semantics):
 *   - Encrypted sources are rejected → `ENCRYPTED_SOURCE`.
 *   - Signatures and the `/AcroForm` are dropped; self-contained URI links are
 *     kept unless `dropAnnotations` is set.
 *   - Ranges are 0-based and inclusive; `end` defaults to `start`.
 */
import { splitPdf, type MergeOptions, type PageRange } from 'pdfnative';
import { z } from 'zod';

import { emitPdfMulti, type MultiOutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { mapPageTreeError } from '../pagetree.js';

export const SPLIT_PDF_NAME = 'split_pdf';

export const SPLIT_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64', 'ranges'],
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded source PDF. Must not be encrypted.',
        },
        ranges: {
            type: 'array',
            description:
                'Page ranges to extract, one output PDF per range. 0-based, inclusive; `end` defaults to `start` (a single page).',
            minItems: 1,
            maxItems: 1000,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['start'],
                properties: {
                    start: { type: 'integer', minimum: 0, description: 'First page index (0-based, inclusive).' },
                    end: { type: 'integer', minimum: 0, description: 'Last page index (0-based, inclusive). Defaults to start.' },
                },
            },
        },
        dropAnnotations: {
            type: 'boolean',
            default: false,
            description: 'When true, drop ALL annotations. Default keeps self-contained URI link annotations.',
        },
        maxOutputSizeBytes: {
            type: 'integer',
            minimum: 1,
            description: 'Maximum size, in bytes, of each produced PDF. Defaults to 268435456 (256 MiB).',
        },
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64' },
        outputPath: {
            type: 'string',
            description: "Base output path (file mode). Each PDF is written to an indexed sibling: 'out.pdf' → 'out-1.pdf', 'out-2.pdf', …",
        },
    },
} as const;

const InputSchema = z.object({
    pdfBase64: z.string().min(4),
    ranges: z
        .array(
            z
                .object({
                    start: z.number().int().min(0),
                    end: z.number().int().min(0).optional(),
                })
                .superRefine((r, ctx) => {
                    if (r.end !== undefined && r.end < r.start) {
                        ctx.addIssue({ code: 'custom', message: `range end (${r.end}) must be >= start (${r.start}).` });
                    }
                }),
        )
        .min(1)
        .max(1000),
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

export async function splitPdfTool(rawInput: unknown): Promise<MultiOutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const input = parsed.data;

    const source = decodeBase64(input.pdfBase64, 'pdfBase64');
    const ranges: PageRange[] = input.ranges.map((r) => (r.end !== undefined ? { start: r.start, end: r.end } : { start: r.start }));

    const opts: MergeOptions = {
        dropAnnotations: input.dropAnnotations,
        ...(input.maxOutputSizeBytes !== undefined ? { maxOutputSize: input.maxOutputSizeBytes } : {}),
    };

    let parts: Uint8Array[];
    try {
        parts = splitPdf(source, ranges, opts);
    } catch (err) {
        mapPageTreeError(err);
    }

    return emitPdfMulti(parts, {
        mode: input.outputMode,
        ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
    });
}
