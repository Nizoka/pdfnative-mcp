/**
 * Tests for `fill_form` (pdfnative v1.6.0 fillForm / flattenForm wrapper).
 */
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { addForm } from '../src/tools/add-form.js';
import { fillFormTool } from '../src/tools/fill-form.js';
import { readFormFieldsTool } from '../src/tools/read-form-fields.js';
import { prepareSignaturePlaceholder } from '../src/tools/prepare-signature-placeholder.js';
import { ensureCompressionReady } from '../src/server.js';
import { assertValidPdf } from './_pdf-assert.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

async function makeFormBase64(): Promise<string> {
    const r = await addForm({
        title: 'Registration',
        fields: [
            { fieldType: 'text', name: 'fullName', label: 'Full name' },
            { fieldType: 'checkbox', name: 'subscribe', label: 'Subscribe' },
        ],
    });
    return r.base64!;
}

describe('fill_form', () => {
    beforeAll(async () => {
        delete process.env[ENV_KEY];
        await ensureCompressionReady();
    });
    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it('fills text and checkbox fields and keeps the interactive form', async () => {
        const pdf = await makeFormBase64();
        const out = await fillFormTool({ pdfBase64: pdf, values: { fullName: 'Alice Martin', subscribe: true } });
        expect(out.mode).toBe('base64');
        assertValidPdf(out.base64 as string, 1);
        // Still interactive: the field is present and now carries the value.
        const fields = await readFormFieldsTool({ pdfBase64: out.base64! });
        const name = fields.fields.find((f) => f.name === 'fullName');
        expect(name?.value).toBe('Alice Martin');
    });

    it('flattens the form when flatten:true (fields removed)', async () => {
        const pdf = await makeFormBase64();
        const out = await fillFormTool({ pdfBase64: pdf, values: { fullName: 'Bob' }, flatten: true });
        assertValidPdf(out.base64 as string, 1);
        const fields = await readFormFieldsTool({ pdfBase64: out.base64! });
        expect(fields.fieldCount).toBe(0);
    });

    it('supports a pure flatten with no values', async () => {
        const pdf = await makeFormBase64();
        const out = await fillFormTool({ pdfBase64: pdf, flatten: true });
        const fields = await readFormFieldsTool({ pdfBase64: out.base64! });
        expect(fields.fieldCount).toBe(0);
    });

    it('rejects an unknown field name with FORM_FIELD_NOT_FOUND', async () => {
        const pdf = await makeFormBase64();
        await expect(fillFormTool({ pdfBase64: pdf, values: { nope: 'x' } })).rejects.toMatchObject({
            code: 'FORM_FIELD_NOT_FOUND',
        });
    });

    it('ignores unknown fields when onUnknownField=ignore', async () => {
        const pdf = await makeFormBase64();
        const out = await fillFormTool({ pdfBase64: pdf, values: { nope: 'x', fullName: 'Ok' }, onUnknownField: 'ignore' });
        assertValidPdf(out.base64 as string, 1);
    });

    it('rejects neither values nor flatten with VALIDATION_ERROR', async () => {
        const pdf = await makeFormBase64();
        await expect(fillFormTool({ pdfBase64: pdf })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects a choice value outside the options with FORM_VALUE_TYPE_ERROR', async () => {
        const withDropdown = await addForm({
            title: 'D',
            fields: [{ fieldType: 'dropdown', name: 'country', label: 'Country', options: ['FR', 'DE'] }],
        });
        await expect(fillFormTool({ pdfBase64: withDropdown.base64!, values: { country: 'ZZ' } })).rejects.toMatchObject({
            code: 'FORM_VALUE_TYPE_ERROR',
        });
    });

    it('rejects junk PDF bytes via the decrypt/parse mapper', async () => {
        const junk = Buffer.from('not a pdf').toString('base64');
        await expect(fillFormTool({ pdfBase64: junk, values: { x: 'y' } })).rejects.toMatchObject({ code: 'PDF_PARSE_FAILED' });
    });

    it('rejects filling a signature field with FORM_UNSUPPORTED', async () => {
        const placeholder = await prepareSignaturePlaceholder({ title: 'Contract', signerName: 'Alice', reason: 'approve' });
        const fields = await readFormFieldsTool({ pdfBase64: placeholder.base64! });
        const sig = fields.fields.find((f) => f.type === 'signature');
        expect(sig).toBeDefined();
        await expect(fillFormTool({ pdfBase64: placeholder.base64!, values: { [sig!.name]: 'x' } })).rejects.toMatchObject({
            code: 'FORM_UNSUPPORTED',
        });
    });

    it('rejects an empty decoded buffer with VALIDATION_ERROR', async () => {
        await expect(fillFormTool({ pdfBase64: '====', values: { x: 'y' } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('writes to a sandboxed file when outputMode=file', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-fillform-'));
        process.env[ENV_KEY] = dir;
        const pdf = await makeFormBase64();
        const out = await fillFormTool({
            pdfBase64: pdf,
            values: { fullName: 'Carol' },
            outputMode: 'file',
            outputPath: 'filled.pdf',
        });
        expect(out.mode).toBe('file');
        expect(out.filePath?.startsWith(dir)).toBe(true);
        const bytes = await fs.readFile(out.filePath as string);
        assertValidPdf(new Uint8Array(bytes), 1);
    });
});
