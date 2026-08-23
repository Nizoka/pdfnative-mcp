/**
 * Shared table fragment: the smart-table body (headers, rows and the
 * pdfnative ≥ 1.2 presentation options) used by `add_table` and by the
 * `table` block of `generate_basic_pdf`. JSON Schema and Zod are kept in
 * lock-step; `toTableBlock` is the single mapper to pdfnative's `TableBlock`.
 */
import type { CellBorders, TableBlock } from 'pdfnative';
import { z } from 'zod';

import { ToolError } from './errors.js';

export const CELL_BORDER_STYLES = ['solid', 'dashed', 'dotted'] as const;
export const CELL_VALIGNS = ['top', 'middle', 'bottom'] as const;

export const CELL_BORDERS_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    description: 'Per-cell vector borders (pure strokes, PDF/A-safe). Choose individual sides or `all`.',
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

export const CellBordersSchema = z.strictObject({
    top: z.boolean().optional(),
    right: z.boolean().optional(),
    bottom: z.boolean().optional(),
    left: z.boolean().optional(),
    all: z.boolean().optional(),
    color: z.string().min(1).max(64).optional(),
    width: z.number().min(0).max(10).optional(),
    style: z.enum(CELL_BORDER_STYLES).optional(),
});

export function toCellBorders(value: z.infer<typeof CellBordersSchema>): CellBorders {
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

/** JSON Schema properties of a table body (spread into a tool or block schema). */
export const TABLE_BODY_PROPERTIES = {
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
    autoFitColumns: {
        type: 'boolean',
        description: 'Auto-fit column widths to content. Output bytes then depend on text metrics (not byte-deterministic across content changes).',
    },
    clipCells: {
        type: 'boolean',
        description: 'Clip cell contents to the column bounds (PDF clip operators). Recommended for PDF/A and visual safety.',
    },
    wrap: {
        type: 'string',
        enum: ['auto', 'always', 'never'],
        description: "Cell wrap policy: 'auto' (default) wraps only overflowing cells; 'always' wraps every cell; 'never' truncates.",
    },
    repeatHeader: {
        type: 'boolean',
        description: 'Repeat the header row on every continuation page (default true).',
    },
    zebra: {
        type: 'boolean',
        description: 'Alternate-row light tint (static fill, PDF/A-1b safe).',
    },
    caption: {
        type: 'string',
        maxLength: 200,
        description: 'Caption rendered above the table (tagged as /Caption under PDF/A).',
    },
    minRowHeight: {
        type: 'number',
        minimum: 1,
        maximum: 200,
        description: 'Minimum row height in points (default 12).',
    },
    cellPadding: {
        type: 'number',
        minimum: 0,
        maximum: 50,
        description: 'Horizontal cell padding in points (default 3).',
    },
    cellBorders: CELL_BORDERS_INPUT_SCHEMA,
    cellVAlign: {
        type: 'string',
        enum: [...CELL_VALIGNS],
        description: 'Vertical alignment of cell content.',
    },
} as const;

/** Zod counterpart of {@link TABLE_BODY_PROPERTIES}. */
export const TableBodyShape = {
    headers: z.array(z.string().min(1).max(200)).min(1).max(50),
    rows: z.array(z.array(z.string().max(500)).min(1).max(50)).min(1).max(5000),
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
} as const;

export const TableBodySchema = z.strictObject(TableBodyShape);
export type TableBodyInput = z.infer<typeof TableBodySchema>;

/** True when any smart-table option is set (the document backend is then required). */
export function hasSmartTableOption(t: TableBodyInput): boolean {
    return (
        t.wrap !== undefined ||
        t.repeatHeader !== undefined ||
        t.zebra !== undefined ||
        t.caption !== undefined ||
        t.minRowHeight !== undefined ||
        t.cellPadding !== undefined ||
        t.cellBorders !== undefined ||
        t.cellVAlign !== undefined
    );
}

/** Every row must have exactly as many cells as there are headers. */
export function assertRowsMatchHeaders(t: Pick<TableBodyInput, 'headers' | 'rows'>, where = ''): void {
    t.rows.forEach((row, i) => {
        if (row.length !== t.headers.length) {
            throw new ToolError(
                'VALIDATION_ERROR',
                `${where}Row ${i} has ${row.length} cell(s) but headers defines ${t.headers.length} column(s).`,
            );
        }
    });
}

export function toTableBlock(t: TableBodyInput): TableBlock {
    return {
        type: 'table',
        headers: t.headers,
        rows: t.rows.map((cells) => ({ cells, type: '', pointed: false })),
        ...(t.autoFitColumns !== undefined ? { autoFitColumns: t.autoFitColumns } : {}),
        ...(t.clipCells !== undefined ? { clipCells: t.clipCells } : {}),
        ...(t.wrap !== undefined ? { wrap: t.wrap } : {}),
        ...(t.repeatHeader !== undefined ? { repeatHeader: t.repeatHeader } : {}),
        ...(t.zebra !== undefined ? { zebra: t.zebra } : {}),
        ...(t.caption !== undefined ? { caption: t.caption } : {}),
        ...(t.minRowHeight !== undefined ? { minRowHeight: t.minRowHeight } : {}),
        ...(t.cellPadding !== undefined ? { cellPadding: t.cellPadding } : {}),
        ...(t.cellBorders !== undefined ? { cellBorders: toCellBorders(t.cellBorders) } : {}),
        ...(t.cellVAlign !== undefined ? { cellVAlign: t.cellVAlign } : {}),
    };
}
