/**
 * Shared error mapping for the pdfnative v1.4.0 page-tree manipulation API
 * (`mergePdfs` / `splitPdf` / `extractPages`).
 *
 * pdfnative throws plain `Error`s for these operations; this helper translates
 * them into stable {@link ToolError} codes so AI clients get a consistent,
 * actionable `code` to branch on (see AGENTS.md §6 error reference).
 */
import { ToolError } from './errors.js';

/**
 * Maps a thrown page-tree error to a {@link ToolError} with a stable code.
 * Always throws — declared `never` so callers can treat the surrounding
 * `try`/`catch` as exhaustive.
 *
 * - Encrypted source           → `ENCRYPTED_SOURCE`
 * - Output / size-cap exceeded  → `OUTPUT_TOO_LARGE`
 * - Anything else (malformed)   → `PDF_PARSE_FAILED`
 */
export function mapPageTreeError(err: unknown): never {
    const message = err instanceof Error ? err.message : String(err);
    if (/encrypt/i.test(message)) {
        throw new ToolError(
            'ENCRYPTED_SOURCE',
            `The page-tree operation does not support encrypted PDFs. Decrypt the source outside the server first. (${message})`,
        );
    }
    if (/\b(exceed|exceeds|too large|maxoutputsize|output size)\b/i.test(message)) {
        throw new ToolError('OUTPUT_TOO_LARGE', message);
    }
    throw new ToolError('PDF_PARSE_FAILED', `Failed to process the source PDF(s): ${message}`);
}
