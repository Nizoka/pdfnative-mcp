/**
 * Shared PDF/A conformance-diagnostics plumbing (pdfnative ≥ 1.7).
 *
 * pdfnative 1.7 surfaces configurations that would break a declared PDF/A
 * level (no embedded fonts, unembedded AcroForm fonts, DeviceCMYK images) as
 * *diagnostics*: by default it `console.warn`s once per code, `strict: true`
 * throws before any bytes are produced, and an `onDiagnostic` sink receives
 * every one of them.
 *
 * This server always installs a sink (so the engine never writes to the
 * console, which keeps the stdio transport's streams clean) and exposes three
 * opt-in inputs on every PDF/A-capable tool:
 *
 *   - `strict`             → escalate any diagnostic to `PDF_A_COMPLIANCE_VIOLATION`
 *   - `includeDiagnostics` → echo the collected diagnostics in `structuredContent`
 *   - `embedFonts`         → embed Noto Sans (Latin) so base-14 Helvetica text
 *                            no longer voids the PDF/A claim (ISO 19005 §6.2.11.4.1)
 *
 * All three default to off, keeping default outputs byte-identical.
 */
import { loadFontData, registerFont, type FontEntry, type PdfDiagnostic, type PdfDiagnosticHandler } from 'pdfnative';
import { z } from 'zod';

import { ToolError } from './errors.js';
import { importFontModule } from './fonts.js';

/** Diagnostic as echoed to MCP clients (mirrors pdfnative's `PdfDiagnostic`). */
export interface ToolDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly severity: 'warning';
}

/** JSON Schema fragments — spread into a tool's `properties`. */
export const DIAGNOSTIC_INPUT_PROPERTIES = {
    strict: {
        type: 'boolean',
        default: false,
        description:
            "Escalate PDF/A conformance diagnostics (e.g. PDFA_NO_FONT_ENTRIES: text rendered through the unembedded base-14 Helvetica while claiming PDF/A) to a PDF_A_COMPLIANCE_VIOLATION error instead of producing a non-conformant file. Pair with embedFonts=true. Default false (the PDF is produced; diagnostics are silent unless includeDiagnostics=true).",
    },
    includeDiagnostics: {
        type: 'boolean',
        default: false,
        description:
            'Return the PDF/A conformance diagnostics pdfnative raised while building (`diagnostics[]` in the structured result, possibly empty). Default false — the default response shape is unchanged.',
    },
    embedFonts: {
        type: 'boolean',
        default: false,
        description:
            'Embed the Noto Sans Latin font instead of relying on the viewer-supplied base-14 Helvetica. Required for a *valid* PDF/A claim (ISO 19005 §6.2.11.4.1 — veraPDF rejects unembedded fonts) and for strict=true to pass; adds ~0.3 MiB and changes the output bytes. Default false for backward compatibility.',
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
        description: 'PDF/A conformance diagnostics raised while building (only present when includeDiagnostics=true).',
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
    readonly layout: { readonly onDiagnostic: PdfDiagnosticHandler; readonly strict?: boolean };
    /** Diagnostics collected so far (in emission order). */
    readonly diagnostics: ToolDiagnostic[];
}

/**
 * Create a per-call diagnostics sink. The sink is always installed so the
 * engine never falls back to `console.warn`; `strict` is forwarded so the
 * engine throws before producing bytes.
 */
export function collectDiagnostics(strict: boolean | undefined): DiagnosticCollector {
    const diagnostics: ToolDiagnostic[] = [];
    const onDiagnostic: PdfDiagnosticHandler = (d: PdfDiagnostic) => {
        diagnostics.push({ code: d.code, message: d.message, severity: d.severity });
    };
    return {
        layout: { onDiagnostic, ...(strict === true ? { strict: true } : {}) },
        diagnostics,
    };
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

/**
 * Map an engine throw raised during a build into a stable tool error code.
 * Engine messages are kept verbatim — they carry the remedy.
 */
export function mapBuildError(err: unknown, toolName: string): ToolError {
    if (err instanceof ToolError) return err;
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('pdfnative: ') && /PDF\/A|ISO 19005|conformance/i.test(message)) {
        return new ToolError('PDF_A_COMPLIANCE_VIOLATION', message.slice('pdfnative: '.length));
    }
    if (message.startsWith('chart:')) {
        return new ToolError('CHART_ERROR', message);
    }
    if (message.startsWith('print.') || /OutputIntent|ICC profile/i.test(message)) {
        return new ToolError('PRINT_ERROR', message);
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
