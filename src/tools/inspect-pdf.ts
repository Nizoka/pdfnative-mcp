/**
 * Tool: inspect_pdf
 *
 * Read-only inspection of an existing PDF document. Reports structural metadata
 * (PDF version, page count), security state (encryption, AcroForm /SigFlags),
 * PDF/A claim (extracted from XMP), and embedded document info.
 *
 * Implementation notes:
 *   - All parsing goes through pdfnative's `openPdf()` (a hardened reader with
 *     CWE-674 / CWE-400 mitigations baked in).
 *   - No filesystem reads — caller supplies the PDF as base64.
 *   - Optional `pages` flag returns per-page sizes; `check` array AND-evaluates
 *     CI-style assertions (pdfa | signed | encrypted) and returns a single
 *     pass/fail flag suitable for downstream automation.
 */
import {
    isArray,
    isDict,
    isName,
    isRef,
    isStream,
    openPdf,
    type ParsedDict as PdfDict,
    type PdfReader,
    type PdfValue,
} from 'pdfnative';
import { z } from 'zod';
import { ToolError } from '../errors.js';

export const INSPECT_PDF_NAME = 'inspect_pdf';

const CHECK_VALUES = ['pdfa', 'signed', 'encrypted', 'placeholder', 'attachments'] as const;
type CheckValue = (typeof CHECK_VALUES)[number];

export const INSPECT_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded PDF bytes to inspect.',
        },
        pages: {
            type: 'boolean',
            default: false,
            description: 'When true, include per-page metadata in the response.',
        },
        check: {
            type: 'array',
            description:
                "Optional CI assertions. The result.checksPassed flag is true only when every requested check holds (e.g. ['pdfa','signed']).",
            maxItems: 8,
            items: { type: 'string', enum: [...CHECK_VALUES] },
        },
        verbosity: {
            type: 'string',
            enum: ['summary', 'full'],
            default: 'full',
            description:
                "Response verbosity. 'full' (default) returns every field; 'summary' returns a token-frugal scalar subset (version, pageCount, encryption, pdfA, signatureCount, hasSignaturePlaceholder, attachmentCount) — drops the attachments[], info and perPage arrays.",
        },
        fields: {
            type: 'array',
            description:
                "Optional dot-path projection applied to the structured result (e.g. ['pageCount','signatureCount']). Composes after verbosity. Unknown paths are omitted.",
            maxItems: 16,
            items: { type: 'string', minLength: 1 },
        },
    },
    required: ['pdfBase64'],
} as const;

export const INSPECT_PDF_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'pageCount', 'encryption', 'signatureCount', 'hasSignaturePlaceholder', 'attachments'],
    properties: {
        version: { type: 'string', description: 'PDF version (e.g. "1.7").' },
        pageCount: { type: 'integer', minimum: 0 },
        encryption: { type: 'string', enum: ['none', 'aes-128', 'aes-256', 'rc4', 'unknown'] },
        pdfA: {
            type: ['string', 'null'],
            description: "Detected PDF/A claim (e.g. '1B', '2B', '2U', '3B') from XMP metadata, or null when absent.",
        },
        signatureCount: { type: 'integer', minimum: 0 },
        hasSignaturePlaceholder: {
            type: 'boolean',
            description: 'True when at least one signature widget exists with empty /Contents — i.e. an unsigned placeholder awaiting `sign_pdf`.',
        },
        attachments: {
            type: 'array',
            description: 'Embedded files exposed via /Names → /EmbeddedFiles (PDF/A-3, Factur-X).',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['name'],
                properties: {
                    name: { type: 'string' },
                    sizeBytes: { type: 'integer', minimum: 0 },
                    mimeType: { type: 'string' },
                    relationship: { type: 'string' },
                    description: { type: 'string' },
                },
            },
        },
        info: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Document /Info dictionary entries decoded as strings.',
        },
        perPage: {
            type: 'array',
            items: {
                type: 'object',
                required: ['index', 'width', 'height'],
                properties: {
                    index: { type: 'integer' },
                    width: { type: 'number' },
                    height: { type: 'number' },
                },
            },
        },
        checks: {
            type: 'object',
            additionalProperties: { type: 'boolean' },
        },
        checksPassed: { type: 'boolean' },
    },
} as const;

