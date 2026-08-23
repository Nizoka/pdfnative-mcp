/**
 * Tool: generate_basic_pdf
 *
 * Generates a multi-page PDF document from structured blocks — headings,
 * paragraphs, lists, tables, images, links, a printed table of contents,
 * barcodes, SVG drawings, form fields and charts (every DocumentBlock kind the
 * engine offers) — using pdfnative's document builder. The most general-purpose
 * tool: use it whenever you need a "regular" PDF (reports, letters, articles,
 * invoices, manuals). The inline blocks share their schemas with the dedicated
 * tools (add_table, embed_image, add_barcode, add_form, add_chart).
 */
import { buildDocumentPDFBytes, type DocumentBlock } from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { splitParagraphSegments } from '../text.js';
import { CHART_BODY_PROPERTIES, ChartBodySchema, toChartBlock } from '../chart.js';
import { EXTENDED_BLOCK_SCHEMAS, ExtendedBlockSchemas, createBlockContext, toExtendedBlock } from '../blocks.js';
import { PDF_A_ENUM, PDF_A_FIELD_DESCRIPTION, PdfASchema } from '../pdfa.js';
import { NORMALIZE_ENUM, NORMALIZE_FIELD_DESCRIPTION, NormalizeSchema } from '../normalize.js';
import {
    WATERMARK_INPUT_SCHEMA,
    WatermarkSchema,
    toWatermarkOptions,
    assertWatermarkPdfACompatible,
} from '../watermark.js';
import {
    LIST_ITEMS_INPUT_SCHEMA,
    ListItemsSchema,
    toListItems,
    OUTLINE_INPUT_SCHEMA,
    OutlineSchema,
    toOutline,
    PAGE_LABELS_INPUT_SCHEMA,
    PageLabelsSchema,
    toPageLabels,
    VIEWER_PREFERENCES_INPUT_SCHEMA,
    ViewerPreferencesSchema,
    toViewerPreferences,
} from '../doc-features.js';
import { PRINT_INPUT_PROPERTIES, PrintInputShape, assertPrintPdfACompatible, toDocumentMetadata, toPrintLayout } from '../print.js';
import { LAYOUT_INPUT_PROPERTIES, LayoutInputShape, assertLayoutPdfACompatible, toLayoutOptions } from '../layout.js';
import { DIAGNOSTIC_INPUT_PROPERTIES, DiagnosticInputShape, collectDiagnostics, latinFontEntries, mapBuildError, withDiagnostics } from '../diagnostics.js';

export const GENERATE_BASIC_PDF_NAME = 'generate_basic_pdf';

