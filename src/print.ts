/**
 * Shared print-production schema (pdfnative ≥ 1.7): page boxes / bleed,
 * printer's marks, `/UserUnit`, a caller-supplied OutputIntent ICC profile and
 * the document-level `/Info` + XMP metadata (author / subject / keywords /
 * `/Trapped`).
 *
 * Every document-producing tool spreads {@link PRINT_INPUT_PROPERTIES} into its
 * JSON Schema and {@link PrintInputShape} into its Zod object, then forwards
 * {@link toPrintLayout} / {@link toDocumentMetadata} to pdfnative. All fields
 * are optional and absent by default, so default outputs stay byte-identical
 * (pdfnative itself is byte-identical when `print` / `outputIntent` /
 * `metadata` are unused).
 */
import type { CustomOutputIntent, DocumentMetadata, PageBox, PrintOptions, PrinterMarksOptions } from 'pdfnative';
import { z } from 'zod';

import { ToolError } from './errors.js';

const BOX_SCHEMA = {
    type: 'array',
    minItems: 4,
    maxItems: 4,
    items: { type: 'number' },
    description: 'Page box as [x0, y0, x1, y1] in PDF points (origin bottom-left); must lie within the MediaBox.',
} as const;

/** JSON Schema fragments — spread into a tool's `properties`. */
export const PRINT_INPUT_PROPERTIES = {
    print: {
        type: 'object',
        additionalProperties: false,
        description:
            "Print-production options (ISO 32000-1 §14.11): page boxes (TrimBox/BleedBox/ArtBox/CropBox), the `bleed` shorthand (TrimBox = MediaBox inset by N points, BleedBox = MediaBox), printer's crop + registration marks drawn outside the TrimBox, and /UserUnit for large formats (raises the header to PDF 1.7; not allowed under pdfa1b). Byte-identical output when omitted.",
        properties: {
            bleed: {
                type: 'number',
                exclusiveMinimum: 0,
                maximum: 200,
                description: 'Bleed in points (e.g. 8.5 = 3 mm). Mutually exclusive with trimBox. Derives TrimBox = MediaBox inset by this amount.',
            },
            trimBox: BOX_SCHEMA,
            bleedBox: BOX_SCHEMA,
            artBox: BOX_SCHEMA,
            cropBox: BOX_SCHEMA,
            marks: {
                description: "Printer's marks (requires a TrimBox via bleed or trimBox): `true` for the defaults, or an object to tune them.",
                oneOf: [
                    { type: 'boolean' },
                    {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            crop: { type: 'boolean', description: 'Corner crop (trim) marks. Default true.' },
                            registration: { type: 'boolean', description: 'Edge-midpoint registration targets. Default true.' },
                            length: { type: 'number', minimum: 1, maximum: 100, description: 'Mark length in points. Default 14.' },
                            offset: { type: 'number', minimum: 0, maximum: 100, description: 'Gap between TrimBox and marks in points. Default 5.' },
                            weight: { type: 'number', minimum: 0.05, maximum: 5, description: 'Stroke width in points. Default 0.25.' },
                        },
                    },
                ],
            },
            userUnit: {
                type: 'number',
                minimum: 1,
                maximum: 75000,
                description: 'Size of one user-space unit in multiples of 1/72 inch (/UserUnit, PDF 1.6+). Use for pages larger than 14400 points. Rejected under pdfa1b.',
            },
        },
    },
    outputIntent: {
        type: 'object',
        additionalProperties: false,
        required: ['iccProfileBase64', 'outputConditionIdentifier'],
        description:
            'Caller-supplied OutputIntent for PDF/A (tagged) output: an RGB ICC profile and its condition strings replace the built-in sRGB intent. Non-RGB (e.g. CMYK) profiles are rejected.',
        properties: {
            iccProfileBase64: { type: 'string', minLength: 1, maxLength: 11_000_000, description: 'Base64-encoded ICC profile bytes (RGB data colour space, ≤ 8 MiB).' },
            outputConditionIdentifier: { type: 'string', minLength: 1, maxLength: 200, description: 'e.g. "sRGB IEC61966-2.1".' },
            registryName: { type: 'string', maxLength: 200, description: 'Default "http://www.color.org".' },
            outputCondition: { type: 'string', maxLength: 200 },
            info: { type: 'string', maxLength: 500 },
        },
    },
    metadata: {
        type: 'object',
        additionalProperties: false,
        description: 'Document-level metadata written to /Info and (under PDF/A) the XMP packet: author, subject, keywords and the /Trapped print flag.',
        properties: {
            author: { type: 'string', maxLength: 500 },
            subject: { type: 'string', maxLength: 1000 },
            keywords: { type: 'string', maxLength: 1000 },
            trapped: {
                type: 'string',
                enum: ['True', 'False', 'Unknown'],
                description: 'Whether the document has been trapped for high-end colour printing (/Trapped + XMP pdf:Trapped).',
            },
        },
    },
} as const;

const BoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const PrintSchema = z
    .object({
        bleed: z.number().gt(0).max(200).optional(),
        trimBox: BoxSchema.optional(),
        bleedBox: BoxSchema.optional(),
        artBox: BoxSchema.optional(),
        cropBox: BoxSchema.optional(),
        marks: z
            .union([
                z.boolean(),
                z.object({
                    crop: z.boolean().optional(),
                    registration: z.boolean().optional(),
                    length: z.number().min(1).max(100).optional(),
                    offset: z.number().min(0).max(100).optional(),
                    weight: z.number().min(0.05).max(5).optional(),
                }),
            ])
            .optional(),
        userUnit: z.number().min(1).max(75000).optional(),
    })
    .refine((p) => !(p.bleed !== undefined && p.trimBox !== undefined), {
        message: 'print.bleed and print.trimBox are mutually exclusive (the bleed shorthand derives the TrimBox).',
    });

