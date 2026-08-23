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
 *   - Optional `pages` flag returns per-page sizes (plus TrimBox/BleedBox/ArtBox/
 *     CropBox/UserUnit when present); optional `signatures` flag lists every
 *     signature field; `check` array AND-evaluates CI-style assertions
 *     (pdfa | signed | encrypted | placeholder | attachments | dss | docTimestamp |
 *     trapped) and returns a single pass/fail flag for downstream automation.
 *   - `dss`, `trapped` and `docTimestampCount` are presence-gated: emitted only
 *     when the document carries the feature.
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
    vriKeyForContents,
} from 'pdfnative';
import { z } from 'zod';
import { ToolError } from '../errors.js';
import { decodePdfBase64 } from '../base64.js';
import {
    collectEmbeddedFiles,
    collectSignatureWidgets,
    DSS_OUTPUT_SCHEMA,
    readDss,
    readPageBoxes,
    readTrapped,
    type DssSummary,
    type PageBoxes,
    type SignatureWidget,
} from '../pdf-introspection.js';
import { mapDecryptError, PASSWORD_INPUT_SCHEMA, PasswordSchema } from '../encryption.js';

export const INSPECT_PDF_NAME = 'inspect_pdf';

const RECT_SCHEMA = {
    type: 'array',
    minItems: 4,
    maxItems: 4,
    items: { type: 'number' },
} as const;
const DSS_SCHEMA = DSS_OUTPUT_SCHEMA;

const CHECK_VALUES = ['pdfa', 'signed', 'encrypted', 'placeholder', 'attachments', 'dss', 'docTimestamp', 'trapped'] as const;
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
        password: PASSWORD_INPUT_SCHEMA,
        pages: {
            type: 'boolean',
            default: false,
            description: 'When true, include per-page metadata in the response.',
        },
        signatures: {
            type: 'boolean',
            default: false,
            description:
                'When true, include a signatures[] array describing every signature field (field name, SubFilter, document-timestamp flag, placeholder flag, ByteRange, /Contents length, /VRI key). Off by default to keep responses compact.',
        },
        check: {
            type: 'array',
            description:
                "Optional CI assertions. The result.checksPassed flag is true only when every requested check holds (e.g. ['pdfa','signed']). 'dss' asserts a /DSS Document Security Store, 'docTimestamp' at least one /DocTimeStamp, 'trapped' an /Info /Trapped entry.",
            maxItems: 8,
            items: { type: 'string', enum: [...CHECK_VALUES] },
        },
        verbosity: {
            type: 'string',
            enum: ['summary', 'full'],
            default: 'full',
            description:
                "Response verbosity. 'full' (default) returns every field; 'summary' returns a token-frugal scalar subset (version, pageCount, encryption, pdfA, signatureCount, hasSignaturePlaceholder, attachmentCount) — drops the attachments[], info, perPage and signatures[] arrays and the dss / trapped / docTimestampCount extras.",
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
        encryptionInfo: {
            type: 'object',
            additionalProperties: false,
            description:
                'Precise Standard Security Handler details (pdfnative v1.6.0), present only when the document is encrypted and was opened successfully. Objects served by the reader are already decrypted.',
            required: ['algorithm', 'revision', 'authenticatedAs'],
            properties: {
                algorithm: { type: 'string', enum: ['rc4-40', 'rc4-128', 'aes128', 'aes256'] },
                revision: { type: 'integer', description: 'Standard Security Handler revision (2, 3, 4 or 6).' },
                authenticatedAs: { type: 'string', enum: ['user', 'owner'], description: 'Which supplied password opened the document.' },
            },
        },
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
                additionalProperties: false,
                required: ['index', 'width', 'height'],
                properties: {
                    index: { type: 'integer' },
                    width: { type: 'number' },
                    height: { type: 'number' },
                    trimBox: { ...RECT_SCHEMA, description: '/TrimBox [llx lly urx ury], present only when set on the page.' },
                    bleedBox: { ...RECT_SCHEMA, description: '/BleedBox, present only when set on the page.' },
                    artBox: { ...RECT_SCHEMA, description: '/ArtBox, present only when set on the page.' },
                    cropBox: { ...RECT_SCHEMA, description: '/CropBox, present only when set on the page.' },
                    userUnit: { type: 'number', description: '/UserUnit (PDF 1.6+), present only when set on the page.' },
                },
            },
        },
        signatures: {
            type: 'array',
            description: 'Signature fields (opt-in via the `signatures` input). Document timestamps are listed inline with isDocTimestamp=true.',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['fieldName', 'subFilter', 'isDocTimestamp', 'isPlaceholder', 'byteRange', 'contentsLength', 'vriKey'],
                properties: {
                    fieldName: { type: ['string', 'null'] },
                    subFilter: { type: ['string', 'null'], description: 'e.g. adbe.pkcs7.detached, ETSI.CAdES.detached, ETSI.RFC3161.' },
                    isDocTimestamp: { type: 'boolean' },
                    isPlaceholder: { type: 'boolean', description: 'True for an unsigned placeholder (all-zero /ByteRange or /Contents).' },
                    byteRange: { type: 'array', items: { type: 'integer', minimum: 0 }, description: '/ByteRange, or [] when absent.' },
                    contentsLength: { type: 'integer', minimum: 0, description: 'Decoded /Contents length in bytes (including zero padding).' },
                    vriKey: { type: ['string', 'null'], description: 'Uppercase-hex SHA-1 of /Contents — the /DSS /VRI key. Null for placeholders.' },
                },
            },
        },
        dss: {
            ...DSS_SCHEMA,
            description: 'Document Security Store summary (ISO 32000-2 §12.8.4.3), present only when the catalog has a /DSS.',
        },
        trapped: {
            type: 'string',
            enum: ['True', 'False', 'Unknown'],
            description: '/Info /Trapped flag, present only when the document carries one.',
        },
        docTimestampCount: {
            type: 'integer',
            minimum: 1,
            description: 'Number of /DocTimeStamp signature fields, present only when at least one exists.',
        },
        pageLabels: {
            type: 'array',
            description:
                'Logical page-numbering ranges from the /PageLabels number tree (ISO 32000-1 §12.4.2), or absent when the document has none. Each range gives the 0-based first page, numbering style, optional prefix and start value.',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['startPage'],
                properties: {
                    startPage: { type: 'integer', minimum: 0 },
                    style: { type: 'string', enum: ['decimal', 'roman', 'Roman', 'alpha', 'Alpha', 'none'] },
                    prefix: { type: 'string' },
                    start: { type: 'integer' },
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
    password: PasswordSchema.optional(),
    pages: z.boolean().default(false),
    signatures: z.boolean().default(false),
    check: z.array(z.enum(CHECK_VALUES)).max(8).optional(),
    verbosity: z.enum(['summary', 'full']).optional(),
    fields: z.array(z.string().min(1)).max(16).optional(),
});

