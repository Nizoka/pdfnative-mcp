/**
 * Tool: inspect_layout
 *
 * Read-only pagination preview: reports how the document builder will
 * paginate a set of `blocks` (the same `blocks` generate_basic_pdf accepts)
 * and where every block lands, WITHOUT rendering a PDF. Wraps pdfnative's
 * `inspectDocumentLayout()`, which reuses the builder's own measurement
 * primitives, so the result is a faithful, deterministic estimate.
 *
 * Only the inputs that can change the engine's answer are accepted:
 *   - `title`, `footerText`  reserve the title band / footer line
 *   - `pdfA`, `normalize`, `embedFonts`  change the text-measurement context
 *     (tagged mode, Unicode normalisation, Noto Sans metrics vs Helvetica)
 *   - `pageSize`, `margins`, `headerTemplate`, `footerTemplate`  change the content box
 * Print boxes, watermarks, metadata, compression and encryption never move a
 * block, so they are deliberately not part of the schema. Known engine gap: a
 * `toc` block is measured as 0 pt (pinned in tests/inspect-layout.test.ts).
 */
import { inspectDocumentLayout, type LayoutInspection } from 'pdfnative';
import { z } from 'zod';
import { ToolError } from '../errors.js';
import { PDF_A_ENUM, PDF_A_FIELD_DESCRIPTION, PdfASchema } from '../pdfa.js';
import { NORMALIZE_ENUM, NORMALIZE_FIELD_DESCRIPTION, NormalizeSchema } from '../normalize.js';
import { DIAGNOSTIC_INPUT_PROPERTIES, latinFontEntries, mapBuildError } from '../diagnostics.js';
import { DOCUMENT_BLOCKS_INPUT_SCHEMA, DocumentBlocksSchema, toDocumentBlocks } from './generate-basic-pdf.js';
import { LAYOUT_INPUT_PROPERTIES, LayoutInputShape, toLayoutOptions } from '../layout.js';

export const INSPECT_LAYOUT_NAME = 'inspect_layout';

export const INSPECT_LAYOUT_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: {
            type: 'string',
            description: 'Document title — reserves the title band on page 1 exactly as generate_basic_pdf does.',
            minLength: 1,
            maxLength: 200,
        },
        blocks: DOCUMENT_BLOCKS_INPUT_SCHEMA,
        footerText: {
            type: 'string',
            maxLength: 200,
            description: 'Footer text as you would pass it to generate_basic_pdf (reserves the footer band).',
        },
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: `Tagged (PDF/A) layout mode, as you would pass it to generate_basic_pdf. ${PDF_A_FIELD_DESCRIPTION}`,
        },
        normalize: {
            type: 'string',
            enum: [...NORMALIZE_ENUM],
            description: NORMALIZE_FIELD_DESCRIPTION,
        },
        embedFonts: {
            type: 'boolean',
            default: false,
            description: `Measure with the embedded Noto Sans Latin metrics instead of Helvetica — pass the same value you will give generate_basic_pdf. (${DIAGNOSTIC_INPUT_PROPERTIES.embedFonts.description})`,
        },
        // The layout options move every block: pass exactly what generate_basic_pdf will get.
        pageSize: LAYOUT_INPUT_PROPERTIES.pageSize,
        margins: LAYOUT_INPUT_PROPERTIES.margins,
        headerTemplate: LAYOUT_INPUT_PROPERTIES.headerTemplate,
        footerTemplate: LAYOUT_INPUT_PROPERTIES.footerTemplate,
        verbosity: {
            type: 'string',
            enum: ['summary', 'full'],
            default: 'full',
            description: "'full' (default) or 'summary' (scalars only: pageWidth, pageHeight, totalPages, blockCount; pages[] and margins dropped).",
        },
        fields: {
            type: 'array',
            description: "Optional dot-path projection applied to the structured result (e.g. ['totalPages'] or ['pages.blocks.type']). Composes after verbosity. Unknown paths are omitted.",
            maxItems: 16,
            items: { type: 'string', minLength: 1 },
        },
    },
    required: ['title', 'blocks'],
} as const;

