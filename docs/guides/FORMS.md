# Forms guide (for AI agents)

pdfnative-mcp has **three** form tools. Pick by intent:

| Intent | Tool |
| --- | --- |
| **Create** a new fillable form from scratch | `add_form` |
| **Inspect** the fields of an existing form | `read_form_fields` (read-only) |
| **Fill / flatten** an existing form | `fill_form` |

`read_form_fields` and `fill_form` are new in **v1.5.0** (pdfnative v1.6.0's
`readFormFields` / `fillForm` / `flattenForm`). They operate on *existing*
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
| `FORM_FIELD_NOT_FOUND` | A value key matched no field. Use `onUnknownField: 'ignore'` to skip. |
| `FORM_VALUE_TYPE_ERROR` | Wrong value type, or a choice value not in the field's options. |
| `FORM_UNSUPPORTED` | Tried to fill/flatten a signature field. |
| `PASSWORD_REQUIRED` / `PASSWORD_INVALID` | Encrypted source needs / rejected the `password`. |

## Non-WinAnsi text

The appearance font is Helvetica (WinAnsi). For values with characters outside
WinAnsi, pass `nonWinAnsi: 'needAppearances'` — `fill_form` writes the value and
sets `/NeedAppearances` so the viewer regenerates the appearance. The default
(`'throw'`) rejects such values so you notice.