export interface EncryptionInfo {
    readonly algorithm: 'rc4-40' | 'rc4-128' | 'aes128' | 'aes256';
    readonly revision: number;
    readonly authenticatedAs: 'user' | 'owner';
}

export interface AttachmentSummary {
    readonly name: string;
    readonly sizeBytes?: number;
    readonly mimeType?: string;
    readonly relationship?: string;
    readonly description?: string;
}

export interface SignatureSummary {
    readonly fieldName: string | null;
    readonly subFilter: string | null;
    readonly isDocTimestamp: boolean;
    readonly isPlaceholder: boolean;
    readonly byteRange: readonly number[];
    readonly contentsLength: number;
    readonly vriKey: string | null;
}

export interface InspectPdfResult {
    readonly version: string;
    readonly pageCount: number;
    readonly encryption: 'none' | 'aes-128' | 'aes-256' | 'rc4' | 'unknown';
    readonly encryptionInfo?: EncryptionInfo;
    readonly pdfA: string | null;
    readonly signatureCount: number;
    readonly hasSignaturePlaceholder: boolean;
    readonly attachments: readonly AttachmentSummary[];
    readonly info: Readonly<Record<string, string>>;
    readonly perPage?: ReadonlyArray<{ readonly index: number; readonly width: number; readonly height: number } & PageBoxes>;
    /** Opt-in via `signatures: true`. */
    readonly signatures?: readonly SignatureSummary[];
    /** Present only when the catalog carries a /DSS. */
    readonly dss?: DssSummary;
    /** Present only when /Info carries /Trapped. */
    readonly trapped?: 'True' | 'False' | 'Unknown';
    /** Present only when at least one /DocTimeStamp field exists. */
    readonly docTimestampCount?: number;
    readonly pageLabels?: ReadonlyArray<{
        readonly startPage: number;
        readonly style?: 'decimal' | 'roman' | 'Roman' | 'alpha' | 'Alpha' | 'none';
        readonly prefix?: string;
        readonly start?: number;
    }>;
    readonly checks?: Readonly<Record<CheckValue, boolean>>;
    readonly checksPassed?: boolean;
}

