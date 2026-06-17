/**
 * Shared text-normalisation helpers for the document tools.
 */

/**
 * Split paragraph text on hard line breaks (`\n`, `\r\n`, `\r`) into trimmed,
 * non-empty segments.
 *
 * LLMs routinely emit `"\n"`-delimited text expecting visual line breaks. In a
 * PDF/A content stream a literal `"\n"` is not a glyph and would render as
 * `.notdef` tofu (or be dropped), so splitting into discrete paragraph blocks
 * keeps the output valid while preserving the author's intended line structure.
 *
 * Whitespace-only segments are dropped; a paragraph consisting solely of line
 * breaks therefore yields an empty array and contributes no block.
 */
export function splitParagraphSegments(text: string): string[] {
    return text
        .split(/\r\n|\r|\n/)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
}
