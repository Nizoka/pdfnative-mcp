/**
 * Shared watermark schema (`src/watermark.ts`): text watermark stays
 * byte-identical, image watermark (JPEG / PNG) renders an image XObject,
 * `position` moves the watermark behind / above the page content, and every
 * boundary violation surfaces as a coded error.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { deflateSync } from 'node:zlib';

import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { addTable } from '../src/tools/add-table.js';
import { ensureCompressionReady } from '../src/server.js';
import {
    WATERMARK_INPUT_SCHEMA,
    WatermarkSchema,
    assertWatermarkPdfACompatible,
    decodeWatermarkImage,
    toWatermarkOptions,
} from '../src/watermark.js';
import { assertValidPdf } from './_pdf-assert.js';

// ── Fixtures ─────────────────────────────────────────────────────────

function crc32(buf: Uint8Array): number {
    let c = ~0;
    for (const b of buf) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = Buffer.from(type, 'latin1');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
    return Buffer.concat([len, typeBytes, data, crc]);
}

/** A 2×2 opaque RGB PNG built from scratch (no fixture files in the repo). */
function makePng(): Uint8Array {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(2, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    // 2 scanlines, each: filter byte + 2 px * 3 bytes
    const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(raw)),
        pngChunk('IEND', new Uint8Array(0)),
    ]);
}

/** Minimal baseline 2×2 JPEG (same bytes the engine's own watermark tests use). */
function makeJpeg(): Uint8Array {
    return new Uint8Array([
        0xff, 0xd8,
        0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xff, 0xdb, 0x00, 0x43, 0x00,
        0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14,
        0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a,
        0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c,
        0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32,
        0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x02, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
        0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
        0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0x00, 0x00, 0x00, 0x00,
        0xff, 0xd9,
    ]);
}

const PNG_B64 = Buffer.from(makePng()).toString('base64');
const JPEG_B64 = Buffer.from(makeJpeg()).toString('base64');
const BLOCKS = [{ type: 'paragraph', text: 'Watermarked body text.' }];

function latin1(base64: string): string {
    return Buffer.from(base64, 'base64').toString('latin1');
}

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

// ── Schema / mapper ──────────────────────────────────────────────────

describe('watermark schema + mapper', () => {
    it('JSON Schema and Zod agree on the property set', () => {
        const jsonKeys = Object.keys(WATERMARK_INPUT_SCHEMA.properties).sort();
        const zodKeys = Object.keys(WatermarkSchema.shape).sort();
        expect(zodKeys).toEqual(jsonKeys);
        expect(Object.keys(WATERMARK_INPUT_SCHEMA.properties.image.properties).sort()).toEqual(
            ['height', 'imageBase64', 'mimeType', 'opacity', 'width'],
        );
        // `text` is no longer required at the JSON level: image-only watermarks are valid.
        expect('required' in WATERMARK_INPUT_SCHEMA).toBe(false);
    });

    it('maps a text-only watermark exactly as before (no image / position keys)', () => {
        expect(toWatermarkOptions({ text: 'DRAFT' })).toEqual({ text: { text: 'DRAFT' } });
        expect(toWatermarkOptions({ text: 'DRAFT', opacity: 0.3, angle: 0, fontSize: 40, color: [1, 0, 0] })).toEqual({
            text: { text: 'DRAFT', fontSize: 40, opacity: 0.3, angle: 0, color: [1, 0, 0] },
        });
    });

    it('maps image + position and decodes the bytes', () => {
        const opts = toWatermarkOptions({
            image: { imageBase64: PNG_B64, mimeType: 'image/png', opacity: 0.5, width: 100, height: 50 },
            position: 'foreground',
        });
        expect(opts.text).toBeUndefined();
        expect(opts.position).toBe('foreground');
        expect(opts.image?.opacity).toBe(0.5);
        expect(opts.image?.width).toBe(100);
        expect(opts.image?.height).toBe(50);
        expect(Buffer.from(opts.image!.data).equals(makePng())).toBe(true);
    });

    it('requires at least one of text / image', () => {
        expect(WatermarkSchema.safeParse({ position: 'foreground' }).success).toBe(false);
        expect(WatermarkSchema.safeParse({ opacity: 0.5 }).success).toBe(false);
        expect(WatermarkSchema.safeParse({ text: 'x' }).success).toBe(true);
        expect(WatermarkSchema.safeParse({ image: { imageBase64: PNG_B64, mimeType: 'image/png' } }).success).toBe(true);
        expect(WatermarkSchema.safeParse({ image: { imageBase64: PNG_B64 } }).success).toBe(false);
        expect(WatermarkSchema.safeParse({ image: { imageBase64: PNG_B64, mimeType: 'image/gif' } }).success).toBe(false);
        expect(WatermarkSchema.safeParse({ image: { imageBase64: PNG_B64, mimeType: 'image/png', extra: 1 } }).success).toBe(false);
    });

    it('rejects bytes that are not JPEG / PNG, or disagree with mimeType', () => {
        const text = Buffer.from('not an image at all').toString('base64');
        expect(() => decodeWatermarkImage({ imageBase64: text, mimeType: 'image/png' })).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
        expect(() => decodeWatermarkImage({ imageBase64: PNG_B64, mimeType: 'image/jpeg' })).toThrow(/does not match mimeType 'image\/jpeg'/);
        expect(() => decodeWatermarkImage({ imageBase64: JPEG_B64, mimeType: 'image/png' })).toThrow(/does not match mimeType 'image\/png'/);
        expect(() => decodeWatermarkImage({ imageBase64: 'data:image/png;base64,@@@@', mimeType: 'image/png' })).toThrow(/not valid base64/);
    });

    it('rejects an oversized image', () => {
        const big = Buffer.alloc(8 * 1024 * 1024 + 1, 0);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(big);
        expect(() => decodeWatermarkImage({ imageBase64: big.toString('base64'), mimeType: 'image/png' })).toThrow(/limit is/);
    });

    it('pdfa1b guard covers text and image opacity (defaults included)', () => {
        const img = { imageBase64: PNG_B64, mimeType: 'image/png' as const };
        expect(() => assertWatermarkPdfACompatible({ image: img }, 'pdfa1b')).toThrow(expect.objectContaining({ code: 'PDF_A_COMPLIANCE_VIOLATION' }));
        expect(() => assertWatermarkPdfACompatible({ text: 'x', opacity: 1, image: { ...img, opacity: 0.9 } }, 'pdfa1b')).toThrow(/pdfa1b/);
        expect(() => assertWatermarkPdfACompatible({ text: 'x', opacity: 1, image: { ...img, opacity: 1 } }, 'pdfa1b')).not.toThrow();
        expect(() => assertWatermarkPdfACompatible({ image: img }, 'pdfa2b')).not.toThrow();
        expect(() => assertWatermarkPdfACompatible(undefined, 'pdfa1b')).not.toThrow();
    });
});

