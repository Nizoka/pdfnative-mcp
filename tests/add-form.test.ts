import { describe, it, expect, beforeAll } from 'vitest';
import { addForm } from '../src/tools/add-form.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

const PDF_HEADER = '%PDF-';

function decode(b64: string): string {
    return Buffer.from(b64, 'base64').toString('latin1').slice(0, 5);
}

describe('add_form', () => {
    it('produces a valid PDF with a text field', async () => {
        const result = await addForm({
            title: 'Contact Form',
            fields: [
                { fieldType: 'text', name: 'firstName', label: 'First Name' },
                { fieldType: 'text', name: 'lastName', label: 'Last Name', required: true },
            ],
        });
        expect(result.mode).toBe('base64');
        expect(result.sizeBytes).toBeGreaterThan(100);
        assertValidPdf(result.base64!);
    });

    it('produces a PDF with all supported field types', async () => {
        const result = await addForm({
            title: 'Full Form',
            fields: [
                { fieldType: 'text', name: 'name', label: 'Name', value: 'Alice' },
                { fieldType: 'textarea', name: 'bio', label: 'Biography', height: 80 },
                { fieldType: 'checkbox', name: 'agree', label: 'I agree', checked: true },
                { fieldType: 'radio', name: 'color', label: 'Favorite color', options: ['Red', 'Blue', 'Green'] },
                { fieldType: 'dropdown', name: 'country', label: 'Country', options: ['France', 'Germany'] },
            ],
            footerText: 'Please fill all fields.',
        });
        expect(result.mode).toBe('base64');
        expect(decode(result.base64!)).toBe(PDF_HEADER);
    });

    it('rejects radio field without options', async () => {
        await expect(
            addForm({
                title: 'Form',
                fields: [{ fieldType: 'radio', name: 'choice' }],
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects dropdown field without options', async () => {
        await expect(
            addForm({
                title: 'Form',
                fields: [{ fieldType: 'dropdown', name: 'pick' }],
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects empty fields array', async () => {
        await expect(
            addForm({
                title: 'Form',
                fields: [],
            }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects missing title', async () => {
        await expect(
            addForm({
                fields: [{ fieldType: 'text', name: 'x' }],
            }),
        ).rejects.toThrow(ToolError);
    });

    it('covers optional field props: readOnly, maxLength, width, fontSize', async () => {
        const result = await addForm({
            title: 'Extended Props',
            fields: [
                {
                    fieldType: 'text',
                    name: 'code',
                    label: 'Code',
                    readOnly: true,
                    maxLength: 10,
                    width: 200,
                    fontSize: 12,
                },
            ],
        });
        expect(result.mode).toBe('base64');
        expect(decode(result.base64!)).toBe(PDF_HEADER);
    });
});

describe('add_form print + diagnostics inputs (v1.6.0)', () => {
    const FORM = { title: 'Survey', fields: [{ fieldType: 'text', name: 'fullName', label: 'Full name' }] } as const;

    it('embedFonts + pdfA + includeDiagnostics yields a valid PDF with no font diagnostic', async () => {
        const result = await addForm({ ...FORM, embedFonts: true, pdfA: 'pdfa2b', includeDiagnostics: true });
        assertValidPdf(result.base64!);
        expect(result.diagnostics!.map((d) => d.code)).not.toContain('PDFA_NO_FONT_ENTRIES');
    });

    it('strict + pdfA without embedFonts is rejected with PDF_A_COMPLIANCE_VIOLATION', async () => {
        await expect(addForm({ ...FORM, pdfA: 'pdfa2b', strict: true })).rejects.toMatchObject({ code: 'PDF_A_COMPLIANCE_VIOLATION' });
    });

    it('print bleed + metadata reach the output', async () => {
        const result = await addForm({ ...FORM, print: { bleed: 8.5 }, metadata: { author: 'A' } });
        const text = Buffer.from(result.base64!, 'base64').toString('latin1');
        expect(text).toContain('/TrimBox');
        expect(text).toContain('/Author (A)');
    });
});
