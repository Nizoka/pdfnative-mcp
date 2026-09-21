/**
 * Shared conformance-diagnostics plumbing (pdfnative ≥ 1.7; nine codes since 1.8).
 *
 * pdfnative surfaces configurations that would break a declared PDF/A or
 * PDF/X claim (no embedded fonts, unembedded AcroForm fonts, DeviceCMYK
 * content, an ICC profile too new for the level, annotations on a print page)
 * — and typography requests that cannot take effect — as *diagnostics*: by
 * default it `console.warn`s once per code, `strict: true` throws before any
 * bytes are produced, and an `onDiagnostic` sink receives every one of them.
 *
 * This server always installs a sink (so the engine never writes to the
 * console, which keeps the stdio transport's streams clean) and exposes three
 * opt-in inputs on every PDF/A-capable tool:
 *
 *   - `strict`             → escalate any diagnostic to a stable error code, chosen
 *                            from the diagnostic's own code (see {@link escalate})
 *   - `includeDiagnostics` → echo the collected diagnostics in `structuredContent`
 *   - `embedFonts`         → embed Noto Sans (Latin) so base-14 Helvetica text
 *                            no longer voids the PDF/A claim (ISO 19005 §6.2.11.4.1)
 *
 * All three default to off, keeping default outputs byte-identical.
 */
import { loadFontData, registerFont, type FontEntry, type PdfDiagnostic, type PdfDiagnosticCode, type PdfDiagnosticHandler } from 'pdfnative';
import { z } from 'zod';

import { ToolError } from './errors.js';
import { importFontModule } from './fonts.js';

/** Diagnostic as echoed to MCP clients (mirrors pdfnative's `PdfDiagnostic`). */
export interface ToolDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly severity: 'warning';
}

/**
 * Every diagnostic code the engine can raise. The `Record` is a compile-time
 * witness: a code added to (or removed from) pdfnative's `PdfDiagnosticCode`
 * union breaks the build until this table — and the agent documentation that
 * tests hold to it — is updated.
 */
const DIAGNOSTIC_CODE_TABLE: Record<PdfDiagnosticCode, true> = {
    PDFA_NO_FONT_ENTRIES: true,
    PDFA_DEVICE_CMYK_IMAGE: true,
    PDFA_UNEMBEDDED_FORM_FONT: true,
    PDFA_DEVICE_CMYK_CONTENT: true,
    PDFA_ICC_PROFILE_VERSION: true,
    PDFX_NO_FONT_ENTRIES: true,
    PDFX_DEVICE_CMYK: true,
    PDFX_ANNOTATIONS: true,
    TYPOGRAPHY_FEATURE_INEFFECTIVE: true,
};
export const DIAGNOSTIC_CODES = Object.keys(DIAGNOSTIC_CODE_TABLE) as readonly PdfDiagnosticCode[];

/** JSON Schema fragments — spread into a tool's `properties`. */
export const DIAGNOSTIC_INPUT_PROPERTIES = {
    strict: {
        type: 'boolean',
        default: false,
        description:
            "Fail instead of producing a file the engine warns about: a PDFA_* diagnostic → PDF_A_COMPLIANCE_VIOLATION (e.g. PDFA_NO_FONT_ENTRIES without embedFonts), a PDFX_* one → PDF_X_COMPLIANCE_VIOLATION, any other → DIAGNOSTIC_ESCALATED. Pair with embedFonts=true.",
    },
    includeDiagnostics: {
        type: 'boolean',
        default: false,
        description:
            'Return the diagnostics raised while building (PDFA_*, PDFX_*, TYPOGRAPHY_*) as `diagnostics[]` (possibly empty).',
    },
    embedFonts: {
        type: 'boolean',
        default: false,
        description:
            'Embed Noto Sans Latin instead of the viewer base-14 Helvetica. REQUIRED for a valid PDF/A or PDF/X claim (every font embedded) and for strict=true; adds ~0.3 MiB.',
    },
} as const;

/** Zod counterpart of {@link DIAGNOSTIC_INPUT_PROPERTIES}. */
export const DiagnosticInputShape = {
    strict: z.boolean().optional(),
    includeDiagnostics: z.boolean().optional(),
    embedFonts: z.boolean().optional(),
} as const;

/** JSON Schema for the optional `diagnostics` output property. */
export const DIAGNOSTICS_OUTPUT_PROPERTY = {
    diagnostics: {
        type: 'array',
        description: 'Engine diagnostics (when includeDiagnostics=true).',
        items: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'message', 'severity'],
            properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                severity: { type: 'string', enum: ['warning'] },
            },
        },
    },
} as const;

export interface DiagnosticCollector {
    /** Layout options to spread into the pdfnative build call. */
    readonly layout: { readonly onDiagnostic: PdfDiagnosticHandler };
    /** Diagnostics collected so far (in emission order). */
    readonly diagnostics: ToolDiagnostic[];
}

