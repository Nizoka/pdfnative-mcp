/**
 * Shared PDF-validity assertions for the test suites.
 *
 * Goes beyond the old "first five bytes are %PDF-" smoke check: it confirms the
 * trailer marker is present and, crucially, that pdfnative's hardened reader can
 * actually parse the document and report at least one page. This catches
 * truncated, structurally-broken, or zero-page output that a header-only check
 * would miss.
 */
import { openPdf } from 'pdfnative';
import { expect } from 'vitest';

const PDF_HEADER = '%PDF-';
const PDF_TRAILER = '%%EOF';

/** Coerce a base64 string or raw bytes into a `Uint8Array`. */
function toBytes(pdf: string | Uint8Array): Uint8Array {
    return typeof pdf === 'string' ? new Uint8Array(Buffer.from(pdf, 'base64')) : pdf;
}

/**
 * Assert that `pdf` (base64 string or raw bytes) is a structurally valid PDF:
 * correct header, an `%%EOF` trailer, parseable by `openPdf()`, and at least
 * `minPages` page(s). Returns the resolved page count for further assertions.
 */
export function assertValidPdf(pdf: string | Uint8Array, minPages = 1): number {
    const bytes = toBytes(pdf);

    // Header: %PDF- must be at the very start.
    const head = Buffer.from(bytes.slice(0, PDF_HEADER.length)).toString('latin1');
    expect(head, 'PDF must start with the %PDF- header').toBe(PDF_HEADER);

    // Trailer: %%EOF must appear near the end (allow trailing whitespace/newlines).
    const tailWindow = Buffer.from(bytes.slice(Math.max(0, bytes.length - 1024))).toString('latin1');
    expect(tailWindow.includes(PDF_TRAILER), 'PDF must contain an %%EOF trailer marker').toBe(true);

    // Structural: the hardened reader must parse it and report pages.
    const reader = openPdf(bytes);
    expect(reader.pageCount, `PDF must have at least ${minPages} page(s)`).toBeGreaterThanOrEqual(minPages);

    return reader.pageCount;
}
