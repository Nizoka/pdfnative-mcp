import { describe, it, expect, beforeAll } from 'vitest';
import { addTable } from '../src/tools/add-table.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MPC_OUTPUT_DIR'];
    await ensureCompressionReady();
});

const PDF_HEADER = '%PDF-';

function decode(b64: string): string {
    return Buffer.from(b64, 'base64').toString('latin1').slice(0, 5);
}

describe('add_table', () => {
    it('produces a valid PDF from minimal table data', async () => {
        const result = await addTable({
            title: 'Sales Report',
            headers: ['Product', 'Units', 'Revenue'],
            rows: [
                ['Widget A', '100', '$1,000'],
                ['Widget B', '200', '$2,500'],
            ],
        });
        expect(result.mode).toBe('base64');
        expect(result.sizeBytes).toBeGreaterThan(100);
        expect(decode(result.base64!)).toBe(PDF_HEADER);
    });

    it('includes infoItems and footerText', async () => {
        const result = await addTable({
            title: 'Inventory',
            headers: ['Item', 'Qty'],
            rows: [['Pen', '50']],
            infoItems: [
                { label: 'Date', value: '2025-01-01' },
                { label: 'Author', value: 'Alice' },
            ],
            footerText: 'Confidential',
        });
        expect(result.mode).toBe('base64');
        expect(decode(result.base64!)).toBe(PDF_HEADER);
    });

    it('rejects mismatched row length', async () => {
        await expect(
            addTable({
                title: 'Report',
                headers: ['A', 'B', 'C'],
                rows: [['x', 'y']], // only 2 cells, but 3 headers
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects empty headers', async () => {
        await expect(
            addTable({
                title: 'Report',
                headers: [],
                rows: [['x']],
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects empty rows', async () => {
        await expect(
            addTable({
                title: 'Report',
                headers: ['Col'],
                rows: [],
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects missing required fields', async () => {
        await expect(addTable({ title: 'Report' })).rejects.toThrow(ToolError);
        await expect(addTable({})).rejects.toThrow(ToolError);
    });
});
