# Typography guide (for AI agents)

Applies to pdfnative-mcp v1.7.0 · pdfnative 1.8.0. Verified on 2026-09-21 against pdfnative-mcp 1.7.0 and pdfnative 1.8.0.

`typography` is one opt-in object that turns on the engine's fine typography:
paragraphs that split across pages under orphan / widow rules, headings kept with
their text, justification with optical margins, no-break spaces where a language or a
standard asks for them, pair kerning, OpenType features and exact base-14 metrics.
The schema descriptions are deliberately terse (the fragment is inlined in ten tools);
this guide is the long form, and the `typography` MCP prompt is its one-screen summary.

**Every key is off by default.** A call that omits `typography` — or passes `{}` —
produces exactly the bytes it produced before 1.7.0. Each option moves glyphs or line
breaks, which is why none of them is ever switched on for you.

## Which tools

The nine document tools accept `typography` at the top level of their arguments:
`generate_basic_pdf`, `add_table`, `add_chart`, `add_barcode`, `embed_image`,
`add_form`, `add_international_text`, `add_attachment` and
`prepare_signature_placeholder`. `inspect_layout` accepts it too, because typography
moves blocks: pass the same object to the preview and to the build.

The block-level controls (`align`, `keepWithNext`, `splittable`) exist on the
`heading` and `paragraph` blocks of `generate_basic_pdf` and `inspect_layout` only.

## TL;DR — a report set with care

```json
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "On Typography",
  "embedFonts": true,
  "typography": {
    "splitParagraphs": true,
    "orphans": 3,
    "widows": 3,
    "keepHeadingsWithNext": { "minLines": 3 },
    "opticalMargins": true,
    "kerning": true,
    "fontFeatures": ["onum", "smcp"]
  },
  "blocks": [
    { "type": "heading", "text": "Why it matters", "level": 1 },
    { "type": "paragraph", "align": "justify", "text": "A page that breaks in the wrong place, strands a heading at its foot or opens rivers of white between words asks the reader to work; one that is set with care disappears, and only the text remains." }
  ]
}}
```

