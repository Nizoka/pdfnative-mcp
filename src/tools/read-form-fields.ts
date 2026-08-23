/**
 * Tool: read_form_fields
 *
 * Read-only enumeration of an existing PDF's AcroForm field tree, backed by
 * pdfnative v1.6.0's `readFormFields()`. Reports each terminal field's
 * fully-qualified name, classified type, current value, flags (readOnly /
 * required / multiline), choice options, and widget placements — the input
 * inventory a caller needs before driving `fill_form`.
 *
 * Encrypted sources are supported via `password` (pdfnative decrypts
 * transparently). No filesystem access — the PDF is supplied as base64.
 */
import { readFormFields, type ParsedFormField } from 'pdfnative';
import { z } from 'zod';

import { ToolError } from '../errors.js';
import { decodePdfBase64 } from '../base64.js';
import { mapDecryptError, PASSWORD_INPUT_SCHEMA, PasswordSchema } from '../encryption.js';

export const READ_FORM_FIELDS_NAME = 'read_form_fields';

export const READ_FORM_FIELDS_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64'],
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded PDF bytes whose AcroForm fields should be enumerated.',
        },
        password: PASSWORD_INPUT_SCHEMA,
        verbosity: {
            type: 'string',
            enum: ['summary', 'full'],
            default: 'full',
            description:
                "Response verbosity. 'full' (default) returns the fields[] array; 'summary' returns a token-frugal { fieldCount } and drops the array.",
        },
        fields: {
            type: 'array',
            description:
                "Optional dot-path projection applied to the structured result (e.g. ['fields.name','fields.type']). Composes after verbosity. Unknown paths are omitted.",
            maxItems: 16,
            items: { type: 'string', minLength: 1 },
        },
    },
} as const;

export const READ_FORM_FIELDS_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['fieldCount', 'fields'],
    properties: {
        fieldCount: { type: 'integer', minimum: 0 },
        fields: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'type', 'readOnly', 'required', 'multiline', 'widgets'],
                properties: {
                    name: { type: 'string', description: 'Fully-qualified field name (/T chain joined with ".").' },
                    type: {
                        type: 'string',
                        enum: ['text', 'checkbox', 'radio', 'dropdown', 'listbox', 'button', 'signature', 'unknown'],
                    },
                    value: {
                        type: ['string', 'boolean', 'array', 'null'],
                        items: { type: 'string' },
                        description: 'Current /V value: text/choice string(s), checkbox/radio state, or null.',
                    },
                    readOnly: { type: 'boolean' },
                    required: { type: 'boolean' },
                    multiline: { type: 'boolean' },
                    options: {
                        type: 'array',
                        description: 'Choice options (/Opt) as { export, label }. Present for dropdown/listbox.',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['export', 'label'],
                            properties: { export: { type: 'string' }, label: { type: 'string' } },
                        },
                    },
                    maxLen: { type: 'integer', minimum: 0, description: 'Maximum text length (/MaxLen), when declared.' },
                    onState: { type: 'string', description: 'On-state name for a checkbox/radio widget (from /AP /N).' },
                    widgets: {
                        type: 'array',
                        description: 'Widget placements: 0-based page index and rectangle [x1,y1,x2,y2].',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['pageIndex', 'rect'],
                            properties: {
                                pageIndex: { type: 'integer', minimum: 0 },
                                rect: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number' } },
                            },
                        },
                    },
                },
            },
        },
    },
} as const;

const InputSchema = z.strictObject({
    pdfBase64: z.string().min(4),
    password: PasswordSchema.optional(),
    verbosity: z.enum(['summary', 'full']).optional(),
    fields: z.array(z.string().min(1)).max(16).optional(),
});

export interface FormFieldSummary {
    readonly name: string;
    readonly type: ParsedFormField['type'];
    readonly value: string | readonly string[] | boolean | null;
    readonly readOnly: boolean;
    readonly required: boolean;
    readonly multiline: boolean;
    readonly options?: ReadonlyArray<{ readonly export: string; readonly label: string }>;
    readonly maxLen?: number;
    readonly onState?: string;
    readonly widgets: ReadonlyArray<{ readonly pageIndex: number; readonly rect: readonly [number, number, number, number] }>;
}

export interface ReadFormFieldsResult {
    readonly fieldCount: number;
    readonly fields: readonly FormFieldSummary[];
}

function decodeBase64(value: string): Uint8Array {
    return decodePdfBase64(value, 'pdfBase64');
}

export async function readFormFieldsTool(rawInput: unknown): Promise<ReadFormFieldsResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { pdfBase64, password } = parsed.data;

    const bytes = decodeBase64(pdfBase64);
    if (bytes.length === 0) {
        throw new ToolError('VALIDATION_ERROR', 'pdfBase64 decoded to an empty buffer.');
    }

    let fields: ParsedFormField[];
    try {
        fields = readFormFields(bytes, password !== undefined ? { password } : undefined);
    } catch (err) {
        mapDecryptError(err, password !== undefined);
    }

    const out: FormFieldSummary[] = fields.map((f) => ({
        name: f.name,
        type: f.type,
        value: f.value,
        readOnly: f.readOnly,
        required: f.required,
        multiline: f.multiline,
        ...(f.options !== undefined ? { options: f.options.map((o) => ({ export: o.export, label: o.label })) } : {}),
        ...(f.maxLen !== undefined ? { maxLen: f.maxLen } : {}),
        ...(f.onState !== undefined ? { onState: f.onState } : {}),
        widgets: f.widgets.map((w) => ({ pageIndex: w.pageIndex, rect: w.rect })),
    }));

    return { fieldCount: out.length, fields: out };
}
