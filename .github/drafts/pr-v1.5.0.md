# PR: v1.5.0 — charts, forms, encryption round-trip, MCP resources, pdfnative 1.6

## Summary

A minor, fully backward-compatible release that aligns the server with
[pdfnative v1.6.0](https://github.com/Nizoka/pdfnative) and grows the catalogue to
**24 tools**. It adds **native vector charts** (`add_chart` + a `chart` block in
`generate_basic_pdf`), **AcroForm fill/flatten** on existing forms
(`read_form_fields`, `fill_form`), an **encryption round-trip** (`encrypt_pdf`,
`decrypt_pdf`, a `password` input on the read-only tools, and `password` + `encrypt`
on `merge_pdfs` / `split_pdf` / `extract_pages`), rewrites `extract_text` onto
**real Unicode extraction** with positioned runs, and exposes generated PDFs as
**native MCP resources**. Every tool now advertises MCP `annotations`. No breaking
changes — all v1.4.0 tool calls work unchanged and default responses are
byte-identical.

Full notes: [`release-notes/v1.5.0.md`](../../release-notes/v1.5.0.md).

## Scope

| Phase | Subject |
| --- | --- |
| 0 | Branch + version bump (package.json `1.5.0`, pdfnative pin `^1.6.0`, `npm audit fix`); `src/version.ts` / `server.json` lock-step; `TOOL_API_VERSION` → 1.5.0 |
| 1 | Shared modules: `src/encryption.ts` (password + `encrypt` schema, `mapDecryptError`), `src/chart.ts` (`ChartBlock` schema + `toChartBlock`); new error codes |
| 2 | `extract_text` rewritten onto pdfnative `extractText()` (Unicode, `includeRuns`, `password`, `maxTextLength`) |
| 3 | `password` on read-only tools (`inspect_pdf` +`encryptionInfo`, `verify_pdf`, `extract_attachments`); `password` + `encrypt` on page-tree tools; `chart` block in `generate_basic_pdf` |
| 4 | New tools: `read_form_fields`, `fill_form`, `add_chart`, `encrypt_pdf`, `decrypt_pdf` |
| 5 | Server registration (5 tools → 24), MCP **tool annotations** on all tools, **resources** capability (`src/resources.ts`, `ListResources`/`ReadResource` handlers, `resource_link` in file-mode results), decision-tree + pitfalls update |
| 6 | Tests: 8 new suites + `tests/_encrypted-fixtures.ts`; extended `server.test.ts`, page-tree + read tests; rewritten `extract-text.test.ts`; `add-barcode.test.ts` coverage gap |
| 7 | Examples: `chart-report`, `fill-form`, `encrypt-decrypt-roundtrip`, `encrypted-merge`, `extract-text-runs` |
| 8 | Docs: README, AGENTS.md, API_STABILITY, ROADMAP, llms.txt, copilot-instructions + new `CLAUDE.md` and guides `CHARTS.md` / `FORMS.md` / `ENCRYPTION.md` |
| 9 | Release: `release-notes/v1.5.0.md`, CHANGELOG mirror, this PR draft |

## Closes

- Roadmap: ships **native vector charts**, **AcroForm fill/flatten**, the **encrypted-PDF round-trip** (previously blocked on a Standard Security Handler writer — unblocked by pdfnative 1.6.0), and **native MCP resources** (previously long-term).
- `redact_pdf` stays **deferred by design**: pdfnative can overlay/flatten but not *remove* page content; an overlay-only "redaction" would create false security. `verify_pdf` keeps its local P-256 ECDSA verifier because pdfnative does not export `ecdsaVerifyHash` (public crypto surface unchanged in 1.6.0). Per-tool HTTP page-by-page streaming remains blocked on MCP partial `structuredContent` envelopes.

## Quality gate

- ✅ `npm run typecheck:all` — 0 errors
- ✅ `npm run lint` — 0 errors (26 pre-existing non-null-assertion warnings in untouched files)
- ✅ `npm run test:coverage` — **432 tests** passing; **89.47** stmts / **79.00** branches / **92.94** funcs / **91.46** lines (≥ vitest thresholds 88 / 75 / 85 / 90)
- ✅ `npm run build` — clean `dist/`
- ✅ `npm run examples:check` — **67** checks; every `examples/*.json` references a live tool; self-contained examples execute and pass structural assertions
- ✅ `npm audit --audit-level=high` — 0 vulnerabilities

## Changes summary

### Added
- **Tool `add_chart`** (new) — native vector charts (`bar`, `barH`, `line`, `pie`, `donut`) via pdfnative 1.6's `ChartBlock`: multi-series, legend, nice axis ticks, gridlines, negative values, hex palettes, tagged `/Figure` + `/Alt` (auto alt text, PDF/A-safe). Shared with the new `chart` block in `generate_basic_pdf` via `src/chart.ts`.
- **Tool `read_form_fields`** (new, read-only) — enumerate an existing AcroForm's field tree (name, type, value, flags, options, widget placements). Supports `password`.
- **Tool `fill_form`** (new) — fill/flatten an existing AcroForm via pdfnative `fillForm`/`flattenForm` (non-destructive incremental update). `values` (string | boolean | string[]), `flatten`, `onUnknownField`, `nonWinAnsi`, `password`. Typed errors `FORM_FIELD_NOT_FOUND` / `FORM_VALUE_TYPE_ERROR` / `FORM_UNSUPPORTED`.
- **Tool `encrypt_pdf`** (new) — re-secure with AES-128 (default) / AES-256; owner/user passwords, permissions, one-call password rotation. RC4 never emitted.
- **Tool `decrypt_pdf`** (new) — emit an unencrypted copy of an RC4 / AES-128 / AES-256 document.
- **`password` input** on `inspect_pdf`, `verify_pdf`, `extract_text`, `extract_attachments`; **`encryptionInfo`** output on `inspect_pdf` (`{ algorithm, revision, authenticatedAs }`).
- **`password` + `encrypt`** on `merge_pdfs` / `split_pdf` / `extract_pages` — completing the encrypted round-trip *open → edit → re-secure*.
- **`extract_text` rewrite** onto pdfnative `extractText()` — `/ToUnicode` decoding (real characters, not glyph indices), optional `includeRuns` → per-page `runs[]` (`{ text, x, y, fontSize, fontName }`), `password`, `maxTextLength`. Output schema unchanged; `runs` additive.
- **Native MCP resources** — `resources` capability; file-mode PDFs exposed as `pdfnative://output/<name>.pdf` (`resources/list` + `resources/read`), plus a `resource_link` content block in file-mode tool results. New `src/resources.ts` (sandbox-scoped, traversal-guarded).
- **MCP tool annotations** — `readOnlyHint` / `destructiveHint:false` / `idempotentHint` / `openWorldHint:false` on all 24 tools.
- **New error codes** — `PASSWORD_REQUIRED`, `PASSWORD_INVALID`, `ENCRYPTION_UNSUPPORTED`, `ENCRYPTION_ERROR`, `FORM_FIELD_NOT_FOUND`, `FORM_VALUE_TYPE_ERROR`, `FORM_UNSUPPORTED`, `CHART_ERROR`, `UNKNOWN_RESOURCE` (all additive).
- **Examples** — `chart-report.json`, `fill-form.json`, `encrypt-decrypt-roundtrip.json`, `encrypted-merge.json`, `extract-text-runs.json`.
- **Tests** — `add-chart`, `read-form-fields`, `fill-form`, `encrypt-pdf`, `decrypt-pdf`, `resources`, `encrypted-reads`, `pagetree-encryption`, `add-barcode`; `tests/_encrypted-fixtures.ts` (in-process encrypted PDFs — unblocks the roadmap's encrypted round-trip fixtures); `extract-text.test.ts` rewritten.
- **Docs** — new `CLAUDE.md`, `docs/guides/CHARTS.md`, `docs/guides/FORMS.md`, `docs/guides/ENCRYPTION.md`.

### Changed
- **Dependency:** `pdfnative` `^1.5.0` → `^1.6.0` (additive). Free improvements surfaced: colour-emoji subset 221 → 1167 glyphs, spec-compliant AES-256 (R6) hashing, encryption of all strings, arrows routed to the math font, tolerant xref reader. `npm audit fix` applied (0 vulnerabilities).
- **MCP `_meta.apiVersion`** `1.4.0` → `1.5.0`; `SERVER_VERSION`, `server.json` versions, `package.json` version → `1.5.0`.
- **Server:** `SERVER_DESCRIPTION` / `SERVER_INSTRUCTIONS` extended to **24 tools** (charts, forms, encryption branches, resources note); `capabilities` now include `resources`.
- **Page-tree tools:** encrypted sources are no longer rejected outright — a password-protected source without a password returns `PASSWORD_REQUIRED` (was `ENCRYPTED_SOURCE`); empty-user-password documents process transparently. `ENCRYPTED_SOURCE` is retained by `annotate_pdf`. (Documented in `docs/API_STABILITY.md` §5.)
- **Docs:** README, `AGENTS.md`, `docs/API_STABILITY.md`, `ROADMAP.md`, `llms.txt`, `.github/copilot-instructions.md` refreshed for the 24-tool / pdfnative-1.6 surface.

### Fixed
- **`extract_text`** no longer emits glyph indices for subset fonts with a `/ToUnicode` CMap — the long-standing best-effort limitation is resolved by pdfnative 1.6.0's decoder.
- **`add_barcode`** gains a dedicated test file (previously only two cases in `tools.test.ts`).

## Reviewer notes

- **Faithful-wrapper caveat surfaced honestly:** `encrypt_pdf` / `decrypt_pdf` and the page-tree tools rebuild the page tree, so they drop signatures + AcroForm. This is stated in each tool description, `SERVER_INSTRUCTIONS`, and `docs/guides/ENCRYPTION.md`.
- **No new runtime dependency** — still only `pdfnative`, `@modelcontextprotocol/sdk`, `zod`.
- **`validate_pdf` intentionally did not gain `password`** — pdfnative's `validatePdfUA(bytes)` takes raw bytes only; a non-functional input would be dishonest.
