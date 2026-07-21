/**
 * Shared schema + mapper for native vector charts (pdfnative v1.6.0 `ChartBlock`).
 *
 * pdfnative 1.6.0 renders bar / horizontal-bar / line / pie / donut charts as
 * pure PDF path operators (zero dependencies, no rasterisation), as a first-class
 * member of the `DocumentBlock` union. This module exposes the chart-block JSON
 * Schema (+ lock-stepped Zod) and a `toChartBlock` mapper so both the dedicated
 * `add_chart` tool and the `generate_basic_pdf` `chart` block build identical
 * pdfnative blocks.
 *
 * Colours are accepted as CSS-style hex strings (e.g. `#3366cc`); pdfnative's
 * `PdfColor` accepts hex strings directly. A tagged-PDF `/Figure` + `/Alt` is
 * emitted automatically (auto-generated alt text when `altText` is omitted), so
 * charts stay PDF/A- and PDF/UA-safe.
 */
import { type ChartBlock } from 'pdfnative';
import { z } from 'zod';

export const CHART_TYPE_ENUM = ['bar', 'barH', 'line', 'pie', 'donut'] as const;

/** Hex-colour pattern shared by series and palette overrides (JSON Schema + Zod stay in lock-step). */
const HEX_COLOR_PATTERN = '^#?[0-9a-fA-F]{6}$';
const HEX_COLOR_RE = new RegExp(HEX_COLOR_PATTERN);
const HEX_COLOR = { type: 'string', pattern: HEX_COLOR_PATTERN, description: 'CSS-style hex colour, e.g. "#3366cc".' } as const;

/** JSON Schema fragment for a single chart series. */
const CHART_SERIES_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['label', 'values'],
    properties: {
        label: { type: 'string', minLength: 1, maxLength: 200, description: 'Series label (shown in the legend).' },
        values: {
            type: 'array',
            minItems: 1,
            maxItems: 1000,
            items: { type: 'number' },
            description: 'Numeric values, one per category. Negative values are supported for bar/line.',
        },
        color: HEX_COLOR,
    },
} as const;

/**
 * JSON Schema for a chart definition (the body shared by the `add_chart` tool
 * input and the `generate_basic_pdf` `chart` block — the block adds `type:'chart'`).
 */
export const CHART_BODY_PROPERTIES = {
    chartType: {
        type: 'string',
        enum: [...CHART_TYPE_ENUM],
        description: "Chart kind. 'pie'/'donut' use exactly one series; 'bar'/'barH'/'line' support multiple series.",
    },
    series: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: CHART_SERIES_SCHEMA,
        description: 'Data series. Pie/donut charts use exactly one series (each value becomes a slice).',
    },
    categories: {
        type: 'array',
        maxItems: 1000,
        items: { type: 'string', maxLength: 200 },
        description: 'Category / slice labels (x-axis). Defaults to 1-based indices when omitted.',
    },
    title: { type: 'string', maxLength: 200, description: 'Chart title rendered above the plot.' },
    legend: { type: 'string', enum: ['bottom', 'none'], description: "Legend placement. Defaults to 'bottom' for multi-series/pie, else 'none'." },
    axis: {
        type: 'object',
        additionalProperties: false,
        description: 'Value-axis options (bar/line only).',
        properties: {
            yMin: { type: 'number', description: 'Force the axis minimum (values are clamped to the plot band).' },
            yMax: { type: 'number', description: 'Force the axis maximum (values are clamped to the plot band).' },
            ticks: { type: 'integer', minimum: 2, maximum: 20, description: 'Target tick count (nice 1/2/5×10ⁿ steps).' },
            grid: { type: 'boolean', description: 'Draw horizontal gridlines.' },
        },
    },
    markers: { type: 'boolean', description: 'Draw point markers on line series. Default false.' },
    colors: {
        type: 'array',
        maxItems: 50,
        items: HEX_COLOR,
        description: 'Palette override (per-series for bar/line, per-slice for pie/donut).',
    },
    align: { type: 'string', enum: ['left', 'center', 'right'], description: "Horizontal alignment within the content width. Default 'left'." },
    altText: { type: 'string', maxLength: 500, description: 'Alt text for the tagged-PDF /Figure /Alt. Auto-generated when omitted.' },
    width: { type: 'number', minimum: 50, maximum: 2000, description: 'Plot width in points (clamped to content width). Default 460.' },
    height: { type: 'number', minimum: 50, maximum: 2000, description: 'Plot-area height in points. Default 240.' },
} as const;

/** Zod counterpart of {@link CHART_BODY_PROPERTIES}. */
export const ChartBodySchema = z.object({
    chartType: z.enum(CHART_TYPE_ENUM),
    series: z
        .array(
            z.object({
                label: z.string().min(1).max(200),
                values: z.array(z.number()).min(1).max(1000),
                color: z.string().regex(HEX_COLOR_RE).optional(),
            }),
        )
        .min(1)
        .max(50),
    categories: z.array(z.string().max(200)).max(1000).optional(),
    title: z.string().max(200).optional(),
    legend: z.enum(['bottom', 'none']).optional(),
    axis: z
        .object({
            yMin: z.number().optional(),
            yMax: z.number().optional(),
            ticks: z.number().int().min(2).max(20).optional(),
            grid: z.boolean().optional(),
        })
        .optional(),
    markers: z.boolean().optional(),
    colors: z.array(z.string().regex(HEX_COLOR_RE)).max(50).optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    altText: z.string().max(500).optional(),
    width: z.number().min(50).max(2000).optional(),
    height: z.number().min(50).max(2000).optional(),
});

/** Normalise a hex colour to pdfnative's expected `#rrggbb` form. */
function normHex(color: string): string {
    return color.startsWith('#') ? color : `#${color}`;
}

/** Map a validated chart body to a pdfnative {@link ChartBlock}. */
export function toChartBlock(input: z.infer<typeof ChartBodySchema>): ChartBlock {
    return {
        type: 'chart',
        chartType: input.chartType,
        series: input.series.map((s) => ({
            label: s.label,
            values: s.values,
            ...(s.color !== undefined ? { color: normHex(s.color) } : {}),
        })),
        ...(input.categories !== undefined ? { categories: input.categories } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.legend !== undefined ? { legend: input.legend } : {}),
        ...(input.axis !== undefined ? { axis: input.axis } : {}),
        ...(input.markers !== undefined ? { markers: input.markers } : {}),
        ...(input.colors !== undefined ? { colors: input.colors.map(normHex) } : {}),
        ...(input.align !== undefined ? { align: input.align } : {}),
        ...(input.altText !== undefined ? { altText: input.altText } : {}),
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
    };
}
