/**
 * Lightweight helpers for detecting whether a PDF already contains a
 * signature placeholder (`/FT /Sig` widget reachable from `/AcroForm`).
 *
 * Used by:
 *   - `sign_pdf` (Phase 3) to decide whether to call `addSignaturePlaceholder`
 *     before signing when `autoInjectPlaceholder` is enabled.
 *   - `inspect_pdf` (Phase 6) to expose `hasSignaturePlaceholder` to AI agents
 *     so they can pick between "sign" and "re-sign" workflows.
 *
 * Implementation goes through pdfnative's hardened `openPdf()` reader so that
 * CWE-674 / CWE-400 mitigations are inherited automatically.
 */
import {
    isArray,
    isDict,
    isName,
    isRef,
    isStream,
    type ParsedDict as PdfDict,
    type PdfReader,
    type PdfValue,
} from 'pdfnative';
import { throwIfInflateCapError } from './inflate-cap.js';

/** Resolve the `/AcroForm` dictionary, or `null` when absent / malformed. */
export function getAcroForm(reader: PdfReader): PdfDict | null {
    const catalog = reader.getCatalog();
    const af = catalog.get('AcroForm');
    if (af === undefined) return null;
    const resolved = isRef(af) ? reader.resolve(af) : af;
    return isDict(resolved) ? resolved : null;
}

/** Count signature widgets (`/FT /Sig`) reachable from the AcroForm fields. */
export function countSignatureWidgets(reader: PdfReader): number {
    const af = getAcroForm(reader);
    if (af === null) return 0;
    const fields = af.get('Fields');
    if (fields === undefined) return 0;
    const arr = isRef(fields) ? reader.resolve(fields) : fields;
    if (!isArray(arr)) return 0;
    let count = 0;
    for (const entry of arr) {
        const fieldDict = isRef(entry) ? reader.resolve(entry) : entry;
        if (!isDict(fieldDict)) continue;
        const ft = fieldDict.get('FT');
        if (isName(ft) && ft.value === 'Sig') count += 1;
    }
    return count;
}

/** True when the PDF already exposes at least one signature widget. */
export function hasSignaturePlaceholder(reader: PdfReader): boolean {
    return countSignatureWidgets(reader) > 0;
}

/**
 * Materialised view of a single signature widget useful to `verify_pdf`.
 * `contentsRaw` is the literal byte string parsed from `/Contents <...>` (one
 * JS-string char per byte — pdfnative stores PDF strings as Latin-1) and is
 * converted to a `Uint8Array` of the underlying CMS SignedData by
 * `signatureWidgetContentsBytes()`.
 */
export interface SignatureWidget {
    readonly fieldName: string | null;
    readonly byteRange: readonly [number, number, number, number] | null;
    readonly contentsRaw: string | null;
    /** Decoded `/Contents` bytes (empty when the widget has no `/Contents`). */
    readonly contentsBytes: Uint8Array;
    readonly subFilter: string | null;
    readonly filter: string | null;
    /** `/Type /DocTimeStamp` or `/SubFilter /ETSI.RFC3161` (PAdES document timestamp). */
    readonly isDocTimestamp: boolean;
    /** Unsigned placeholder: `/ByteRange` all zero or `/Contents` all zero bytes. */
    readonly isPlaceholder: boolean;
    readonly signingTimeRaw: string | null;
    readonly reason: string | null;
    readonly signerName: string | null;
    readonly location: string | null;
    readonly contactInfo: string | null;
}

/** Decode a `/Contents` literal byte-string into the underlying byte array. */
export function contentsToBytes(raw: string): Uint8Array {
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        out[i] = raw.charCodeAt(i) & 0xff;
    }
    return out;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function nameValueOrNull(value: unknown): string | null {
    if (
        typeof value === 'object' &&
        value !== null &&
        'type' in value &&
        (value as { type: unknown }).type === 'name' &&
        'value' in value &&
        typeof (value as { value: unknown }).value === 'string'
    ) {
        return (value as { value: string }).value;
    }
    return null;
}

function byteRangeOrNull(value: unknown): readonly [number, number, number, number] | null {
    if (!Array.isArray(value) || value.length !== 4) return null;
    const nums: number[] = [];
    for (const entry of value) {
        if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0) return null;
        nums.push(entry);
    }
    return [nums[0]!, nums[1]!, nums[2]!, nums[3]!] as const;
}

function isAllZeroBytes(bytes: Uint8Array): boolean {
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] !== 0) return false;
    }
    return true;
}

