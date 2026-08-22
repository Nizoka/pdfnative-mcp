/**
 * Tool: add_chart
 *
 * Generate a single-page PDF containing a native vector chart (pdfnative
 * v1.6.0 `ChartBlock`) — bar, horizontal-bar, line (optional markers), pie or
 * donut — rendered as pure PDF path operators (zero dependencies, no
 * rasterisation). Multi-series bar/line, legends, "nice" axis ticks, gridlines,
 * negative values and a tagged-PDF `/Figure` + `/Alt` (auto-generated when
 * `altText` is omitted, so PDF/A output stays conformant).
 *
 * For a chart embedded amongst headings / paragraphs / tables, use a `chart`
 * block inside `generate_basic_pdf` instead; this tool is the focused,
 * discoverable single-chart entry point (both build identical pdfnative blocks
 * via `toChartBlock`).
 */
import { buildDocumentPDFBytes, type DocumentBlock } from 'pdfnative';
import { z } from 'zod';

import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { CHART_BODY_PROPERTIES, ChartBodySchema, toChartBlock } from '../chart.js';
import { PDF_A_ENUM, PDF_A_FIELD_DESCRIPTION, PdfASchema } from '../pdfa.js';
import { PRINT_INPUT_PROPERTIES, PrintInputShape, assertPrintPdfACompatible, toDocumentMetadata, toPrintLayout } from '../print.js';
import { DIAGNOSTIC_INPUT_PROPERTIES, DiagnosticInputShape, collectDiagnostics, latinFontEntries, mapBuildError, withDiagnostics } from '../diagnostics.js';

export const ADD_CHART_NAME = 'add_chart';

export const ADD_CHART_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['chartType', 'series'],
    properties: {
        intro: {
            type: 'string',
            maxLength: 2000,
            description: 'Optional introductory paragraph rendered above the chart. The chart `title` (if any) is also used as the PDF metadata title.',
        },
        ...CHART_BODY_PROPERTIES,
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: PDF_A_FIELD_DESCRIPTION,
        },
        ...PRINT_INPUT_PROPERTIES,
        ...DIAGNOSTIC_INPUT_PROPERTIES,
        outputMode: {
            type: 'string',
            enum: ['base64', 'file'],
            default: 'base64',
            description: "Either 'base64' (returns the PDF inline) or 'file' (writes into the PDFNATIVE_MCP_OUTPUT_DIR sandbox).",
        },
        outputPath: { type: 'string', description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf." },
    },
} as const;

const InputSchema = ChartBodySchema.extend({
    intro: z.string().max(2000).optional(),
    pdfA: PdfASchema.optional(),
    ...PrintInputShape,
    ...DiagnosticInputShape,
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function addChart(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { intro, pdfA, print, outputIntent, metadata, strict, includeDiagnostics, embedFonts, outputMode, outputPath, ...chartBody } = parsed.data;
    assertPrintPdfACompatible(print, pdfA);

    const blocks: DocumentBlock[] = [];
    if (intro !== undefined) blocks.push({ type: 'paragraph', text: intro });
    blocks.push(toChartBlock(chartBody));

    const docMetadata = toDocumentMetadata(metadata);
    const fontEntries = await latinFontEntries(embedFonts);
    const collector = collectDiagnostics(strict);

    let bytes: Uint8Array;
    try {
        bytes = buildDocumentPDFBytes(
            {
                title: chartBody.title ?? 'Chart',
                blocks,
                ...(docMetadata !== undefined ? { metadata: docMetadata } : {}),
                ...(fontEntries.length > 0 ? { fontEntries } : {}),
            },
            {
                ...(pdfA !== undefined ? { tagged: pdfA } : {}),
                ...toPrintLayout({ print, outputIntent }),
                ...collector.layout,
            },
        );
    } catch (err) {
        // PDF/A conformance and print-production failures keep their stable codes;
        // everything else is a chart rendering failure, as before.
        const mapped = mapBuildError(err, ADD_CHART_NAME);
        if (mapped.code === 'PDF_A_COMPLIANCE_VIOLATION' || mapped.code === 'PRINT_ERROR') throw mapped;
        throw new ToolError('CHART_ERROR', `Failed to render chart: ${err instanceof Error ? err.message : String(err)}`);
    }

    return withDiagnostics(
        await emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) }),
        collector,
        includeDiagnostics,
    );
}