`embedFonts: true` comes first on purpose: `kerning`, `fontFeatures` and the narrow
no-break space of the `'fr'` preset read tables and glyphs that only an embedded font
has (see [Limits](#limits)). Worked, placeholder-free example:
[`examples/typography-report.json`](../../examples/typography-report.json).

## The 12 keys

| Key | Type | Default | Bounds | Effect |
| --- | --- | --- | --- | --- |
| `splitParagraphs` | boolean | `false` | — | A paragraph that does not fit breaks at a line boundary instead of moving to the next page whole. By default a paragraph is atomic, and one taller than a page overflows. |
| `orphans` | integer | `2` | 1–10 | Minimum lines left at the foot of a page for a break to be allowed there. Needs `splitParagraphs`. |
| `widows` | integer | `2` | 1–10 | Minimum lines carried over to the next page. Needs `splitParagraphs`. |
| `keepHeadingsWithNext` | boolean, or `{ minLines }` | `false` | `minLines` 1–10 | Never strand a heading at a page foot: it moves to the next page with its content. `true` means `{ minLines: 2 }`. Works without `splitParagraphs`. |
| `unitBinding` | boolean, or `{ units }` | `false` | `units`: up to 100 strings of 1–16 characters | No-break space between a number and the unit symbol that follows (`150 €`, `12 kg`, `30 %`). `units` **replaces** the built-in symbol list. |
| `bindShortWords` | boolean, or `{ maxLength, words }` | `false` | `maxLength` 1–3 (default 1); `words`: up to 100 strings of 1–16 characters | Never end a line on a short word: words of up to `maxLength` letters, or exactly the listed `words`. |
| `punctuationSpacing` | `'fr'`, `'fr-CA'`, or an array of rules | none | up to 32 rules `{ char, side, space }` — `char` 1–2 characters, `side` `'before'` \| `'after'`, `space` `'nbsp'` \| `'narrow'` (all three required) | No-break spaces next to punctuation. `'fr'`: narrow before `;` `!` `?`, no-break before `:` and inside `« »`. `'fr-CA'`: `:` and `« »` only. `'nbsp'` is U+00A0, `'narrow'` is U+202F (needs `embedFonts`). |
| `opticalMargins` | boolean | `false` | — | Hang punctuation slightly into the margin of `align: 'justify'` text, so the optical edge of the column is straight. |
| `metrics` | `'approximate'` \| `'exact'` | `'approximate'` | — | Base-14 text only: `'exact'` measures with the Adobe Core 14 AFM widths. Lines may wrap differently. |
| `fontFeatures` | array of tags | none | unique items, at most 11, from `tnum` `pnum` `lnum` `onum` `zero` `ordn` `sups` `subs` `smcp` `c2sc` `case` | OpenType single-substitution features, applied in order — a later tag wins where two touch the same glyph. Needs `embedFonts`. |
| `kerning` | boolean | `false` | — | Pair kerning from the font's GPOS table. Needs `embedFonts`. |
| `hyphenationLanguage` | string (BCP 47 tag) | none | at most 35 characters, e.g. `en-GB` | **No effect on this server** — no hyphenation provider is installed. Accepted so a document description stays portable; see [Limits](#limits). |

Unknown keys are refused with `VALIDATION_ERROR` — the object is strict, like every
other input of this server. An engine-side refusal of a `typography` value is reported
with the same code.

The three micro-typography rules (`unitBinding`, `bindShortWords`,
`punctuationSpacing`) convert **existing plain spaces only**. Nothing is inserted where
the author wrote no space, so text is written the way its author types it.

## Block-level controls (`generate_basic_pdf`, `inspect_layout`)

| Block | Key | Meaning |
| --- | --- | --- |
| `paragraph` | `align` | `'left'` (default) \| `'right'` \| `'center'` \| `'justify'`. Justification spans every line but the last across the measure; a line that would need an implausible stretch is left ragged. |
| `paragraph` | `keepWithNext` | Keep this paragraph on the same page as the block that follows — a lead-in line before a table or a figure. Default `false`. |
| `paragraph` | `splittable` | Allow or forbid this one paragraph breaking across pages, overriding `typography.splitParagraphs` either way. |
| `heading` | `keepWithNext` | Keep this heading with the block that follows, overriding `typography.keepHeadingsWithNext` for this block, either way. |

A paragraph whose text contains newlines is split into several paragraphs by the
server; `align` and `splittable` then describe each of them, and `keepWithNext` applies
to the last one — the one that touches the next block.

## Recipes

### A report whose paragraphs split, and whose headings stay with their text

```json
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Annual report",
  "typography": {
    "splitParagraphs": true,
    "orphans": 3,
    "widows": 3,
    "keepHeadingsWithNext": true
  },
  "blocks": [
    { "type": "heading", "text": "Results", "level": 1 },
    { "type": "paragraph", "text": "A long paragraph that may now continue on the next page, never leaving fewer than three lines on either side of the break." },
    { "type": "heading", "text": "Figures", "level": 2, "keepWithNext": true },
    { "type": "paragraph", "text": "The table below summarises the year.", "keepWithNext": true },
    { "type": "table", "headers": ["Quarter", "Revenue"], "rows": [["Q1", "120"], ["Q2", "180"]] },
    { "type": "paragraph", "text": "A short legal notice that must stay in one piece.", "splittable": false }
  ]
}}
```

None of these four keys needs an embedded font. Under a PDF/A claim a paragraph split
across pages remains one `/P` structure element.

### French punctuation — `'fr'` and `'fr-CA'`

<!-- demo-language: fr (punctuationSpacing 'fr' is a French convention) -->
```json
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Typographie française",
  "embedFonts": true,
  "typography": { "punctuationSpacing": "fr", "unitBinding": true, "bindShortWords": true },
  "blocks": [
    { "type": "paragraph", "text": "Vraiment ? Oui ! Voici la règle : « on ne sépare jamais un signe double du mot qui le précède » ; c'est l'usage." }
  ]
}}
```

- `'fr'` sets a **narrow** no-break space (U+202F) before `;` `!` `?`, and a no-break
  space (U+00A0) before `:` and inside `« »`.
- `'fr-CA'` sets the colon and the guillemets only, as Canadian French usage does.
- Without `embedFonts: true` the text is set in base-14 Helvetica, which has no U+202F
  glyph: `'fr'` then **degrades to `'fr-CA'`**.
- Any other convention is an explicit rule list:

```json
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Explicit punctuation rules",
  "embedFonts": true,
  "typography": {
    "punctuationSpacing": [
      { "char": ":", "side": "before", "space": "nbsp" },
      { "char": "?", "side": "before", "space": "narrow" }
    ]
  },
  "blocks": [{ "type": "paragraph", "text": "Ready ? Here is the rule : keep the mark with its word." }]
}}
```

Example: [`examples/typography-french.json`](../../examples/typography-french.json).

### Unit and short-word binding

```json
{ "tool": "add_table", "arguments": {
  "title": "Shipment",
  "typography": { "unitBinding": true, "bindShortWords": { "words": ["w", "z", "i", "a", "o", "u"] } },
  "headers": ["Item", "Weight", "Price"],
  "rows": [["Parcel", "12 kg", "150 €"]]
}}
```

- `unitBinding` follows ISO 80000-1 §7.1, which asks for the number and its unit to stay
  together in every language, so it carries no locale assumption. Only a recognised
  symbol standing on its own is bound: "150 people" stays breakable.
- `bindShortWords: true` binds one-letter words. It is orthography in Polish, Czech,
  Slovak, Russian, Ukrainian and Hungarian, and a house style elsewhere.
  `{ "maxLength": 2 }` widens it to two-letter words (three at most);
  `{ "words": [...] }` restricts it to a closed list, matched case-insensitively.
- Two side effects: the no-break space is visible to `extract_text`, and every binding
  removes a break opportunity, which a narrow column can feel.
- The rules apply to headings, paragraphs, lists, link labels and table content.

### Justified text with optical margins

```json
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Justified",
  "typography": { "opticalMargins": true, "splitParagraphs": true },
  "blocks": [
    { "type": "paragraph", "align": "justify", "text": "“Set with care,” the page disappears. Justification distributes the slack between words only: there is no letter-spacing and no glyph scaling, and the last line of the paragraph stays ragged." }
  ]
}}
```

`opticalMargins` applies to the leading mark of left-aligned and justified lines and to
the trailing mark of justified and right-aligned ones, with conservative offsets.
Justified lines keep their space glyphs, so `extract_text` and viewer search still see
word boundaries. Long compounds benefit from soft hyphens (U+00AD) — write them as the
JSON escape `\u00AD`.

### OpenType features and kerning

```json
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Figures and small caps",
  "embedFonts": true,
  "includeDiagnostics": true,
  "typography": { "kerning": true, "fontFeatures": ["onum", "smcp"] },
  "blocks": [{ "type": "paragraph", "text": "AVAILABLE To You: founded in 1987, 12 480 copies printed." }]
}}
```

| Tag | Effect |
| --- | --- |
| `tnum` / `pnum` | Tabular (equal-width) / proportional figures |
| `lnum` / `onum` | Lining / old-style figures |
| `zero` | Slashed zero |
| `ordn`, `sups`, `subs` | Ordinals, superiors, inferiors |
| `smcp`, `c2sc` | Small capitals from lowercase / from capitals |
| `case` | Case-sensitive forms |

Only single substitutions are supported — one glyph in, one glyph out. Ligatures and
contextual features (`liga`, `calt`, `frac`) are not in the enum and are refused with
`VALIDATION_ERROR`. Tags are applied in order and a later tag wins where two touch the
same glyph: `["onum", "pnum"]` both act on the figures, so the earlier one substitutes
nothing and is reported as ineffective — pick one per glyph class. Which tags change
anything is a property of the font: on the bundled Noto Sans, `onum`, `pnum`, `smcp`,
`c2sc`, `zero`, `case`, `sups` and `subs` substitute glyphs, `tnum` and `lnum` are
already the default, and `ordn` is not declared by the font at all (see
[Limits](#limits)). Kerning adjustments are written inside one text-showing operator, so selection and
extraction are unaffected.

### Exact base-14 metrics

```json
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Exact Helvetica metrics",
  "typography": { "metrics": "exact" },
  "blocks": [
    { "type": "paragraph", "text": "Invoice total — 12 480,00 EUR", "align": "right" },
    { "type": "paragraph", "text": "Measured with the real advance widths", "align": "center" }
  ]
}}
```

Without `embedFonts` the text is set in the viewer's Helvetica, which the engine
measures with a historical estimate by default (accented letters and most punctuation
share one width), so right-aligned and centred lines land slightly off. `'exact'` reads
the Adobe Core 14 AFM advances instead. It is opt-in because correct measurement moves
line breaks, and it needs no embedded font — an embedded font always measures from its
own tables. Example:
[`examples/typography-exact-metrics.json`](../../examples/typography-exact-metrics.json).

## Previewing with `inspect_layout`

`inspect_layout` takes the same `title`, `blocks`, layout options, `embedFonts` and
`typography` as `generate_basic_pdf`, builds nothing, and returns `totalPages` plus, per
page, each block's `type`, `x`, `top`, `width` and `height`. The preview and the build
share one pagination planner, so the page count matches the built document — as long
as you pass the **same** `typography` and the **same** `embedFonts` to both.

```json
{ "tool": "inspect_layout", "arguments": {
  "title": "Annual report",
  "embedFonts": true,
  "typography": { "splitParagraphs": true, "orphans": 3, "widows": 3, "keepHeadingsWithNext": true },
  "blocks": [
    { "type": "heading", "text": "Results", "level": 1 },
    { "type": "paragraph", "align": "justify", "text": "The paragraph you are about to build." }
  ],
  "fields": ["totalPages", "pages.blocks.type", "pages.blocks.page"]
}}
```

A paragraph that was split shows up once on each page it occupies. Use it to check
that a heading did move with its text before spending a build on it.

## Limits

Stated plainly, because the engine cannot do more than this and the server never
pretends otherwise:

- **No hyphenation dictionary is installed.** The engine's hyphenation seam is a
  function, which a JSON boundary cannot carry, and no dictionary ships with the engine
  or with this server. `hyphenationLanguage` is validated and recorded, and has **no
  effect** here. Put soft hyphens (U+00AD, `\u00AD` in JSON) in long words: they are
  honoured as break opportunities and are drawn only when a line breaks there.
- **`kerning`, `fontFeatures` and the `'fr'` narrow no-break space need
  `embedFonts: true`** (or `add_international_text`, which always embeds its fonts).
  Base-14 Helvetica has no GPOS / GSUB tables and no U+202F glyph: kerning and features
  do nothing there, and `'fr'` degrades to `'fr-CA'`.
- **`metrics: 'exact'` acts on base-14 text only.** With `embedFonts: true` it changes
  nothing.
- **`tnum` and `lnum` are no-ops on the bundled Noto Sans**, whose default figures
  already are tabular and lining (`pnum` and `onum` do substitute). The engine reports
  the diagnostic `TYPOGRAPHY_FEATURE_INEFFECTIVE` for a requested tag that substitutes
  no glyph in the document — `tnum` / `lnum`, a tag the font does not declare (`ordn`
  on Noto Sans), a tag overridden by a later one, or **any** tag when no font is
  embedded. It is a warning, not an error: pass `includeDiagnostics: true` to read it in
  `structuredContent.diagnostics`. Under `strict: true` the call fails instead, with
  **`DIAGNOSTIC_ESCALATED`** (the message carries the diagnostic code). `kerning`
  without an embedded font is silent: it simply does nothing.
- Justification distributes space between words only — no letter-spacing, no glyph
  scaling. Features are single substitutions; complex-script shaping is done by the
  script shapers, independently of `fontFeatures`.
- No custom fonts: the embedded Latin face is the bundled Noto Sans, so "which tags
  change anything" is a property of that font.

```json
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Ineffective feature",
  "embedFonts": true,
  "includeDiagnostics": true,
  "typography": { "fontFeatures": ["tnum"] },
  "blocks": [{ "type": "paragraph", "text": "1 234 567" }]
}}
```

The result carries `diagnostics: [{ "code": "TYPOGRAPHY_FEATURE_INEFFECTIVE", … }]`;
the same call with `"strict": true` is an `isError` result —
`generate_basic_pdf failed [DIAGNOSTIC_ESCALATED]: [TYPOGRAPHY_FEATURE_INEFFECTIVE] …` —
and no PDF is produced.

## See also

- [PRINT.md](PRINT.md) — page boxes, CMYK, PDF/X-4.
- [PDFA.md](PDFA.md) — `embedFonts`, `strict` and the diagnostics under a PDF/A claim.
- [REPRODUCIBLE.md](REPRODUCIBLE.md) — typography is deterministic: the same inputs and
  the same pinned instant give the same bytes.
- [docs/AGENT_CONTRACT.md](../AGENT_CONTRACT.md) §6 — every error code.
- The engine's own guide:
  [pdfnative — Typography](https://github.com/Nizoka/pdfnative/blob/main/docs/guides/typography.md).
