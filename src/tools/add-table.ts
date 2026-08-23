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
 *     in pdfnative v1.1. `debug` (layout overlay) is document-backend only and
 *     forces it too; the other layout options (pageSize, margins, header /
 *     footer templates, compress) are honoured by both backends.
 */
import { buildDocumentPDFBytes, buildPDFBytes, type DocumentBlock } from 'pdfnative';
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
import { LAYOUT_INPUT_PROPERTIES, LayoutInputShape, toLayoutOptions } from '../layout.js';
import { TABLE_BODY_PROPERTIES, TableBodyShape, assertRowsMatchHeaders, hasSmartTableOption, toTableBlock } from '../table.js';
import { DIAGNOSTIC_INPUT_PROPERTIES, DiagnosticInputShape, collectDiagnostics, latinFontEntries, mapBuildError, withDiagnostics } from '../diagnostics.js';

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
        ...TABLE_BODY_PROPERTIES,
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
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: PDF_A_FIELD_DESCRIPTION,
        },
        watermark: WATERMARK_INPUT_SCHEMA,
        viewerPreferences: VIEWER_PREFERENCES_INPUT_SCHEMA,
        ...PRINT_INPUT_PROPERTIES,
        ...LAYOUT_INPUT_PROPERTIES,
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

const InputSchema = z.strictObject({
    title: z.string().min(1).max(200),
    ...TableBodyShape,
    infoItems: z
        .array(
            z.strictObject({
                label: z.string().min(1).max(100),
                value: z.string().max(500),
            }),
        )
        .max(20)
        .optional(),
    footerText: z.string().max(200).optional(),
    pdfA: PdfASchema.optional(),
    watermark: WatermarkSchema.optional(),
    viewerPreferences: ViewerPreferencesSchema.optional(),
    ...PrintInputShape,
    ...LayoutInputShape,
    ...DiagnosticInputShape,
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function addTable(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, headers, rows, infoItems, footerText, autoFitColumns, clipCells, wrap, repeatHeader, zebra, caption, minRowHeight, cellPadding, cellBorders, cellVAlign, pdfA, watermark, viewerPreferences, print, outputIntent, metadata, creationDate, pageSize, margins, headerTemplate, footerTemplate, compress, debug, strict, includeDiagnostics, embedFonts, outputMode, outputPath } = parsed.data;
    assertWatermarkPdfACompatible(watermark, pdfA);
    assertPrintPdfACompatible(print, pdfA);

    const tableBody = { headers, rows, autoFitColumns, clipCells, wrap, repeatHeader, zebra, caption, minRowHeight, cellPadding, cellBorders, cellVAlign };
    assertRowsMatchHeaders(tableBody);

    const useDocumentBackend = autoFitColumns !== undefined || clipCells !== undefined || pdfA !== undefined || watermark !== undefined || debug !== undefined || hasSmartTableOption(tableBody);

    const collector = collectDiagnostics(strict);
    const layout = {
        ...(viewerPreferences !== undefined ? { viewerPreferences: toViewerPreferences(viewerPreferences) } : {}),
        ...toPrintLayout({ print, outputIntent, creationDate }),
        ...toLayoutOptions({ pageSize, margins, headerTemplate, footerTemplate, compress, debug }),
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
            const tableBlock = toTableBlock(tableBody);
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
