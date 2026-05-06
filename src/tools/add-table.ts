/**
 * Tool: add_table
 *
 * Generates a tabular PDF report from a title, column headers, and data rows
 * using pdfnative's table/report builder. Ideal for data exports, financial
 * summaries, schedules, and any content that fits naturally into rows and columns.
 *
 * Backends:
 *   - Default: `buildPDFBytes` (PdfParams) — byte-identical with v0.2.0 callers.
 *   - When `autoFitColumns` and/or `clipCells` is set, switches to
 *     `buildDocumentPDFBytes` + `TableBlock` since those props live on TableBlock
 *     in pdfnative v1.1.
 */
import { buildDocumentPDFBytes, buildPDFBytes, type DocumentBlock, type TableBlock } from 'pdfnative';
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
        autoFitColumns: {
            type: 'boolean',
            description:
                'When true, column widths auto-fit content (pdfnative v1.1). Switches the backend to buildDocumentPDFBytes; byte output differs from the default path.',
        },
        clipCells: {
            type: 'boolean',
            description:
                'When true, cell contents are clipped to column bounds via PDF clip-path operators (pdfnative v1.1). Recommended for PDF/A and visual safety. Switches the backend to buildDocumentPDFBytes.',
        },
        pdfA: {
            type: 'string',
            enum: ['pdfa1b', 'pdfa2b', 'pdfa2u', 'pdfa3b'],
            description: 'Optional PDF/A conformance level. Mutually exclusive with PDF encryption.',
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
    autoFitColumns: z.boolean().optional(),
    clipCells: z.boolean().optional(),
    pdfA: z.enum(['pdfa1b', 'pdfa2b', 'pdfa2u', 'pdfa3b']).optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function addTable(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, headers, rows, infoItems, footerText, autoFitColumns, clipCells, pdfA, outputMode, outputPath } = parsed.data;

    // Validate column count consistency: every row must have the same length as headers
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].length !== headers.length) {
            throw new ToolError(
                'VALIDATION_ERROR',
                `Row ${i} has ${rows[i].length} cell(s) but headers defines ${headers.length} column(s).`,
            );
        }
    }

    const useDocumentBackend = autoFitColumns !== undefined || clipCells !== undefined || pdfA !== undefined;

    let bytes: Uint8Array;
    if (useDocumentBackend) {
        const tableBlock: TableBlock = {
            type: 'table',
            headers,
            rows: rows.map((cells) => ({ cells, type: '', pointed: false })),
            ...(autoFitColumns !== undefined ? { autoFitColumns } : {}),
            ...(clipCells !== undefined ? { clipCells } : {}),
        };
        const blocks: DocumentBlock[] = [];
        if (infoItems !== undefined && infoItems.length > 0) {
            for (const item of infoItems) {
                blocks.push({ type: 'paragraph', text: `${item.label}: ${item.value}` });
            }
        }
        blocks.push(tableBlock);
        bytes = buildDocumentPDFBytes(
            { title, blocks, ...(footerText !== undefined ? { footerText } : {}) },
            pdfA !== undefined ? { tagged: pdfA } : {},
        );
    } else {
        bytes = buildPDFBytes({
            title,
            infoItems: (infoItems ?? []).map((item) => ({ label: item.label, value: item.value })),
            balanceText: '',
            countText: '',
            headers,
            rows: rows.map((cells) => ({ cells, type: '', pointed: false })),
            footerText: footerText ?? '',
        });
    }

    return emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) });
}