export const GENERATE_BASIC_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: {
            type: 'string',
            description: 'Document title (rendered at top of page 1 and used as PDF metadata title).',
            minLength: 1,
            maxLength: 200,
        },
        blocks: {
            type: 'array',
            description: 'Ordered list of content blocks composing the document body.',
            minItems: 1,
            maxItems: 5000,
            items: {
                oneOf: [
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'text', 'level'],
                        properties: {
                            type: { const: 'heading' },
                            text: { type: 'string', minLength: 1, maxLength: 500 },
                            level: { type: 'integer', enum: [1, 2, 3] },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'text'],
                        properties: {
                            type: { const: 'paragraph' },
                            text: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 50000,
                                description: "Paragraph text. Embedded newlines ('\\n') are automatically split into separate paragraphs — no need to pre-split; never emit a literal newline expecting a soft line break.",
                            },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'items'],
                        properties: {
                            type: { const: 'list' },
                            style: { type: 'string', enum: ['bullet', 'numbered'], default: 'bullet' },
                            items: LIST_ITEMS_INPUT_SCHEMA,
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type'],
                        properties: {
                            type: { const: 'pageBreak' },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'height'],
                        properties: {
                            type: { const: 'spacer' },
                            height: { type: 'number', minimum: 1, maximum: 500 },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'chartType', 'series'],
                        description: 'Native vector chart rendered as pure PDF path operators — bar / horizontal-bar / stacked-bar / line / area / scatter / pie / donut (pdfnative 1.7 charts v2: time and log axes, data labels, secondary axis, legends). Same body as add_chart.',
                        properties: {
                            type: { const: 'chart' },
                            ...CHART_BODY_PROPERTIES,
                        },
                    },
                    ...EXTENDED_BLOCK_SCHEMAS,
                ],
            },
        },
        footerText: {
            type: 'string',
            maxLength: 200,
            description: 'Optional footer text rendered at the bottom of every page.',
        },
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: PDF_A_FIELD_DESCRIPTION,
        },
        watermark: WATERMARK_INPUT_SCHEMA,
        normalize: {
            type: 'string',
            enum: [...NORMALIZE_ENUM],
            description: NORMALIZE_FIELD_DESCRIPTION,
        },
        outline: OUTLINE_INPUT_SCHEMA,
        pageLabels: PAGE_LABELS_INPUT_SCHEMA,
        viewerPreferences: VIEWER_PREFERENCES_INPUT_SCHEMA,
        ...PRINT_INPUT_PROPERTIES,
        ...LAYOUT_INPUT_PROPERTIES,
        ...DIAGNOSTIC_INPUT_PROPERTIES,
        outputMode: {
            type: 'string',
            enum: ['base64', 'file'],
            default: 'base64',
            description: "Either 'base64' (returns the PDF inline as a base64 string) or 'file' (writes to a path inside the configured PDFNATIVE_MCP_OUTPUT_DIR sandbox).",
        },
        outputPath: {
            type: 'string',
            description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf.",
        },
    },
    required: ['title', 'blocks'],
} as const;

/**
 * Ceiling on engine blocks after newline splitting. Below the engine's own
 * 100 000 guard so the failure is a coded VALIDATION_ERROR with an agent
 * remedy rather than the engine's "raise layout.maxBlocks" (an option this
 * server deliberately does not expose).
 */
const MAX_ENGINE_BLOCKS = 50_000;

/** The `blocks` input — every DocumentBlock kind pdfnative offers; shared with inspect_layout. */
export const DOCUMENT_BLOCKS_INPUT_SCHEMA = GENERATE_BASIC_PDF_INPUT_SCHEMA.properties.blocks;