/**
 * Enumerate every `/FT /Sig` widget (recursing into `/Kids`), materialising
 * its `/V` signature dict. Document timestamps (`/Type /DocTimeStamp`) are
 * ordinary signature fields in the AcroForm and are returned inline, flagged
 * via `isDocTimestamp`.
 */
export function collectSignatureWidgets(reader: PdfReader): SignatureWidget[] {
    const af = getAcroForm(reader);
    if (af === null) return [];
    const fields = af.get('Fields');
    if (fields === undefined) return [];
    const arr = isRef(fields) ? reader.resolve(fields) : fields;
    if (!isArray(arr)) return [];
    const widgets: SignatureWidget[] = [];
    const seen = new Set<unknown>();
    const visit = (entry: PdfValue, depth: number): void => {
        if (depth > 32) return;
        const fieldDict = isRef(entry) ? reader.resolve(entry) : entry;
        if (!isDict(fieldDict) || seen.has(fieldDict)) return;
        seen.add(fieldDict);
        const ft = fieldDict.get('FT');
        if (isName(ft) && ft.value === 'Sig') {
            const vRaw = fieldDict.get('V');
            const v = vRaw !== undefined && isRef(vRaw) ? reader.resolve(vRaw) : vRaw;
            const sigDict = v !== undefined && isDict(v) ? v : null;
            const tName = fieldDict.get('T');
            const byteRange = sigDict ? byteRangeOrNull(sigDict.get('ByteRange')) : null;
            const contentsRaw = sigDict ? stringOrNull(sigDict.get('Contents')) : null;
            const contentsBytes = contentsRaw === null ? new Uint8Array(0) : contentsToBytes(contentsRaw);
            const subFilter = sigDict ? nameValueOrNull(sigDict.get('SubFilter')) : null;
            const type = sigDict ? nameValueOrNull(sigDict.get('Type')) : null;
            const byteRangeAllZero = byteRange !== null && byteRange.every((n) => n === 0);
            widgets.push({
                fieldName: stringOrNull(tName),
                byteRange,
                contentsRaw,
                contentsBytes,
                subFilter,
                filter: sigDict ? nameValueOrNull(sigDict.get('Filter')) : null,
                isDocTimestamp: type === 'DocTimeStamp' || subFilter === 'ETSI.RFC3161',
                isPlaceholder: sigDict === null || byteRangeAllZero || contentsRaw === null || isAllZeroBytes(contentsBytes),
                signingTimeRaw: sigDict ? stringOrNull(sigDict.get('M')) : null,
                reason: sigDict ? stringOrNull(sigDict.get('Reason')) : null,
                signerName: sigDict ? stringOrNull(sigDict.get('Name')) : null,
                location: sigDict ? stringOrNull(sigDict.get('Location')) : null,
                contactInfo: sigDict ? stringOrNull(sigDict.get('ContactInfo')) : null,
            });
        }
        const kidsRaw = fieldDict.get('Kids');
        const kids = kidsRaw !== undefined && isRef(kidsRaw) ? reader.resolve(kidsRaw) : kidsRaw;
        if (kids !== undefined && isArray(kids)) {
            for (const kid of kids) visit(kid, depth + 1);
        }
    };
    for (const entry of arr) visit(entry, 0);
    return widgets;
}

/** Summary of the Document Security Store (`/DSS`, ISO 32000-2 §12.8.4.3). */
export interface DssSummary {
    readonly certs: number;
    readonly ocsps: number;
    readonly crls: number;
    /** Keys of the `/VRI` dictionary (uppercase hex SHA-1 of each signature's `/Contents`). */
    readonly vriKeys: readonly string[];
}

/** JSON Schema for {@link DssSummary} — shared by `inspect_pdf` and `verify_pdf` output schemas. */
export const DSS_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['certs', 'ocsps', 'crls', 'vriKeys'],
    properties: {
        certs: { type: 'integer', minimum: 0, description: 'Number of /DSS /Certs entries.' },
        ocsps: { type: 'integer', minimum: 0, description: 'Number of /DSS /OCSPs entries.' },
        crls: { type: 'integer', minimum: 0, description: 'Number of /DSS /CRLs entries.' },
        vriKeys: {
            type: 'array',
            items: { type: 'string' },
            description: '/VRI dictionary keys (uppercase-hex SHA-1 of each covered signature /Contents).',
        },
    },
} as const;

/** Decoded revocation material carried by the `/DSS`. */
export interface DssMaterial extends DssSummary {
    readonly ocspDer: readonly Uint8Array[];
    readonly crlDer: readonly Uint8Array[];
}

