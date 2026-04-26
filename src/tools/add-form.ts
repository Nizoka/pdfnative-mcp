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

export const ADD_FORM_NAME = 'add_form';

const FORM_FIELD_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['fieldType', 'name'],
    properties: {
        fieldType: {
            type: 'string',
            enum: ['text', 'textarea', 'checkbox', 'radio', 'dropdown'],
            description: 'Type of form control to render.',
        },
        name: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            description: 'Unique field name used as the PDF annotation identifier.',
        },
        label: {
            type: 'string',
            maxLength: 200,
            description: 'Human-readable label shown above the field.',
        },
        value: {
            type: 'string',
            maxLength: 2000,
            description: 'Default value pre-filled in the field.',
        },
        options: {
            type: 'array',
            description: 'Choices for dropdown or radio fields.',
            maxItems: 100,
            items: { type: 'string', maxLength: 200 },
        },
        readOnly: { type: 'boolean', description: 'Prevent editing of this field.' },
        required: { type: 'boolean', description: 'Mark field as required.' },
        maxLength: {
            type: 'integer',
            minimum: 1,
            maximum: 32767,
            description: 'Maximum character length for text/textarea fields.',
        },
        width: {
            type: 'number',
            minimum: 10,
            maximum: 500,
            description: 'Field width in points (optional).',
        },
        height: {
            type: 'number',
            minimum: 10,
            maximum: 300,
            description: 'Field height in points (optional).',
        },
        checked: {
            type: 'boolean',
            description: 'Initial checked state for checkbox fields.',
        },
        fontSize: {
            type: 'number',
            minimum: 6,
            maximum: 48,
            description: 'Font size for text rendering inside the field.',
        },
    },
};

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
        outputMode: {
            type: 'string',
            enum: ['base64', 'file'],
            default: 'base64',
            description:
                "Either 'base64' (returns the PDF inline) or 'file' (writes to a sandboxed path inside PDFNATIVE_MPC_OUTPUT_DIR).",
        },
        outputPath: {
            type: 'string',
            description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf.",
        },
    },
    required: ['title', 'fields'],
} as const;

const FieldSchema = z.object({
    fieldType: z.enum(['text', 'textarea', 'checkbox', 'radio', 'dropdown']),
    name: z.string().min(1).max(100),
    label: z.string().max(200).optional(),
    value: z.string().max(2000).optional(),
    options: z.array(z.string().max(200)).max(100).optional(),
    readOnly: z.boolean().optional(),
    required: z.boolean().optional(),
    maxLength: z.number().int().min(1).max(32767).optional(),
    width: z.number().min(10).max(500).optional(),
    height: z.number().min(10).max(300).optional(),
    checked: z.boolean().optional(),
    fontSize: z.number().min(6).max(48).optional(),
});

const InputSchema = z.object({
    title: z.string().min(1).max(200),
    fields: z.array(FieldSchema).min(1).max(200),
    footerText: z.string().max(200).optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

export async function addForm(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, fields, footerText, outputMode, outputPath } = parsed.data;

    // Validate that radio/dropdown fields have options
    for (const field of fields) {
        if ((field.fieldType === 'radio' || field.fieldType === 'dropdown') && (!field.options || field.options.length === 0)) {
            throw new ToolError(
                'VALIDATION_ERROR',
                `Field '${field.name}' of type '${field.fieldType}' requires at least one option.`,
            );
        }
    }

    // Build blocks: title block + form fields
    const blocks: DocumentBlock[] = fields.map(
        (field): DocumentBlock => ({
            type: 'formField',
            fieldType: field.fieldType as 'text' | 'multilineText' | 'checkbox' | 'radio' | 'dropdown' | 'listbox',
            name: field.name,
            ...(field.label !== undefined ? { label: field.label } : {}),
            ...(field.value !== undefined ? { value: field.value } : {}),
            ...(field.options !== undefined ? { options: field.options } : {}),
            ...(field.readOnly !== undefined ? { readOnly: field.readOnly } : {}),
            ...(field.required !== undefined ? { required: field.required } : {}),
            ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
            ...(field.width !== undefined ? { width: field.width } : {}),
            ...(field.height !== undefined ? { height: field.height } : {}),
            ...(field.checked !== undefined ? { checked: field.checked } : {}),
            ...(field.fontSize !== undefined ? { fontSize: field.fontSize } : {}),
        }),
    );

    const bytes = buildDocumentPDFBytes({
        title,
        blocks,
        ...(footerText !== undefined ? { footerText } : {}),
    });

    return emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) });
}
