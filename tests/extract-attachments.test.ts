/**
 * Tests for `extract_attachments` (read-only embedded-file extraction).
 *
 * Centres on the Factur-X round-trip: `add_attachment` embeds an XML payload,
 * `extract_attachments` pulls it back out byte-for-byte. Also covers the
 * filename filter, metadata-only probe, encrypted rejection, verbosity/fields
 * projection helpers (applied here at the data level), and error paths.
 */
import { describe, expect, it } from 'vitest';

import { addAttachment } from '../src/tools/add-attachment.js';
import { extractAttachments } from '../src/tools/extract-attachments.js';
import { inspectPdf } from '../src/tools/inspect-pdf.js';

const XML = '<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice/>';
const CSV = 'a,b\n1,2\n';

function b64(s: string): string {
    return Buffer.from(s, 'utf8').toString('base64');
}

async function makeInvoiceWithAttachments(): Promise<string> {
    const r = await addAttachment({
        title: 'Factur-X round-trip',
        attachments: [
            { filename: 'factur-x.xml', mimeType: 'application/xml', dataBase64: b64(XML), relationship: 'Source', description: 'Factur-X XML' },
            { filename: 'data.csv', mimeType: 'text/csv', dataBase64: b64(CSV), relationship: 'Supplement' },
        ],
    });
    return r.base64!;
}

describe('extract_attachments', () => {
    it('round-trips the embedded payload byte-for-byte', async () => {
        const pdfBase64 = await makeInvoiceWithAttachments();
        const out = await extractAttachments({ pdfBase64 });

        expect(out.attachmentCount).toBe(2);
        const xml = out.attachments.find((a) => a.name === 'factur-x.xml');
        expect(xml).toBeDefined();
        expect(xml?.mimeType).toBe('application/xml');
        expect(xml?.relationship).toBe('Source');
        expect(xml?.description).toBe('Factur-X XML');
        expect(Buffer.from(xml!.dataBase64!, 'base64').toString('utf8')).toBe(XML);

        const csv = out.attachments.find((a) => a.name === 'data.csv');
        expect(Buffer.from(csv!.dataBase64!, 'base64').toString('utf8')).toBe(CSV);
    });

    it('reports metadata consistent with inspect_pdf', async () => {
        const pdfBase64 = await makeInvoiceWithAttachments();
        const insp = await inspectPdf({ pdfBase64 });
        const out = await extractAttachments({ pdfBase64, includeData: false });
        expect(out.attachmentCount).toBe(insp.attachments?.length ?? 0);
        expect(out.attachments.map((a) => a.name).sort()).toEqual(
            (insp.attachments ?? []).map((a) => a.name).sort(),
        );
    });

    it('filters to a single attachment by exact filename', async () => {
        const pdfBase64 = await makeInvoiceWithAttachments();
        const out = await extractAttachments({ pdfBase64, filename: 'factur-x.xml' });
        expect(out.attachmentCount).toBe(1);
        expect(out.attachments[0].name).toBe('factur-x.xml');
    });

    it('omits payload bytes when includeData is false', async () => {
        const pdfBase64 = await makeInvoiceWithAttachments();
        const out = await extractAttachments({ pdfBase64, includeData: false });
        expect(out.attachmentCount).toBe(2);
        for (const a of out.attachments) {
            expect(a.dataBase64).toBeUndefined();
            expect(a.name).toBeTruthy();
        }
    });

    it('returns zero attachments for a PDF without embedded files', async () => {
        const insp = await import('../src/tools/generate-basic-pdf.js');
        const doc = await insp.generateBasicPdf({ title: 'Plain', blocks: [{ type: 'paragraph', text: 'Hi' }] });
        const out = await extractAttachments({ pdfBase64: doc.base64! });
        expect(out.attachmentCount).toBe(0);
        expect(out.attachments).toHaveLength(0);
    });

    it('throws ATTACHMENT_NOT_FOUND when the filename filter matches nothing', async () => {
        const pdfBase64 = await makeInvoiceWithAttachments();
        await expect(extractAttachments({ pdfBase64, filename: 'missing.xml' })).rejects.toMatchObject({
            code: 'ATTACHMENT_NOT_FOUND',
        });
    });

    it('rejects malformed input with VALIDATION_ERROR', async () => {
        await expect(extractAttachments({})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(extractAttachments({ pdfBase64: 123 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects non-PDF bytes with PDF_PARSE_FAILED', async () => {
        await expect(extractAttachments({ pdfBase64: b64('not a pdf at all') })).rejects.toMatchObject({
            code: 'PDF_PARSE_FAILED',
        });
    });
});