function resolveDssDict(reader: PdfReader): PdfDict | null {
    const dssRaw = reader.getCatalog().get('DSS');
    if (dssRaw === undefined) return null;
    const dss = isRef(dssRaw) ? reader.resolve(dssRaw) : dssRaw;
    return isDict(dss) ? dss : null;
}

function dssStreams(reader: PdfReader, dss: PdfDict, key: string): Uint8Array[] {
    const raw = dss.get(key);
    if (raw === undefined) return [];
    const arr = isRef(raw) ? reader.resolve(raw) : raw;
    if (!isArray(arr)) return [];
    const out: Uint8Array[] = [];
    for (const entry of arr) {
        const stream = isRef(entry) ? reader.resolve(entry) : entry;
        if (!isStream(stream)) continue;
        try {
            out.push(reader.decodeStream(stream));
            /* v8 ignore next 3 -- defensive: engine-written DSS streams always decode. */
        } catch {
            // skip undecodable entries
        }
    }
    return out;
}

function dssArrayLength(reader: PdfReader, dss: PdfDict, key: string): number {
    const raw = dss.get(key);
    if (raw === undefined) return 0;
    const arr = isRef(raw) ? reader.resolve(raw) : raw;
    return isArray(arr) ? arr.length : 0;
}

function dssVriKeys(reader: PdfReader, dss: PdfDict): string[] {
    const raw = dss.get('VRI');
    if (raw === undefined) return [];
    const vri = isRef(raw) ? reader.resolve(raw) : raw;
    if (!isDict(vri)) return [];
    return [...vri.keys()];
}

/** Read the catalog `/DSS` summary, or `null` when the document has none. */
export function readDss(reader: PdfReader): DssSummary | null {
    const dss = resolveDssDict(reader);
    if (dss === null) return null;
    return {
        certs: dssArrayLength(reader, dss, 'Certs'),
        ocsps: dssArrayLength(reader, dss, 'OCSPs'),
        crls: dssArrayLength(reader, dss, 'CRLs'),
        vriKeys: dssVriKeys(reader, dss),
    };
}

/** Read the catalog `/DSS` with its OCSP / CRL streams decoded, or `null` when absent. */
export function readDssMaterial(reader: PdfReader): DssMaterial | null {
    const dss = resolveDssDict(reader);
    if (dss === null) return null;
    const ocspDer = dssStreams(reader, dss, 'OCSPs');
    const crlDer = dssStreams(reader, dss, 'CRLs');
    return {
        certs: dssArrayLength(reader, dss, 'Certs'),
        ocsps: dssArrayLength(reader, dss, 'OCSPs'),
        crls: dssArrayLength(reader, dss, 'CRLs'),
        vriKeys: dssVriKeys(reader, dss),
        ocspDer,
        crlDer,
    };
}

/** Print-production page boxes and `/UserUnit` — only the keys present on the page. */
export interface PageBoxes {
    readonly trimBox?: readonly [number, number, number, number];
    readonly bleedBox?: readonly [number, number, number, number];
    readonly artBox?: readonly [number, number, number, number];
    readonly cropBox?: readonly [number, number, number, number];
    readonly userUnit?: number;
}

function rectOrUndefined(value: unknown): readonly [number, number, number, number] | undefined {
    if (!Array.isArray(value) || value.length !== 4) return undefined;
    const nums: number[] = [];
    for (const entry of value) {
        if (typeof entry !== 'number' || !Number.isFinite(entry)) return undefined;
        nums.push(entry);
    }
    return [nums[0]!, nums[1]!, nums[2]!, nums[3]!] as const;
}

/** Read `/TrimBox`, `/BleedBox`, `/ArtBox`, `/CropBox` and `/UserUnit` from a page dictionary. */
export function readPageBoxes(pageDict: PdfDict, reader?: PdfReader): PageBoxes {
    const out: { -readonly [K in keyof PageBoxes]: PageBoxes[K] } = {};
    const resolveEntry = (key: string): unknown => {
        const raw = pageDict.get(key);
        if (raw === undefined) return undefined;
        return reader !== undefined && isRef(raw) ? reader.resolve(raw) : raw;
    };
    const trimBox = rectOrUndefined(resolveEntry('TrimBox'));
    if (trimBox !== undefined) out.trimBox = trimBox;
    const bleedBox = rectOrUndefined(resolveEntry('BleedBox'));
    if (bleedBox !== undefined) out.bleedBox = bleedBox;
    const artBox = rectOrUndefined(resolveEntry('ArtBox'));
    if (artBox !== undefined) out.artBox = artBox;
    const cropBox = rectOrUndefined(resolveEntry('CropBox'));
    if (cropBox !== undefined) out.cropBox = cropBox;
    const userUnit = resolveEntry('UserUnit');
    if (typeof userUnit === 'number' && Number.isFinite(userUnit)) out.userUnit = userUnit;
    return out;
}