function decodeBase64(value: string): Uint8Array {
    return decodePdfBase64(value, 'pdfBase64');
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

/** Map pdfnative's precise `reader.encryption` cipher to the scalar `encryption` field. */
function scalarFromEncryptionInfo(info: EncryptionInfo): InspectPdfResult['encryption'] {
    switch (info.algorithm) {
        case 'aes256':
            return 'aes-256';
        case 'aes128':
            return 'aes-128';
        /* v8 ignore next 3 -- rc4 requires a legacy encrypted fixture; classification is covered by classifyEncryption unit tests. */
        default:
            return 'rc4';
    }
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
    // Metadata-only view of the shared embedded-file collector (no payload bytes).
    return collectEmbeddedFiles(reader).map(({ data: _data, ...summary }) => summary);
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

/** Read the /PageLabels number tree (pdfnative v1.5.0), or undefined when absent. */
function readPageLabels(reader: PdfReader): InspectPdfResult['pageLabels'] {
    const labels = reader.getPageLabels();
    if (labels === null || labels.length === 0) return undefined;
    return labels.map((r) => ({
        startPage: r.startPage,
        ...(r.style !== undefined ? { style: r.style } : {}),
        ...(r.prefix !== undefined ? { prefix: r.prefix } : {}),
        ...(r.start !== undefined ? { start: r.start } : {}),
    }));
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
        // Page boxes / UserUnit are spread last and only carry the keys present on the page,
        // so the default { index, width, height } shape is unchanged for ordinary documents.
        return { index, width, height, ...readPageBoxes(page, reader) };
    });
}

function summariseSignatures(widgets: readonly SignatureWidget[]): SignatureSummary[] {
    return widgets.map((w) => ({
        fieldName: w.fieldName,
        subFilter: w.subFilter,
        isDocTimestamp: w.isDocTimestamp,
        isPlaceholder: w.isPlaceholder,
        byteRange: w.byteRange === null ? [] : [...w.byteRange],
        contentsLength: w.contentsBytes.length,
        vriKey: w.isPlaceholder ? null : vriKeyForContents(w.contentsBytes),
    }));
}

export async function inspectPdf(rawInput: unknown): Promise<InspectPdfResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { pdfBase64, password, pages: includePages, signatures: includeSignatures, check } = parsed.data;

    const bytes = decodeBase64(pdfBase64);
    let reader: PdfReader;
    try {
        reader = openPdf(bytes, password !== undefined ? { password } : undefined);
    } catch (err) {
        mapDecryptError(err, password !== undefined);
    }

    const version = extractVersion(bytes);
    const pageCount = reader.pageCount;
    const encryptionInfo = reader.encryption ?? undefined;
    const encryption = encryptionInfo !== null && encryptionInfo !== undefined
        ? scalarFromEncryptionInfo(encryptionInfo)
        : detectEncryption(reader);
    const pdfA = detectPdfAClaim(reader);
    const info = readInfoDict(reader);
    const { count: signatureCount, hasPlaceholder } = inspectSignatures(reader);
    const attachments = readAttachments(reader);
    const pageLabels = readPageLabels(reader);
    const dss = readDss(reader);
    const trapped = readTrapped(reader.getInfo());
    const widgets = collectSignatureWidgets(reader);
    const docTimestampCount = widgets.filter((w) => w.isDocTimestamp).length;

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

    if (encryptionInfo !== null && encryptionInfo !== undefined) {
        result.encryptionInfo = encryptionInfo;
    }

    if (pageLabels !== undefined) {
        result.pageLabels = pageLabels;
    }

    if (includePages) {
        result.perPage = readPerPage(reader);
    }

    if (includeSignatures) {
        result.signatures = summariseSignatures(widgets);
    }

    // Presence-gated fields (same precedent as pageLabels / encryptionInfo): emitted only
    // when the document actually carries the feature, so default output stays byte-identical.
    if (dss !== null) {
        result.dss = dss;
    }
    if (trapped !== null) {
        result.trapped = trapped;
    }
    if (docTimestampCount > 0) {
        result.docTimestampCount = docTimestampCount;
    }

    if (check !== undefined && check.length > 0) {
        const checks: Record<CheckValue, boolean> = {
            pdfa: pdfA !== null,
            signed: signatureCount > 0 && !hasPlaceholder,
            encrypted: encryption !== 'none',
            placeholder: hasPlaceholder,
            attachments: attachments.length > 0,
            dss: dss !== null,
            docTimestamp: docTimestampCount > 0,
            trapped: trapped !== null,
        };
        const requested: Record<CheckValue, boolean> = {
            pdfa: false,
            signed: false,
            encrypted: false,
            placeholder: false,
            attachments: false,
            dss: false,
            docTimestamp: false,
            trapped: false,
        };
        for (const c of check) requested[c] = checks[c];
        result.checks = requested;
        result.checksPassed = check.every((c) => checks[c]);
    }

    return result;
}
