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
import { PDF_A_ENUM, PDF_A_FIELD_DESCRIPTION, PdfASchema } from '../pdfa.js';
import { WATERMARK_INPUT_SCHEMA, WatermarkSchema, toWatermarkOptions } from '../watermark.js';

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
        wrap: {
            type: 'string',
            enum: ['auto', 'always', 'never'],
            description: "Cell wrap policy (pdfnative v1.2). 'auto' (default) wraps only when a cell overflows; 'always' wraps every cell; 'never' uses v1.1 character truncation.",
        },
        repeatHeader: {
            type: 'boolean',
            description: 'Repeat the header row on every continuation page (pdfnative v1.2). Default true.',
        },
        zebra: {
            type: 'boolean',
            description: 'Enable zebra striping (alternate-row light tint, PDF/A-1b safe). pdfnative v1.2.',
        },
        caption: {
            type: 'string',
            maxLength: 200,
            description: 'Caption rendered above the table (and emitted as /Caption structure element in tagged/PDF/A mode). pdfnative v1.2.',
        },
        minRowHeight: {
            type: 'number',
            minimum: 1,
            maximum: 200,
            description: 'Minimum row height in points (default 12). pdfnative v1.2.',
        },
        cellPadding: {
            type: 'number',
            minimum: 0,
            maximum: 50,
            description: 'Horizontal cell padding in points applied to both insets (default 3). pdfnative v1.2.',
        },
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: PDF_A_FIELD_DESCRIPTION,
        },
        watermark: WATERMARK_INPUT_SCHEMA,
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
    wrap: z.enum(['auto', 'always', 'never']).optional(),
    repeatHeader: z.boolean().optional(),
    zebra: z.boolean().optional(),
    caption: z.string().max(200).optional(),
    minRowHeight: z.number().min(1).max(200).optional(),
    cellPadding: z.number().min(0).max(50).optional(),
    pdfA: PdfASchema.optional(),
    watermark: WatermarkSchema.optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function addTable(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, headers, rows, infoItems, footerText, autoFitColumns, clipCells, wrap, repeatHeader, zebra, caption, minRowHeight, cellPadding, pdfA, watermark, outputMode, outputPath } = parsed.data;

    // Validate column count consistency: every row must have the same length as headers
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].length !== headers.length) {
            throw new ToolError(
                'VALIDATION_ERROR',
                `Row ${i} has ${rows[i].length} cell(s) but headers defines ${headers.length} column(s).`,
            );
        }
    }

    const smartTableField = wrap !== undefined || repeatHeader !== undefined || zebra !== undefined || caption !== undefined || minRowHeight !== undefined || cellPadding !== undefined;
    const useDocumentBackend = autoFitColumns !== undefined || clipCells !== undefined || pdfA !== undefined || watermark !== undefined || smartTableField;

    let bytes: Uint8Array;
    if (useDocumentBackend) {
        const tableBlock: TableBlock = {
            type: 'table',
            headers,
            rows: rows.map((cells) => ({ cells, type: '', pointed: false })),
            ...(autoFitColumns !== undefined ? { autoFitColumns } : {}),
            ...(clipCells !== undefined ? { clipCells } : {}),
            ...(wrap !== undefined ? { wrap } : {}),
            ...(repeatHeader !== undefined ? { repeatHeader } : {}),
            ...(zebra !== undefined ? { zebra } : {}),
            ...(caption !== undefined ? { caption } : {}),
            ...(minRowHeight !== undefined ? { minRowHeight } : {}),
            ...(cellPadding !== undefined ? { cellPadding } : {}),
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
            {
                ...(pdfA !== undefined ? { tagged: pdfA } : {}),
                ...(watermark !== undefined ? { watermark: toWatermarkOptions(watermark) } : {}),
            },
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
