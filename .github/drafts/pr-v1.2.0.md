# PR: v1.2.0 — token-frugal responses, attachment round-trip, watermarks

## Summary

A minor, fully backward-compatible release that turns pdfnative-mcp into a state-of-the-art MCP server. Adds a **14th tool** (`extract_attachments`) that completes the Factur-X / ZUGFeRD round-trip, **text watermarks** on `generate_basic_pdf` and `add_table`, opt-in **Unicode `normalize`**, and makes every read-only tool markedly more **token-frugal** for AI agents (typically ~90% fewer output tokens on large results). Upgrades runtime validation to **zod 4**, fixes the MCP registry publish block caused by `mcpName` casing, and ships a new root **AGENTS.md** operations manual. Hardens contributor confidence with **examples-as-tests** (every `examples/*.json` is executed and structurally validated in CI), a shared **`assertValidPdf`** helper, and a dedicated **local-testing guide**. No breaking changes — all v1.1.0 tool calls work unchanged and default responses are byte-identical.

Full notes: [`release-notes/v1.2.0.md`](../../release-notes/v1.2.0.md).

## Scope

| Phase | Subject |
| --- | --- |
| 1 | Token-frugal reads (`verbosity` / `fields`) + drop duplicated base64 from `structuredContent` + `src/projection.ts` |
| 2 | MCP registry publish fix (`mcpName` → `io.github.Nizoka/pdfnative-mcp`) + version/apiVersion bump to 1.2.0 |
| 3 | Tool `extract_attachments` (14th) — shared `collectEmbeddedFiles()` collector with `inspect_pdf` |
| 4 | Watermarks (`generate_basic_pdf`, `add_table`) + opt-in `normalize` (`generate_basic_pdf`, `add_international_text`) |
| 5 | Dependency: zod `^3.23.8` → `^4.0.0` |
| 6 | Docs: AGENTS.md, AI_GUIDE recipes + error table, README/llms.txt/ROADMAP/API_STABILITY/KNOWLEDGE_BASE |
| 7 | Tooling: examples-as-tests runner + `assertValidPdf` helper + 4 new example files + `LOCAL_TESTING.md` |

## Closes

- Roadmap v1.2.0 — token-frugal responses, attachment round-trip, watermarks (all items shipped)
- `merge_pdfs` / `split_pdf` / `redact_pdf` remain deferred (blocked on upstream pdfnative page-tree export API)

## Quality gate

- ✅ `npm run typecheck:all` — 0 errors
- ✅ `npm run lint` — 0 errors (36 pre-existing non-null-assertion warnings from v1.0.0)
- ✅ `npm run test` — 24 files passing (216 → grows with examples-as-tests + new feature tests)
- ✅ `npm run test:coverage` — ≥ vitest thresholds (88 stmts / 75 branches / 85 funcs / 90 lines)
- ✅ `npm run build` — clean `dist/`
- ✅ `npm run examples:check` — every `examples/*.json` references a live tool; self-contained examples execute and pass `assertValidPdf`

## Changes summary

### Added
- **Tool `extract_attachments`** (new, 14th tool, read-only) — byte-for-byte extraction of embedded files, completing the Factur-X / ZUGFeRD round-trip with `add_attachment`. Returns `{ attachmentCount, attachments: [{ name, sizeBytes?, mimeType?, relationship?, description?, dataBase64? }] }`. Shares `collectEmbeddedFiles()` with `inspect_pdf`; `filename` filter; `includeData: false` probe; rejects encrypted PDFs (`EXTRACTION_UNSUPPORTED`); caps payloads at 16 MiB/file and 32 MiB aggregate (`OUTPUT_TOO_LARGE`); `ATTACHMENT_NOT_FOUND` when a filter matches nothing.
- **Watermarks** — `generate_basic_pdf` and `add_table` accept an optional `watermark` ({ text, fontSize?, opacity?, angle?, color? [r,g,b] 0–1, position? }) rendered on every page. Omitted = byte-identical output. `opacity < 1.0` is rejected under `pdfA: 'pdfa1b'` (ISO 19005-1 §6.4).
- **Unicode `normalize`** — `generate_basic_pdf` and `add_international_text` accept an optional `normalize` (`'NFC' | 'NFD' | 'NFKC' | 'NFKD'`). `add_international_text` keeps its `'NFC'` default; `generate_basic_pdf` defaults to no normalization (byte-stable).
- **Token-frugal reads** — `inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text`, `extract_attachments` accept optional `verbosity: 'summary'` (compact scalar verdict) and `fields: ['a','b.c']` (dot-path projection, applied after `verbosity`). Backed by a new dependency-free `src/projection.ts`.
- **Root `AGENTS.md`** — agent operations manual: 14-tool catalogue, decision tree, token-frugal usage, output modes, recipes, error→remediation table.
- **Examples-as-tests** — `tests/examples.test.ts` loads every `examples/*.json`, asserts each referenced tool exists, and executes self-contained single-tool examples end-to-end (validating produced PDFs with `assertValidPdf`).
- **`assertValidPdf` helper** (`tests/_pdf-assert.ts`) — verifies `%PDF-` header, `%%EOF` trailer, real `openPdf()` parse, and page count ≥ 1; adopted across the generation suites.
- **New example files** — `watermarked-report.json`, `basic-watermark-normalize.json` (executable), `factur-x-roundtrip.json`, `token-frugal-read.json` (documentation, placeholder-driven).
- **`docs/guides/LOCAL_TESTING.md`** — contributor guide for verifying builds and PDF correctness locally (quality gate, examples runner, `inspect_pdf`/`validate_pdf`/`verify_pdf`, file output + viewer, veraPDF, MCP Inspector).
- **`examples:check` npm script**.

