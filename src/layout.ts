/**
 * Shared page-layout schema (pdfnative `PdfLayoutOptions`): page size preset,
 * margins, header / footer templates with `{page}` `{pages}` `{date}` `{title}`
 * placeholders, FlateDecode stream compression and the layout debug overlay.
 *
 * Every document-producing tool spreads {@link LAYOUT_INPUT_PROPERTIES} into its
 * JSON Schema and {@link LayoutInputShape} into its Zod object, then forwards
 * {@link toLayoutOptions} to pdfnative. All fields are optional and absent by
 * default, so default outputs stay byte-identical (pdfnative applies its A4 /
 * default-margin / uncompressed defaults only when the keys are absent).
 *
 * Engine facts (pdfnative 1.7.0):
 *   - `PAGE_SIZES` presets live in `src/core/pdf-layout.ts`; A4 is the default.
 *   - `footerTemplate` *replaces* the default footer (`{ left: footerText,
 *     right: '{page}/{pages}' }`) entirely — `footerText` is then ignored.
 *   - `{date}` is the engine's wall-clock date (YYYY-MM-DD, host TZ), not
 *     `creationDate`; it is therefore not reproducible across days.
 *   - `compress` needs `initNodeCompression()` (done once at server boot via
 *     `ensureCompressionReady()`); XMP streams stay uncompressed under PDF/A.
 *   - `debug` is honoured by the document backend only; the overlay is plain
 *     stroked rectangles (no transparency), so PDF/A builds are not rejected.
 */
import type { PageTemplate, PdfLayoutOptions } from 'pdfnative';
import { z } from 'zod';

/** Page-size presets — keys of pdfnative's `PAGE_SIZES` (width × height in points). */
export const PAGE_SIZE_PRESETS = {
    A4: { width: 595.28, height: 841.89 },
    Letter: { width: 612, height: 792 },
    Legal: { width: 612, height: 1008 },
    A3: { width: 841.89, height: 1190.55 },
    Tabloid: { width: 792, height: 1224 },
} as const;

export type PageSizePreset = keyof typeof PAGE_SIZE_PRESETS;

const PAGE_SIZE_KEYS = ['A4', 'Letter', 'Legal', 'A3', 'Tabloid'] as const;

const MARGIN_SCHEMA = { type: 'number', minimum: 0, maximum: 200 } as const;

const TEMPLATE_TEXT_SCHEMA = {
    type: 'string',
    maxLength: 200,
    description: 'Text with optional placeholders {page} {pages} {title} {date} (date = YYYY-MM-DD wall clock at build time, not creationDate).',
} as const;

const TEMPLATE_SCHEMA = (zone: 'top' | 'bottom') =>
    ({
        type: 'object',
        additionalProperties: false,
        description:
            zone === 'top'
                ? 'Header line rendered at the top of every page (left / center / right zones). Reserves 15 pt of content height.'
                : 'Footer line rendered at the bottom of every page. Replaces the default footer entirely: when set, footerText is ignored and page numbers appear only if you include {page}/{pages}.',
        properties: {
            left: TEMPLATE_TEXT_SCHEMA,
            center: TEMPLATE_TEXT_SCHEMA,
            right: TEMPLATE_TEXT_SCHEMA,
            fontSize: { type: 'number', minimum: 6, maximum: 14, description: 'Font size in points. Default 7.' },
            color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: 'Hex colour, e.g. "#666666".' },
        },
    }) as const;

