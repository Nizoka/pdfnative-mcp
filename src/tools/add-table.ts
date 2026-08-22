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
import { buildDocumentPDFBytes, buildPDFBytes, type CellBorders, type DocumentBlock, type TableBlock } from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { PDF_A_ENUM, PDF_A_FIELD_DESCRIPTION, PdfASchema } from '../pdfa.js';
import {
    WATERMARK_INPUT_SCHEMA,
    WatermarkSchema,
    toWatermarkOptions,
    assertWatermarkPdfACompatible,
} from '../watermark.js';
import {
    VIEWER_PREFERENCES_INPUT_SCHEMA,
    ViewerPreferencesSchema,
    toViewerPreferences,
} from '../doc-features.js';
import { PRINT_INPUT_PROPERTIES, PrintInputShape, assertPrintPdfACompatible, toDocumentMetadata, toPrintLayout } from '../print.js';
import { DIAGNOSTIC_INPUT_PROPERTIES, DiagnosticInputShape, collectDiagnostics, latinFontEntries, mapBuildError, withDiagnostics } from '../diagnostics.js';

const CELL_BORDER_STYLES = ['solid', 'dashed', 'dotted'] as const;
const CELL_VALIGNS = ['top', 'middle', 'bottom'] as const;

const CELL_BORDERS_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    description:
        'Per-cell vector borders (pdfnative v1.4). Switches the backend to buildDocumentPDFBytes. Choose individual sides or `all`.',
    properties: {
        top: { type: 'boolean' },
        right: { type: 'boolean' },
        bottom: { type: 'boolean' },
        left: { type: 'boolean' },
        all: { type: 'boolean', description: 'Draw all four edges (overrides the individual side flags).' },
        color: { type: 'string', description: "Stroke colour as a PDF operator string ('0.8 0.8 0.8') or hex. Default light grey." },
        width: { type: 'number', minimum: 0, maximum: 10, description: 'Stroke width in points (default 0.5).' },
        style: { type: 'string', enum: [...CELL_BORDER_STYLES], description: "Stroke style (default 'solid')." },
    },
} as const;

const CellBordersSchema = z.object({
    top: z.boolean().optional(),
    right: z.boolean().optional(),
    bottom: z.boolean().optional(),
    left: z.boolean().optional(),
    all: z.boolean().optional(),
    color: z.string().min(1).max(64).optional(),
    width: z.number().min(0).max(10).optional(),
    style: z.enum(CELL_BORDER_STYLES).optional(),
});

function toCellBorders(value: z.infer<typeof CellBordersSchema>): CellBorders {
    return {
        ...(value.top !== undefined ? { top: value.top } : {}),
        ...(value.right !== undefined ? { right: value.right } : {}),
        ...(value.bottom !== undefined ? { bottom: value.bottom } : {}),
        ...(value.left !== undefined ? { left: value.left } : {}),
        ...(value.all !== undefined ? { all: value.all } : {}),
        ...(value.color !== undefined ? { color: value.color } : {}),
        ...(value.width !== undefined ? { width: value.width } : {}),
        ...(value.style !== undefined ? { style: value.style } : {}),
    };
}

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
        cellBorders: CELL_BORDERS_INPUT_SCHEMA,
        cellVAlign: {
            type: 'string',
            enum: [...CELL_VALIGNS],
            description: 'Vertical alignment of cell content (pdfnative v1.4). Switches the backend to buildDocumentPDFBytes.',
        },
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: PDF_A_FIELD_DESCRIPTION,
        },
        watermark: WATERMARK_INPUT_SCHEMA,
        viewerPreferences: VIEWER_PREFERENCES_INPUT_SCHEMA,
        ...PRINT_INPUT_PROPERTIES,
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
    cellBorders: CellBordersSchema.optional(),
    cellVAlign: z.enum(CELL_VALIGNS).optional(),
    pdfA: PdfASchema.optional(),
    watermark: WatermarkSchema.optional(),
    viewerPreferences: ViewerPreferencesSchema.optional(),
    ...PrintInputShape,
    ...DiagnosticInputShape,
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function addTable(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, headers, rows, infoItems, footerText, autoFitColumns, clipCells, wrap, repeatHeader, zebra, caption, minRowHeight, cellPadding, cellBorders, cellVAlign, pdfA, watermark, viewerPreferences, print, outputIntent, metadata, strict, includeDiagnostics, embedFonts, outputMode, outputPath } = parsed.data;
    assertWatermarkPdfACompatible(watermark, pdfA);
    assertPrintPdfACompatible(print, pdfA);

    // Validate column count consistency: every row must have the same length as headers
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].length !== headers.length) {
            throw new ToolError(
                'VALIDATION_ERROR',
                `Row ${i} has ${rows[i].length} cell(s) but headers defines ${headers.length} column(s).`,
            );
        }
    }

    const smartTableField = wrap !== undefined || repeatHeader !== undefined || zebra !== undefined || caption !== undefined || minRowHeight !== undefined || cellPadding !== undefined || cellBorders !== undefined || cellVAlign !== undefined;
    const useDocumentBackend = autoFitColumns !== undefined || clipCells !== undefined || pdfA !== undefined || watermark !== undefined || smartTableField;

    const collector = collectDiagnostics(strict);
    const layout = {
        ...(viewerPreferences !== undefined ? { viewerPreferences: toViewerPreferences(viewerPreferences) } : {}),
        ...toPrintLayout({ print, outputIntent }),
        ...collector.layout,
    };
    const docMetadata = toDocumentMetadata(metadata);
    const fontEntries = await latinFontEntries(embedFonts);
    const sharedParams = {
        ...(docMetadata !== undefined ? { metadata: docMetadata } : {}),
        ...(fontEntries.length > 0 ? { fontEntries } : {}),
    };

    let bytes: Uint8Array;
    try {
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
                ...(cellBorders !== undefined ? { cellBorders: toCellBorders(cellBorders) } : {}),
                ...(cellVAlign !== undefined ? { cellVAlign } : {}),
            };
            const blocks: DocumentBlock[] = [];
            if (infoItems !== undefined && infoItems.length > 0) {
                for (const item of infoItems) {
                    blocks.push({ type: 'paragraph', text: `${item.label}: ${item.value}` });
                }
            }
            blocks.push(tableBlock);
            bytes = buildDocumentPDFBytes(
                { title, blocks, ...(footerText !== undefined ? { footerText } : {}), ...sharedParams },
                {
                    ...(pdfA !== undefined ? { tagged: pdfA } : {}),
                    ...(watermark !== undefined ? { watermark: toWatermarkOptions(watermark) } : {}),
                    ...layout,
                },
            );
        } else {
            bytes = buildPDFBytes(
                {
                    title,
                    infoItems: (infoItems ?? []).map((item) => ({ label: item.label, value: item.value })),
                    balanceText: '',
                    countText: '',
                    headers,
                    rows: rows.map((cells) => ({ cells, type: '', pointed: false })),
                    footerText: footerText ?? '',
                    ...sharedParams,
                },
                layout,
            );
        }
    } catch (err) {
        throw mapBuildError(err, ADD_TABLE_NAME);
    }

    return withDiagnostics(
        await emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) }),
        collector,
        includeDiagnostics,
    );
}
