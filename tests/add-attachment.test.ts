/**
 * Tests for `add_attachment` (PDF/A-3 generation with embedded files).
 */
import { describe, expect, it } from 'vitest';

import { addAttachment } from '../src/tools/add-attachment.js';
import { inspectPdf } from '../src/tools/inspect-pdf.js';

function b64(s: string): string {
    return Buffer.from(s, 'utf8').toString('base64');
}

describe('add_attachment', () => {
    it('produces a PDF/A-3 with the supplied attachment', async () => {
        const r = await addAttachment({
            title: 'Factur-X test',
            attachments: [
                { filename: 'invoice.xml', mimeType: 'application/xml', dataBase64: b64('<?xml version="1.0"?><Invoice/>'), relationship: 'Source', description: 'Factur-X XML' },
            ],
        });
        expect(r.mode).toBe('base64');
        expect(r.sizeBytes).toBeGreaterThan(0);
        const insp = await inspectPdf({ pdfBase64: r.base64! });
        expect(insp.pdfA).toBe('3B');
    });

    it('rejects empty attachment payload with VALIDATION_ERROR', async () => {
        await expect(
            addAttachment({
                title: 'X',
                attachments: [{ filename: 'empty.bin', mimeType: 'application/octet-stream', dataBase64: '' }],
            }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects oversized attachments with ATTACHMENT_TOO_LARGE', async () => {
        // 9 MiB of zeros
        const huge = Buffer.alloc(9 * 1024 * 1024).toString('base64');
        await expect(
            addAttachment({
                title: 'X',
                attachments: [{ filename: 'big.bin', mimeType: 'application/octet-stream', dataBase64: huge }],
            }),
        ).rejects.toMatchObject({ code: 'ATTACHMENT_TOO_LARGE' });
    });

    it('rejects malformed input with VALIDATION_ERROR', async () => {
        await expect(addAttachment({})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(addAttachment({ title: 'x', attachments: [] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('accepts custom body blocks', async () => {
        const r = await addAttachment({
            title: 'Custom body',
            blocks: [
                { type: 'heading', text: 'Cover', level: 1 },
                { type: 'paragraph', text: 'See attached.' },
            ],
            attachments: [{ filename: 'data.csv', mimeType: 'text/csv', dataBase64: b64('a,b\n1,2\n') }],
        });
        expect(r.sizeBytes).toBeGreaterThan(0);
    });
});
