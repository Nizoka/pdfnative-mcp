/**
 * Tool: extract_text
 *
 * Unicode text extraction from a PDF, backed by pdfnative v1.6.0's
 * `extractText()` (ISO 32000-1 §9.4 text-showing operators decoded through each
 * font's `/ToUnicode` CMap, `/Encoding /Differences`, and WinAnsi / MacRoman
 * base tables; Form XObjects are recursed).
 *
 * What changed in pdfnative-mcp v1.5.0 (was best-effort in ≤ 1.4.0):
 *   - Real Unicode output: subset fonts with `/ToUnicode` now decode to
 *     characters instead of glyph indices. Codes with no mapping decode to
 *     U+FFFD (the `extractable` flag flips to false and `extractableReason`
 *     explains it).
 *   - Encrypted PDFs are supported: pass `password` (decryption is transparent),
 *     replacing the old `EXTRACTION_UNSUPPORTED` rejection.
 *   - Optional positioned runs (`includeRuns`) surface per-run device-space
 *     geometry `{ text, x, y, fontSize, fontName }`.
 *   - A hard `maxTextLength` memory cap (default 16 000 000 chars) bounds
 *     adversarial input.
 *
 * The default response shape (`pages[]`, `fullText`, `extractable`) is
 * unchanged; `runs` is additive and present only when `includeRuns` is true.
 */
import { extractText as pdfnativeExtractText, openPdf, type ExtractTextOptions, type PdfReader } from 'pdfnative';
import { z } from 'zod';

import { ToolError } from '../errors.js';
import { decodePdfBase64 } from '../base64.js';
import { mapDecryptError, PASSWORD_INPUT_SCHEMA, PasswordSchema } from '../encryption.js';

export const EXTRACT_TEXT_NAME = 'extract_text';

/** Default hard cap on total extracted characters (matches pdfnative's default). */
const DEFAULT_MAX_TEXT_LENGTH = 16_000_000;

export const EXTRACT_TEXT_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64'],
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded PDF bytes.',
        },
        pages: {
            type: 'array',
            description: 'Optional 0-based page indices to extract. When omitted, every page is extracted.',
            maxItems: 1000,
            items: { type: 'integer', minimum: 0 },
        },
        includeRuns: {
            type: 'boolean',
            default: false,
            description:
                'When true, each page also carries `runs[]` — positioned text-showing operations `{ text, x, y, fontSize, fontName }` in device space (content-stream order). Useful for layout-aware extraction; larger responses.',
        },
        password: PASSWORD_INPUT_SCHEMA,
        maxTextLength: {
            type: 'integer',
            minimum: 1,
            description: `Hard cap on total extracted characters across all pages (memory bound for adversarial input). Default ${DEFAULT_MAX_TEXT_LENGTH}. Exceeding it fails with OUTPUT_TOO_LARGE.`,
        },
        verbosity: {
            type: 'string',
            enum: ['summary', 'full'],
            default: 'full',
            description:
                "Response verbosity. 'full' (default) returns the per-page pages[] array and fullText; 'summary' returns a token-frugal { pageCount, extractedPageCount, extractable, charCount } and drops the text payloads.",
        },
        fields: {
            type: 'array',
            description:
                "Optional dot-path projection applied to the structured result (e.g. ['fullText'] or ['extractable']). Composes after verbosity. Unknown paths are omitted.",
            maxItems: 16,
            items: { type: 'string', minLength: 1 },
        },
    },
} as const;

export const EXTRACT_TEXT_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pageCount', 'extractedPageCount', 'extractable', 'pages', 'fullText'],
    properties: {
        pageCount: { type: 'integer', minimum: 0 },
        extractedPageCount: { type: 'integer', minimum: 0 },
        extractable: {
            type: 'boolean',
            description:
                'False when one or more requested pages produced text that is entirely U+FFFD replacement characters — a font with no usable /ToUnicode CMap or base encoding. Blank pages are still considered extractable.',
        },
        extractableReason: { type: 'string', description: 'Human-readable explanation when extractable=false. Absent when extractable=true.' },
        pages: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['index', 'text'],
                properties: {
                    index: { type: 'integer', minimum: 0 },
                    text: { type: 'string' },
                    runs: {
                        type: 'array',
                        description: 'Positioned text runs (present only when includeRuns is true).',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['text', 'x', 'y', 'fontSize', 'fontName'],
                            properties: {
                                text: { type: 'string' },
                                x: { type: 'number' },
                                y: { type: 'number' },
                                fontSize: { type: 'number' },
                                fontName: { type: 'string' },
                            },
                        },
                    },
                },
            },
        },
        fullText: { type: 'string' },
    },
} as const;

