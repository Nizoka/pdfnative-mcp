/**
 * Tests for `read_form_fields` (pdfnative v1.6.0 readFormFields wrapper).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { addForm } from '../src/tools/add-form.js';
import { readFormFieldsTool } from '../src/tools/read-form-fields.js';
import { ensureCompressionReady } from '../src/server.js';

async function makeFormBase64(): Promise<string> {
    const r = await addForm({
        title: 'Registration',
        fields: [
            { fieldType: 'text', name: 'fullName', label: 'Full name' },
            { fieldType: 'checkbox', name: 'subscribe', label: 'Subscribe' },
            { fieldType: 'dropdown', name: 'country', label: 'Country', options: ['FR', 'DE', 'ES'] },
        ],
    });
    return r.base64!;
}

describe('read_form_fields', () => {
    beforeAll(async () => {
        delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
        await ensureCompressionReady();
    });

    it('enumerates every field with name and type', async () => {
        const pdf = await makeFormBase64();
        const out = await readFormFieldsTool({ pdfBase64: pdf });
        expect(out.fieldCount).toBe(3);
        const byName = Object.fromEntries(out.fields.map((f) => [f.name, f]));
        expect(byName['fullName']!.type).toBe('text');
        expect(byName['subscribe']!.type).toBe('checkbox');
        expect(byName['country']!.type).toBe('dropdown');
    });

    it('reports widget placements with a page index and rect', async () => {
        const pdf = await makeFormBase64();
        const out = await readFormFieldsTool({ pdfBase64: pdf });
        const field = out.fields[0]!;
        expect(field.widgets.length).toBeGreaterThan(0);
        expect(field.widgets[0]!.rect).toHaveLength(4);
        expect(field.widgets[0]!.pageIndex).toBe(0);
    });

    it('returns an empty field list for a PDF without a form', async () => {
        const { generateBasicPdf } = await import('../src/tools/generate-basic-pdf.js');
        const doc = await generateBasicPdf({ title: 'Plain', blocks: [{ type: 'paragraph', text: 'no form' }] });
        const out = await readFormFieldsTool({ pdfBase64: doc.base64! });
        expect(out.fieldCount).toBe(0);
        expect(out.fields).toEqual([]);
    });

    it('rejects malformed input', async () => {
        await expect(readFormFieldsTool({})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects junk PDF bytes with PDF_PARSE_FAILED', async () => {
        const junk = Buffer.from('not a pdf').toString('base64');
        await expect(readFormFieldsTool({ pdfBase64: junk })).rejects.toMatchObject({ code: 'PDF_PARSE_FAILED' });
    });
});