export const INSPECT_LAYOUT_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pageWidth', 'pageHeight', 'margins', 'totalPages', 'pages'],
    properties: {
        pageWidth: { type: 'number', description: 'Page width in points (595.28 = A4).' },
        pageHeight: { type: 'number', description: 'Page height in points (841.89 = A4).' },
        margins: {
            type: 'object',
            additionalProperties: false,
            required: ['t', 'r', 'b', 'l'],
            description: 'Page margins { top, right, bottom, left } in points.',
            properties: {
                t: { type: 'number' },
                r: { type: 'number' },
                b: { type: 'number' },
                l: { type: 'number' },
            },
        },
        totalPages: { type: 'integer', minimum: 1, description: 'Number of pages the blocks paginate into.' },
        pages: {
            type: 'array',
            description: 'Per-page block placement, in render order. A table that spans pages appears once per slice.',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['index', 'blocks'],
                properties: {
                    index: { type: 'integer', minimum: 0, description: '0-based page index.' },
                    blocks: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['type', 'page', 'x', 'top', 'width', 'height'],
                            properties: {
                                type: { type: 'string', description: "The originating block's type (heading, paragraph, table, …)." },
                                page: { type: 'integer', minimum: 0, description: '0-based page index the block was placed on.' },
                                x: { type: 'number', description: 'Left edge in points.' },
                                top: { type: 'number', description: 'Top edge in points, y increasing upward (PDF user space).' },
                                width: { type: 'number', description: 'Content width available to the block in points.' },
                                height: { type: 'number', description: 'Estimated block height in points.' },
                            },
                        },
                    },
                },
            },
        },
    },
} as const;

const InputSchema = z.strictObject({
    title: z.string().min(1).max(200),
    blocks: DocumentBlocksSchema,
    footerText: z.string().max(200).optional(),
    pdfA: PdfASchema.optional(),
    normalize: NormalizeSchema.optional(),
    embedFonts: z.boolean().optional(),
    pageSize: LayoutInputShape.pageSize,
    margins: LayoutInputShape.margins,
    headerTemplate: LayoutInputShape.headerTemplate,
    footerTemplate: LayoutInputShape.footerTemplate,
    verbosity: z.enum(['summary', 'full']).optional(),
    fields: z.array(z.string().min(1)).max(16).optional(),
});

export interface InspectedLayoutBlock {
    readonly type: string;
    readonly page: number;
    readonly x: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

export interface InspectLayoutResult {
    readonly pageWidth: number;
    readonly pageHeight: number;
    readonly margins: { readonly t: number; readonly r: number; readonly b: number; readonly l: number };
    readonly totalPages: number;
    readonly pages: ReadonlyArray<{ readonly index: number; readonly blocks: readonly InspectedLayoutBlock[] }>;
}

/** Two-decimal rounding keeps the per-block geometry compact without losing layout-relevant precision. */
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function toResult(inspection: LayoutInspection): InspectLayoutResult {
    return {
        pageWidth: round2(inspection.pageWidth),
        pageHeight: round2(inspection.pageHeight),
        margins: {
            t: round2(inspection.margins.t),
            r: round2(inspection.margins.r),
            b: round2(inspection.margins.b),
            l: round2(inspection.margins.l),
        },
        totalPages: inspection.totalPages,
        pages: inspection.pages.map((page) => ({
            index: page.index,
            blocks: page.blocks.map((b) => ({
                type: b.type,
                page: b.page,
                x: round2(b.x),
                top: round2(b.top),
                width: round2(b.width),
                height: round2(b.height),
            })),
        })),
    };
}

export async function inspectLayout(rawInput: unknown): Promise<InspectLayoutResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, blocks, footerText, pdfA, normalize, embedFonts, pageSize, margins, headerTemplate, footerTemplate } = parsed.data;

    const docBlocks = toDocumentBlocks(blocks);
    const fontEntries = await latinFontEntries(embedFonts);

    let inspection: LayoutInspection;
    try {
        inspection = inspectDocumentLayout(
            {
                title,
                blocks: docBlocks,
                ...(footerText !== undefined ? { footerText } : {}),
                ...(fontEntries.length > 0 ? { fontEntries } : {}),
            },
            {
                ...(pdfA !== undefined ? { tagged: pdfA } : {}),
                ...(normalize !== undefined ? { normalize } : {}),
                ...toLayoutOptions({ pageSize, margins, headerTemplate, footerTemplate }),
            },
        );
    } catch (err) {
        throw mapBuildError(err, INSPECT_LAYOUT_NAME);
    }
    return toResult(inspection);
}
