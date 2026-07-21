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