### Changed
- **Dependency:** `zod` `^3.23.8` → `^4.0.0` (resolved 4.4.3). The MCP SDK peer range already permitted zod 4; the only source change was migrating one `superRefine` issue code to the zod-4 string-literal form.
- **MCP registry ID:** `mcpName` (`package.json`) and `name` (`server.json`) → `io.github.Nizoka/pdfnative-mcp` (canonical GitHub login casing). The npm package name stays lowercase `pdfnative-mcp`.
- **MCP `_meta.apiVersion`** bumped `1.1.0` → `1.2.0` on every tool; `SERVER_VERSION` and `server.json` versions → `1.2.0`.
- **Base64 delivery:** base64-mode PDF-producing tools no longer duplicate the PDF into `structuredContent.base64`; the bytes are delivered once via the embedded `resource` content block. `structuredContent` for base64 mode is now `{ mode, sizeBytes }`. File mode is unchanged.
- **Tool count assertion** in `tests/server.test.ts` — 13 → 14; decision-tree and `tools/list` lists include `extract_attachments`.
- **Docs:** README, `AGENTS.md`, `docs/AI_GUIDE.md`, `docs/API_STABILITY.md`, `docs/KNOWLEDGE_BASE.md`, `ROADMAP.md`, `llms.txt` refreshed for the 14-tool / token-frugal surface.

### Fixed
- **MCP registry publication** failed because validation compares `mcpName` to the GitHub namespace with case-sensitive equality (`Nizoka`), while the published metadata used lowercase `nizoka`. Corrected to `io.github.Nizoka/pdfnative-mcp`.
- **Stale `multilingual-doc.json` example** used the removed `text` field instead of `paragraphs` — now caught and fixed by examples-as-tests.

## Deferred (with rationale)

- **`merge_pdfs` / `split_pdf` / `redact_pdf`** — pdfnative v1.3 still does not export page-tree manipulation primitives. Blocked on upstream API expansion.
- **Encryption / decryption tools** — out of scope for v1.2.0 by decision; no encrypted-PDF round-trip fixtures yet.
- **veraPDF in CI** — documented as an optional external validator in `LOCAL_TESTING.md`; intentionally not added as a project dependency to preserve the zero-superfluous-dependency philosophy.

## Reviewer checklist

- [ ] CHANGELOG.md v1.2.0 entry mirrors `release-notes/v1.2.0.md`
- [ ] `package.json` version === `server.json` versions === `SERVER_VERSION` === `1.2.0`
- [ ] `package.json` `mcpName` === `server.json` `name` === `io.github.Nizoka/pdfnative-mcp` (case-sensitive); npm `name` stays `pdfnative-mcp`
- [ ] Tool count assertion in `tests/server.test.ts` equals 14; list includes `extract_attachments`
- [ ] Every tool exposes `_meta.apiVersion === '1.2.0'` and a non-empty `_meta.examples` array
- [ ] `extract_attachments` schema + tests aligned (round-trip byte-match, filename filter, includeData:false, encrypted reject, caps, ATTACHMENT_NOT_FOUND)
- [ ] `watermark` rejected with `opacity < 1.0` under `pdfa1b`; omitted watermark = byte-identical output
- [ ] `normalize` default preserved (`NFC` on `add_international_text`, none on `generate_basic_pdf`)
- [ ] base64 NOT present in `structuredContent`; PDF delivered via the `resource` content block
- [ ] `verbosity: 'summary'` and `fields` project correctly; defaults unchanged
- [ ] `tests/examples.test.ts` passes; every `examples/*.json` references valid tools and self-contained examples produce valid PDFs
- [ ] `assertValidPdf` adopted in the touched generation suites
- [ ] `docs/guides/LOCAL_TESTING.md` linked from README + CONTRIBUTING
- [ ] `SERVER_INSTRUCTIONS` decision tree lists 14 tools incl. `extract_attachments`, watermark + normalize pitfalls
- [ ] `server.json` validates against the MCP registry schema
- [ ] zod 4 install clean (`npm audit` 0 vulnerabilities); no `any` added in `src/`
- [ ] No CodeQL alerts
- [ ] Test coverage ≥ vitest thresholds (88 / 75 / 85 / 90)

## Notes for the merger

- **Prepare-only:** this PR does **not** tag or publish. npm publication is handled by GitHub Actions Trusted Publishing (OIDC) after merge + tag.
- Open as **Draft** until the gate is re-confirmed on CI.