const InputSchema = z.strictObject({
    pdfBase64: z.string().min(4),
    pages: z.array(z.number().int().min(0)).max(1000).optional(),
    includeRuns: z.boolean().default(false),
    password: PasswordSchema.optional(),
    maxTextLength: z.number().int().positive().optional(),
    verbosity: z.enum(['summary', 'full']).optional(),
    fields: z.array(z.string().min(1)).max(16).optional(),
});

export interface ExtractedTextRun {
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly fontSize: number;
    readonly fontName: string;
}

export interface ExtractedPage {
    readonly index: number;
    readonly text: string;
    readonly runs?: readonly ExtractedTextRun[];
}

export interface ExtractTextResult {
    readonly pageCount: number;
    readonly extractedPageCount: number;
    readonly extractable: boolean;
    readonly extractableReason?: string;
    readonly pages: readonly ExtractedPage[];
    readonly fullText: string;
}

function decodeBase64(value: string): Uint8Array {
    return decodePdfBase64(value, 'pdfBase64');
}

/** True when a page's text is non-empty but every non-whitespace char is U+FFFD. */
function isUnmapped(text: string): boolean {
    let sawContent = false;
    for (const ch of text) {
        if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f') continue;
        sawContent = true;
        if (ch !== '�') return false;
    }
    return sawContent;
}

export async function extractText(rawInput: unknown): Promise<ExtractTextResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const input = parsed.data;
    const pdfBytes = decodeBase64(input.pdfBase64);
    if (pdfBytes.length === 0) {
        throw new ToolError('VALIDATION_ERROR', 'pdfBase64 decoded to an empty buffer.');
    }

    // Open once to report the true document page count (extractText only returns
    // the requested subset) and to surface password / parse failures up-front.
    let reader: PdfReader;
    try {
        reader = openPdf(pdfBytes, input.password !== undefined ? { password: input.password } : undefined);
    } catch (err) {
        mapDecryptError(err, input.password !== undefined);
    }
    const totalPages = reader.pageCount;

    const options: ExtractTextOptions = {
        includeRuns: input.includeRuns,
        maxTextLength: input.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH,
        ...(input.pages !== undefined ? { pages: input.pages } : {}),
        ...(input.password !== undefined ? { password: input.password } : {}),
    };

    let extracted;
    try {
        extracted = pdfnativeExtractText(pdfBytes, options);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/maxtextlength|exceed|too (large|many)/i.test(message)) {
            throw new ToolError('OUTPUT_TOO_LARGE', `Extracted text exceeds the configured maxTextLength cap. (${message})`);
        }
        if (/\bpage\b/i.test(message) && /\b(index|range|invalid|out of)\b/i.test(message)) {
            throw new ToolError('VALIDATION_ERROR', message);
        }
        // openPdf parse / password failures funnel through the shared decrypt mapper.
        mapDecryptError(err, input.password !== undefined);
    }

    const pagesOut: ExtractedPage[] = extracted.map((p) => ({
        index: p.pageIndex,
        text: p.text,
        ...(input.includeRuns && p.runs !== undefined
            ? { runs: p.runs.map((r) => ({ text: r.text, x: r.x, y: r.y, fontSize: r.fontSize, fontName: r.fontName })) }
            : {}),
    }));

    const unmapped = pagesOut.some((p) => isUnmapped(p.text));
    const fullText = pagesOut.map((p) => p.text).filter((t) => t.length > 0).join('\n\n');

    return {
        pageCount: totalPages,
        extractedPageCount: pagesOut.length,
        extractable: !unmapped,
        ...(unmapped
            ? {
                  extractableReason:
                      'One or more pages decoded entirely to U+FFFD replacement characters. The PDF uses a font with no usable /ToUnicode CMap or base encoding, so its glyphs cannot be mapped to Unicode. Re-render the source with a producer that embeds /ToUnicode mappings.',
              }
            : {}),
        pages: pagesOut,
        fullText,
    };
}
