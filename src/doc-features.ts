/**
 * Shared input schemas + mappers for the pdfnative v1.4.0 document features
 * that several generation tools expose: document outline / bookmarks
 * (`/Outlines`), page labels (`/PageLabels`), and viewer preferences
 * (`/ViewerPreferences`).
 *
 * Keeping the hand-written JSON Schema, the Zod schema, and the pdfnative
 * mapper together in one module guarantees they stay aligned (a core
 * convention of this server).
 */
import { z } from 'zod';
import type { ListItem, OutlineItem, PageLabelRange, ViewerPreferences } from 'pdfnative';

/* -------------------------------------------------------------------------- */
/* Nested (hierarchical) lists                                                */
/* -------------------------------------------------------------------------- */

/** Maximum list-nesting depth accepted at the tool boundary. */
const MAX_LIST_DEPTH = 6;

/** One JSON-Schema list item: a plain string, or an object with a nested sub-list. */
function listItemSchema(depth: number): Record<string, unknown> {
    const objectProps: Record<string, unknown> = {
        text: { type: 'string', minLength: 1, maxLength: 1000 },
    };
    if (depth > 1) {
        objectProps['items'] = {
            type: 'array',
            minItems: 1,
            maxItems: 1000,
            items: listItemSchema(depth - 1),
        };
    }
    return {
        oneOf: [
            { type: 'string', minLength: 1, maxLength: 1000 },
            { type: 'object', additionalProperties: false, required: ['text'], properties: objectProps },
        ],
    };
}

/** JSON Schema for a list's `items` array (strings and/or nested objects). */
export const LIST_ITEMS_INPUT_SCHEMA = {
    type: 'array',
    minItems: 1,
    maxItems: 1000,
    description:
        'List items. A string is a leaf; an object { text, items } nests a sub-list (bullets/numbers indent; numbered sub-lists restart at 1).',
    items: listItemSchema(MAX_LIST_DEPTH),
} as const;

type ListItemInput = string | { text: string; items?: ListItemInput[] };

const ListItemSchema: z.ZodType<ListItemInput> = z.lazy(() =>
    z.union([
        z.string().min(1).max(1000),
        z.strictObject({
            text: z.string().min(1).max(1000),
            items: z.array(ListItemSchema).min(1).max(1000).optional(),
        }),
    ]),
);

export const ListItemsSchema = z.array(ListItemSchema).min(1).max(1000);

function toListItem(item: ListItemInput): string | ListItem {
    if (typeof item === 'string') return item;
    return {
        text: item.text,
        ...(item.items !== undefined ? { items: item.items.map(toListItem) } : {}),
    };
}

/** Maps validated list input to the pdfnative `ListBlock.items` value. */
export function toListItems(items: z.infer<typeof ListItemsSchema>): readonly (string | ListItem)[] {
    return items.map(toListItem);
}

/* -------------------------------------------------------------------------- */
/* Document outline / bookmarks                                               */
/* -------------------------------------------------------------------------- */

/** Maximum bookmark-tree depth accepted at the tool boundary. */
const MAX_OUTLINE_DEPTH = 6;

/** One JSON-Schema outline node (bounded recursion via repeated nesting). */
function outlineNodeSchema(depth: number): Record<string, unknown> {
    const properties: Record<string, unknown> = {
        title: { type: 'string', minLength: 1, maxLength: 500, description: 'Bookmark label.' },
        pageIndex: { type: 'integer', minimum: 0, description: '0-based destination page index.' },
        y: { type: 'number', description: 'Destination Y coordinate in points (default: top of page).' },
        bold: { type: 'boolean' },
        italic: { type: 'boolean' },
        color: {
            type: 'string',
            description: "Label colour as a hex string ('#1a73e8') or PDF operator string ('0 0 1').",
        },
        open: {
            type: 'boolean',
            description: 'Initial expansion state (default true). false renders the branch collapsed.',
        },
    };
    if (depth > 1) {
        properties['children'] = {
            type: 'array',
            maxItems: 1000,
            items: outlineNodeSchema(depth - 1),
        };
    }
    return {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'pageIndex'],
        properties,
    };
}

export const OUTLINE_INPUT_SCHEMA = {
    description:
        "Document outline (bookmarks panel). Either 'auto' (derive a flat outline from heading blocks) or an explicit nested bookmark tree.",
    oneOf: [
        { type: 'string', enum: ['auto'] },
        { type: 'array', minItems: 1, maxItems: 1000, items: outlineNodeSchema(MAX_OUTLINE_DEPTH) },
    ],
} as const;

