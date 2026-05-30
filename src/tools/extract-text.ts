/**
 * Tool: extract_text
 *
 * Best-effort plain-text extraction from a PDF.
 *
 * Approach:
 *   - Walk each page's `/Contents` stream(s) via pdfnative's `openPdf()`
 *     reader and `decodeStream()`.
 *   - Pull out the operands of the `Tj`, `'`, `"` and `TJ` text-showing
 *     operators (PDF 32000-1 §9.4). Literal strings (`(...)`) are unescaped
 *     for the common escape sequences (\\\\, \\(, \\), \\n, \\r, \\t, octal);
 *     hex strings (`<...>`) are decoded to bytes and reinterpreted as
 *     PDFDocEncoding fallback (Latin-1) when no /ToUnicode CMap can be applied.
 *
 * Limitations (intentional v1.0.0 scope):
 *   - No /ToUnicode CMap resolution — text from embedded subset fonts may
 *     come out as glyph indices rather than Unicode characters. The output
 *     `extractable` flag is set to `false` when *any* page yields no text
 *     while having a non-empty content stream.
 *   - Encrypted PDFs are rejected with `EXTRACTION_UNSUPPORTED`.
 *   - Tagged-mode structure-tree extraction (which would give cleaner text)
 *     is tracked for v1.1.
 */
import {
    isArray,
    isRef,
    isStream,
    openPdf,
    type PdfReader,
    type PdfStream,
} from 'pdfnative';
import { z } from 'zod';

import { ToolError } from '../errors.js';

export const EXTRACT_TEXT_NAME = 'extract_text';

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
    },
} as const;

export const EXTRACT_TEXT_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pageCount', 'extractedPageCount', 'extractable', 'pages', 'fullText'],
    properties: {
        pageCount: { type: 'integer', minimum: 0 },
        extractedPageCount: { type: 'integer', minimum: 0 },
        extractable: { type: 'boolean', description: 'False when one or more requested pages had a non-empty content stream but yielded no extractable text (likely subset fonts without /ToUnicode).' },
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
                },
            },
        },
        fullText: { type: 'string' },
    },
} as const;

const InputSchema = z.object({
    pdfBase64: z.string().min(4),
    pages: z.array(z.number().int().min(0)).max(1000).optional(),
});

export interface ExtractedPage {
    readonly index: number;
    readonly text: string;
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
    try {
        return new Uint8Array(Buffer.from(value, 'base64'));
        /* v8 ignore next 3 */
    } catch {
        throw new ToolError('VALIDATION_ERROR', 'pdfBase64 is not valid base64.');
    }
}

function isEncrypted(reader: PdfReader): boolean {
    return reader.trailer.get('Encrypt') !== undefined;
}