const OutputIntentSchema = z.object({
    iccProfileBase64: z.string().min(1).max(11_000_000),
    outputConditionIdentifier: z.string().min(1).max(200),
    registryName: z.string().max(200).optional(),
    outputCondition: z.string().max(200).optional(),
    info: z.string().max(500).optional(),
});

const MetadataSchema = z.object({
    author: z.string().max(500).optional(),
    subject: z.string().max(1000).optional(),
    keywords: z.string().max(1000).optional(),
    trapped: z.enum(['True', 'False', 'Unknown']).optional(),
});

/** Zod counterpart of {@link PRINT_INPUT_PROPERTIES} — spread into a tool's `z.object({...})`. */
export const PrintInputShape = {
    print: PrintSchema.optional(),
    outputIntent: OutputIntentSchema.optional(),
    metadata: MetadataSchema.optional(),
} as const;

export type PrintInput = z.infer<typeof PrintSchema>;
export type OutputIntentInput = z.infer<typeof OutputIntentSchema>;
export type MetadataInput = z.infer<typeof MetadataSchema>;

/** Layout fragment (`print` + `outputIntent`) to spread into the pdfnative layout options. */
export function toPrintLayout(input: { print?: PrintInput; outputIntent?: OutputIntentInput }): {
    print?: PrintOptions;
    outputIntent?: CustomOutputIntent;
} {
    const out: { print?: PrintOptions; outputIntent?: CustomOutputIntent } = {};
    if (input.print !== undefined) out.print = toPrintOptions(input.print);
    if (input.outputIntent !== undefined) out.outputIntent = toOutputIntent(input.outputIntent);
    return out;
}

export function toPrintOptions(p: PrintInput): PrintOptions {
    const box = (b: readonly [number, number, number, number] | undefined): PageBox | undefined => (b === undefined ? undefined : [b[0], b[1], b[2], b[3]]);
    let marks: boolean | PrinterMarksOptions | undefined;
    if (typeof p.marks === 'boolean') marks = p.marks;
    else if (p.marks !== undefined) {
        marks = {
            ...(p.marks.crop !== undefined ? { crop: p.marks.crop } : {}),
            ...(p.marks.registration !== undefined ? { registration: p.marks.registration } : {}),
            ...(p.marks.length !== undefined ? { length: p.marks.length } : {}),
            ...(p.marks.offset !== undefined ? { offset: p.marks.offset } : {}),
            ...(p.marks.weight !== undefined ? { weight: p.marks.weight } : {}),
        };
    }
    const trimBox = box(p.trimBox);
    const bleedBox = box(p.bleedBox);
    const artBox = box(p.artBox);
    const cropBox = box(p.cropBox);
    return {
        ...(p.bleed !== undefined ? { bleed: p.bleed } : {}),
        ...(trimBox !== undefined ? { trimBox } : {}),
        ...(bleedBox !== undefined ? { bleedBox } : {}),
        ...(artBox !== undefined ? { artBox } : {}),
        ...(cropBox !== undefined ? { cropBox } : {}),
        ...(marks !== undefined ? { marks } : {}),
        ...(p.userUnit !== undefined ? { userUnit: p.userUnit } : {}),
    };
}

export function toOutputIntent(o: OutputIntentInput): CustomOutputIntent {
    let icc: Buffer;
    try {
        icc = Buffer.from(o.iccProfileBase64, 'base64');
    } catch {
        throw new ToolError('VALIDATION_ERROR', 'outputIntent.iccProfileBase64 is not valid base64.');
    }
    if (icc.byteLength === 0 || icc.byteLength > 8 * 1024 * 1024) {
        throw new ToolError('VALIDATION_ERROR', 'outputIntent.iccProfileBase64 must decode to 1 byte .. 8 MiB.');
    }
    return {
        iccProfile: new Uint8Array(icc),
        outputConditionIdentifier: o.outputConditionIdentifier,
        ...(o.registryName !== undefined ? { registryName: o.registryName } : {}),
        ...(o.outputCondition !== undefined ? { outputCondition: o.outputCondition } : {}),
        ...(o.info !== undefined ? { info: o.info } : {}),
    };
}

/** `DocumentParams.metadata` / `PdfParams.metadata` fragment, or `undefined` when nothing was supplied. */
export function toDocumentMetadata(m: MetadataInput | undefined): DocumentMetadata | undefined {
    if (m === undefined) return undefined;
    const out: DocumentMetadata = {
        ...(m.author !== undefined ? { author: m.author } : {}),
        ...(m.subject !== undefined ? { subject: m.subject } : {}),
        ...(m.keywords !== undefined ? { keywords: m.keywords } : {}),
        ...(m.trapped !== undefined ? { trapped: m.trapped } : {}),
    };
    return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Pre-flight checks the engine would reject anyway, surfaced with the stable
 * `PDF_A_COMPLIANCE_VIOLATION` code before any work is done.
 */
export function assertPrintPdfACompatible(print: PrintInput | undefined, pdfA: string | undefined): void {
    if (print?.userUnit !== undefined && pdfA === 'pdfa1b') {
        throw new ToolError(
            'PDF_A_COMPLIANCE_VIOLATION',
            'print.userUnit requires PDF 1.6+ and is not allowed under PDF/A-1 (pdfa1b) — use pdfa2b or later.',
        );
    }
}