/** JSON Schema fragments — spread into a tool's `properties`. */
export const LAYOUT_INPUT_PROPERTIES = {
    pageSize: {
        type: 'string',
        enum: PAGE_SIZE_KEYS,
        description: 'Page-size preset (portrait): A4 595.28×841.89 (default), Letter 612×792, Legal 612×1008, A3 841.89×1190.55, Tabloid 792×1224 pt. print.* boxes must fit the resulting MediaBox.',
    },
    margins: {
        type: 'object',
        additionalProperties: false,
        required: ['top', 'right', 'bottom', 'left'],
        description: 'Page margins in points (all four required; 0–200). Default { top: 45, right: 36, bottom: 35, left: 36 }.',
        properties: {
            top: MARGIN_SCHEMA,
            right: MARGIN_SCHEMA,
            bottom: MARGIN_SCHEMA,
            left: MARGIN_SCHEMA,
        },
    },
    headerTemplate: TEMPLATE_SCHEMA('top'),
    footerTemplate: TEMPLATE_SCHEMA('bottom'),
    compress: {
        type: 'boolean',
        description: 'FlateDecode content/font/CMap streams (ISO 32000-1 §7.3.8). Default false. Output bytes change (smaller); PDF/A conformance is unaffected (XMP stays uncompressed).',
    },
    debug: {
        type: 'boolean',
        description: 'Development aid: draw the margin box, block bounds and table cell outlines as thin stroked rectangles on every page. Text geometry is unchanged. Default false.',
    },
} as const;

const TemplateSchema = z.strictObject({
    left: z.string().max(200).optional(),
    center: z.string().max(200).optional(),
    right: z.string().max(200).optional(),
    fontSize: z.number().min(6).max(14).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const MarginsSchema = z.strictObject({
    top: z.number().min(0).max(200),
    right: z.number().min(0).max(200),
    bottom: z.number().min(0).max(200),
    left: z.number().min(0).max(200),
});

/** Zod counterpart of {@link LAYOUT_INPUT_PROPERTIES} — spread into a tool's `z.strictObject({...})`. */
export const LayoutInputShape = {
    pageSize: z.enum(PAGE_SIZE_KEYS).optional(),
    margins: MarginsSchema.optional(),
    headerTemplate: TemplateSchema.optional(),
    footerTemplate: TemplateSchema.optional(),
    compress: z.boolean().optional(),
    debug: z.boolean().optional(),
} as const;

export type TemplateInput = z.infer<typeof TemplateSchema>;
export type MarginsInput = z.infer<typeof MarginsSchema>;

export interface LayoutInput {
    pageSize?: PageSizePreset;
    margins?: MarginsInput;
    headerTemplate?: TemplateInput;
    footerTemplate?: TemplateInput;
    compress?: boolean;
    debug?: boolean;
}

type LayoutFragment = Pick<PdfLayoutOptions, 'pageWidth' | 'pageHeight' | 'margins' | 'headerTemplate' | 'footerTemplate' | 'compress' | 'debug'>;

function toTemplate(t: TemplateInput): PageTemplate {
    return {
        ...(t.left !== undefined ? { left: t.left } : {}),
        ...(t.center !== undefined ? { center: t.center } : {}),
        ...(t.right !== undefined ? { right: t.right } : {}),
        ...(t.fontSize !== undefined ? { fontSize: t.fontSize } : {}),
        ...(t.color !== undefined ? { color: t.color } : {}),
    };
}

/**
 * Layout fragment to spread into the pdfnative layout options. Nothing is
 * emitted for absent inputs, so the engine's defaults (and byte-identical
 * default output) are untouched.
 */
export function toLayoutOptions(input: LayoutInput): LayoutFragment {
    const out: { -readonly [K in keyof LayoutFragment]: LayoutFragment[K] } = {};
    if (input.pageSize !== undefined) {
        const size = PAGE_SIZE_PRESETS[input.pageSize];
        out.pageWidth = size.width;
        out.pageHeight = size.height;
    }
    if (input.margins !== undefined) {
        out.margins = { t: input.margins.top, r: input.margins.right, b: input.margins.bottom, l: input.margins.left };
    }
    if (input.headerTemplate !== undefined) out.headerTemplate = toTemplate(input.headerTemplate);
    if (input.footerTemplate !== undefined) out.footerTemplate = toTemplate(input.footerTemplate);
    if (input.compress !== undefined) out.compress = input.compress;
    if (input.debug !== undefined) out.debug = input.debug;
    return out;
}