const InputSchema = z.object({
    pdfBase64: z.string().min(4),
    pages: z.boolean().default(false),
    check: z.array(z.enum(CHECK_VALUES)).max(8).optional(),
    verbosity: z.enum(['summary', 'full']).optional(),
    fields: z.array(z.string().min(1)).max(16).optional(),
});

export interface AttachmentSummary {
    readonly name: string;
    readonly sizeBytes?: number;
    readonly mimeType?: string;
    readonly relationship?: string;
    readonly description?: string;
}

export interface InspectPdfResult {
    readonly version: string;
    readonly pageCount: number;
    readonly encryption: 'none' | 'aes-128' | 'aes-256' | 'rc4' | 'unknown';
    readonly pdfA: string | null;
    readonly signatureCount: number;
    readonly hasSignaturePlaceholder: boolean;
    readonly attachments: readonly AttachmentSummary[];
    readonly info: Readonly<Record<string, string>>;
    readonly perPage?: ReadonlyArray<{ readonly index: number; readonly width: number; readonly height: number }>;
    readonly checks?: Readonly<Record<CheckValue, boolean>>;
    readonly checksPassed?: boolean;
}

function decodeBase64(value: string): Uint8Array {
    // Buffer.from(..., 'base64') is documented to never throw in Node.js — invalid chars are silently skipped.
    /* v8 ignore next 3 */
    try {
        return new Uint8Array(Buffer.from(value, 'base64'));
    } catch {
        throw new ToolError('VALIDATION_ERROR', 'pdfBase64 is not valid base64.');
    }
}

/** Extract the leading "%PDF-x.y" version marker from the file header (ISO 32000-1 §7.5.2). */
function extractVersion(bytes: Uint8Array): string {
    const head = Buffer.from(bytes.slice(0, 16)).toString('latin1');
    const m = /%PDF-(\d+\.\d+)/.exec(head);
    return m === null ? 'unknown' : (m[1] as string);
}

function pdfStringToJs(val: PdfValue): string | null {
    if (typeof val === 'string') return val;
    if (isName(val)) return `/${val.value}`;
    return null;
}

function readInfoDict(reader: PdfReader): Record<string, string> {
    const info = reader.getInfo();
    if (info === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of info.entries()) {
        const resolved = reader.resolveValue(value);
        const s = pdfStringToJs(resolved);
        if (s !== null) out[key] = s;
    }
    return out;
}

/**
 * Classify an /Encrypt dictionary's /V and /Length keys into a high-level scheme name.
 *
 * Exported as a pure helper so unit tests can exercise every branch without
 * having to round-trip an actually-encrypted PDF (pdfnative does not currently
 * expose an encryption-writer API). Real-PDF coverage will be lifted further
 * in pdfnative-mcp v1.1 when fixture keys are available.
 */
export function classifyEncryption(
    v: unknown,
    length: unknown,
): InspectPdfResult['encryption'] {
    if (typeof v !== 'number') return 'unknown';
    if (v === 5) return 'aes-256';
    if (v === 4) {
        const len = typeof length === 'number' ? length : 128;
        return len >= 256 ? 'aes-256' : 'aes-128';
    }
    if (v === 1 || v === 2) return 'rc4';
    return 'unknown';
}

function detectEncryption(reader: PdfReader): InspectPdfResult['encryption'] {
    const enc = reader.trailer.get('Encrypt');
    if (enc === undefined) return 'none';
    const dict = isRef(enc) ? reader.resolve(enc) : enc;
    if (!isDict(dict)) return 'unknown';
    return classifyEncryption(dict.get('V'), dict.get('Length'));
}