function collectContentStreams(reader: PdfReader, page: ReturnType<PdfReader['getPage']>): Uint8Array {
    const contents = page.get('Contents');
    if (contents === undefined) return new Uint8Array(0);
    const resolved = isRef(contents) ? reader.resolve(contents) : contents;
    const streams: PdfStream[] = [];
    if (isStream(resolved)) {
        streams.push(resolved);
    } else if (isArray(resolved)) {
        for (const entry of resolved) {
            const r = isRef(entry) ? reader.resolve(entry) : entry;
            if (isStream(r)) streams.push(r);
        }
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (const s of streams) {
        try {
            const decoded = reader.decodeStream(s);
            chunks.push(decoded);
            total += decoded.length;
            /* v8 ignore next 3 */
        } catch {
            // skip undecodable stream (e.g. unknown filter)
        }
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

/** Latin-1 view of decoded content-stream bytes — sufficient for operator detection. */
function toLatin1(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    return s;
}

const TEXT_OPERATORS = new Set(['Tj', "'", '"', 'TJ']);

function unescapePdfLiteral(raw: string): string {
    let out = '';
    for (let i = 0; i < raw.length; i++) {
        const c = raw[i]!;
        if (c !== '\\') {
            out += c;
            continue;
        }
        const next = raw[i + 1];
        if (next === undefined) break;
        if (next === 'n') { out += '\n'; i++; continue; }
        if (next === 'r') { out += '\r'; i++; continue; }
        if (next === 't') { out += '\t'; i++; continue; }
        if (next === 'b') { out += '\b'; i++; continue; }
        if (next === 'f') { out += '\f'; i++; continue; }
        if (next === '(' || next === ')' || next === '\\') { out += next; i++; continue; }
        if (next >= '0' && next <= '7') {
            let oct = next;
            if (raw[i + 2] !== undefined && raw[i + 2]! >= '0' && raw[i + 2]! <= '7') {
                oct += raw[i + 2];
                if (raw[i + 3] !== undefined && raw[i + 3]! >= '0' && raw[i + 3]! <= '7') {
                    oct += raw[i + 3];
                }
            }
            out += String.fromCharCode(parseInt(oct, 8));
            i += oct.length;
            continue;
        }
        // Unknown escape: drop the backslash, keep next char (PDF spec §7.3.4.2).
        out += next;
        i++;
    }
    return out;
}

function unescapePdfHex(hex: string): string {
    let cleaned = '';
    for (const c of hex) {
        if (/[0-9a-fA-F]/.test(c)) cleaned += c;
    }
    if (cleaned.length % 2 === 1) cleaned += '0';
    let out = '';
    for (let i = 0; i < cleaned.length; i += 2) {
        out += String.fromCharCode(parseInt(cleaned.substring(i, i + 2), 16));
    }
    return out;
}

/**
 * Tokenise a single page's content stream and concatenate the operand strings
 * of every text-showing operator. Strings are emitted in the order they appear;
 * paragraph breaks are inferred from BT/ET blocks (one newline per text object).
 */
/** @internal — exported for unit-testing only. */
export function _extractPageTextForTesting(latin1: string): string {
    return extractPageText(latin1);
}

function extractPageText(latin1: string): string {
    const out: string[] = [];
    let i = 0;
    const len = latin1.length;
    let pendingStrings: string[] = [];

    function flushTextObject(): void {
        if (pendingStrings.length === 0) return;
        out.push(pendingStrings.join(''));
        out.push('\n');
        pendingStrings = [];
    }

    while (i < len) {
        const c = latin1[i]!;
        // Skip comments
        if (c === '%') {
            while (i < len && latin1[i] !== '\n' && latin1[i] !== '\r') i++;
            continue;
        }
        // Literal string `(...)`
        if (c === '(') {
            let depth = 1;
            let j = i + 1;
            let raw = '';
            while (j < len && depth > 0) {
                const cj = latin1[j]!;
                if (cj === '\\' && j + 1 < len) {
                    raw += cj + latin1[j + 1]!;
                    j += 2;
                    continue;
                }
                if (cj === '(') depth++;
                else if (cj === ')') {
                    depth--;
                    if (depth === 0) break;
                }
                raw += cj;
                j++;
            }
            pendingStrings.push(unescapePdfLiteral(raw));
            i = j + 1;
            continue;
        }
        // Hex string `<...>`
        if (c === '<' && latin1[i + 1] !== '<') {
            const end = latin1.indexOf('>', i + 1);
            if (end === -1) break;
            pendingStrings.push(unescapePdfHex(latin1.substring(i + 1, end)));
            i = end + 1;
            continue;
        }
        // Identify operator tokens (letters / quote chars)
        if (/[A-Za-z'"]/.test(c)) {
            let j = i;
            while (j < len && /[A-Za-z'"*]/.test(latin1[j]!)) j++;
            const tok = latin1.substring(i, j);
            if (tok === 'BT') {
                pendingStrings = [];
            } else if (tok === 'ET') {
                flushTextObject();
            } else if (TEXT_OPERATORS.has(tok)) {
                // Strings already captured above; just record a soft separator.
                if (tok === "'" || tok === '"') pendingStrings.push(' ');
            }
            i = j;
            continue;
        }
        i++;
    }
    flushTextObject();
    return out.join('').replace(/\s+\n/g, '\n').trim();
}

export async function extractText(rawInput: unknown): Promise<ExtractTextResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const pdfBytes = decodeBase64(parsed.data.pdfBase64);

    let reader: PdfReader;
    try {
        reader = openPdf(pdfBytes);
    } catch (err) {
        throw new ToolError('PDF_PARSE_FAILED', `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (isEncrypted(reader)) {
        throw new ToolError('EXTRACTION_UNSUPPORTED', 'Encrypted PDFs are not supported by extract_text in v1.0.0.');
    }

    const totalPages = reader.pageCount;
    const requested = parsed.data.pages ?? Array.from({ length: totalPages }, (_, k) => k);

    const pagesOut: ExtractedPage[] = [];
    let extractable = true;
    for (const idx of requested) {
        if (idx >= totalPages) {
            throw new ToolError('VALIDATION_ERROR', `pages[]: index ${idx} is out of range (pageCount=${totalPages}).`);
        }
        const page = reader.getPage(idx);
        const raw = collectContentStreams(reader, page);
        const latin1 = toLatin1(raw);
        const text = extractPageText(latin1);
        if (raw.length > 0 && text.length === 0) extractable = false;
        pagesOut.push({ index: idx, text });
    }

    const fullText = pagesOut.map((p) => p.text).filter((t) => t.length > 0).join('\n\n');

    return {
        pageCount: totalPages,
        extractedPageCount: pagesOut.length,
        extractable,
        ...(extractable ? {} : { extractableReason: 'One or more pages have non-empty content streams but yielded no extractable text. This typically means the PDF uses subset fonts without /ToUnicode CMaps (common for PDFs produced by some converters). The PDF is not corrupt; re-render the source document with a producer that emits /ToUnicode mappings, or wait for pdfnative-mcp v1.1 which adds tagged-mode structure-tree extraction.' }),
        pages: pagesOut,
        fullText,
    };
}