// ── Rendering through the document tools ────────────────────────────

describe('watermark rendering', () => {
    it('text-only watermark output is byte-identical with and without the new schema fields touched', async () => {
        const a = await generateBasicPdf({ title: 'T', blocks: BLOCKS, watermark: { text: 'DRAFT' }, creationDate: '2026-01-01T00:00:00Z' });
        const b = await generateBasicPdf({ title: 'T', blocks: BLOCKS, watermark: { text: 'DRAFT' }, creationDate: '2026-01-01T00:00:00Z' });
        expect(a.base64).toBe(b.base64);
        expect(latin1(a.base64!)).not.toContain('/Subtype /Image');
    });

    it('PNG image watermark renders an image XObject on the page (generate_basic_pdf)', async () => {
        const r = await generateBasicPdf({
            title: 'Img',
            blocks: BLOCKS,
            watermark: { image: { imageBase64: PNG_B64, mimeType: 'image/png', width: 200, height: 200 } },
        });
        assertValidPdf(r.base64!, 1);
        const body = latin1(r.base64!);
        expect(body).toContain('/XObject');
        expect(body).toContain('/Subtype /Image');
    });

    it('JPEG image watermark renders (add_table) and combines with text', async () => {
        const r = await addTable({
            title: 'Tbl',
            headers: ['a', 'b'],
            rows: [['1', '2']],
            watermark: { text: 'SAMPLE', image: { imageBase64: JPEG_B64, mimeType: 'image/jpeg', opacity: 0.2 } },
        });
        assertValidPdf(r.base64!, 1);
        const body = latin1(r.base64!);
        expect(body).toContain('/Subtype /Image');
        expect(body).toContain('/DCTDecode');
    });

    it('position foreground vs background produce different documents', async () => {
        const wm = { image: { imageBase64: PNG_B64, mimeType: 'image/png' as const } };
        const bg = await generateBasicPdf({ title: 'P', blocks: BLOCKS, watermark: { ...wm, position: 'background' }, creationDate: '2026-01-01T00:00:00Z' });
        const fg = await generateBasicPdf({ title: 'P', blocks: BLOCKS, watermark: { ...wm, position: 'foreground' }, creationDate: '2026-01-01T00:00:00Z' });
        const dflt = await generateBasicPdf({ title: 'P', blocks: BLOCKS, watermark: wm, creationDate: '2026-01-01T00:00:00Z' });
        expect(bg.base64).not.toBe(fg.base64);
        expect(bg.base64).toBe(dflt.base64); // background is the engine default
        assertValidPdf(fg.base64!, 1);
    });

    it('surfaces image validation failures as VALIDATION_ERROR from the tool', async () => {
        await expect(
            generateBasicPdf({ title: 'X', blocks: BLOCKS, watermark: { image: { imageBase64: PNG_B64, mimeType: 'image/jpeg' } } }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(
            generateBasicPdf({ title: 'X', blocks: BLOCKS, watermark: { position: 'foreground' } }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('image watermark with default opacity is rejected under pdfa1b', async () => {
        await expect(
            generateBasicPdf({ title: 'X', blocks: BLOCKS, pdfA: 'pdfa1b', watermark: { image: { imageBase64: PNG_B64, mimeType: 'image/png' } } }),
        ).rejects.toMatchObject({ code: 'PDF_A_COMPLIANCE_VIOLATION' });
    });
});
