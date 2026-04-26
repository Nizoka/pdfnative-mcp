/**
 * Tool: add_table
 *
 * Generates a tabular PDF report from a title, column headers, and data rows
 * using pdfnative's table/report builder. Ideal for data exports, financial
 * summaries, schedules, and any content that fits naturally into rows and columns.
 */
import { buildPDFBytes } from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';

export const ADD_TABLE_NAME = 'add_table';

export const ADD_TABLE_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: {
            type: 'string',
            description: 'Report title rendered at the top of the document and used as PDF metadata title.',
            minLength: 1,
            maxLength: 200,
        },
        headers: {
            type: 'array',
            description: 'Column header labels. Must have the same length as each row in `rows`.',
            minItems: 1,
            maxItems: 50,
            items: { type: 'string', minLength: 1, maxLength: 200 },
        },
        rows: {
            type: 'array',
            description: 'Data rows. Each row is an array of cell strings with the same length as `headers`.',
            minItems: 1,
            maxItems: 5000,
            items: {
                type: 'array',
                minItems: 1,
                maxItems: 50,
                items: { type: 'string', maxLength: 500 },
            },
        },
        infoItems: {
            type: 'array',
            description: 'Optional key-value metadata rows rendered below the title (e.g. date, author).',
            maxItems: 20,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['label', 'value'],
                properties: {
                    label: { type: 'string', minLength: 1, maxLength: 100 },
                    value: { type: 'string', maxLength: 500 },
                },
            },
        },
        footerText: {
            type: 'string',
            maxLength: 200,
            description: 'Optional text rendered at the bottom of every page.',
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
    required: ['title', 'headers', 'rows'],
} as const;

const InputSchema = z.object({
    title: z.string().min(1).max(200),
    headers: z.array(z.string().min(1).max(200)).min(1).max(50),
    rows: z.array(z.array(z.string().max(500)).min(1).max(50)).min(1).max(5000),
    infoItems: z
        .array(
            z.object({
                label: z.string().min(1).max(100),
                value: z.string().max(500),
            }),
        )
        .max(20)
        .optional(),
    footerText: z.string().max(200).optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function addTable(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, headers, rows, infoItems, footerText, outputMode, outputPath } = parsed.data;

    // Validate column count consistency: every row must have the same length as headers
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].length !== headers.length) {
            throw new ToolError(
                'VALIDATION_ERROR',
                `Row ${i} has ${rows[i].length} cell(s) but headers defines ${headers.length} column(s).`,
            );
        }
    }

    const bytes = buildPDFBytes({
        title,
        infoItems: (infoItems ?? []).map((item) => ({ label: item.label, value: item.value })),
        balanceText: '',
        countText: '',
        headers,
        rows: rows.map((cells) => ({ cells, type: '', pointed: false })),
        footerText: footerText ?? '',
    });

    return emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) });
}
