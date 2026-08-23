/**
 * Shared barcode fragment used by `add_barcode` and by the `barcode` block of
 * `generate_basic_pdf`. JSON Schema and Zod are kept in lock-step.
 */
import type { BarcodeBlock } from 'pdfnative';
import { z } from 'zod';

import { ToolError } from './errors.js';

export const BARCODE_FORMAT_ENUM = ['qr', 'code128', 'ean13', 'datamatrix', 'pdf417'] as const;
export const QR_EC_LEVEL_ENUM = ['L', 'M', 'Q', 'H'] as const;
export const BLOCK_ALIGN_ENUM = ['left', 'center', 'right'] as const;

/** JSON Schema properties of a barcode body (spread into a tool or block schema). */
export const BARCODE_BODY_PROPERTIES = {
    format: {
        type: 'string',
        enum: [...BARCODE_FORMAT_ENUM],
        description: 'Barcode symbology to render.',
    },
    data: {
        type: 'string',
        minLength: 1,
        maxLength: 4296,
        description: 'Raw payload to encode — do NOT URL-encode. For QR/URL pass e.g. "https://example.com" verbatim. EAN-13 must be 12 or 13 digits (13th is auto-computed). Code 128 accepts ASCII alphanumerics.',
    },
    width: {
        type: 'number',
        minimum: 30,
        maximum: 500,
        default: 200,
        description: 'Barcode width in PDF points.',
    },
    height: {
        type: 'number',
        minimum: 30,
        maximum: 500,
        default: 200,
        description: 'Barcode height in PDF points (ignored for square symbologies like QR/Data Matrix).',
    },
    ecLevel: {
        type: 'string',
        enum: [...QR_EC_LEVEL_ENUM],
        default: 'M',
        description: 'QR ONLY. Error correction level (L=7%, M=15%, Q=25%, H=30%). Ignored for code128/ean13/datamatrix/pdf417. Use H for printed media that may get smudged or partially covered (e.g. logo overlay).',
    },
} as const;

/** Zod counterpart of {@link BARCODE_BODY_PROPERTIES}. */
export const BarcodeBodyShape = {
    format: z.enum(BARCODE_FORMAT_ENUM),
    data: z.string().min(1).max(4296),
    width: z.number().min(30).max(500).default(200),
    height: z.number().min(30).max(500).default(200),
    ecLevel: z.enum(QR_EC_LEVEL_ENUM).default('M'),
} as const;

export const BarcodeBodySchema = z.strictObject(BarcodeBodyShape);
export type BarcodeBodyInput = z.infer<typeof BarcodeBodySchema>;

/** Format-specific payload rules the engine would otherwise reject with an opaque error. */
export function assertBarcodePayload(b: Pick<BarcodeBodyInput, 'format' | 'data'>, where = ''): void {
    if (b.format === 'ean13' && !/^\d{12,13}$/.test(b.data)) {
        throw new ToolError('VALIDATION_ERROR', `${where}EAN-13 data must be 12 or 13 digits.`);
    }
}

export function toBarcodeBlock(b: BarcodeBodyInput, align: (typeof BLOCK_ALIGN_ENUM)[number]): BarcodeBlock {
    return {
        type: 'barcode',
        format: b.format,
        data: b.data,
        width: b.width,
        height: b.height,
        align,
        ...(b.format === 'qr' ? { ecLevel: b.ecLevel } : {}),
    };
}
