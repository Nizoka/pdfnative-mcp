/**
 * Shared schema + mapper for native vector charts (pdfnative `ChartBlock`).
 *
 * pdfnative renders bar / horizontal-bar / stacked-bar / line / area / scatter /
 * pie / donut charts as pure PDF path operators (zero dependencies, no
 * rasterisation), as a first-class member of the `DocumentBlock` union. Charts
 * v2 (pdfnative 1.7) adds a secondary right axis, log and UTC-deterministic
 * time scales, per-point data labels and x-label collision handling.
 *
 * Cross-field rules (log scale vs non-positive values, scatter needing
 * positional x values, …) are validated by the engine, whose messages carry the
 * remedy; they surface as `CHART_ERROR`. The schemas here validate shapes and
 * bounds only, so they cannot drift from the engine. This module exposes the chart-block JSON
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

export const CHART_TYPE_ENUM = ['bar', 'barH', 'stackedBar', 'stackedBarH', 'line', 'area', 'scatter', 'pie', 'donut'] as const;

const X_VALUE = { type: ['number', 'string'], maxLength: 64, description: 'Positional x value: a number (linear axis) or an ISO-8601 date / epoch milliseconds (time axis).' } as const;

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
        xValues: {
            type: 'array',
            minItems: 1,
            maxItems: 1000,
            items: X_VALUE,
            description: "Per-point x positions (same length as values) for scatter charts and for line/area charts with xAxis.type 'linear' or 'time'.",
        },
        yAxis: { type: 'string', enum: ['left', 'right'], description: "Bind the series to the left (default) or the secondary right value axis (cartesian charts only; configure its range with 'axis2')." },
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
        description:
            "Chart kind. 'pie'/'donut' use exactly one series; 'bar'/'barH'/'stackedBar'/'stackedBarH'/'line'/'area'/'scatter' support multiple series. 'scatter' requires xValues on every series and a positional xAxis.type ('linear' or 'time').",
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
            scale: { type: 'string', enum: ['linear', 'log'], description: "Value-axis scale. 'log' requires strictly positive values and is not available for stacked charts." },
        },
    },
    axis2: {
        type: 'object',
        additionalProperties: false,
        description: "Secondary RIGHT value axis (drawn only when a series sets yAxis:'right').",
        properties: {
            yMin: { type: 'number' },
            yMax: { type: 'number' },
            ticks: { type: 'integer', minimum: 2, maximum: 20 },
            scale: { type: 'string', enum: ['linear', 'log'] },
        },
    },
    xAxis: {
        type: 'object',
        additionalProperties: false,
        description: "Horizontal axis. 'category' (default) positions points by index; 'linear' / 'time' position them by series xValues (line/area/scatter only). Time ticks are UTC-deterministic.",
        properties: {
            type: { type: 'string', enum: ['category', 'linear', 'time'] },
            min: { ...X_VALUE, description: 'Axis minimum (number, or ISO-8601 / epoch ms for time axes).' },
            max: { ...X_VALUE, description: 'Axis maximum (number, or ISO-8601 / epoch ms for time axes).' },
            ticks: { type: 'integer', minimum: 2, maximum: 20 },
            grid: { type: 'boolean', description: 'Draw vertical gridlines.' },
        },
    },
    dataLabels: {
        description: 'Per-point value labels: true for defaults, or an object to format them.',
        oneOf: [
            { type: 'boolean' },
            {
                type: 'object',
                additionalProperties: false,
                properties: {
                    decimals: { type: 'integer', minimum: 0, maximum: 6 },
                    prefix: { type: 'string', maxLength: 16 },
                    suffix: { type: 'string', maxLength: 16 },
                },
            },
        ],
    },
    labelStride: { type: 'integer', minimum: 1, maximum: 1000, description: 'Draw every Nth category label. Default: automatic (measured non-overlap); 1 draws every label.' },
    labelRotation: { type: 'number', minimum: 0, maximum: 90, description: 'Rotate category labels counter-clockwise by this many degrees (disables the automatic stride).' },
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
                xValues: z.array(z.union([z.number(), z.string().max(64)])).min(1).max(1000).optional(),
                yAxis: z.enum(['left', 'right']).optional(),
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
            scale: z.enum(['linear', 'log']).optional(),
        })
        .optional(),
    axis2: z
        .object({
            yMin: z.number().optional(),
            yMax: z.number().optional(),
            ticks: z.number().int().min(2).max(20).optional(),
            scale: z.enum(['linear', 'log']).optional(),
        })
        .optional(),
    xAxis: z
        .object({
            type: z.enum(['category', 'linear', 'time']).optional(),
            min: z.union([z.number(), z.string().max(64)]).optional(),
            max: z.union([z.number(), z.string().max(64)]).optional(),
            ticks: z.number().int().min(2).max(20).optional(),
            grid: z.boolean().optional(),
        })
        .optional(),
    dataLabels: z
        .union([
            z.boolean(),
            z.object({
                decimals: z.number().int().min(0).max(6).optional(),
                prefix: z.string().max(16).optional(),
                suffix: z.string().max(16).optional(),
            }),
        ])
        .optional(),
    labelStride: z.number().int().min(1).max(1000).optional(),
    labelRotation: z.number().min(0).max(90).optional(),
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
            ...(s.xValues !== undefined ? { xValues: s.xValues } : {}),
            ...(s.yAxis !== undefined ? { yAxis: s.yAxis } : {}),
        })),
        ...(input.categories !== undefined ? { categories: input.categories } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.legend !== undefined ? { legend: input.legend } : {}),
        ...(input.axis !== undefined ? { axis: input.axis } : {}),
        ...(input.axis2 !== undefined ? { axis2: input.axis2 } : {}),
        ...(input.xAxis !== undefined ? { xAxis: input.xAxis } : {}),
        ...(input.dataLabels !== undefined ? { dataLabels: input.dataLabels } : {}),
        ...(input.labelStride !== undefined ? { labelStride: input.labelStride } : {}),
        ...(input.labelRotation !== undefined ? { labelRotation: input.labelRotation } : {}),
        ...(input.markers !== undefined ? { markers: input.markers } : {}),
        ...(input.colors !== undefined ? { colors: input.colors.map(normHex) } : {}),
        ...(input.align !== undefined ? { align: input.align } : {}),
        ...(input.altText !== undefined ? { altText: input.altText } : {}),
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
    };
}