/**
 * The error a diagnostic becomes under `strict`. The class is read from the
 * diagnostic's own code, which is why `strict` is handled here and not handed
 * to the engine: the engine's strict mode throws a bare `Error` carrying the
 * message only, and a message cannot be classified reliably (a PDF/X message
 * also says "conformance").
 */
export function escalate(d: PdfDiagnostic): ToolError {
    if (d.code.startsWith('PDFA_')) return new ToolError('PDF_A_COMPLIANCE_VIOLATION', d.message);
    if (d.code.startsWith('PDFX_')) return new ToolError('PDF_X_COMPLIANCE_VIOLATION', d.message);
    return new ToolError('DIAGNOSTIC_ESCALATED', `[${d.code}] ${d.message}`);
}

/**
 * Create a per-call diagnostics sink. The sink is always installed so the
 * engine never falls back to `console.warn`. Under `strict` it throws at the
 * first diagnostic — the engine raises them before producing bytes and does
 * not catch what a handler throws, so the build stops exactly where the
 * engine's own strict mode would stop it.
 */
export function collectDiagnostics(strict: boolean | undefined): DiagnosticCollector {
    const diagnostics: ToolDiagnostic[] = [];
    const onDiagnostic: PdfDiagnosticHandler = (d: PdfDiagnostic) => {
        if (strict === true) throw escalate(d);
        diagnostics.push({ code: d.code, message: d.message, severity: d.severity });
    };
    return { layout: { onDiagnostic }, diagnostics };
}

const LATIN_FONT_LANG = 'latin';
const LATIN_FONT_FILE = 'noto-sans-data.js';
let latinRegistered = false;

/**
 * Font entries for `embedFonts: true` — Noto Sans Latin registered once per
 * process and loaded per call (the same module `add_international_text`
 * uses for its `latin` lang code). Returns `[]` when the flag is off so the
 * build call stays byte-identical.
 */
export async function latinFontEntries(embedFonts: boolean | undefined, fontRef = '/F3'): Promise<FontEntry[]> {
    if (embedFonts !== true) return [];
    if (!latinRegistered) {
        registerFont(LATIN_FONT_LANG, async () => {
            const data = await importFontModule(LATIN_FONT_FILE);
            return data as Awaited<ReturnType<Parameters<typeof registerFont>[1]>>;
        });
        latinRegistered = true;
    }
    const fontData = await loadFontData(LATIN_FONT_LANG);
    if (fontData === null) {
        throw new ToolError('FONT_LOAD_FAILED', 'Failed to load the Noto Sans Latin font data for embedFonts.');
    }
    return [{ fontData, fontRef, lang: LATIN_FONT_LANG }];
}

/** The prefix pdfnative puts on some of its own throws. */
const ENGINE_PREFIX = 'pdfnative: ';

/**
 * Map an engine throw raised during a build into a stable tool error code.
 * Engine messages are kept verbatim — they carry the remedy.
 */
export function mapBuildError(err: unknown, toolName: string): ToolError {
    if (err instanceof ToolError) return err;
    const message = err instanceof Error ? err.message : String(err);
    // The engine prefixes some of its throws with its own name; the class of an
    // error must not depend on it.
    const bare = message.startsWith(ENGINE_PREFIX) ? message.slice(ENGINE_PREFIX.length) : message;
    // Order matters: a PDF/X coherence message also mentions the OutputIntent
    // ("PDF/X-4 requires layout.outputIntent…"), so the PDF/X prefixes are tested
    // first. These are argument errors — assertPdfXCompatible() catches most of
    // them before the build; the ICC device-class one can only be seen here.
    if (bare.startsWith('layout.pdfx') || bare.startsWith('PDF/X')) {
        return new ToolError('VALIDATION_ERROR', bare);
    }
    if (bare.startsWith('typography.')) {
        return new ToolError('VALIDATION_ERROR', bare);
    }
    // Defence in depth: `strict` is classified by escalate() and no longer reaches
    // the engine, and the PDF/A conflicts are refused before the build
    // (assertWatermarkPdfACompatible, assertPrintPdfACompatible, …) — but an engine
    // throw about PDF/A keeps its stable code
    // (tests/_fixtures/pdfnative-build-errors.json lists the engine's messages).
    if (/PDF\/A|ISO 19005/i.test(bare)) {
        return new ToolError('PDF_A_COMPLIANCE_VIOLATION', bare);
    }
    if (bare.startsWith('chart:')) {
        return new ToolError('CHART_ERROR', bare);
    }
    if (bare.startsWith('print.') || bare.startsWith('outputIntent.') || /OutputIntent|ICC profile/i.test(bare)) {
        return new ToolError('PRINT_ERROR', bare);
    }
    return new ToolError('GENERATION_FAILED', `${toolName}: ${message}`);
}

/**
 * Attach the collected diagnostics to a tool output when the caller opted in.
 * Returns the same object otherwise so default outputs stay untouched.
 */
export function withDiagnostics<T extends object>(output: T, collector: DiagnosticCollector, include: boolean | undefined): T {
    if (include !== true) return output;
    return { ...output, diagnostics: [...collector.diagnostics] };
}