/** Read `/Info /Trapped` (a name: True | False | Unknown), or `null` when absent / malformed. */
export function readTrapped(infoDict: PdfDict | null): 'True' | 'False' | 'Unknown' | null {
    if (infoDict === null) return null;
    const value = nameValueOrNull(infoDict.get('Trapped'));
    if (value === 'True' || value === 'False' || value === 'Unknown') return value;
    return null;
}

/**
 * Metadata for a single embedded file (`/EmbeddedFiles` filespec), optionally
 * carrying the decoded payload bytes.
 *
 * Shared by `inspect_pdf` (metadata only) and `extract_attachments`
 * (`includeData: true`). Walking the catalog `/Names → /EmbeddedFiles → Names[]`
 * tree once keeps the two tools byte-for-byte consistent.
 */
export interface EmbeddedFile {
    readonly name: string;
    readonly sizeBytes?: number;
    readonly mimeType?: string;
    readonly relationship?: string;
    readonly description?: string;
    /** Decoded file bytes — present only when `collectEmbeddedFiles` is called with `includeData: true`. */
    readonly data?: Uint8Array;
}

/**
 * Enumerate every embedded file reachable from the catalog name tree
 * (`/Names → /EmbeddedFiles → Names[]`). When `includeData` is true the
 * `/EmbeddedFile` stream is decoded via the hardened reader and returned as
 * `data`; otherwise only metadata is collected.
 */
export function collectEmbeddedFiles(
    reader: PdfReader,
    opts?: { readonly includeData?: boolean },
): EmbeddedFile[] {
    const includeData = opts?.includeData ?? false;
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
    const out: EmbeddedFile[] = [];
    for (let i = 0; i + 1 < namesArr.length; i += 2) {
        const name = namesArr[i];
        if (typeof name !== 'string') continue;
        const fsEntry = namesArr[i + 1];
        const fileSpec = fsEntry !== undefined && isRef(fsEntry) ? reader.resolve(fsEntry) : fsEntry;
        if (!isDict(fileSpec)) {
            out.push({ name });
            continue;
        }
        const file: { -readonly [K in keyof EmbeddedFile]: EmbeddedFile[K] } = { name };
        const rel = fileSpec.get('AFRelationship');
        if (rel !== undefined && isName(rel)) file.relationship = rel.value;
        const desc = fileSpec.get('Desc');
        if (typeof desc === 'string') file.description = desc;
        const efEntry = fileSpec.get('EF');
        const ef = efEntry !== undefined && isRef(efEntry) ? reader.resolve(efEntry) : efEntry;
        if (ef !== undefined && isDict(ef)) {
            const fEntry = ef.get('F') ?? ef.get('UF');
            const fStream = fEntry !== undefined && isRef(fEntry) ? reader.resolve(fEntry) : fEntry;
            if (fStream !== undefined && isStream(fStream)) {
                const len = fStream.dict.get('Length');
                if (typeof len === 'number') file.sizeBytes = len;
                const params = fStream.dict.get('Params');
                const paramsDict = params !== undefined && isRef(params) ? reader.resolve(params) : params;
                if (paramsDict !== undefined && isDict(paramsDict)) {
                    const sz = paramsDict.get('Size');
                    if (typeof sz === 'number') file.sizeBytes = sz;
                }
                const subtype = fStream.dict.get('Subtype');
                if (subtype !== undefined && isName(subtype)) file.mimeType = subtype.value.replace(/#2F/gi, '/');
                if (includeData) {
                    let decoded: Uint8Array;
                    try {
                        decoded = reader.decodeStream(fStream);
                    } catch (err) {
                        // An embedded file exceeding the operator's inflate cap gets a coded error
                        // naming the remedy; anything else keeps its original (engine) message.
                        throwIfInflateCapError(err);
                        throw err;
                    }
                    file.data = decoded;
                    // Prefer the actual decoded length when the dictionary lacked /Params /Size.
                    if (file.sizeBytes === undefined) file.sizeBytes = decoded.length;
                }
            }
        }
        out.push(file);
    }
    return out;
}
