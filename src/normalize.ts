/**
 * Shared Unicode-normalization schema for the text-producing tools.
 *
 * Maps directly to pdfnative's `PdfLayoutOptions.normalize`
 * (`'NFC' | 'NFD' | 'NFKC' | 'NFKD' | false`). Exposed as an opt-in enum so
 * agents can compose decomposed combining sequences (common in Vietnamese,
 * some Indic scripts, or macOS-copied text) into the precomposed code points a
 * font's cmap is most likely to cover, maximising glyph coverage.
 */
import { z } from 'zod';

/** Allowed Unicode normalization forms (omitted = engine default / byte-stable). */
export const NORMALIZE_ENUM = ['NFC', 'NFD', 'NFKC', 'NFKD'] as const;

export const NORMALIZE_FIELD_DESCRIPTION =
    "Unicode normalization before shaping ('NFC' recommended for glyph coverage; NFD/NFKC/NFKD accepted). Omit = none.";

/** Zod validator for the optional `normalize` input. */
export const NormalizeSchema = z.enum(NORMALIZE_ENUM);

export type NormalizeForm = z.infer<typeof NormalizeSchema>;