function inspectSignatures(reader: PdfReader): { count: number; hasPlaceholder: boolean } {
    const af = findAcroFormDict(reader);
    if (af === null) return { count: 0, hasPlaceholder: false };
    const fields = af.get('Fields');
    if (fields === undefined) return { count: 0, hasPlaceholder: false };
    const arr = isRef(fields) ? reader.resolve(fields) : fields;
    if (!isArray(arr)) return { count: 0, hasPlaceholder: false };
    let count = 0;
    let hasPlaceholder = false;
    for (const entry of arr) {
        const fieldDict = isRef(entry) ? reader.resolve(entry) : entry;
        if (!isDict(fieldDict)) continue;
        const ft = fieldDict.get('FT');
        if (!isName(ft) || ft.value !== 'Sig') continue;
        count += 1;
        const vRaw = fieldDict.get('V');
        if (vRaw === undefined) {
            hasPlaceholder = true;
            continue;
        }
        const v = isRef(vRaw) ? reader.resolve(vRaw) : vRaw;
        if (!isDict(v)) {
            hasPlaceholder = true;
            continue;
        }
        const contents = v.get('Contents');
        if (typeof contents !== 'string' || isAllZero(contents)) {
            hasPlaceholder = true;
        }
    }
    return { count, hasPlaceholder };
}

function isAllZero(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        if (s.charCodeAt(i) !== 0) return false;
    }
    return true;
}

