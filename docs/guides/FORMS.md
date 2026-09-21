# Forms guide (for AI agents)

pdfnative-mcp has **three** form tools (plus `formField` blocks inside `generate_basic_pdf`). Pick by intent:

| Intent | Tool |
| --- | --- |
| **Create** a new fillable form from scratch | `add_form` |
| **Mix** fields into a longer document (prose, tables, images, a contents page) | `generate_basic_pdf` with `formField` blocks — same field body as `add_form` |
| **Create** a fillable form that is **password-protected** | `add_form` (or `generate_basic_pdf`) with `encrypt` — build-time encryption keeps the AcroForm; `encrypt_pdf` afterwards would drop it |
| **Inspect** the fields of an existing form | `read_form_fields` (read-only) |
| **Fill / flatten** an existing form | `fill_form` |

## Field types you can create (`add_form`, `formField` block)

| `fieldType` | Notes |
| --- | --- |
| `text` | single line; `value`, `placeholder` (hint while empty), `maxLength`, `readOnly`, `required`, `width` / `height`, `fontSize` |
| `textarea` | multi-line (`/Ff 4096`). Since 1.6.0 this maps to the engine's `multilineText`; 1.5.0 passed the name through unmapped and produced a single-line field, so bytes change for this input |
| `checkbox` | `checked` |
| `radio` | `options` required; fields sharing a `name` form one group; `checked` |
| `dropdown` | `options` required (1–100 entries); `value` |
| `listbox` | v1.6.0 — `options` required; multi-select list |

Every field needs a unique `name` (`/T`, 1–100 chars) and may carry a `label` rendered above it.

`read_form_fields` and `fill_form` arrived in **v1.5.0** (pdfnative's
`readFormFields` / `fillForm` / `flattenForm`; since pdfnative 1.7 the AcroForm
`/Helv` font carries a `/ToUnicode` CMap, so filled text extracts reliably). They
operate on *existing*
AcroForms — a template made by `add_form`, or any third-party fillable PDF.

## The typical flow

```jsonc
// 1) discover the field names
{ "tool": "read_form_fields", "arguments": { "pdfBase64": "<pdf>" } }
// → { fieldCount, fields: [{ name, type, value, options?, widgets, … }] }

// 2) fill them (optionally flatten in the same call)
{ "tool": "fill_form", "arguments": {
  "pdfBase64": "<pdf>",
  "values": { "fullName": "Alice Martin", "subscribe": true, "country": "FR" },
  "flatten": true
}}
```

## Values by field type

| Field type | Value shape |
| --- | --- |
| `text` (incl. multiline) | a string |
| `checkbox` / `radio` | a boolean, or the export-state string |
| `dropdown` | a string (must be one of the field's options) |
| `listbox` (multi-select) | an array of strings |
| `signature` | **not fillable** → `FORM_UNSUPPORTED` |

## Flatten

- `flatten: true` stamps each widget's appearance into the page content and
  removes the interactive layer — the result is final and non-editable.
- **Pure flatten** (bake in existing values, no changes): call `fill_form` with
  `flatten: true` and **no** `values`.

## Non-destructive & encrypted

- Filling is an **incremental update**: the original bytes are preserved, so a
  prior signature stays valid for its revision.
- Encrypted forms work — pass `password`; appended objects are encrypted under
  the document's existing scheme (no plaintext leak).

## Error codes

| Code | Meaning |
| --- | --- |
| `FORM_FIELD_NOT_FOUND` | A value key matched no field. The message itself names the remedy: list the real names with `read_form_fields`, or pass `onUnknownField: 'ignore'` to skip unknown keys. |
| `FORM_VALUE_TYPE_ERROR` | Wrong value type, or a choice value not in the field's options. |
| `FORM_UNSUPPORTED` | Tried to fill/flatten a signature field. |
| `PASSWORD_REQUIRED` / `PASSWORD_INVALID` | Encrypted source needs / rejected the `password`. |

## Creating templates with `add_form` — PDF/A and reproducibility

- `add_form` shares the document-tool options: `pdfA`, `embedFonts`, `strict`,
  `print`, `metadata`, `outputIntent`, `typography`, an opt-in `creationDate`
  (ISO-8601) and the layout options (`pageSize`, `margins`, `headerTemplate` /
  `footerTemplate`, `compress`, `debug`, `encrypt`). It has no `pdfx` input: form
  fields are annotations, which PDF/X does not allow on the printed area. Pin
  `creationDate` to get byte-identical templates from identical inputs on every host
  and in every time zone (dates are written in UTC — see
  [REPRODUCIBLE.md](REPRODUCIBLE.md)); omitted, every call differs by the wall clock
  (`encrypt` output is randomised regardless, and never cached).
- **An archival form needs `embedFonts: true`.** Since pdfnative 1.8.0 (upstream fix
  #74) `add_form` (or a `formField` block) + `pdfA` + `embedFonts: true` **validates**
  under veraPDF: the AcroForm default-resources font (`/AcroForm /DR`) is now the
  embedded Noto Sans, like the page text. It is the `form-pdfa2b.pdf` entry of the
  veraPDF corpus — a negative canary until v1.6.0, an expected pass now.
  **Without** `embedFonts: true` both the page text and the field font fall back to the
  unembedded base-14 Helvetica (ISO 19005-2 rule 6.2.11.4.1): the wrapper reports
  `PDFA_NO_FONT_ENTRIES` and `PDFA_UNEMBEDDED_FORM_FONT` (`includeDiagnostics: true`;
  `strict: true` fails the call with `PDF_A_COMPLIANCE_VIOLATION`), and `inspect_pdf`
  still reports the claim, which is void. See
  [PDFA.md](PDFA.md#known-limitations-engine-gaps-documented-honestly).

## Non-WinAnsi text

The appearance font is Helvetica (WinAnsi). For values with characters outside
WinAnsi, pass `nonWinAnsi: 'needAppearances'` — `fill_form` writes the value and
sets `/NeedAppearances` so the viewer regenerates the appearance. The default
(`'throw'`) rejects such values so you notice.