interface OutlineNodeInput {
    title: string;
    pageIndex: number;
    y?: number;
    bold?: boolean;
    italic?: boolean;
    color?: string;
    open?: boolean;
    children?: OutlineNodeInput[];
}

const OutlineNodeSchema: z.ZodType<OutlineNodeInput> = z.lazy(() =>
    z.strictObject({
        title: z.string().min(1).max(500),
        pageIndex: z.number().int().min(0),
        y: z.number().optional(),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        color: z.string().min(1).max(64).optional(),
        open: z.boolean().optional(),
        children: z.array(OutlineNodeSchema).max(1000).optional(),
    }),
);

export const OutlineSchema = z.union([z.literal('auto'), z.array(OutlineNodeSchema).min(1).max(1000)]);

function toOutlineItem(node: OutlineNodeInput): OutlineItem {
    return {
        title: node.title,
        pageIndex: node.pageIndex,
        ...(node.y !== undefined ? { y: node.y } : {}),
        ...(node.bold !== undefined ? { bold: node.bold } : {}),
        ...(node.italic !== undefined ? { italic: node.italic } : {}),
        ...(node.color !== undefined ? { color: node.color } : {}),
        ...(node.open !== undefined ? { open: node.open } : {}),
        ...(node.children !== undefined ? { children: node.children.map(toOutlineItem) } : {}),
    };
}

/** Maps validated outline input to the pdfnative `DocumentParams.outline` value. */
export function toOutline(value: z.infer<typeof OutlineSchema>): readonly OutlineItem[] | 'auto' {
    return value === 'auto' ? 'auto' : value.map(toOutlineItem);
}

/* -------------------------------------------------------------------------- */
/* Page labels                                                                */
/* -------------------------------------------------------------------------- */

const PAGE_LABEL_STYLES = ['decimal', 'roman', 'Roman', 'alpha', 'Alpha', 'none'] as const;

export const PAGE_LABELS_INPUT_SCHEMA = {
    type: 'array',
    description:
        'Page-label ranges (the visible page numbers in the viewer, e.g. roman front-matter then decimal body). startPage values must be unique and strictly increasing.',
    minItems: 1,
    maxItems: 1000,
    items: {
        type: 'object',
        additionalProperties: false,
        required: ['startPage'],
        properties: {
            startPage: { type: 'integer', minimum: 0, description: '0-based index of the first page in this range.' },
            style: {
                type: 'string',
                enum: [...PAGE_LABEL_STYLES],
                description: "Numbering style. 'none' (or omitted with a prefix) yields prefix-only labels.",
            },
            prefix: { type: 'string', maxLength: 64, description: "Optional label prefix (e.g. 'A-')." },
            start: { type: 'integer', minimum: 1, description: 'First numeric value in the range (default 1).' },
        },
    },
} as const;

export const PageLabelsSchema = z
    .array(
        z.strictObject({
            startPage: z.number().int().min(0),
            style: z.enum(PAGE_LABEL_STYLES).optional(),
            prefix: z.string().max(64).optional(),
            start: z.number().int().min(1).optional(),
        }),
    )
    .min(1)
    .max(1000);

/** Maps validated page-label input to `DocumentParams.pageLabels`. */
export function toPageLabels(value: z.infer<typeof PageLabelsSchema>): readonly PageLabelRange[] {
    return value.map((r) => ({
        startPage: r.startPage,
        ...(r.style !== undefined ? { style: r.style } : {}),
        ...(r.prefix !== undefined ? { prefix: r.prefix } : {}),
        ...(r.start !== undefined ? { start: r.start } : {}),
    }));
}

/* -------------------------------------------------------------------------- */
/* Viewer preferences                                                         */
/* -------------------------------------------------------------------------- */

const PAGE_LAYOUTS = ['singlePage', 'oneColumn', 'twoColumnLeft', 'twoColumnRight', 'twoPageLeft', 'twoPageRight'] as const;
const PAGE_MODES = ['useNone', 'useOutlines', 'useThumbs', 'fullScreen', 'useOC', 'useAttachments'] as const;
const NON_FULLSCREEN_PAGE_MODES = ['useNone', 'useOutlines', 'useThumbs', 'useOC'] as const;
const DUPLEX_MODES = ['simplex', 'duplexFlipShortEdge', 'duplexFlipLongEdge'] as const;

