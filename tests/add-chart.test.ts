/**
 * Tests for `add_chart` (pdfnative v1.6.0 native vector charts).
 */
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { addChart } from '../src/tools/add-chart.js';
import { ensureCompressionReady } from '../src/server.js';
import { assertValidPdf } from './_pdf-assert.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

describe('add_chart', () => {
    beforeAll(async () => {
        delete process.env[ENV_KEY];
        await ensureCompressionReady();
    });
    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it('renders a multi-series bar chart', async () => {
        const out = await addChart({
            chartType: 'bar',
            title: 'Quarterly revenue',
            categories: ['Q1', 'Q2', 'Q3', 'Q4'],
            series: [
                { label: '2025', values: [12, 18, 15, 22] },
                { label: '2026', values: [14, 20, 19, 25] },
            ],
            axis: { grid: true },
            colors: ['#3366cc', '#dc3912'],
        });
        expect(out.mode).toBe('base64');
        assertValidPdf(out.base64 as string, 1);
    });

    it('renders a pie chart from a single series', async () => {
        const out = await addChart({
            chartType: 'pie',
            title: 'Market share',
            categories: ['A', 'B', 'C'],
            series: [{ label: 'Share', values: [55, 30, 15] }],
        });
        assertValidPdf(out.base64 as string, 1);
    });

    it('renders a PDF/A-2b line chart (tagged, auto alt text)', async () => {
        const out = await addChart({
            chartType: 'line',
            markers: true,
            categories: ['Jan', 'Feb', 'Mar'],
            series: [{ label: 'Signups', values: [120, 180, 260] }],
            pdfA: 'pdfa2b',
        });
        assertValidPdf(out.base64 as string, 1);
    });

    it('accepts an optional intro paragraph', async () => {
        const out = await addChart({
            chartType: 'donut',
            intro: 'Distribution of responses.',
            series: [{ label: 's', values: [1, 2, 3] }],
            categories: ['x', 'y', 'z'],
        });
        assertValidPdf(out.base64 as string, 1);
    });

    it('rejects a missing series with VALIDATION_ERROR', async () => {
        await expect(addChart({ chartType: 'bar' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects an invalid chartType with VALIDATION_ERROR', async () => {
        await expect(addChart({ chartType: 'radar', series: [{ label: 's', values: [1] }] })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
    });

    it('rejects a non-hex colour with VALIDATION_ERROR', async () => {
        await expect(
            addChart({ chartType: 'bar', series: [{ label: 's', values: [1], color: 'blue' }], categories: ['a'] }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(
            addChart({ chartType: 'bar', series: [{ label: 's', values: [1] }], categories: ['a'], colors: ['not-a-color'] }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('writes to a sandboxed file when outputMode=file', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-chart-'));
        process.env[ENV_KEY] = dir;
        const out = await addChart({
            chartType: 'bar',
            series: [{ label: 's', values: [1, 2] }],
            categories: ['a', 'b'],
            outputMode: 'file',
            outputPath: 'chart.pdf',
        });
        expect(out.mode).toBe('file');
        const bytes = await fs.readFile(out.filePath as string);
        assertValidPdf(new Uint8Array(bytes), 1);
    });
});

describe('add_chart print + diagnostics inputs (v1.6.0)', () => {
    const CHART = { chartType: 'bar', title: 'Sales', series: [{ label: 'Q1', values: [1, 2, 3] }], categories: ['a', 'b', 'c'] } as const;

    it('embedFonts + pdfA + includeDiagnostics yields a valid PDF with no font diagnostic', async () => {
        const result = await addChart({ ...CHART, embedFonts: true, pdfA: 'pdfa2b', includeDiagnostics: true });
        assertValidPdf(result.base64 as string);
        expect(result.diagnostics!.map((d) => d.code)).not.toContain('PDFA_NO_FONT_ENTRIES');
    });

    it('strict + pdfA without embedFonts keeps the stable PDF_A_COMPLIANCE_VIOLATION code (not CHART_ERROR)', async () => {
        await expect(addChart({ ...CHART, pdfA: 'pdfa2b', strict: true })).rejects.toMatchObject({ code: 'PDF_A_COMPLIANCE_VIOLATION' });
    });

    it('print bleed + metadata reach the output', async () => {
        const result = await addChart({ ...CHART, print: { bleed: 8.5, marks: true }, metadata: { author: 'A' } });
        const text = Buffer.from(result.base64 as string, 'base64').toString('latin1');
        expect(text).toContain('/TrimBox');
        expect(text).toContain('/Author (A)');
    });

    it('marks without a TrimBox surfaces as PRINT_ERROR', async () => {
        await expect(addChart({ ...CHART, print: { marks: true } })).rejects.toMatchObject({ code: 'PRINT_ERROR' });
    });
});

describe('add_chart — charts v2 (pdfnative 1.7)', () => {
    beforeAll(async () => {
        await ensureCompressionReady();
    });

    const pdfOf = (r: { base64?: string }): Buffer => Buffer.from(r.base64 as string, 'base64');

    it('renders stackedBar, stackedBarH and area charts', async () => {
        for (const chartType of ['stackedBar', 'stackedBarH', 'area'] as const) {
            const r = await addChart({
                chartType,
                categories: ['Q1', 'Q2', 'Q3'],
                series: [
                    { label: 'A', values: [1, 2, 3] },
                    { label: 'B', values: [2, 1, 2] },
                ],
                dataLabels: { decimals: 1, suffix: ' k' },
            });
            assertValidPdf(pdfOf(r));
        }
    });

    it('renders a scatter chart on a linear x axis and a line chart on a UTC time axis with a secondary right axis', async () => {
        const scatter = await addChart({
            chartType: 'scatter',
            xAxis: { type: 'linear', grid: true },
            series: [{ label: 'pts', values: [3, 1, 4, 1, 5], xValues: [1, 2, 3, 4, 5] }],
        });
        assertValidPdf(pdfOf(scatter));

        const dual = await addChart({
            chartType: 'line',
            xAxis: { type: 'time', ticks: 4 },
            axis: { scale: 'linear', grid: true },
            axis2: { yMin: 0, yMax: 100, ticks: 5 },
            series: [
                { label: 'Revenue', values: [10, 20, 15], xValues: ['2026-01-01', '2026-02-01', '2026-03-01'] },
                { label: 'Margin %', values: [40, 45, 42], xValues: ['2026-01-01', '2026-02-01', '2026-03-01'], yAxis: 'right' },
            ],
            markers: true,
        });
        assertValidPdf(pdfOf(dual));
    });

    it('supports a log scale and x-label stride / rotation on category charts, deterministically', async () => {
        const args = {
            chartType: 'bar' as const,
            categories: Array.from({ length: 40 }, (_, i) => `Category ${i + 1}`),
            series: [{ label: 'v', values: Array.from({ length: 40 }, (_, i) => 10 ** (1 + (i % 4))) }],
            axis: { scale: 'log' as const },
            labelRotation: 45,
        };
        const a = await addChart(args);
        const b = await addChart(args);
        expect(a.base64).toBe(b.base64);
        const strided = await addChart({ ...args, labelRotation: undefined, labelStride: 5 });
        assertValidPdf(pdfOf(strided));
        expect(strided.base64).not.toBe(a.base64);
    });

    it('lets the engine validate cross-field rules and maps them to CHART_ERROR with the remedy', async () => {
        const log = await addChart({ chartType: 'bar', series: [{ label: 'v', values: [0, 1] }], axis: { scale: 'log' } }).catch((e: unknown) => e);
        expect(log).toMatchObject({ code: 'CHART_ERROR' });
        expect(String((log as Error).message)).toMatch(/log/i);

        const scatter = await addChart({ chartType: 'scatter', series: [{ label: 'v', values: [1, 2] }] }).catch((e: unknown) => e);
        expect(scatter).toMatchObject({ code: 'CHART_ERROR' });

        const mismatch = await addChart({ chartType: 'line', xAxis: { type: 'linear' }, series: [{ label: 'v', values: [1, 2, 3], xValues: [1, 2] }] }).catch((e: unknown) => e);
        expect(mismatch).toMatchObject({ code: 'CHART_ERROR' });

        const stackedLog = await addChart({ chartType: 'stackedBar', series: [{ label: 'v', values: [1, 2] }], axis: { scale: 'log' } }).catch((e: unknown) => e);
        expect(stackedLog).toMatchObject({ code: 'CHART_ERROR' });
    });

    it('rejects out-of-range v2 fields with VALIDATION_ERROR (shape and bounds stay in the schema)', async () => {
        await expect(addChart({ chartType: 'bar', series: [{ label: 'v', values: [1] }], labelRotation: 120 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(addChart({ chartType: 'bar', series: [{ label: 'v', values: [1] }], labelStride: 0 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(addChart({ chartType: 'bar', series: [{ label: 'v', values: [1], yAxis: 'middle' }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(addChart({ chartType: 'bar', series: [{ label: 'v', values: [1] }], dataLabels: { decimals: 9 } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('a v1 chart renders identically with or without the new (absent) fields', async () => {
        const base = { chartType: 'bar' as const, categories: ['a', 'b'], series: [{ label: 's', values: [1, 2] }] };
        const a = await addChart(base);
        const b = await addChart({ ...base, labelStride: undefined, xAxis: undefined });
        expect(a.base64).toBe(b.base64);
    });
});
