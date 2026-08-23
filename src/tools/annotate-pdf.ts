/**
 * Tool: annotate_pdf
 *
 * Adds markup / drawing annotations (ISO 32000-1 §12.5) to an existing PDF using
 * pdfnative v1.5.0's annotation-writer API (`buildAnnotationBody` +
 * `PdfModifier.addAnnotation`). Writes are non-destructive incremental updates:
 * the original content is preserved byte-for-byte and each annotation is
 * appended to the target page's `/Annots` array.
 *
 * Supported types (discriminated by `type`):
 *   - text                                   — sticky-note (`/Text`)
 *   - highlight | underline | strikeout | squiggly — text-markup (`/Highlight` …)
 *   - square | circle                        — shapes
 *   - line                                   — straight line
 *   - freetext                               — free-standing text (`/FreeText`)
 *
 * Faithful-wrapper notes:
 *   - Encrypted sources are rejected (`ENCRYPTED_SOURCE`) — decrypt first; the
 *     incremental writer cannot patch an encrypted object stream safely.
 *   - `/Contents` and `/T` are safely encoded by pdfnative.
 */
import {
    buildAnnotationBody,
    createModifier,
    openPdf,
    type MarkupAnnotation,
    type PdfColor,
    type PdfReader,
} from 'pdfnative';
import { z } from 'zod';

import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { decodePdfBase64 } from '../base64.js';

export const ANNOTATE_PDF_NAME = 'annotate_pdf';

const ANNOTATION_TYPES = [
    'text',
    'highlight',
    'underline',
    'strikeout',
    'squiggly',
    'square',
    'circle',
    'line',
    'freetext',
] as const;

const RECT_SCHEMA = {
    type: 'array',
    minItems: 4,
    maxItems: 4,
    items: { type: 'number' },
    description: 'Annotation rectangle [x1, y1, x2, y2] in PDF user-space points.',
} as const;

const COLOR_SCHEMA = {
    oneOf: [
        { type: 'string', description: 'Hex (e.g. "#ffcc00") or PDF operator string ("R G B").' },
        { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' }, description: 'RGB tuple, 0.0–1.0.' },
    ],
} as const;

export const ANNOTATE_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64', 'annotations'],
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded source PDF to annotate.',
        },
        annotations: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            description: 'Markup / drawing annotations to add. Each is attached to a 0-based page index.',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['page', 'type', 'rect'],
                properties: {
                    page: { type: 'integer', minimum: 0, description: '0-based page index to attach the annotation to.' },
                    type: { type: 'string', enum: [...ANNOTATION_TYPES] },
                    rect: RECT_SCHEMA,
                    contents: { type: 'string', description: 'Text content / note body (/Contents).' },
                    color: { ...COLOR_SCHEMA, description: 'Border / line / icon colour (/C).' },
                    opacity: { type: 'number', minimum: 0, maximum: 1, description: 'Constant opacity /CA in [0,1].' },
                    title: { type: 'string', description: 'Author / title (/T).' },
                    // text
                    open: { type: 'boolean', description: "type='text': whether the note pop-up starts open." },
                    icon: { type: 'string', description: "type='text': icon name (Note, Comment, Key, Help, Insert…)." },
                    // text-markup
                    quadPoints: {
                        type: 'array',
                        items: { type: 'number' },
                        description: "type=highlight|underline|strikeout|squiggly: 8 numbers per marked region.",
                    },
                    // shapes
                    interiorColor: { ...COLOR_SCHEMA, description: "type=square|circle: interior fill colour (/IC)." },
                    borderWidth: { type: 'number', minimum: 0, description: "type=square|circle|line: border width in points." },
                    // line
                    start: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' }, description: "type='line': start point [x, y]." },
                    end: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' }, description: "type='line': end point [x, y]." },
                    // freetext
                    fontSize: { type: 'number', minimum: 1, description: "type='freetext': default-appearance font size." },
                },
            },
        },
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64' },
        outputPath: { type: 'string' },
    },
} as const;

const rectSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const pointSchema = z.tuple([z.number(), z.number()]);
const colorSchema = z.union([z.string(), z.tuple([z.number(), z.number(), z.number()])]);