function readAttachments(reader: PdfReader): AttachmentSummary[] {
    const catalog = reader.getCatalog();
    const namesEntry = catalog.get('Names');
    if (namesEntry === undefined) return [];
    const names = isRef(namesEntry) ? reader.resolve(namesEntry) : namesEntry;
    if (!isDict(names)) return [];
    const embEntry = names.get('EmbeddedFiles');
    if (embEntry === undefined) return [];
    const emb = isRef(embEntry) ? reader.resolve(embEntry) : embEntry;
    if (!isDict(emb)) return [];
    const namesArrEntry = emb.get('Names');
    if (namesArrEntry === undefined) return [];
    const namesArr = isRef(namesArrEntry) ? reader.resolve(namesArrEntry) : namesArrEntry;
    if (!isArray(namesArr)) return [];
    const out: AttachmentSummary[] = [];
    for (let i = 0; i + 1 < namesArr.length; i += 2) {
        const name = namesArr[i];
        if (typeof name !== 'string') continue;
        const fsEntry = namesArr[i + 1];
        const fileSpec = fsEntry !== undefined && isRef(fsEntry) ? reader.resolve(fsEntry) : fsEntry;
        if (!isDict(fileSpec)) {
            out.push({ name });
            continue;
        }
        const summary: { -readonly [K in keyof AttachmentSummary]: AttachmentSummary[K] } = { name };
        const rel = fileSpec.get('AFRelationship');
        if (rel !== undefined && isName(rel)) summary.relationship = rel.value;
        const desc = fileSpec.get('Desc');
        if (typeof desc === 'string') summary.description = desc;
        const efEntry = fileSpec.get('EF');
        const ef = efEntry !== undefined && isRef(efEntry) ? reader.resolve(efEntry) : efEntry;
        if (ef !== undefined && isDict(ef)) {
            const fEntry = ef.get('F') ?? ef.get('UF');
            const fStream = fEntry !== undefined && isRef(fEntry) ? reader.resolve(fEntry) : fEntry;
            if (fStream !== undefined && isStream(fStream)) {
                const len = fStream.dict.get('Length');
                if (typeof len === 'number') summary.sizeBytes = len;
                const params = fStream.dict.get('Params');
                const paramsDict = params !== undefined && isRef(params) ? reader.resolve(params) : params;
                if (paramsDict !== undefined && isDict(paramsDict)) {
                    const sz = paramsDict.get('Size');
                    if (typeof sz === 'number') summary.sizeBytes = sz;
                }
                const subtype = fStream.dict.get('Subtype');
                if (subtype !== undefined && isName(subtype)) summary.mimeType = subtype.value.replace(/#2F/gi, '/');
            }
        }
        out.push(summary);
    }
    return out;
}

function findAcroFormDict(reader: PdfReader): PdfDict | null {
    const catalog = reader.getCatalog();
    const af = catalog.get('AcroForm');
    if (af === undefined) return null;
    const resolved = isRef(af) ? reader.resolve(af) : af;
    return isDict(resolved) ? resolved : null;
}

/** Best-effort PDF/A claim detection by scanning the XMP metadata stream for `pdfaid:part`. */
function detectPdfAClaim(reader: PdfReader): string | null {
    const catalog = reader.getCatalog();
    const meta = catalog.get('Metadata');
    const resolved = meta !== undefined && isRef(meta) ? reader.resolve(meta) : meta;
    if (resolved === undefined || !isStream(resolved)) return null;
    let xml: string;
    /* v8 ignore start - decodeStream is robust on pdfnative-produced XMP; defensive guard only. */
    try {
        const decoded = reader.decodeStream(resolved);
        xml = Buffer.from(decoded).toString('utf8');
    } catch {
        return null;
    }
    /* v8 ignore stop */
    const partMatch = /pdfaid:part\s*=\s*"(\d+)"|<pdfaid:part>\s*(\d+)\s*<\/pdfaid:part>/.exec(xml);
    const confMatch = /pdfaid:conformance\s*=\s*"([A-Z])"|<pdfaid:conformance>\s*([A-Z])\s*<\/pdfaid:conformance>/.exec(xml);
    if (partMatch === null) return null;
    const part = (partMatch[1] ?? partMatch[2]) as string;
    const conf = confMatch === null ? '' : ((confMatch[1] ?? confMatch[2]) as string);
    return `${part}${conf}`;
}

function readPerPage(reader: PdfReader): InspectPdfResult['perPage'] {
    const pages = reader.getPages();
    return pages.map((page, index) => {
        const mediaBox = page.get('MediaBox');
        const arr = mediaBox === undefined ? undefined : isRef(mediaBox) ? reader.resolve(mediaBox) : mediaBox;
        let width = 0;
        let height = 0;
        if (arr !== undefined && isArray(arr) && arr.length === 4) {
            const x0 = typeof arr[0] === 'number' ? arr[0] : 0;
            const y0 = typeof arr[1] === 'number' ? arr[1] : 0;
            const x1 = typeof arr[2] === 'number' ? arr[2] : 0;
            const y1 = typeof arr[3] === 'number' ? arr[3] : 0;
            width = Math.abs(x1 - x0);
            height = Math.abs(y1 - y0);
        }
        return { index, width, height };
    });
}

export async function inspectPdf(rawInput: unknown): Promise<InspectPdfResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { pdfBase64, pages: includePages, check } = parsed.data;

    const bytes = decodeBase64(pdfBase64);
    let reader: PdfReader;
    try {
        reader = openPdf(bytes);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('PDF_PARSE_FAILED', `Failed to parse PDF: ${message}`);
    }

    const version = extractVersion(bytes);
    const pageCount = reader.pageCount;
    const encryption = detectEncryption(reader);
    const pdfA = detectPdfAClaim(reader);
    const info = readInfoDict(reader);
    const { count: signatureCount, hasPlaceholder } = inspectSignatures(reader);
    const attachments = readAttachments(reader);

    const result: {
        -readonly [K in keyof InspectPdfResult]: InspectPdfResult[K];
    } = {
        version,
        pageCount,
        encryption,
        pdfA,
        signatureCount,
        hasSignaturePlaceholder: hasPlaceholder,
        attachments,
        info,
    };

    if (includePages) {
        result.perPage = readPerPage(reader);
    }

    if (check !== undefined && check.length > 0) {
        const checks: Record<CheckValue, boolean> = {
            pdfa: pdfA !== null,
            signed: signatureCount > 0 && !hasPlaceholder,
            encrypted: encryption !== 'none',
            placeholder: hasPlaceholder,
            attachments: attachments.length > 0,
        };
        const requested: Record<CheckValue, boolean> = {
            pdfa: false,
            signed: false,
            encrypted: false,
            placeholder: false,
            attachments: false,
        };
        for (const c of check) requested[c] = checks[c];
        result.checks = requested;
        result.checksPassed = check.every((c) => checks[c]);
    }

    return result;
}