const InputSchema = z.strictObject({
    title: z.string().min(1).max(200),
    blocks: z
        .array(
            z.discriminatedUnion('type', [
                z.strictObject({
                    type: z.literal('heading'),
                    text: z.string().min(1).max(500),
                    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
                }),
                z.strictObject({
                    type: z.literal('paragraph'),
                    text: z.string().min(1).max(50000),
                }),
                z.strictObject({
                    type: z.literal('list'),
                    style: z.enum(['bullet', 'numbered']).default('bullet'),
                    items: ListItemsSchema,
                }),
                z.strictObject({ type: z.literal('pageBreak') }),
                z.strictObject({
                    type: z.literal('spacer'),
                    height: z.number().min(1).max(500),
                }),
                ChartBodySchema.extend({ type: z.literal('chart') }),
                ...ExtendedBlockSchemas,
            ]),
        )
        .min(1)
        .max(5000),
    footerText: z.string().max(200).optional(),
    pdfA: PdfASchema.optional(),
    watermark: WatermarkSchema.optional(),
    normalize: NormalizeSchema.optional(),
    outline: OutlineSchema.optional(),
    pageLabels: PageLabelsSchema.optional(),
    viewerPreferences: ViewerPreferencesSchema.optional(),
    ...PrintInputShape,
    ...LayoutInputShape,
    ...DiagnosticInputShape,
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

/** Zod counterpart of {@link DOCUMENT_BLOCKS_INPUT_SCHEMA}; shared with inspect_layout. */
export const DocumentBlocksSchema = InputSchema.shape.blocks;
export type DocumentBlocksInput = z.infer<typeof DocumentBlocksSchema>;

/**
 * Map validated blocks to engine blocks. Paragraph text is split on embedded
 * newlines; the extended kinds go through src/blocks.ts (which also enforces
 * the per-call image byte budget). Throws VALIDATION_ERROR when nothing
 * renderable remains.
 */
export function toDocumentBlocks(blocks: DocumentBlocksInput): DocumentBlock[] {
    const blockContext = createBlockContext();
    const docBlocks: DocumentBlock[] = blocks.flatMap((block, index): DocumentBlock[] => {
        switch (block.type) {
            case 'heading':
                return [{ type: 'heading', text: block.text, level: block.level }];
            case 'paragraph':
                return splitParagraphSegments(block.text).map((text) => ({ type: 'paragraph', text }));
            case 'list':
                return [{ type: 'list', items: toListItems(block.items), style: block.style }];
            case 'pageBreak':
                return [{ type: 'pageBreak' }];
            case 'spacer':
                return [{ type: 'spacer', height: block.height }];
            case 'chart':
                return [toChartBlock(block)];
            default:
                return [toExtendedBlock(block, index, blockContext)];
        }
    });
    if (docBlocks.length === 0) {
        throw new ToolError('VALIDATION_ERROR', 'blocks must contain at least one block with renderable content.');
    }
    if (docBlocks.length > MAX_ENGINE_BLOCKS) {
        throw new ToolError(
            'VALIDATION_ERROR',
            `The document expands to ${docBlocks.length} blocks after splitting paragraphs on newlines, over the ${MAX_ENGINE_BLOCKS} limit. Split it into several documents (merge_pdfs can join them) or use fewer newline-separated paragraphs.`,
        );
    }
    return docBlocks;
}

export async function generateBasicPdf(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const {
        title, blocks, footerText, pdfA, watermark, normalize, outline, pageLabels, viewerPreferences,
        print, outputIntent, metadata, creationDate, pageSize, margins, headerTemplate, footerTemplate, compress, debug, encrypt, strict, includeDiagnostics, embedFonts, outputMode, outputPath,
    } = parsed.data;
    assertWatermarkPdfACompatible(watermark, pdfA);
    assertPrintPdfACompatible(print, pdfA);
    assertLayoutPdfACompatible({ encrypt }, pdfA);

    const docBlocks = toDocumentBlocks(blocks);
    const docMetadata = toDocumentMetadata(metadata);
    const fontEntries = await latinFontEntries(embedFonts);
    const collector = collectDiagnostics(strict);

    let bytes: Uint8Array;
    try {
        bytes = buildDocumentPDFBytes(
            {
                title,
                blocks: docBlocks,
                ...(footerText !== undefined ? { footerText } : {}),
                ...(outline !== undefined ? { outline: toOutline(outline) } : {}),
                ...(pageLabels !== undefined ? { pageLabels: toPageLabels(pageLabels) } : {}),
                ...(docMetadata !== undefined ? { metadata: docMetadata } : {}),
                ...(fontEntries.length > 0 ? { fontEntries } : {}),
            },
            {
                ...(pdfA !== undefined ? { tagged: pdfA } : {}),
                ...(watermark !== undefined ? { watermark: toWatermarkOptions(watermark) } : {}),
                ...(normalize !== undefined ? { normalize } : {}),
                ...(viewerPreferences !== undefined ? { viewerPreferences: toViewerPreferences(viewerPreferences) } : {}),
                ...toPrintLayout({ print, outputIntent, creationDate }),
                ...toLayoutOptions({ pageSize, margins, headerTemplate, footerTemplate, compress, debug, encrypt }),
                ...collector.layout,
            },
        );
    } catch (err) {
        throw mapBuildError(err, GENERATE_BASIC_PDF_NAME);
    }

    return withDiagnostics(
        await emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) }),
        collector,
        includeDiagnostics,
    );
}
