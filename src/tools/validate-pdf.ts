/**
 * Tool: validate_pdf
 *
 * Read-only, render-free structural conformance checks. `standard` picks the
 * rule set; the default is the one this tool has always run.
 *
 * `standard: 'pdf-ua-1'` (default) — PDF/UA (ISO 14289-1), pdfnative's
 * `validatePdfUA()`: the structural prerequisites of an accessible Tagged PDF:
 *
 *   - Catalog /MarkInfo << /Marked true >>            (ISO 14289-1 §7.1)
 *   - Catalog /StructTreeRoot (+ /ParentTree)         (ISO 14289-1 §7.1)
 *   - Catalog /Metadata (XMP) and /Lang               (ISO 14289-1 §7.2, §7.3)
 *   - MCID uniqueness within each page content stream (ISO 32000-1 §14.7.4.3)
 *
 * `standard: 'pdf-x-4'` — PDF/X-4 (ISO 15930-7), pdfnative's `validatePdfX()`
 * (1.8.0): PDF 1.6 header, no encryption, trailer /ID, the PDF/X-4 XMP
 * identification, a `/GTS_PDFX` OutputIntent with an embedded `prtr` ICC
 * profile, a TrimBox or ArtBox per page nested in the BleedBox and MediaBox,
 * every font embedded (Form XObjects, patterns and appearance streams
 * included), no annotation on the printed area, no JavaScript, no embedded
 * file, no OPI / PostScript / reference XObject, no LZW, no transfer function,
 * device colour consistent with the OutputIntent.
 *
 * Both are developer-time gates, NOT a substitute for a reference validator:
 * veraPDF checks fonts, colour and rendering for PDF/A and PDF/UA; it does not
 * cover PDF/X, for which no open reference validator exists — a press job is
 * confirmed with callas pdfToolbox or Acrobat Preflight. A `valid: true`
 * result means the structural prerequisites hold. For PDF/X the result says so
 * itself, in `caveats`, because an agent reads the result and not this file.
 *
 * Inputs: `pdfBase64`, `standard`.
 * Output (validated against the structured outputSchema):
 *   - `standard`, `valid`, `errors[]`, `warnings[]`, `summary` (+ `caveats[]` for PDF/X).
 */
import { validatePdfUA, validatePdfX } from 'pdfnative';
import { z } from 'zod';
import { ToolError } from '../errors.js';
import { decodePdfBase64 } from '../base64.js';

export const VALIDATE_PDF_NAME = 'validate_pdf';

/** The rule sets, in the spelling the output `standard` field has always used. */
export const VALIDATE_STANDARDS = ['pdf-ua-1', 'pdf-x-4'] as const;
export type ValidateStandard = (typeof VALIDATE_STANDARDS)[number];

export const VALIDATE_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded PDF bytes to validate for structural conformance.',
        },
        standard: {
            type: 'string',
            enum: [...VALIDATE_STANDARDS],
            default: 'pdf-ua-1',
            description:
                "Rule set. 'pdf-ua-1' (default): PDF/UA accessibility structure (ISO 14289-1). 'pdf-x-4': PDF/X-4 print exchange (ISO 15930-7) — OutputIntent + prtr ICC profile, TrimBox, embedded fonts, no annotations / JavaScript / embedded files; structural prerequisites only, not a certified preflight (see caveats[]).",
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
        standard: { type: 'string', enum: [...VALIDATE_STANDARDS], description: 'Conformance standard checked (ISO 14289-1 or ISO 15930-7).' },
        valid: { type: 'boolean', description: 'True when no blocking structural violations were found.' },
        errors: {
            type: 'array',
            description: 'Blocking conformance violations. Empty when valid is true.',
            items: { type: 'string' },
        },
        warnings: {
            type: 'array',
            description: 'Non-blocking best-practice recommendations.',
            items: { type: 'string' },
        },
        summary: { type: 'string', description: 'Human-readable one-line summary of the result.' },
        caveats: {
            type: 'array',
            description: "standard 'pdf-x-4' only: what a valid verdict does NOT establish.",
            items: { type: 'string' },
        },
    },
} as const;

const InputSchema = z.strictObject({
    pdfBase64: z.string().min(4),
    standard: z.enum(VALIDATE_STANDARDS).optional(),
    verbosity: z.enum(['summary', 'full']).optional(),
    fields: z.array(z.string().min(1)).max(16).optional(),
});

export interface ValidatePdfResult {
    readonly standard: ValidateStandard;
    readonly valid: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly summary: string;
    /** Present for `pdf-x-4` only, so the default (PDF/UA) response is unchanged. */
    readonly caveats?: readonly string[];
}

/**
 * What a PDF/X verdict from a structural, render-free check leaves open.
 * Returned with every `pdf-x-4` result, valid or not.
 */
export const PDF_X_CAVEATS = [
    'Structural prerequisites only: this is not a certified preflight. Confirm a press job with callas pdfToolbox or Acrobat Preflight — veraPDF does not cover PDF/X and no open reference validator exists.',
    'Not checked: colour inside Form XObjects and images, transparency blend spaces, optional content, and anything that needs rendering (overprint, ink coverage, resolution).',
] as const;

const LABEL: Record<ValidateStandard, string> = { 'pdf-ua-1': 'PDF/UA', 'pdf-x-4': 'PDF/X-4' };

/** Engine messages that mean "this is not a readable PDF", not "this PDF does not conform". */
const NOT_A_PDF = ['Unparseable PDF:', 'Missing %PDF- header', 'No document catalog:'] as const;

function decodeBase64(value: string): Uint8Array {
    return decodePdfBase64(value, 'pdfBase64');
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

    const standard: ValidateStandard = parsed.data.standard ?? 'pdf-ua-1';
    const result = standard === 'pdf-x-4' ? validatePdfX(bytes) : validatePdfUA(bytes);

    // The engine reports an unparsable document as a conformance failure
    // ('Unparseable PDF: …'). Every other read tool raises PDF_PARSE_FAILED for
    // that condition, so surface it with the same code: a base64 slip must not
    // read as 'document not accessible' (or 'not print-ready') in a CI loop.
    const unparseable = result.errors.find((e) => NOT_A_PDF.some((prefix) => e.startsWith(prefix)));
    if (unparseable !== undefined) {
        throw new ToolError('PDF_PARSE_FAILED', `${unparseable.replace(/\.$/, '')}. Pass the raw PDF bytes as base64 (inspect_pdf reports the same condition).`);
    }

    const label = LABEL[standard];
    const summary = result.valid
        ? `${label} structural prerequisites hold${result.warnings.length > 0 ? ` (${result.warnings.length} warning(s))` : ''}.`
        : `${label} validation failed with ${result.errors.length} error(s)${result.warnings.length > 0 ? ` and ${result.warnings.length} warning(s)` : ''}.`;

    return {
        standard,
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        summary,
        ...(standard === 'pdf-x-4' ? { caveats: PDF_X_CAVEATS } : {}),
    };
}