const AnnotationSchema = z
    .strictObject({
        page: z.number().int().min(0),
        type: z.enum(ANNOTATION_TYPES),
        rect: rectSchema,
        contents: z.string().optional(),
        color: colorSchema.optional(),
        opacity: z.number().min(0).max(1).optional(),
        title: z.string().optional(),
        open: z.boolean().optional(),
        icon: z.string().optional(),
        quadPoints: z.array(z.number()).optional(),
        interiorColor: colorSchema.optional(),
        borderWidth: z.number().min(0).optional(),
        start: pointSchema.optional(),
        end: pointSchema.optional(),
        fontSize: z.number().min(1).optional(),
    })
    .superRefine((a, ctx) => {
        if (a.type === 'line' && (a.start === undefined || a.end === undefined)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "type='line' requires both 'start' and 'end'." });
        }
    });

const InputSchema = z.strictObject({
    pdfBase64: z.string().min(4),
    annotations: z.array(AnnotationSchema).min(1).max(200),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

type AnnotationInput = z.infer<typeof AnnotationSchema>;

function decodeBase64(value: string): Uint8Array {
    return decodePdfBase64(value, 'pdfBase64');
}

/** Fields shared by every annotation variant. */
function baseFields(a: AnnotationInput): {
    rect: readonly [number, number, number, number];
    contents?: string;
    color?: PdfColor;
    opacity?: number;
    title?: string;
} {
    return {
        rect: a.rect,
        ...(a.contents !== undefined ? { contents: a.contents } : {}),
        ...(a.color !== undefined ? { color: a.color as PdfColor } : {}),
        ...(a.opacity !== undefined ? { opacity: a.opacity } : {}),
        ...(a.title !== undefined ? { title: a.title } : {}),
    };
}

/** Map a validated input annotation to a typed pdfnative {@link MarkupAnnotation}. */
function toMarkupAnnotation(a: AnnotationInput): MarkupAnnotation {
    const base = baseFields(a);
    switch (a.type) {
        case 'text':
            return {
                type: 'text',
                ...base,
                ...(a.open !== undefined ? { open: a.open } : {}),
                ...(a.icon !== undefined ? { icon: a.icon } : {}),
            };
        case 'highlight':
        case 'underline':
        case 'strikeout':
        case 'squiggly':
            return {
                type: a.type,
                ...base,
                ...(a.quadPoints !== undefined ? { quadPoints: a.quadPoints } : {}),
            };
        case 'square':
        case 'circle':
            return {
                type: a.type,
                ...base,
                ...(a.interiorColor !== undefined ? { interiorColor: a.interiorColor as PdfColor } : {}),
                ...(a.borderWidth !== undefined ? { borderWidth: a.borderWidth } : {}),
            };
        case 'line':
            return {
                type: 'line',
                ...base,
                // Presence guaranteed by the superRefine above.
                start: a.start as readonly [number, number],
                end: a.end as readonly [number, number],
                ...(a.borderWidth !== undefined ? { borderWidth: a.borderWidth } : {}),
            };
        case 'freetext':
            return {
                type: 'freetext',
                ...base,
                ...(a.fontSize !== undefined ? { fontSize: a.fontSize } : {}),
            };
    }
}

function isEncrypted(reader: PdfReader): boolean {
    return reader.trailer.get('Encrypt') !== undefined;
}

export async function annotatePdf(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const input = parsed.data;

    const bytes = decodeBase64(input.pdfBase64);
    let reader: PdfReader;
    try {
        reader = openPdf(bytes);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('PDF_PARSE_FAILED', `Failed to parse PDF: ${message}`);
    }

    if (isEncrypted(reader)) {
        throw new ToolError(
            'ENCRYPTED_SOURCE',
            'annotate_pdf does not support encrypted PDFs. Run decrypt_pdf first (this drops signatures and AcroForm), annotate, then encrypt_pdf again.',
        );
    }

    const pageCount = reader.pageCount;
    for (const a of input.annotations) {
        if (a.page >= pageCount) {
            throw new ToolError(
                'VALIDATION_ERROR',
                `annotation page ${a.page} is out of range (document has ${pageCount} page(s), 0-based).`,
            );
        }
    }

    const modifier = createModifier(reader);
    try {
        for (const a of input.annotations) {
            modifier.addAnnotation(a.page, buildAnnotationBody(toMarkupAnnotation(a)));
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('PDF_PARSE_FAILED', `Failed to add annotation: ${message}`);
    }

    const out = modifier.save();

    return emitPdf(out, {
        mode: input.outputMode,
        ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
    });
}
