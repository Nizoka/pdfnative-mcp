/**
 * Tool: generate_basic_pdf
 *
 * Generates a multi-page PDF document with structured blocks (headings, paragraphs,
 * lists) using pdfnative's document builder. The most general-purpose tool — use it
 * whenever you need a "regular" PDF (reports, letters, articles, invoices, manuals).
 */
import { buildDocumentPDFBytes, type DocumentBlock } from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { PDF_A_ENUM, PDF_A_FIELD_DESCRIPTION, PdfASchema } from '../pdfa.js';

export const GENERATE_BASIC_PDF_NAME = 'generate_basic_pdf';

export const GENERATE_BASIC_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: {
            type: 'string',
            description: 'Document title (rendered at top of page 1 and used as PDF metadata title).',
            minLength: 1,
            maxLength: 200,
        },
        blocks: {
            type: 'array',
            description: 'Ordered list of content blocks composing the document body.',
            minItems: 1,
            maxItems: 5000,
            items: {
                oneOf: [
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'text', 'level'],
                        properties: {
                            type: { const: 'heading' },
                            text: { type: 'string', minLength: 1, maxLength: 500 },
                            level: { type: 'integer', enum: [1, 2, 3] },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'text'],
                        properties: {
                            type: { const: 'paragraph' },
                            text: { type: 'string', minLength: 1, maxLength: 50000 },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'items'],
                        properties: {
                            type: { const: 'list' },
                            style: { type: 'string', enum: ['bullet', 'numbered'], default: 'bullet' },
                            items: {
                                type: 'array',
                                minItems: 1,
                                maxItems: 1000,
                                items: { type: 'string', minLength: 1, maxLength: 1000 },
                            },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type'],
                        properties: {
                            type: { const: 'pageBreak' },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'height'],
                        properties: {
                            type: { const: 'spacer' },
                            height: { type: 'number', minimum: 1, maximum: 500 },
                        },
                    },
                ],
            },
        },
        footerText: {
            type: 'string',
            maxLength: 200,
            description: 'Optional footer text rendered at the bottom of every page.',
        },
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: PDF_A_FIELD_DESCRIPTION,
        },
        outputMode: {
            type: 'string',
            enum: ['base64', 'file'],
            default: 'base64',
            description: "Either 'base64' (returns the PDF inline as a base64 string) or 'file' (writes to a path inside the configured PDFNATIVE_MCP_OUTPUT_DIR sandbox).",
        },
        outputPath: {
            type: 'string',
            description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf.",
        },
    },
    required: ['title', 'blocks'],
} as const;

const InputSchema = z.object({
    title: z.string().min(1).max(200),
    blocks: z
        .array(
            z.discriminatedUnion('type', [
                z.object({
                    type: z.literal('heading'),
                    text: z.string().min(1).max(500),
                    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
                }),
                z.object({
                    type: z.literal('paragraph'),
                    text: z.string().min(1).max(50000),
                }),
                z.object({
                    type: z.literal('list'),
                    style: z.enum(['bullet', 'numbered']).default('bullet'),
                    items: z.array(z.string().min(1).max(1000)).min(1).max(1000),
                }),
                z.object({ type: z.literal('pageBreak') }),
                z.object({
                    type: z.literal('spacer'),
                    height: z.number().min(1).max(500),
                }),
            ]),
        )
        .min(1)
        .max(5000),
    footerText: z.string().max(200).optional(),
    pdfA: PdfASchema.optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function generateBasicPdf(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, blocks, footerText, pdfA, outputMode, outputPath } = parsed.data;

    const docBlocks: DocumentBlock[] = blocks.map((block): DocumentBlock => {
        switch (block.type) {
            case 'heading':
                return { type: 'heading', text: block.text, level: block.level };
            case 'paragraph':
                return { type: 'paragraph', text: block.text };
            case 'list':
                return { type: 'list', items: block.items, style: block.style };
            case 'pageBreak':
                return { type: 'pageBreak' };
            case 'spacer':
                return { type: 'spacer', height: block.height };
        }
    });

    const bytes = buildDocumentPDFBytes(
        {
            title,
            blocks: docBlocks,
            ...(footerText !== undefined ? { footerText } : {}),
        },
        pdfA !== undefined ? { tagged: pdfA } : {},
    );

    return emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) });
}
