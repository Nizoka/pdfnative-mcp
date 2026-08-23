/**
 * Shared AcroForm field fragment used by `add_form` and by the `formField`
 * block of `generate_basic_pdf`. JSON Schema and Zod are kept in lock-step.
 *
 * Field-type names are the agent-facing ones (`textarea`); the engine name
 * (`multilineText`) is mapped in {@link toFormFieldBlock}.
 */
import type { FormFieldBlock } from 'pdfnative';
import { z } from 'zod';

import { ToolError } from './errors.js';

export const FORM_FIELD_TYPE_ENUM = ['text', 'textarea', 'checkbox', 'radio', 'dropdown', 'listbox'] as const;

/** JSON Schema properties of one form field (spread into a field item or block schema). */
export const FORM_FIELD_PROPERTIES = {
    fieldType: {
        type: 'string',
        enum: [...FORM_FIELD_TYPE_ENUM],
        description: 'Type of form control to render. Radio fields sharing a name form one radio group.',
    },
    name: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
        description: 'Unique field name used as the PDF annotation identifier (/T).',
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
    placeholder: {
        type: 'string',
        maxLength: 200,
        description: 'Hint text shown while the field is empty.',
    },
    options: {
        type: 'array',
        description: 'Choices for dropdown, listbox or radio fields.',
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
        description: 'Field width in points (default: full content width).',
    },
    height: {
        type: 'number',
        minimum: 10,
        maximum: 300,
        description: 'Field height in points (default depends on the type).',
    },
    checked: {
        type: 'boolean',
        description: 'Initial checked state for checkbox / radio fields.',
    },
    fontSize: {
        type: 'number',
        minimum: 6,
        maximum: 48,
        description: 'Font size for text rendering inside the field.',
    },
} as const;

/** Zod counterpart of {@link FORM_FIELD_PROPERTIES}. */
export const FormFieldShape = {
    fieldType: z.enum(FORM_FIELD_TYPE_ENUM),
    name: z.string().min(1).max(100),
    label: z.string().max(200).optional(),
    value: z.string().max(2000).optional(),
    placeholder: z.string().max(200).optional(),
    options: z.array(z.string().max(200)).max(100).optional(),
    readOnly: z.boolean().optional(),
    required: z.boolean().optional(),
    maxLength: z.number().int().min(1).max(32767).optional(),
    width: z.number().min(10).max(500).optional(),
    height: z.number().min(10).max(300).optional(),
    checked: z.boolean().optional(),
    fontSize: z.number().min(6).max(48).optional(),
} as const;

export const FormFieldSchema = z.strictObject(FormFieldShape);
export type FormFieldInput = z.infer<typeof FormFieldSchema>;

/** Choice fields need at least one option; the engine would otherwise emit an empty widget. */
export function assertFormFieldOptions(field: FormFieldInput, where = ''): void {
    if (
        (field.fieldType === 'radio' || field.fieldType === 'dropdown' || field.fieldType === 'listbox') &&
        (field.options === undefined || field.options.length === 0)
    ) {
        throw new ToolError('VALIDATION_ERROR', `${where}Field '${field.name}' of type '${field.fieldType}' requires at least one option.`);
    }
}

export function toFormFieldBlock(field: FormFieldInput): FormFieldBlock {
    return {
        type: 'formField',
        fieldType: field.fieldType === 'textarea' ? 'multilineText' : field.fieldType,
        name: field.name,
        ...(field.label !== undefined ? { label: field.label } : {}),
        ...(field.value !== undefined ? { value: field.value } : {}),
        ...(field.placeholder !== undefined ? { placeholder: field.placeholder } : {}),
        ...(field.options !== undefined ? { options: field.options } : {}),
        ...(field.readOnly !== undefined ? { readOnly: field.readOnly } : {}),
        ...(field.required !== undefined ? { required: field.required } : {}),
        ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
        ...(field.width !== undefined ? { width: field.width } : {}),
        ...(field.height !== undefined ? { height: field.height } : {}),
        ...(field.checked !== undefined ? { checked: field.checked } : {}),
        ...(field.fontSize !== undefined ? { fontSize: field.fontSize } : {}),
    };
}
