/**
 * Tool: fill_form
 *
 * Fill (and optionally flatten) the AcroForm of an *existing* PDF, backed by
 * pdfnative v1.6.0's `fillForm()` / `flattenForm()`. This is the counterpart to
 * `add_form` (which *creates* a new interactive form): `fill_form` operates on a
 * document that already has fields — e.g. a template produced by `add_form` or a
 * third-party fillable PDF.
 *
 * Semantics (faithful to pdfnative):
 *   - Non-destructive incremental update: the original bytes are preserved, so a
 *     prior signature stays valid for its revision.
 *   - `flatten: true` stamps each widget's appearance into page content and drops
 *     the interactive layer. Passing no `values` with `flatten: true` performs a
 *     pure flatten.
 *   - Text/choice values take a string (array for multi-select listboxes);
 *     checkbox/radio take a boolean or the export-state string.
 *   - Encrypted documents are supported via `password`; appended objects are
 *     encrypted under the document's existing scheme (no plaintext leak).
 *   - Signature fields cannot be filled/flattened → `FORM_UNSUPPORTED`.
 */
import {
    fillForm,
    flattenForm,
    FormFieldNotFoundError,
    FormUnsupportedError,
    FormValueTypeError,
    type FillFormOptions,
    type FormFillValue,
} from 'pdfnative';
import { z } from 'zod';

import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { decodePdfBase64 } from '../base64.js';
import { mapDecryptError, PASSWORD_INPUT_SCHEMA, PasswordSchema } from '../encryption.js';

export const FILL_FORM_NAME = 'fill_form';

export const FILL_FORM_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64'],
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded source PDF containing the AcroForm to fill. Use read_form_fields first to discover field names.',
        },
        values: {
            type: 'object',
            description:
                'Map of fully-qualified field name → value. Text/choice: a string (array of strings for multi-select listboxes). Checkbox/radio: a boolean or the export-state string. Omit (or pass {}) with flatten:true for a pure flatten.',
            additionalProperties: {
                oneOf: [
                    { type: 'string' },
                    { type: 'boolean' },
                    { type: 'array', items: { type: 'string' }, maxItems: 1000 },
                ],
            },
        },
        flatten: {
            type: 'boolean',
            default: false,
            description: 'When true, stamp appearances into page content and remove the interactive fields after filling.',
        },
        onUnknownField: {
            type: 'string',
            enum: ['throw', 'ignore'],
            default: 'throw',
            description: "Behaviour for a value key that matches no field. 'throw' (default) → FORM_FIELD_NOT_FOUND; 'ignore' skips it.",
        },
        nonWinAnsi: {
            type: 'string',
            enum: ['throw', 'needAppearances'],
            default: 'throw',
            description:
                "Behaviour when a value contains non-WinAnsi characters (appearance font is Helvetica/WinAnsi). 'throw' (default) rejects it; 'needAppearances' writes the value and sets /NeedAppearances so the viewer regenerates the appearance.",
        },
        password: PASSWORD_INPUT_SCHEMA,
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64', description: "'base64' (default) returns the PDF inline; 'file' writes it inside the PDFNATIVE_MCP_OUTPUT_DIR sandbox (SECURITY_VIOLATION when the sandbox is not configured)." },
        outputPath: { type: 'string', description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf." },
    },
} as const;

const InputSchema = z.strictObject({
    pdfBase64: z.string().min(4),
    values: z.record(z.string(), z.union([z.string(), z.boolean(), z.array(z.string()).max(1000)])).optional(),
    flatten: z.boolean().default(false),
    onUnknownField: z.enum(['throw', 'ignore']).optional(),
    nonWinAnsi: z.enum(['throw', 'needAppearances']).optional(),
    password: PasswordSchema.optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

function decodeBase64(value: string): Uint8Array {
    return decodePdfBase64(value, 'pdfBase64');
}

/** Translate a pdfnative form error into a stable {@link ToolError}. Always throws. */
function mapFormError(err: unknown, hadPassword: boolean): never {
    if (err instanceof FormFieldNotFoundError) {
        throw new ToolError('FORM_FIELD_NOT_FOUND', `${err.message}. List the real field names with read_form_fields, or pass onUnknownField:'ignore' to skip unknown keys.`);
    }
    if (err instanceof FormValueTypeError) {
        throw new ToolError('FORM_VALUE_TYPE_ERROR', err.message);
    }
    if (err instanceof FormUnsupportedError) {
        throw new ToolError('FORM_UNSUPPORTED', err.message);
    }
    mapDecryptError(err, hadPassword);
}

export async function fillFormTool(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const input = parsed.data;

    const bytes = decodeBase64(input.pdfBase64);
    if (bytes.length === 0) {
        throw new ToolError('VALIDATION_ERROR', 'pdfBase64 decoded to an empty buffer.');
    }
    const values = (input.values ?? {}) as Record<string, FormFillValue>;
    const hasValues = Object.keys(values).length > 0;

    if (!hasValues && !input.flatten) {
        throw new ToolError('VALIDATION_ERROR', 'Provide `values` to fill, or set `flatten: true` for a pure flatten.');
    }

    let result: Uint8Array;
    try {
        if (!hasValues) {
            // Pure flatten (no field values supplied).
            result = flattenForm(bytes, input.password !== undefined ? { password: input.password } : undefined);
        } else {
            const opts: FillFormOptions = {
                flatten: input.flatten,
                ...(input.onUnknownField !== undefined ? { onUnknownField: input.onUnknownField } : {}),
                ...(input.nonWinAnsi !== undefined ? { nonWinAnsi: input.nonWinAnsi } : {}),
                ...(input.password !== undefined ? { password: input.password } : {}),
            };
            result = fillForm(bytes, values, opts);
        }
    } catch (err) {
        mapFormError(err, input.password !== undefined);
    }

    return emitPdf(result, {
        mode: input.outputMode,
        ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
    });
}
