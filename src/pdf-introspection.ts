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
