# Forms guide (for AI agents)

pdfnative-mcp has **three** form tools. Pick by intent:

| Intent | Tool |
| --- | --- |
| **Create** a new fillable form from scratch | `add_form` |
| **Inspect** the fields of an existing form | `read_form_fields` (read-only) |
| **Fill / flatten** an existing form | `fill_form` |

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
  `print`, `metadata`, `outputIntent` and an opt-in `creationDate` (ISO-8601).
  Pin `creationDate` to get byte-identical templates from identical inputs on the
  same host time zone; omitted, every call differs by the wall clock.
- **Known limitation:** `add_form` + `pdfA` + `embedFonts: true` still fails
  PDF/A-2b under veraPDF. The page text uses the embedded Noto Sans, but the
  AcroForm default resources (`/AcroForm /DR /Helv`) reference the base-14
  Helvetica as an unembedded Type1 font (ISO 19005-2 rule 6.2.11.4.1). This is an
  engine-side gap tracked by the `form-pdfa2b.pdf` negative canary in the veraPDF
  corpus; `inspect_pdf` will still report the claim. Do not rely on a PDF/A claim
  on a form until the upstream fix lands — see [PDFA.md](PDFA.md#known-limitations-engine-gaps-documented-honestly).

## Non-WinAnsi text

The appearance font is Helvetica (WinAnsi). For values with characters outside
WinAnsi, pass `nonWinAnsi: 'needAppearances'` — `fill_form` writes the value and
sets `/NeedAppearances` so the viewer regenerates the appearance. The default
(`'throw'`) rejects such values so you notice.
