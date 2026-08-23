/**
 * The composable document blocks that `generate_basic_pdf` (and the read-only
 * `inspect_layout` dry-run) accept on top of heading / paragraph / list /
 * pageBreak / spacer / chart: `table`, `image`, `link`, `toc`, `barcode`,
 * `svg` and `formField` — every `DocumentBlock` kind pdfnative offers.
 *
 * Each block reuses the fragment of the dedicated tool (`src/table.ts`,
 * `src/barcode.ts`, `src/form.ts`, `src/image.ts`) so a standalone artefact
 * and an inline block validate and render identically. JSON Schema and Zod
 * are kept in lock-step; {@link toExtendedBlock} is the single mapper.
 */
import type { DocumentBlock } from 'pdfnative';
import { z } from 'zod';

import { BARCODE_BODY_PROPERTIES, BLOCK_ALIGN_ENUM, BarcodeBodyShape, assertBarcodePayload, toBarcodeBlock } from './barcode.js';
import { ToolError } from './errors.js';
import { FORM_FIELD_PROPERTIES, FormFieldShape, assertFormFieldOptions, toFormFieldBlock } from './form.js';
import { BOUNDED_IMAGE_PAYLOAD_PROPERTIES, BoundedImagePayloadShape, ImageByteBudget, decodeImageBase64 } from './image.js';
import { TABLE_BODY_PROPERTIES, TableBodyShape, assertRowsMatchHeaders, toTableBlock } from './table.js';

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LINK_SCHEMES = /^(?:https?:|mailto:)/i;
// eslint-disable-next-line no-control-regex -- C0 / DEL are exactly what the engine rejects
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const SVG_DATA_MAX_CHARS = 100_000;

const ALIGN_PROPERTY = {
    type: 'string',
    enum: [...BLOCK_ALIGN_ENUM],
    default: 'left',
    description: 'Horizontal placement inside the content width.',
} as const;
const ALT_PROPERTY = {
    type: 'string',
    maxLength: 500,
    description: 'Accessible description (tagged /Figure /Alt). Always provide it for non-decorative content under PDF/A or PDF/UA.',
} as const;
const COLOR_PROPERTY = { type: 'string', pattern: '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$', description: 'Hex colour (#RGB or #RRGGBB).' } as const;

