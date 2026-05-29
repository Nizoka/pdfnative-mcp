/**
 * Shared PDF/A conformance-target plumbing.
 *
 * pdfnative v1.2.0 exports `PDF_A_CONFORMANCE_TARGETS` as the single source of
 * truth for the four supported conformance levels (`pdfa1b` | `pdfa2b` |
 * `pdfa2u` | `pdfa3b`). Every tool schema in this server imports the same
 * tuple so MCP `inputSchema.enum`, Zod runtime validation, and the underlying
 * pdfnative `tagged` option stay in lockstep automatically when pdfnative ships
 * a new conformance target.
 */
import { PDF_A_CONFORMANCE_TARGETS, type PdfAConformanceTarget } from 'pdfnative';
import { z } from 'zod';

/** Mutable copy spread into JSON Schema `enum:` arrays. */
export const PDF_A_ENUM: readonly PdfAConformanceTarget[] = PDF_A_CONFORMANCE_TARGETS;

/** Reusable Zod enum for `pdfA` input validation. */
export const PdfASchema = z.enum(
    PDF_A_CONFORMANCE_TARGETS as unknown as readonly [PdfAConformanceTarget, ...PdfAConformanceTarget[]],
);

/** Shared JSON Schema description with PDF/A authoring guidance for AI agents. */
export const PDF_A_FIELD_DESCRIPTION =
    "Optional PDF/A conformance level (powered by pdfnative v1.2). Use 'pdfa1b' for archival of simple text+images, 'pdfa2b'/'pdfa2u' for richer content (2u guarantees Unicode mapping), 'pdfa3b' when embedding source attachments (Factur-X / ZUGFeRD). Mutually exclusive with PDF encryption. See docs/guides/PDFA.md.";
