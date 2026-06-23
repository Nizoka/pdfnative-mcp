/**
 * Tool: validate_pdf
 *
 * Read-only PDF/UA (ISO 14289-1) structural conformance check. Wraps pdfnative's
 * `validatePdfUA()` — a fast, render-free validator that inspects the document
 * catalog, structure tree and per-page marked content for the structural
 * prerequisites of an accessible Tagged PDF:
 *
 *   - Catalog /MarkInfo << /Marked true >>            (ISO 14289-1 §7.1)
 *   - Catalog /StructTreeRoot (+ /ParentTree)         (ISO 14289-1 §7.1)
 *   - Catalog /Metadata (XMP) and /Lang               (ISO 14289-1 §7.2, §7.3)
 *   - MCID uniqueness within each page content stream (ISO 32000-1 §14.7.4.3)
 *
 * It is a developer-time gate, NOT a substitute for a full reference validator
 * (e.g. veraPDF) which additionally checks fonts, colour and rendering. A
 * `valid: true` result means the structural prerequisites hold.
 *
 * Inputs: `pdfBase64`.
 * Output (validated against the structured outputSchema):
 *   - `standard`, `valid`, `errors[]`, `warnings[]`, `summary`.
 */
import { validatePdfUA } from 'pdfnative';
import { z } from 'zod';
import { ToolError } from '../errors.js';

export const VALIDATE_PDF_NAME = 'validate_pdf';

export const VALIDATE_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded PDF bytes to validate for PDF/UA (ISO 14289-1) structural conformance.',
        },
        verbosity: {
            type: 'string',
            enum: ['summary', 'full'],
            default: 'full',
            description:
                "Response verbosity. 'full' (default) returns errors[] and warnings[]; 'summary' returns a token-frugal verdict { standard, valid, errorCount, warningCount, summary } and drops the message arrays.",
        },
        fields: {
            type: 'array',
            description:
                "Optional dot-path projection applied to the structured result (e.g. ['valid']). Composes after verbosity. Unknown paths are omitted.",
            maxItems: 16,
            items: { type: 'string', minLength: 1 },
        },
    },
    required: ['pdfBase64'],
} as const;

export const VALIDATE_PDF_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['standard', 'valid', 'errors', 'warnings', 'summary'],
    properties: {
        standard: { type: 'string', enum: ['pdf-ua-1'], description: 'Conformance standard checked (ISO 14289-1).' },
        valid: { type: 'boolean', description: 'True when no blocking structural violations were found.' },
        errors: {
            type: 'array',
            description: 'Blocking PDF/UA conformance violations. Empty when valid is true.',
            items: { type: 'string' },
        },
        warnings: {
            type: 'array',
            description: 'Non-blocking best-practice recommendations.',
            items: { type: 'string' },
        },
        summary: { type: 'string', description: 'Human-readable one-line summary of the result.' },
    },
} as const;

const InputSchema = z.object({
    pdfBase64: z.string().min(4),
    verbosity: z.enum(['summary', 'full']).optional(),
    fields: z.array(z.string().min(1)).max(16).optional(),
});

export interface ValidatePdfResult {
    readonly standard: 'pdf-ua-1';
    readonly valid: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly summary: string;
}

function decodeBase64(value: string): Uint8Array {
    try {
        return new Uint8Array(Buffer.from(value, 'base64'));
    } catch {
        throw new ToolError('VALIDATION_ERROR', 'pdfBase64 is not valid base64.');
    }
}

export async function validatePdf(rawInput: unknown): Promise<ValidatePdfResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }

    const bytes = decodeBase64(parsed.data.pdfBase64);
    if (bytes.length === 0) {
        throw new ToolError('VALIDATION_ERROR', 'pdfBase64 decoded to an empty buffer.');
    }

    const result = validatePdfUA(bytes);

    const summary = result.valid
        ? `PDF/UA structural prerequisites hold${result.warnings.length > 0 ? ` (${result.warnings.length} warning(s))` : ''}.`
        : `PDF/UA validation failed with ${result.errors.length} error(s)${result.warnings.length > 0 ? ` and ${result.warnings.length} warning(s)` : ''}.`;

    return {
        standard: 'pdf-ua-1',
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        summary,
    };
}