/** JSON Schema `oneOf` members for the seven extended blocks. */
export const EXTENDED_BLOCK_SCHEMAS = [
    {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'headers', 'rows'],
        description: 'Inline smart table — same body as add_table (every row must have exactly as many cells as headers).',
        properties: {
            type: { const: 'table' },
            ...TABLE_BODY_PROPERTIES,
        },
    },
    {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'imageBase64', 'mimeType'],
        description: 'Inline JPEG/PNG image. Without width/height the pixel size is used as points and clamped to the content width; with one dimension the aspect ratio is kept. The decoded bytes of all image blocks in one call are capped at 24 MiB (a watermark image has its own 8 MiB cap).',
        properties: {
            type: { const: 'image' },
            ...BOUNDED_IMAGE_PAYLOAD_PROPERTIES,
            width: { type: 'number', minimum: 10, maximum: 800, description: 'Render width in points.' },
            height: { type: 'number', minimum: 10, maximum: 1000, description: 'Render height in points.' },
            align: ALIGN_PROPERTY,
            alt: ALT_PROPERTY,
        },
    },
    {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'text', 'url'],
        description: 'Clickable external link (/URI action). Only http:, https: and mailto: URLs are accepted.',
        properties: {
            type: { const: 'link' },
            text: { type: 'string', minLength: 1, maxLength: 500 },
            url: { type: 'string', minLength: 1, maxLength: 2048, description: 'http(s):// or mailto: URL.' },
            fontSize: { type: 'number', minimum: 6, maximum: 48, description: 'Default 10.' },
            color: COLOR_PROPERTY,
        },
    },
    {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        description: "Printed table of contents generated from the document's heading blocks (internal /GoTo links with dot leaders). Pairs with outline:'auto' for the bookmark pane.",
        properties: {
            type: { const: 'toc' },
            title: { type: 'string', maxLength: 200, description: "Default 'Table of Contents'." },
            maxLevel: { type: 'integer', enum: [1, 2, 3], description: 'Deepest heading level listed (default 3).' },
            fontSize: { type: 'number', minimum: 6, maximum: 24, description: 'Default 10.' },
            indent: { type: 'number', minimum: 0, maximum: 100, description: 'Points of indent per heading level (default 15).' },
        },
    },
    {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'format', 'data'],
        description: 'Inline barcode — same body as add_barcode (pure vector, no /Alt available in the engine).',
        properties: {
            type: { const: 'barcode' },
            ...BARCODE_BODY_PROPERTIES,
            align: ALIGN_PROPERTY,
        },
    },
    {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'data'],
        description:
            "Vector drawing from an SVG path `d` string or SVG markup. Supported: <path> <rect> (rx/ry) <circle> <ellipse> <line> <polyline> <polygon> and <text>/<tspan> (x, y, font-size, fill, text-anchor, dx/dy); fill / stroke / stroke-width attributes; double-quoted attributes only. NOT supported (silently ignored): transform, <g>, <use>, <image>, <defs>/<clipPath>, gradients, opacity, CSS/style, dash patterns, text word-wrap. No external reference is ever fetched (no XML parser: entities other than &amp; &lt; &gt; &quot; &apos; &nbsp; &#n; are dropped). Pure path operators — PDF/A-safe at every level.",
        properties: {
            type: { const: 'svg' },
            data: { type: 'string', minLength: 1, maxLength: SVG_DATA_MAX_CHARS, description: 'Path `d` string or SVG markup (≤ 100 000 characters).' },
            width: { type: 'number', minimum: 10, maximum: 800, description: 'Render width in points (default 200).' },
            height: { type: 'number', minimum: 10, maximum: 1000, description: 'Render height in points (default 200).' },
            align: ALIGN_PROPERTY,
            viewBox: {
                type: 'array',
                minItems: 4,
                maxItems: 4,
                items: { type: 'number' },
                description: '[minX, minY, width, height] — overrides the viewBox of the markup; required for a bare path string that is not 0-based.',
            },
            fill: { type: 'string', description: "Hex colour or 'none' (default black).", pattern: '^(?:none|#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))$' },
            stroke: { type: 'string', description: "Hex colour or 'none' (default none).", pattern: '^(?:none|#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))$' },
            strokeWidth: { type: 'number', minimum: 0, maximum: 50, description: 'Stroke width in SVG user units (default 1).' },
            alt: ALT_PROPERTY,
        },
    },
    {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'fieldType', 'name'],
        description: 'Inline AcroForm field — same body as an add_form field. Under a PDF/A claim the widget appearance font is not embedded (PDFA_UNEMBEDDED_FORM_FONT; strict:true fails the call).',
        properties: {
            type: { const: 'formField' },
            ...FORM_FIELD_PROPERTIES,
        },
    },
] as const;

const Color = z.string().regex(HEX_COLOR);
const ColorOrNone = z.union([z.literal('none'), Color]);

