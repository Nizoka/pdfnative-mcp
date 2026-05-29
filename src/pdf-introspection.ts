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
    type ParsedDict as PdfDict,
    type PdfReader,
} from 'pdfnative';

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
    readonly subFilter: string | null;
    readonly filter: string | null;
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

/** Enumerate every `/FT /Sig` widget, materialising its `/V` signature dict. */
export function collectSignatureWidgets(reader: PdfReader): SignatureWidget[] {
    const af = getAcroForm(reader);
    if (af === null) return [];
    const fields = af.get('Fields');
    if (fields === undefined) return [];
    const arr = isRef(fields) ? reader.resolve(fields) : fields;
    if (!isArray(arr)) return [];
    const widgets: SignatureWidget[] = [];
    for (const entry of arr) {
        const fieldDict = isRef(entry) ? reader.resolve(entry) : entry;
        if (!isDict(fieldDict)) continue;
        const ft = fieldDict.get('FT');
        if (!isName(ft) || ft.value !== 'Sig') continue;
        const vRaw = fieldDict.get('V');
        const v = vRaw !== undefined && isRef(vRaw) ? reader.resolve(vRaw) : vRaw;
        const sigDict = v !== undefined && isDict(v) ? v : null;
        const tName = fieldDict.get('T');
        widgets.push({
            fieldName: stringOrNull(tName),
            byteRange: sigDict ? byteRangeOrNull(sigDict.get('ByteRange')) : null,
            contentsRaw: sigDict ? stringOrNull(sigDict.get('Contents')) : null,
            subFilter: sigDict ? nameValueOrNull(sigDict.get('SubFilter')) : null,
            filter: sigDict ? nameValueOrNull(sigDict.get('Filter')) : null,
            signingTimeRaw: sigDict ? stringOrNull(sigDict.get('M')) : null,
            reason: sigDict ? stringOrNull(sigDict.get('Reason')) : null,
            signerName: sigDict ? stringOrNull(sigDict.get('Name')) : null,
            location: sigDict ? stringOrNull(sigDict.get('Location')) : null,
            contactInfo: sigDict ? stringOrNull(sigDict.get('ContactInfo')) : null,
        });
    }
    return widgets;
}
