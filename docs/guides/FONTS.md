# Fonts — the bundled faces and the operator's own (v1.8.0)

Applies to pdfnative-mcp v1.8.0 · pdfnative 1.9.0.

pdfnative-mcp draws text with three kinds of font, and the choice is made per call:

| Face | Who provides it | How a call selects it |
| --- | --- | --- |
| Base-14 Helvetica | The viewer (not embedded) | The default of the Latin document tools when `embedFonts` is omitted — never PDF/A-conformant, see [PDFA.md](PDFA.md). |
| The bundled Noto faces | The engine (`pdfnative`) | `embedFonts: true` embeds Noto Sans Latin; `add_international_text` embeds the face of each `lang` (32 scripts, colour emoji, math). |
| The operator's `.ttf` / `.otf` files | The operator, through `PDFNATIVE_MCP_FONT_DIR` | `font: '<slug>'` on `generate_basic_pdf`, `inspect_layout` and `add_international_text`. |

This guide is about the third kind: a brand face, a corporate typeface, a font with
glyphs the bundled set lacks.

## How the operator registers fonts

```bash
PDFNATIVE_MCP_FONT_DIR=/srv/fonts npx pdfnative-mcp
```

At boot the server reads the directory **once** (not recursively) and, for every `.ttf`
/ `.otf` file:

1. folds the file's base name to a **slug** — lower-case letters, digits and dashes,
   1–64 characters: `Brand Sans-Bold.ttf` → `brand-sans-bold`, `NotoSerif.otf` →
   `notoserif`;
2. parses the file with the engine's own font compiler (metrics, `cmap`, widths, GSUB /
   GPOS) — the same code path the bundled faces go through;
3. registers it under `custom:<slug>` in the engine's font registry.

The startup log on stderr lists the registered slugs. The variable is one of the fourteen
operator knobs: read once, declared in `server.json`, and an invalid value **refuses to
start** rather than serving a silently incomplete registry:

| Condition | Outcome |
| --- | --- |
| A relative path, a missing directory, an unreadable one | boot refusal |
| No `.ttf` / `.otf` file in the directory | boot refusal |
| More than 64 font files | boot refusal |
| A file over 16 MiB | boot refusal |
| A file the engine cannot parse as TrueType / OpenType | boot refusal, naming the file |
| Two files folding to the same slug (`Brand.ttf` and `brand.otf`) | boot refusal — rename one |
| A name that folds to an empty slug (`---.ttf`) | boot refusal — rename it |

Registration order is by slug, so the registry is the same on every file system and the
output is reproducible across hosts.

## How a call uses one

```json
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Quarterly letter",
  "font": "brand-sans-bold",
  "blocks": [
    { "type": "heading", "text": "Quarterly letter", "level": 1 },
    { "type": "paragraph", "text": "Set in the operator's brand face; characters the face lacks fall back to the bundled Noto Sans." }
  ]
}}
```

- `font` is the slug (pattern `^[a-z0-9][a-z0-9-]{0,63}$`). The face is the **primary**
  font of the document (`/F3`); the bundled faces follow as fallbacks, so a character the
  operator's font lacks is still drawn.
- The same input exists on `inspect_layout` (so the pagination preview measures with the
  real metrics) and on `add_international_text` (the operator's face is tried before the
  faces of `lang`).
- Omit `font` and the output is byte-identical to 1.7.0: the key adds a font entry only
  when present.
- `typography.fontFeatures` and `kerning` act on the operator's font when it declares the
  tables; a feature the font lacks is reported as `TYPOGRAPHY_FEATURE_INEFFECTIVE`
  ([TYPOGRAPHY.md](TYPOGRAPHY.md#limits)).
- The font is embedded (subset) like every other face, so a PDF/A or PDF/X claim holds
  with it; the licence of the font file is the operator's responsibility.

## What an agent sees

The catalogue (`tools/list`) **never varies by operator**: `font` is always advertised, as
a string with the slug pattern, and never lists the registered slugs. The list is learnt
from the first failure:

```text
generate_basic_pdf failed [FONT_NOT_FOUND]: font 'brand-serif' is unknown. Registered custom fonts: brand-sans-bold, brand-sans-regular.
```

When the operator registered nothing, the message says so
(`the operator registered no custom font (PDFNATIVE_MCP_FONT_DIR is unset)`): an agent
then drops `font` and uses `embedFonts: true` or `add_international_text`. `FONT_NOT_FOUND`
is a plain `isError` result, never a protocol error, and the message names slugs only —
never a path.

## Security notes

- No tool argument ever carries a path; the directory is the operator's choice and is
  never listed to a client.
- Every file is parsed before it is registered, so a malformed font fails at boot — in the
  operator's log — not inside a tool call.
- The per-file and per-directory bounds (16 MiB, 64 files) keep boot time and memory
  predictable; they are not operator-tunable.
- The same policy as the output sandbox and the network allow-list: operator knobs are
  read once, validated strictly, and an invalid value is a refusal, never a fallback.

- The response cache (`PDFNATIVE_MCP_CACHE_DIR`) namespaces its keys by a fingerprint of the
  registry (slug, size and SHA-256 of every file), so a face replaced on disk and a restart never
  serve a PDF rendered with the earlier bytes — a `font` call names the face by its slug only.

## See also

- [TYPOGRAPHY.md](TYPOGRAPHY.md) — features, kerning, direction.
- [PDFA.md](PDFA.md) — why Latin text without an embedded font never conforms.
- [../AGENT_CONTRACT.md](../AGENT_CONTRACT.md) §4 — the operator environment table.