/** Zod members for the seven extended blocks (spread into the `discriminatedUnion`). */
export const ExtendedBlockSchemas = [
    z.strictObject({ type: z.literal('table'), ...TableBodyShape }),
    z.strictObject({
        type: z.literal('image'),
        ...BoundedImagePayloadShape,
        width: z.number().min(10).max(800).optional(),
        height: z.number().min(10).max(1000).optional(),
        align: z.enum(BLOCK_ALIGN_ENUM).default('left'),
        alt: z.string().max(500).optional(),
    }),
    z.strictObject({
        type: z.literal('link'),
        text: z.string().min(1).max(500),
        url: z.string().min(1).max(2048),
        fontSize: z.number().min(6).max(48).optional(),
        color: Color.optional(),
    }),
    z.strictObject({
        type: z.literal('toc'),
        title: z.string().max(200).optional(),
        maxLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        fontSize: z.number().min(6).max(24).optional(),
        indent: z.number().min(0).max(100).optional(),
    }),
    z.strictObject({ type: z.literal('barcode'), ...BarcodeBodyShape, align: z.enum(BLOCK_ALIGN_ENUM).default('left') }),
    z.strictObject({
        type: z.literal('svg'),
        data: z.string().min(1).max(SVG_DATA_MAX_CHARS),
        width: z.number().min(10).max(800).optional(),
        height: z.number().min(10).max(1000).optional(),
        align: z.enum(BLOCK_ALIGN_ENUM).default('left'),
        viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
        fill: ColorOrNone.optional(),
        stroke: ColorOrNone.optional(),
        strokeWidth: z.number().min(0).max(50).optional(),
        alt: z.string().max(500).optional(),
    }),
    z.strictObject({ type: z.literal('formField'), ...FormFieldShape }),
] as const;

export type ExtendedBlockInput = z.infer<(typeof ExtendedBlockSchemas)[number]>;

/** Per-call state the mapper needs (image byte budget). */
export interface BlockContext {
    readonly images: ImageByteBudget;
}

export function createBlockContext(): BlockContext {
    return { images: new ImageByteBudget() };
}

/** Map one extended block to the engine shape; `index` names the block in error messages. */
export function toExtendedBlock(block: ExtendedBlockInput, index: number, ctx: BlockContext): DocumentBlock {
    const where = `blocks[${index}]: `;
    switch (block.type) {
        case 'table': {
            assertRowsMatchHeaders(block, where);
            return toTableBlock(block);
        }
        case 'image': {
            const field = `blocks[${index}].imageBase64`;
            const data = decodeImageBase64(block.imageBase64, block.mimeType, field);
            ctx.images.add(data, field);
            return {
                type: 'image',
                data,
                ...(block.width !== undefined ? { width: block.width } : {}),
                ...(block.height !== undefined ? { height: block.height } : {}),
                align: block.align,
                ...(block.alt !== undefined ? { alt: block.alt } : {}),
            };
        }
        case 'link': {
            if (!LINK_SCHEMES.test(block.url) || CONTROL_CHARS.test(block.url)) {
                throw new ToolError('VALIDATION_ERROR', `${where}url must start with http://, https:// or mailto: and contain no control characters.`);
            }
            return {
                type: 'link',
                text: block.text,
                url: block.url,
                ...(block.fontSize !== undefined ? { fontSize: block.fontSize } : {}),
                ...(block.color !== undefined ? { color: block.color } : {}),
            };
        }
        case 'toc':
            return {
                type: 'toc',
                ...(block.title !== undefined ? { title: block.title } : {}),
                ...(block.maxLevel !== undefined ? { maxLevel: block.maxLevel } : {}),
                ...(block.fontSize !== undefined ? { fontSize: block.fontSize } : {}),
                ...(block.indent !== undefined ? { indent: block.indent } : {}),
            };
        case 'barcode': {
            assertBarcodePayload(block, where);
            return toBarcodeBlock(block, block.align);
        }
        case 'svg':
            return {
                type: 'svg',
                data: block.data,
                ...(block.width !== undefined ? { width: block.width } : {}),
                ...(block.height !== undefined ? { height: block.height } : {}),
                align: block.align,
                ...(block.viewBox !== undefined ? { viewBox: block.viewBox } : {}),
                ...(block.fill !== undefined ? { fill: block.fill } : {}),
                ...(block.stroke !== undefined ? { stroke: block.stroke } : {}),
                ...(block.strokeWidth !== undefined ? { strokeWidth: block.strokeWidth } : {}),
                ...(block.alt !== undefined ? { alt: block.alt } : {}),
            };
        case 'formField': {
            assertFormFieldOptions(block, where);
            return toFormFieldBlock(block);
        }
    }
}
