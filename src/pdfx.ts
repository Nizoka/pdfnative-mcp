/**
 * Shared PDF/X conformance-target plumbing (pdfnative >= 1.8).
 *
 * Mirrors src/pdfa.ts: the engine exports `PDF_X_CONFORMANCE_TARGETS` as the
 * single source of truth (`pdfx4` today), so the MCP `inputSchema.enum`, the
 * Zod validator and the `pdfx` layout option stay in lock-step when the engine
 * ships another target.
 *
 * What `pdfx: 'pdfx4'` writes (ISO 15930-7): a `%PDF-1.6` header, the PDF/X-4
 * XMP identification, a `/GTS_PDFX` OutputIntent carrying the caller's ICC
 * profile, a TrimBox on every page (the MediaBox when `print` sets none) and
 * `/Trapped`. The engine ships no press profile and neither does this server:
 * the printing condition's ICC profile is the caller's to supply.
 *
 * The engine refuses incoherent requests with plain `Error`s. The ones that
 * can be seen in the arguments alone are refused HERE first, in this server's
 * vocabulary (`pdfA`, `encrypt`, `embedFonts`) and with `VALIDATION_ERROR`,
 * before any work is done; the rest (an ICC profile whose device class is not
 * `prtr`) is mapped from the engine message by `mapBuildError()`.
 */
import { PDF_X_CONFORMANCE_TARGETS, type PdfXConformanceTarget } from 'pdfnative';
import { z } from 'zod';

import { ToolError } from './errors.js';

/** Copy spread into JSON Schema `enum:` arrays. */
export const PDF_X_ENUM: readonly PdfXConformanceTarget[] = PDF_X_CONFORMANCE_TARGETS;

/** Reusable Zod enum for `pdfx` input validation. */
export const PdfXSchema = z.enum(PDF_X_CONFORMANCE_TARGETS as unknown as readonly [PdfXConformanceTarget, ...PdfXConformanceTarget[]]);

/** Shared JSON Schema description with the prerequisites an agent cannot guess. */
export const PDF_X_FIELD_DESCRIPTION =
    "PDF/X-4 print exchange (ISO 15930-7). REQUIRES outputIntent with the printer's ICC profile (device class 'prtr'; CMYK or Gray — none is bundled); needs embedFonts:true for a conformant file (PDFX_NO_FONT_ENTRIES otherwise, strict:true refuses). Exclusive with pdfA and encrypt; metadata.trapped must be 'True' or 'False'; TrimBox or ArtBox, not both. Links and form fields are reported (PDFX_ANNOTATIONS). Check with validate_pdf standard:'pdf-x-4'. See the print_ready prompt.";

/** JSON Schema fragment — spread into a tool's `properties`. */
export const PDFX_INPUT_PROPERTIES = {
    pdfx: {
        type: 'string',
        enum: [...PDF_X_ENUM],
        description: PDF_X_FIELD_DESCRIPTION,
    },
} as const;

/** Zod counterpart of {@link PDFX_INPUT_PROPERTIES}. */
export const PdfXInputShape = {
    pdfx: PdfXSchema.optional(),
} as const;

export interface PdfXContext {
    readonly pdfx?: PdfXConformanceTarget | undefined;
    readonly pdfA?: string | undefined;
    readonly encrypt?: unknown;
    readonly outputIntent?: unknown;
    readonly metadata?: { readonly trapped?: 'True' | 'False' | 'Unknown' | undefined } | undefined;
    readonly print?: { readonly artBox?: unknown; readonly trimBox?: unknown; readonly bleed?: unknown } | undefined;
}

/**
 * Refuse, before the build, every PDF/X request the arguments alone show to be
 * incoherent. A no-op when `pdfx` is absent.
 */
export function assertPdfXCompatible(ctx: PdfXContext): void {
    if (ctx.pdfx === undefined) return;
    if (ctx.pdfA !== undefined) {
        throw new ToolError('VALIDATION_ERROR', 'pdfx and pdfA are mutually exclusive: one conformance claim per file. PDF/A is for archiving, PDF/X for print exchange — drop one of them.');
    }
    if (ctx.encrypt !== undefined) {
        throw new ToolError('VALIDATION_ERROR', 'pdfx and encrypt are mutually exclusive: PDF/X forbids encryption (ISO 15930-7). Drop one of them.');
    }
    if (ctx.outputIntent === undefined) {
        throw new ToolError(
            'VALIDATION_ERROR',
            "pdfx requires outputIntent: the ICC profile of the printing condition (device class 'prtr' — e.g. ISO Coated v2 or GRACoL, from your printer) plus its outputConditionIdentifier. No press profile is bundled.",
        );
    }
    if (ctx.metadata?.trapped === 'Unknown') {
        throw new ToolError('VALIDATION_ERROR', "pdfx requires a known trapping state: set metadata.trapped to 'True' or 'False', or omit it for 'False'.");
    }
    if (ctx.print?.artBox !== undefined && (ctx.print.trimBox !== undefined || ctx.print.bleed !== undefined)) {
        throw new ToolError('VALIDATION_ERROR', 'pdfx pages carry a TrimBox or an ArtBox, not both: drop print.artBox, or print.trimBox and print.bleed.');
    }
}

/** Layout fragment to spread into the pdfnative layout options; empty when `pdfx` is absent. */
export function toPdfXLayout(pdfx: PdfXConformanceTarget | undefined): { pdfx?: PdfXConformanceTarget } {
    return pdfx !== undefined ? { pdfx } : {};
}
