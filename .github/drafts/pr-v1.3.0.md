# PR: v1.3.0 — page-tree tools, pdfnative 1.4 features, constant-time signing

## Summary

A minor, fully backward-compatible release that extends pdfnative-mcp to **17 tools** and threads the new [pdfnative v1.4.0](https://github.com/Nizoka/pdfnative) capabilities through the server. Adds three **page-tree tools** — `merge_pdfs`, `split_pdf`, `extract_pages` — finally unblocking the long-deferred roadmap items now that pdfnative exports a safe page-tree API. Threads pdfnative 1.4's **document features** (bookmarks/`outline`, `pageLabels`, nested `list` items, `viewerPreferences`, table `cellBorders`/`cellVAlign`) into the authoring tools, and hardens `sign_pdf` with a per-call constant-time **`node:crypto` signature provider** (transparent pure-JS fallback). No breaking changes — all v1.2.0 tool calls work unchanged and default responses are byte-identical.

Full notes: [`release-notes/v1.3.0.md`](../../release-notes/v1.3.0.md).

## Scope

| Phase | Subject |
| --- | --- |
| 0 | Branch + version bump (package.json `1.3.0`, pdfnative pin `^1.4.0`) |
| 1 | Page-tree tools: `emitPdfMulti` + `MultiOutputResult` (`src/output.ts`), `src/pagetree.ts` error mapping, `merge_pdfs`, `split_pdf`, `extract_pages` |
| 2 | Document features: `src/doc-features.ts` (outline / page labels / viewer prefs / nested lists) threaded into `generate_basic_pdf`, `add_table` (`cellBorders`/`cellVAlign`), `add_international_text` |
| 3 | Constant-time signing: `src/crypto-provider.ts` (`node:crypto`) wired into `sign_pdf` with pure-JS fallback |
| 4 | Server registration (3 tools, `MULTI_PDF_OUTPUT_SCHEMA`, dispatch, `SERVER_VERSION`/`apiVersion` → 1.3.0, decision tree); `index.ts`, `server.json` |
| 5 | Tests: page-tree fixtures + 6 new suites + extended `output.test.ts`; `server.test.ts` → 17 tools / 1.3.0 |
| 6 | Examples: `merge-pdfs`, `split-pdf`, `extract-pages`, `bookmarked-report`, `bordered-table` |
| 7 | Docs: README, AGENTS.md, AI_GUIDE, API_STABILITY, KNOWLEDGE_BASE, LOCAL_TESTING, ROADMAP, llms.txt, copilot-instructions |
| 8 | Security & spec alignment: HTTP DNS-rebinding protection (cli.ts), `serverInfo` title/description (server.ts), JSON-Schema-2020-12 dialect guard, MCP-2025-11-25 protocol notes |
| 9 | Release: `release-notes/v1.3.0.md`, CHANGELOG mirror, this PR draft |

## Closes

- Roadmap: ships the previously **blocked-upstream** page-tree tools `merge_pdfs`, `split_pdf`, plus the new `extract_pages` (pdfnative v1.4.0 page-tree export API).
- `redact_pdf` and an encrypted-PDF round-trip remain deferred (blocked on upstream pdfnative content-redaction / Standard Security Handler writer APIs).

## Quality gate

- ✅ `npm run typecheck:all` — 0 errors
- ✅ `npm run lint` — 0 errors (36 pre-existing non-null-assertion warnings in untouched files)
- ✅ `npm run test:coverage` — **306 tests** passing; **89.96** stmts / **78.85** branches / **95.43** funcs / **92.14** lines (≥ vitest thresholds 88 / 75 / 85 / 90)
- ✅ `npm run build` — clean `dist/`
- ✅ `npm run examples:check` — every `examples/*.json` references a live tool; self-contained examples execute and pass `assertValidPdf`

## Changes summary

### Added
- **Tool `merge_pdfs`** (new, 15th) — concatenate 2–50 PDFs (`pdfsBase64[]`) into one via pdfnative's page-tree API. Optional `dropAnnotations`/`maxOutputSizeBytes`; standard `outputMode`/`outputPath`. Encrypted sources → `ENCRYPTED_SOURCE`; oversize output → `OUTPUT_TOO_LARGE` (shared `src/pagetree.ts`).
- **Tool `split_pdf`** (new, 16th) — split one PDF into one document per page range (`ranges: [{ start, end? }]`, 0-based inclusive; `end` defaults to `start`, validated `end >= start`). Returns the new `MultiOutputResult` (`{ mode, count, totalSizeBytes, parts[] }`); file mode writes indexed paths (`report.pdf` → `report-1.pdf`, …).
- **Tool `extract_pages`** (new, 17th) — pull an arbitrary page subset (`pages: number[]`, 0-based, max 5000, order preserved) into a single PDF.
- **`generate_basic_pdf`** — optional `outline` (`'auto'` or explicit `[{ title, pageIndex, children?, open? }]` tree, depth ≤ 6), `pageLabels` (`[{ startPage, style?, prefix?, start? }]`), nested `list` items (`{ text, items?, style? }`, depth ≤ 6), and `viewerPreferences`.
- **`add_table`** — optional `cellBorders` ({ top?, right?, bottom?, left?, color?, width? }), `cellVAlign` (`'top'|'middle'|'bottom'`), and `viewerPreferences` (any forces the document backend).
- **`add_international_text`** — optional `viewerPreferences`.
- **`src/crypto-provider.ts`** — `buildNodeCryptoProvider()` returns a per-call `node:crypto` `CryptoProvider` (RSA PKCS#1/PKCS#8; ECDSA P-256 SEC1/PKCS#8, DER signatures), or `null` on import failure.
- **`src/output.ts`** — `emitPdfMulti()` + `MultiOutputResult`/`MultiOutputPart` (per-part 50 MiB cap, 200 MiB aggregate); `indexedOutputPath()` helper.
- **`src/doc-features.ts`** — shared Zod schemas + mappers (nested lists, outline, page labels, viewer preferences) reused across authoring tools.
- **`src/pagetree.ts`** — `mapPageTreeError()` centralises page-tree error mapping.
- **Security (HTTP transport):** the optional Streamable HTTP transport (`PDFNATIVE_MCP_PORT`) enables DNS-rebinding protection — `enableDnsRebindingProtection` + `allowedHosts`/`allowedOrigins` pinned to the loopback authority; foreign `Host`/`Origin` → **403** (MCP Security Best Practices). stdio unaffected.
- **`serverInfo` metadata:** advertises `title` + `description` (MCP `Implementation`, mirroring `server.json`).
- **Examples** — `merge-pdfs.json`, `split-pdf.json`, `extract-pages.json`, `bookmarked-report.json`, `bordered-table.json` (executable, guarded by examples-as-tests).
- **Tests** — `merge-pdfs.test.ts`, `split-pdf.test.ts`, `extract-pages.test.ts`, `crypto-provider.test.ts`, `sign-pdf-provider.test.ts`, `doc-features.test.ts`, `http-transport.test.ts` (DNS-rebinding 403), a JSON-Schema-2020-12 dialect guard + `serverInfo` metadata assertions in `server.test.ts`, `_pagetree-fixtures.ts`; extended `output.test.ts`.

### Changed
- **Dependency:** `pdfnative` `^1.3.0` → `^1.4.0` (additive — page-tree, outline, page-label, viewer-preference, nested-list, cell-border APIs).
- **Signing:** RSA and EC-DER paths sign through the `node:crypto` provider (constant-time) with a transparent pure-JS fallback when key import fails; the raw-scalar `ecPrivateScalarHex` path stays pure-JS. Produced signatures are interoperable and verify identically with `verify_pdf`.
- **MCP `_meta.apiVersion`** bumped `1.2.0` → `1.3.0` on every tool; `SERVER_VERSION` and `server.json` versions → `1.3.0`.
- **Server:** `SERVER_INSTRUCTIONS` decision tree extended to 17 tools (combine/carve branch + page-tree, signing, nested-list pitfalls); new `MULTI_PDF_OUTPUT_SCHEMA` advertised for `split_pdf`; `dispatchOutput` handles the multi-output shape first.
- **Tool count assertion** in `tests/server.test.ts` — 14 → 17.
- **MCP protocol alignment:** built on `@modelcontextprotocol/sdk` ^1.29, which negotiates the latest **2025-11-25** revision (fallback `2025-06-18`/`2025-03-26`); tool schemas are JSON Schema 2020-12 (dialect-agnostic); `merge_pdfs`' `maxOutputSizeBytes` documented as the in-memory assembly guard (distinct from the 50 MiB emit cap).
- **Docs:** README, `AGENTS.md`, `docs/AI_GUIDE.md`, `docs/API_STABILITY.md`, `docs/KNOWLEDGE_BASE.md`, `docs/guides/LOCAL_TESTING.md`, `ROADMAP.md`, `llms.txt`, and `.github/copilot-instructions.md` refreshed for the 17-tool / pdfnative-1.4 surface + protocol alignment.

## Deferred (with rationale)

- **`redact_pdf`** — pdfnative does not yet export an annotation read/write or content-stream redaction API. Building it on raw primitives would be production-unsafe. Blocked upstream.
- **Encrypted-PDF round-trip fixtures** — once pdfnative exposes a Standard Security Handler writer.
- **Per-tool HTTP page-by-page streaming** — once MCP allows partial `structuredContent` envelopes.

## Reviewer checklist

- [ ] CHANGELOG.md v1.3.0 entry mirrors `release-notes/v1.3.0.md`
- [ ] `package.json` version === `server.json` versions === `SERVER_VERSION` === `1.3.0`
- [ ] Tool count assertion in `tests/server.test.ts` equals 17; list includes `merge_pdfs`, `split_pdf`, `extract_pages`
- [ ] Every tool exposes `_meta.apiVersion === '1.3.0'` and a non-empty `_meta.examples` array
- [ ] Page-tree tools reject encrypted sources with `ENCRYPTED_SOURCE`; oversize output → `OUTPUT_TOO_LARGE`
- [ ] `split_pdf` returns the multi-output shape `{ mode, count, totalSizeBytes, parts[] }`; file mode writes indexed paths
- [ ] `outline` / `pageLabels` / nested `list` items / `viewerPreferences` produce the expected catalog entries; omitting them = byte-identical output
- [ ] `add_table` `cellBorders` / `cellVAlign` force the document backend; default output unchanged
- [ ] `sign_pdf` constant-time `node:crypto` path verifies identically with `verify_pdf`; pure-JS fallback path covered (RSA PKCS#1, EC PKCS#8/SEC1, raw scalar)
- [ ] `SERVER_INSTRUCTIONS` decision tree lists 17 tools incl. the combine/carve branch
- [ ] HTTP transport rejects a foreign `Host`/`Origin` with **403** and accepts the loopback authority (covered by `http-transport.test.ts`)
- [ ] `serverInfo` advertises `title` + `description`; tool schemas pass the JSON-Schema-2020-12 dialect guard
- [ ] `server.json` validates against the MCP registry schema
- [ ] No `any` added in `src/`; no new CodeQL alerts
- [ ] Test coverage ≥ vitest thresholds (88 / 75 / 85 / 90)

## Notes for the merger

- No breaking changes; minor bump per [`docs/API_STABILITY.md`](../../docs/API_STABILITY.md) §3 (new tools + new optional inputs).
- Publish is via GitHub Actions Trusted Publishing (OIDC) — no `NPM_TOKEN`.
- GitHub Release title: `v1.3.0 — page-tree tools, pdfnative 1.4 features, constant-time signing`.
