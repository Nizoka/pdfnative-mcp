/**
 * `PDFNATIVE_MCP_MAX_INFLATE_BYTES` — operator override of the engine's
 * zip-bomb decompression cap (`src/inflate-cap.ts`, applied once in `src/cli.ts`).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { deflateSync } from 'node:zlib';
import { DEFAULT_MAX_INFLATE_OUTPUT, getMaxInflateOutputSize, setMaxInflateOutputSize } from 'pdfnative';

import {
    applyInflateCap,
    isInflateCapError,
    MAX_INFLATE_ENV,
    MAX_INFLATE_MIN_BYTES,
    readInflateCap,
    throwIfInflateCapError,
} from '../src/inflate-cap.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { extractText } from '../src/tools/extract-text.js';
import { extractAttachments } from '../src/tools/extract-attachments.js';
import { inspectPdf } from '../src/tools/inspect-pdf.js';
import { ensureCompressionReady } from '../src/server.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

afterEach(() => {
    setMaxInflateOutputSize(DEFAULT_MAX_INFLATE_OUTPUT);
});

describe('readInflateCap / applyInflateCap', () => {
    it('returns null (engine default untouched) when unset or empty', () => {
        expect(readInflateCap({})).toBeNull();
        expect(readInflateCap({ [MAX_INFLATE_ENV]: '' })).toBeNull();
        expect(applyInflateCap({})).toBe(DEFAULT_MAX_INFLATE_OUTPUT);
        expect(getMaxInflateOutputSize()).toBe(DEFAULT_MAX_INFLATE_OUTPUT);
    });

    it('parses a positive integer byte count and applies it to the engine', () => {
        expect(readInflateCap({ [MAX_INFLATE_ENV]: '268435456' })).toBe(268435456);
        expect(readInflateCap({ [MAX_INFLATE_ENV]: ' 4096 ' })).toBe(4096);
        expect(applyInflateCap({ [MAX_INFLATE_ENV]: '2048' })).toBe(2048);
        expect(getMaxInflateOutputSize()).toBe(2048);
    });

    it('refuses to start on an invalid value (mirrors PDFNATIVE_MCP_HTTP_TOKEN)', () => {
        for (const bad of ['abc', '-1', '0', '1.5', '1e6', '100MB', String(MAX_INFLATE_MIN_BYTES - 1), '9'.repeat(16)]) {
            expect(() => readInflateCap({ [MAX_INFLATE_ENV]: bad }), bad).toThrow(new RegExp(MAX_INFLATE_ENV));
        }
        expect(() => applyInflateCap({ [MAX_INFLATE_ENV]: 'abc' })).toThrow(/positive integer/);
        expect(getMaxInflateOutputSize()).toBe(DEFAULT_MAX_INFLATE_OUTPUT);
    });

    it('recognises both engine (pure-JS) and Node zlib cap failures', () => {
        expect(isInflateCapError(new Error('inflate: decompressed output exceeds maximum of 1024 bytes (potential zip bomb)'))).toBe(true);
        const nodeErr = Object.assign(new RangeError('Cannot create a Buffer larger than 1024 bytes'), { code: 'ERR_BUFFER_TOO_LARGE' });
        expect(isInflateCapError(nodeErr)).toBe(true);
        expect(isInflateCapError(new Error('Invalid PDF: missing xref'))).toBe(false);
        expect(isInflateCapError('plain string')).toBe(false);
        expect(() => throwIfInflateCapError(new Error('unrelated'))).not.toThrow();
        expect(() => throwIfInflateCapError(nodeErr)).toThrow(expect.objectContaining({ code: 'PDF_PARSE_FAILED', message: expect.stringContaining(MAX_INFLATE_ENV) }));
    });
});

describe('a stream exceeding the cap fails the read tools with a coded error', () => {
    /**
     * Minimal single-page PDF whose content stream is FlateDecode-compressed and
     * expands to ~60 KB (the document tools emit uncompressed content, so a
     * hand-built fixture is the only way to exercise the inflate path).
     */
    function flatePdfBase64(): string {
        const line = '(Lorem ipsum dolor sit amet) Tj T* ';
        const content = `BT /F1 12 Tf 72 720 Td 14 TL ${line.repeat(1600)}ET`;
        const compressed = deflateSync(Buffer.from(content, 'latin1'));
        const attachment = deflateSync(Buffer.alloc(64 * 1024, 0x41));
        const objects: Array<string | Buffer> = [
            '<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(big.txt) 6 0 R] >> >> >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
            compressed,
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            '<< /Type /Filespec /F (big.txt) /UF (big.txt) /EF << /F 7 0 R >> >>',
            attachment,
        ];
        const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
        const offsets: number[] = [];
        let pos = parts[0]!.length;
        objects.forEach((body, i) => {
            offsets.push(pos);
            const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
            const payload = Buffer.isBuffer(body)
                ? Buffer.concat([Buffer.from(`<< /Length ${body.length} /Filter /FlateDecode${i === 6 ? ' /Type /EmbeddedFile' : ''} >>\nstream\n`, 'latin1'), body, Buffer.from('\nendstream', 'latin1')])
                : Buffer.from(body, 'latin1');
            const tail = Buffer.from('\nendobj\n', 'latin1');
            parts.push(head, payload, tail);
            pos += head.length + payload.length + tail.length;
        });
        const xrefPos = pos;
        const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
        parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`, 'latin1'));
        return Buffer.concat(parts).toString('base64');
    }

    it('extract_attachments includeData surfaces PDF_PARSE_FAILED naming the env var once the cap is below the stream size', async () => {
        const pdfBase64 = flatePdfBase64();
        // Sanity: decodes fine under the default cap.
        const ok = await extractAttachments({ pdfBase64, includeData: true });
        expect(ok.attachments[0]?.name).toBe('big.txt');

        applyInflateCap({ [MAX_INFLATE_ENV]: String(MAX_INFLATE_MIN_BYTES) });
        await expect(extractAttachments({ pdfBase64, includeData: true })).rejects.toMatchObject({
            code: 'PDF_PARSE_FAILED',
            message: expect.stringMatching(/exceeds maximum of 1024 bytes[\s\S]*PDFNATIVE_MCP_MAX_INFLATE_BYTES/),
        });
        // Metadata-only listing never inflates the payload, so it keeps working.
        const meta = await extractAttachments({ pdfBase64, includeData: false });
        expect(meta.attachments[0]?.name).toBe('big.txt');
    });

    it('extract_text degrades to empty text for a capped content stream (engine swallows per-page decode failures)', async () => {
        const pdfBase64 = flatePdfBase64();
        const ok = await extractText({ pdfBase64 });
        expect(ok.pages[0]?.text).toContain('Lorem ipsum');

        applyInflateCap({ [MAX_INFLATE_ENV]: String(MAX_INFLATE_MIN_BYTES) });
        const capped = await extractText({ pdfBase64 });
        expect(capped.pages[0]?.text).toBe('');
    });

    it('inspect_pdf still answers structurally (page content is never inflated for metadata)', async () => {
        const pdfBase64 = flatePdfBase64();
        applyInflateCap({ [MAX_INFLATE_ENV]: String(MAX_INFLATE_MIN_BYTES) });
        const out = await inspectPdf({ pdfBase64, pages: true, annotations: true });
        expect(out.pageCount).toBe(1);
        expect(out.perPage![0]!.width).toBe(612);
        expect(out.annotations).toEqual([]);
    });

    it('the document tools still build under a tight cap (they emit uncompressed content)', async () => {
        applyInflateCap({ [MAX_INFLATE_ENV]: String(MAX_INFLATE_MIN_BYTES) });
        const r = await generateBasicPdf({ title: 'Cap', blocks: [{ type: 'paragraph', text: 'still fine' }] });
        expect(r.base64).toBeDefined();
    });
});
