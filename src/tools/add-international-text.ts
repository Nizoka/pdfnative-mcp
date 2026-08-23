/**
 * Tool: add_international_text
 *
 * Generates a PDF that contains text in non-Latin scripts (Arabic, Hebrew, Thai,
 * CJK, Devanagari, Bengali, Tamil, Telugu, Sinhala, Tibetan, Khmer, Myanmar,
 * Ethiopic, Cyrillic, Greek, Georgian, Armenian, Vietnamese, Turkish, Polish).
 * Uses the pre-built Noto font data modules shipped with `pdfnative` via
 * `pdfnative/fonts/*.js` and registers them on demand.
 *
 * BiDi reordering, Arabic positional shaping, complex-script OpenType shaping
 * (Thai/Devanagari/Bengali/Tamil/Telugu/Sinhala/Tibetan/Khmer/Myanmar), COLRv1
 * colour emoji, and CIDFont Type2 / Identity-H embedding are all handled
 * transparently by pdfnative. Input is NFC-normalised so decomposed sequences
 * map to the widest possible glyph coverage.
 */
import {
    buildDocumentPDFBytes,
    registerFont,
    loadFontData,
    type DocumentBlock,
    type FontEntry,
} from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { importFontModule } from '../fonts.js';
import { splitParagraphSegments } from '../text.js';
import { PDF_A_ENUM, PdfASchema } from '../pdfa.js';
import { NORMALIZE_ENUM, NormalizeSchema } from '../normalize.js';
import {
    VIEWER_PREFERENCES_INPUT_SCHEMA,
    ViewerPreferencesSchema,
    toViewerPreferences,
} from '../doc-features.js';
import { PRINT_INPUT_PROPERTIES, PrintInputShape, assertPrintPdfACompatible, toDocumentMetadata, toPrintLayout } from '../print.js';
import { DIAGNOSTIC_INPUT_PROPERTIES, DiagnosticInputShape, collectDiagnostics, mapBuildError, withDiagnostics } from '../diagnostics.js';

// This tool always embeds the Noto fonts it renders with, so `embedFonts` is not exposed.
const { strict: STRICT_PROPERTY, includeDiagnostics: INCLUDE_DIAGNOSTICS_PROPERTY } = DIAGNOSTIC_INPUT_PROPERTIES;
const { strict: StrictShape, includeDiagnostics: IncludeDiagnosticsShape } = DiagnosticInputShape;

export const ADD_INTERNATIONAL_TEXT_NAME = 'add_international_text';

/** Mapping from the public `lang` code to pdfnative's bundled Noto font data file. */
const LANG_TO_FONT_FILE: Readonly<Record<string, string>> = {
    ar: 'noto-arabic-data.js',
    he: 'noto-hebrew-data.js',
    th: 'noto-thai-data.js',
    ja: 'noto-jp-data.js',
    zh: 'noto-sc-data.js',
    ko: 'noto-kr-data.js',
    el: 'noto-greek-data.js',
    hi: 'noto-devanagari-data.js',
    bn: 'noto-bengali-data.js',
    ta: 'noto-tamil-data.js',
    ru: 'noto-cyrillic-data.js',
    ka: 'noto-georgian-data.js',
    hy: 'noto-armenian-data.js',
    tr: 'noto-turkish-data.js',
    pl: 'noto-polish-data.js',
    vi: 'noto-vietnamese-data.js',
    // Added in v0.3.0 / pdfnative v1.1.0:
    latin: 'noto-sans-data.js',
    // Added in v1.1.0 / pdfnative v1.3.0 — six new complex scripts:
    te: 'noto-telugu-data.js',
    si: 'noto-sinhala-data.js',
    bo: 'noto-tibetan-data.js',
    km: 'noto-khmer-data.js',
    my: 'noto-myanmar-data.js',
    am: 'noto-ethiopic-data.js',
    // COLRv1 colour emoji (pdfnative v1.3.0). Falls back to monochrome glyphs
    // automatically inside pdfnative when a colour table is unavailable.
    emoji: 'noto-color-emoji-data.js',
    // Mathematical / technical symbols (pdfnative v1.5.0, Noto Sans Math OFL-1.1).
    // Combine with a base script (e.g. lang: ['latin','math']) to render ∀ ∃ √ ∑ ∫ ∞ ± ÷ ×.
    math: 'noto-sans-math-data.js',
};

const SUPPORTED_LANGS = Object.keys(LANG_TO_FONT_FILE) as ReadonlyArray<keyof typeof LANG_TO_FONT_FILE>;

const _registered = new Set<string>();
function ensureFontRegistered(lang: string): void {
    if (_registered.has(lang)) return;
    const fontFile = LANG_TO_FONT_FILE[lang];
    if (fontFile === undefined) {
        throw new ToolError('UNSUPPORTED_LANG', `Unsupported lang '${lang}'. Supported: ${SUPPORTED_LANGS.join(', ')}.`);
    }
    registerFont(lang, async () => {
        const data = await importFontModule(fontFile);
        return data as Awaited<ReturnType<Parameters<typeof registerFont>[1]>>;
    });
    _registered.add(lang);
}