export const VIEWER_PREFERENCES_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    description: 'Reader presentation hints (catalog /PageLayout, /PageMode, /ViewerPreferences). PDF/A-safe; all optional.',
    properties: {
        pageLayout: { type: 'string', enum: [...PAGE_LAYOUTS] },
        pageMode: { type: 'string', enum: [...PAGE_MODES] },
        hideToolbar: { type: 'boolean' },
        hideMenubar: { type: 'boolean' },
        hideWindowUI: { type: 'boolean' },
        fitWindow: { type: 'boolean' },
        centerWindow: { type: 'boolean' },
        displayDocTitle: { type: 'boolean' },
        nonFullScreenPageMode: { type: 'string', enum: [...NON_FULLSCREEN_PAGE_MODES] },
        direction: { type: 'string', enum: ['l2r', 'r2l'] },
        printScaling: { type: 'string', enum: ['none', 'appDefault'] },
        duplex: {
            type: 'string',
            enum: [...DUPLEX_MODES],
            description: 'Print-dialog paper handling default (/Duplex): single-sided or double-sided flipping on the short/long edge.',
        },
        pickTrayByPDFSize: { type: 'boolean', description: 'Ask the printer to pick the input tray from the PDF page size (/PickTrayByPDFSize).' },
        printPageRange: {
            type: 'array',
            maxItems: 100,
            description: 'Default page ranges for the Print dialog (/PrintPageRange) as inclusive 1-based [first, last] pairs, e.g. [[1, 4], [7, 7]].',
            items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 1 } },
        },
        numCopies: {
            type: 'integer',
            minimum: 1,
            maximum: 1000,
            description: 'Default number of copies for the Print dialog (/NumCopies; viewers honour 2-5 per ISO 32000 Table 150).',
        },
    },
} as const;

export const ViewerPreferencesSchema = z.strictObject({
    pageLayout: z.enum(PAGE_LAYOUTS).optional(),
    pageMode: z.enum(PAGE_MODES).optional(),
    hideToolbar: z.boolean().optional(),
    hideMenubar: z.boolean().optional(),
    hideWindowUI: z.boolean().optional(),
    fitWindow: z.boolean().optional(),
    centerWindow: z.boolean().optional(),
    displayDocTitle: z.boolean().optional(),
    nonFullScreenPageMode: z.enum(NON_FULLSCREEN_PAGE_MODES).optional(),
    direction: z.enum(['l2r', 'r2l']).optional(),
    printScaling: z.enum(['none', 'appDefault']).optional(),
    duplex: z.enum(DUPLEX_MODES).optional(),
    pickTrayByPDFSize: z.boolean().optional(),
    printPageRange: z
        .array(z.tuple([z.number().int().min(1), z.number().int().min(1)]))
        .max(100)
        .optional(),
    numCopies: z.number().int().min(1).max(1000).optional(),
});

/** Maps validated viewer-preference input to `PdfLayoutOptions.viewerPreferences`. */
export function toViewerPreferences(value: z.infer<typeof ViewerPreferencesSchema>): ViewerPreferences {
    return {
        ...(value.pageLayout !== undefined ? { pageLayout: value.pageLayout } : {}),
        ...(value.pageMode !== undefined ? { pageMode: value.pageMode } : {}),
        ...(value.hideToolbar !== undefined ? { hideToolbar: value.hideToolbar } : {}),
        ...(value.hideMenubar !== undefined ? { hideMenubar: value.hideMenubar } : {}),
        ...(value.hideWindowUI !== undefined ? { hideWindowUI: value.hideWindowUI } : {}),
        ...(value.fitWindow !== undefined ? { fitWindow: value.fitWindow } : {}),
        ...(value.centerWindow !== undefined ? { centerWindow: value.centerWindow } : {}),
        ...(value.displayDocTitle !== undefined ? { displayDocTitle: value.displayDocTitle } : {}),
        ...(value.nonFullScreenPageMode !== undefined ? { nonFullScreenPageMode: value.nonFullScreenPageMode } : {}),
        ...(value.direction !== undefined ? { direction: value.direction } : {}),
        ...(value.printScaling !== undefined ? { printScaling: value.printScaling } : {}),
        ...(value.duplex !== undefined ? { duplex: value.duplex } : {}),
        ...(value.pickTrayByPDFSize !== undefined ? { pickTrayByPDFSize: value.pickTrayByPDFSize } : {}),
        ...(value.printPageRange !== undefined
            ? { printPageRange: value.printPageRange.map(([first, last]): readonly [number, number] => [first, last]) }
            : {}),
        ...(value.numCopies !== undefined ? { numCopies: value.numCopies } : {}),
    };
}
