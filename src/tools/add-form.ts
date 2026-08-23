/**
 * Tool: add_form
 *
 * Generates a PDF containing an interactive form with text fields, text areas,
 * checkboxes, radio buttons, and dropdowns using pdfnative's document builder.
 * Suitable for data-capture forms, surveys, and fillable templates.
 */
import { buildDocumentPDFBytes, type DocumentBlock } from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { PDF_A_ENUM, PDF_A_FIELD_DESCRIPTION, PdfASchema } from '../pdfa.js';
import { PRINT_INPUT_PROPERTIES, PrintInputShape, assertPrintPdfACompatible, toDocumentMetadata, toPrintLayout } from '../print.js';
import { LAYOUT_INPUT_PROPERTIES, LayoutInputShape, assertLayoutPdfACompatible, toLayoutOptions } from '../layout.js';
import { FORM_FIELD_PROPERTIES, FormFieldSchema, assertFormFieldOptions, toFormFieldBlock } from '../form.js';
import { DIAGNOSTIC_INPUT_PROPERTIES, DiagnosticInputShape, collectDiagnostics, latinFontEntries, mapBuildError, withDiagnostics } from '../diagnostics.js';

export const ADD_FORM_NAME = 'add_form';

const FORM_FIELD_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['fieldType', 'name'],
    properties: FORM_FIELD_PROPERTIES,
} as const;

export const ADD_FORM_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: {
            type: 'string',
            description: 'Form title rendered at the top of the document.',
            minLength: 1,
            maxLength: 200,
        },
        fields: {
            type: 'array',
            description: 'Ordered list of form field definitions.',
            minItems: 1,
            maxItems: 200,
            items: FORM_FIELD_SCHEMA,
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
        ...PRINT_INPUT_PROPERTIES,
        ...LAYOUT_INPUT_PROPERTIES,
        ...DIAGNOSTIC_INPUT_PROPERTIES,
        outputMode: {
            type: 'string',
            enum: ['base64', 'file'],
            default: 'base64',
            description:
                "Either 'base64' (returns the PDF inline) or 'file' (writes to a sandboxed path inside PDFNATIVE_MCP_OUTPUT_DIR).",
        },
        outputPath: {
            type: 'string',
            description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf.",
        },
    },
    required: ['title', 'fields'],
} as const;

const InputSchema = z.strictObject({
    title: z.string().min(1).max(200),
    fields: z.array(FormFieldSchema).min(1).max(200),
    footerText: z.string().max(200).optional(),
    pdfA: PdfASchema.optional(),
    ...PrintInputShape,
    ...LayoutInputShape,
    ...DiagnosticInputShape,
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function addForm(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, fields, footerText, pdfA, print, outputIntent, metadata, creationDate, pageSize, margins, headerTemplate, footerTemplate, compress, debug, encrypt, strict, includeDiagnostics, embedFonts, outputMode, outputPath } = parsed.data;
    assertPrintPdfACompatible(print, pdfA);
    assertLayoutPdfACompatible({ encrypt }, pdfA);

    for (const field of fields) assertFormFieldOptions(field);

    // One formField block per field; 'textarea' is mapped to the engine's 'multilineText'.
    const blocks: DocumentBlock[] = fields.map((field): DocumentBlock => toFormFieldBlock(field));

    const docMetadata = toDocumentMetadata(metadata);
    const fontEntries = await latinFontEntries(embedFonts);
    const collector = collectDiagnostics(strict);

    let bytes: Uint8Array;
    try {
        bytes = buildDocumentPDFBytes(
            {
                title,
                blocks,
                ...(footerText !== undefined ? { footerText } : {}),
                ...(docMetadata !== undefined ? { metadata: docMetadata } : {}),
                ...(fontEntries.length > 0 ? { fontEntries } : {}),
            },
            {
                ...(pdfA !== undefined ? { tagged: pdfA } : {}),
                ...toPrintLayout({ print, outputIntent, creationDate }),
                ...toLayoutOptions({ pageSize, margins, headerTemplate, footerTemplate, compress, debug, encrypt }),
                ...collector.layout,
            },
        );
    } catch (err) {
        throw mapBuildError(err, ADD_FORM_NAME);
    }

    return withDiagnostics(
        await emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) }),
        collector,
        includeDiagnostics,
    );
}
