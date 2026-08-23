/**
 * Shared error mapping for the pdfnative v1.4.0 page-tree manipulation API
 * (`mergePdfs` / `splitPdf` / `extractPages`).
 *
 * pdfnative throws plain `Error`s for these operations; this helper translates
 * them into stable {@link ToolError} codes so AI clients get a consistent,
 * actionable `code` to branch on (see AGENTS.md §6 error reference).
 */
import { PdfEncryptionUnsupportedError, PdfPasswordError } from 'pdfnative';

import { ToolError } from './errors.js';
import { mapDecryptError } from './encryption.js';

/**
 * Maps a thrown page-tree error to a {@link ToolError} with a stable code.
 * Always throws — declared `never` so callers can treat the surrounding
 * `try`/`catch` as exhaustive.
 *
 * Since pdfnative v1.6.0 the page-tree API ingests encrypted sources (via a
 * `password`) and can re-encrypt its output, so encryption failures are routed
 * through the shared decrypt mapper for precise codes:
 *
 * - Missing source password     → `PASSWORD_REQUIRED`
 * - Wrong source password       → `PASSWORD_INVALID`
 * - Unsupported handler / CSPRNG → `ENCRYPTION_UNSUPPORTED` / `ENCRYPTION_ERROR`
 * - Output / size-cap exceeded   → `OUTPUT_TOO_LARGE`
 * - Page index / range errors   → `VALIDATION_ERROR` (pages are 0-based)
 * - Anything else (malformed)    → `PDF_PARSE_FAILED`
 *
 * @param hadPassword whether the caller supplied a source password (informs the
 *                    PASSWORD_REQUIRED vs PASSWORD_INVALID distinction).
 */
export function mapPageTreeError(err: unknown, hadPassword = false): never {
    if (err instanceof PdfPasswordError || err instanceof PdfEncryptionUnsupportedError) {
        mapDecryptError(err, hadPassword);
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/\b(exceed|exceeds|too large|maxoutputsize|output size)\b/i.test(message)) {
        throw new ToolError('OUTPUT_TOO_LARGE', message);
    }
    if (/csprng|getRandomValues|web ?crypto/i.test(message)) {
        mapDecryptError(err, hadPassword);
    }
    if (/page index .* out of range|range \[.*\] invalid for .*-page document|out of range \(0-/i.test(message)) {
        throw new ToolError('VALIDATION_ERROR', `${message}. Page indices and ranges are 0-based (first page = 0); check pageCount with inspect_pdf.`);
    }
    throw new ToolError('PDF_PARSE_FAILED', `Failed to process the source PDF(s): ${message}`);
}