export const ADD_INTERNATIONAL_TEXT_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description: 'PDF title (rendered as page heading and stored as document metadata).',
        },
        lang: {
            description:
                "Language / script identifier. Either a single code (e.g. 'ar'), a comma-separated list ('ar,emoji'), or an array (['ar','emoji']). Multiple codes enable multi-font run splitting (script + emoji + Latin fallback).",
            // anyOf (not oneOf): a single code also satisfies the comma-separated string branch.
            anyOf: [
                { type: 'string', enum: [...SUPPORTED_LANGS] },
                {
                    type: 'array',
                    minItems: 1,
                    maxItems: SUPPORTED_LANGS.length,
                    items: { type: 'string', enum: [...SUPPORTED_LANGS] },
                },
                { type: 'string', minLength: 2, maxLength: 80, description: 'Comma-separated list of supported codes.' },
            ],
        },
        paragraphs: {
            type: 'array',
            minItems: 1,
            maxItems: 1000,
            description: 'Ordered list of paragraphs to render in the chosen script.',
            items: { type: 'string', minLength: 1, maxLength: 50000 },
        },
        pdfA: {
            type: 'string',
            enum: [...PDF_A_ENUM],
            description: 'PDF/A level (Tagged PDF + sRGB OutputIntent + XMP). Fonts are embedded here, so the claim is valid as-is. See docs/guides/PDFA.md.',
        },
        normalize: {
            type: 'string',
            enum: [...NORMALIZE_ENUM],
            description:
                "Unicode normalization before shaping. Default 'NFC' (widest glyph coverage); NFD/NFKC/NFKD or false for special needs.",
        },
        viewerPreferences: VIEWER_PREFERENCES_INPUT_SCHEMA,
        ...PRINT_INPUT_PROPERTIES,
        strict: STRICT_PROPERTY,
        includeDiagnostics: INCLUDE_DIAGNOSTICS_PROPERTY,
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64', description: "'base64' (default) returns the PDF inline; 'file' writes it inside the PDFNATIVE_MCP_OUTPUT_DIR sandbox (SECURITY_VIOLATION when the sandbox is not configured)." },
        outputPath: { type: 'string', description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf (no absolute paths, no '..')." },
    },
    required: ['title', 'lang', 'paragraphs'],
} as const;

const LangInput = z.union([
    z.enum(SUPPORTED_LANGS as [string, ...string[]]),
    z.array(z.enum(SUPPORTED_LANGS as [string, ...string[]])).min(1).max(SUPPORTED_LANGS.length),
    z.string().min(2).max(80),
]);

const InputSchema = z.strictObject({
    title: z.string().min(1).max(200),
    lang: LangInput,
    paragraphs: z.array(z.string().min(1).max(50000)).min(1).max(1000),
    pdfA: PdfASchema.optional(),
    normalize: NormalizeSchema.optional(),
    viewerPreferences: ViewerPreferencesSchema.optional(),
    ...PrintInputShape,
    strict: StrictShape,
    includeDiagnostics: IncludeDiagnosticsShape,
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

/** Normalise the polymorphic `lang` input into a unique, validated list of codes. */
function normaliseLangs(raw: string | string[]): string[] {
    const tokens = Array.isArray(raw) ? raw : raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tokens) {
        if (LANG_TO_FONT_FILE[t] === undefined) {
            throw new ToolError(
                'UNSUPPORTED_LANG',
                `Unsupported lang '${t}'. Supported: ${SUPPORTED_LANGS.join(', ')}.`,
            );
        }
        if (!seen.has(t)) {
            seen.add(t);
            out.push(t);
        }
    }
    if (out.length === 0) {
        throw new ToolError('UNSUPPORTED_LANG', 'lang must resolve to at least one supported code.');
    }
    return out;
}

export async function addInternationalText(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, lang, paragraphs, pdfA, normalize, viewerPreferences, print, outputIntent, metadata, creationDate, strict, includeDiagnostics, outputMode, outputPath } = parsed.data;
    assertPrintPdfACompatible(print, pdfA);

    const langs = normaliseLangs(lang);
    // Auto-register Noto Sans Latin fallback under PDF/A so non-WinAnsi Latin (smart
    // quotes, em-dash, ellipsis) is embedded and veraPDF rule 6.3.4 passes.
    if (pdfA !== undefined && !langs.includes('latin')) {
        langs.push('latin');
    }

    const fontEntries: FontEntry[] = [];
    for (let i = 0; i < langs.length; i += 1) {
        const code = langs[i] as string;
        ensureFontRegistered(code);
        const fontData = await loadFontData(code);
        if (fontData === null) {
            throw new ToolError('FONT_LOAD_FAILED', `Failed to load font data for lang '${code}'.`);
        }
        fontEntries.push({ fontData, fontRef: `/F${3 + i}`, lang: code });
    }

    const blocks: DocumentBlock[] = paragraphs.flatMap((text) =>
        splitParagraphSegments(text).map((segment): DocumentBlock => ({ type: 'paragraph', text: segment })),
    );
    if (blocks.length === 0) {
        throw new ToolError('VALIDATION_ERROR', 'paragraphs must contain at least one non-empty line of text.');
    }

    const docMetadata = toDocumentMetadata(metadata);
    const collector = collectDiagnostics(strict);
    let bytes: Uint8Array;
    try {
        bytes = buildDocumentPDFBytes(
            { title, blocks, fontEntries, ...(docMetadata !== undefined ? { metadata: docMetadata } : {}) },
            {
                normalize: normalize ?? 'NFC',
                ...(pdfA !== undefined ? { tagged: pdfA } : {}),
                ...(viewerPreferences !== undefined ? { viewerPreferences: toViewerPreferences(viewerPreferences) } : {}),
                ...toPrintLayout({ print, outputIntent, creationDate }),
                ...collector.layout,
            },
        );
    } catch (err) {
        throw mapBuildError(err, ADD_INTERNATIONAL_TEXT_NAME);
    }
    return withDiagnostics(
        await emitPdf(bytes, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) }),
        collector,
        includeDiagnostics,
    );
}
