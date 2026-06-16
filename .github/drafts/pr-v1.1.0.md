# PR: v1.1.0 — pdfnative 1.3 alignment + AI-friendliness

## Summary

A minor, fully backward-compatible release that upgrades the engine to [pdfnative v1.3.0](https://github.com/Nizoka/pdfnative/releases/tag/v1.3.0) and hardens the server for AI agents. Adds a 13th tool (`validate_pdf` for PDF/UA validation), six new scripts (`te`, `si`, `bo`, `km`, `my`, `am`), COLRv1 colour emoji support, and a deterministic newline sanitizer that turns common LLM formatting habits into valid PDF/A output. Includes security hardening via npm audit fix (hono, js-yaml, vite vulnerabilities). No breaking changes — all v1.0.0 tool calls work unchanged.

Full notes: [`release-notes/v1.1.0.md`](../../release-notes/v1.1.0.md).

## Scope (1 commit + npm audit fix)

| Phase | Subject |
| --- | --- |
| 1 | Foundation upgrade — pdfnative 1.3.0, validate_pdf tool, newline sanitizer |
| 2 | International scripts (6 new: te, si, bo, km, my, am) + COLRv1 emoji + NFC normalization |
| 3 | Security: npm audit fix (hono, js-yaml, vite path traversal / DoS / CORS vulnerabilities) |
| 4 | MCP apiVersion 1.1.0 on all tools, SERVER_VERSION bump, SERVER_INSTRUCTIONS / llms.txt refresh |
| 5 | Docs: CHANGELOG v1.1.0, release-notes sync, examples, test suite validation |

## Closes

- Roadmap v1.1.0 — all items except `merge_pdfs` / `split_pdf` / `redact_pdf` (deferred to v1.2, blocked on upstream page-tree export API)

## Quality gate

- ✅ `npm run typecheck:all` — 0 errors
- ✅ `npm run lint` — 0 errors (36 warnings on non-null assertions, pre-existing from v1.0.0)
- ✅ `npm run test` — 173/173 passing across 19 files
- ✅ `npm run test:coverage` — 88.96 / 76.16 / 97.12 / 91.7 (stmts / branches / funcs / lines), all ≥ vitest thresholds
- ✅ `npm run build` — clean dist
- ✅ `npm audit` — 0 vulnerabilities (fixed: hono 4 path traversal, js-yaml DoS, vite fs.deny bypass)

## Changes summary

### Added
- **Tool `validate_pdf`** (new, 13th tool) — PDF/UA (ISO 14289-1) structural conformance check via pdfnative's `validatePdfUA()`. Returns `{ standard: 'pdf-ua-1', valid, errors[], warnings[], summary }`.
- **Six new international scripts** — Telugu (`te`), Sinhala (`si`), Tibetan (`bo`), Khmer (`km`), Myanmar (`my`), Ethiopic (`am`) via pdfnative v1.3 bundled Noto font modules. **24 scripts total**.
- **COLRv1 colour emoji** — `add_international_text` `lang='emoji'` now renders native colour emoji (Noto Color Emoji) with automatic monochrome fallback.
- **Newline auto-split sanitizer** — paragraphs with `\n` / `\r\n` / `\r` are split into discrete blocks, eliminating `.notdef` tofu from LLM-generated multi-line text. Applies to `generate_basic_pdf` and `add_international_text`.
- **Automatic NFC normalization** — `add_international_text` normalizes input to NFC for maximal glyph coverage.

### Changed
- **Dependency:** `pdfnative` bumped `^1.2.0` → `^1.3.0`.
- **Dependency security:** hono, js-yaml, vite updated via `npm audit fix` (3 high & 1 moderate vulnerabilities closed).
- **MCP `_meta.apiVersion`** bumped `1.0.0` → `1.1.0` on all 13 tools.
- **`SERVER_VERSION`** → `1.1.0`.
- **`SERVER_INSTRUCTIONS` / `llms.txt`** — refreshed decision tree (13 tools), 24-script copy, PDF/A survival directives.
- **Tool count assertion** in `tests/server.test.ts` — 12 → 13.

### Fixed
- **Euro sign & CP-1252 symbols** (`€ ‚ ƒ „ … † ‡ ™ œ ž Ÿ`) — now render and extract correctly thanks to pdfnative v1.3's Base-14 `/ToUnicode` fix. EUR workaround no longer needed.
- **Duplicate MCID in wrapped table cells** — pdfnative v1.3 assigns unique MCID per line, so tagged/PDF-A tables are now PDF/UA-safe.
- **Path traversal on Windows** (hono 4.12.24) — encoded backslash (`%5C`) injection in `serve-static` fixed.
- **CORS middleware credential reflection** (hono 4.12.24) — wildcard origin no longer reflects credentials.
- **Body Limit bypass on AWS Lambda** (hono 4.12.24) — understated Content-Length no longer bypasses limit.
- **Quadratic DoS in YAML merge keys** (js-yaml 4.1.1) — repeated aliases no longer trigger exponential complexity.
- **NTLMv2 hash disclosure** (vite 8.0.15) — UNC path handling on Windows hardened.
- **fs.deny bypass** (vite 8.0.15) — Windows alternate path traversal fixed.

## Deferred (with rationale)

- **`merge_pdfs` / `split_pdf` / `redact_pdf`** — pdfnative v1.3 still does not export page-tree manipulation primitives. Blocked on upstream API expansion.
- **Per-tool HTTP page-by-page streaming** — unchanged from v1.0.0; still pending upstream capabilities.
- **Encrypted-PDF round-trip fixtures** — unchanged from v1.0.0; still pending upstream capabilities.

## Reviewer checklist

- [ ] CHANGELOG.md v1.1.0 entry mirrors `release-notes/v1.1.0.md`
- [ ] `package.json` version === SERVER_VERSION === `1.1.0`
- [ ] Tool count assertion in `tests/server.test.ts` equals 13
- [ ] Every tool exposes `_meta.apiVersion === '1.1.0'` and a non-empty `_meta.examples` array
- [ ] `validate_pdf` tool schema and tests are aligned (5 test cases, boundary validation, non-PDF handling)
- [ ] `add_international_text` covers **24 scripts** (original 17 + 6 new)
- [ ] `add_international_text.test.ts` verifies emoji COLRv1 + emoji monochrome fallback
- [ ] `text.test.ts` covers newline auto-split (LF, CRLF, CR, whitespace filtering)
- [ ] `SERVER_INSTRUCTIONS` contains DECISION TREE (13 tools) and COMMON PITFALLS sections
- [ ] `server.json` validates against the MCP registry schema
- [ ] `llms.txt` refreshed with 24-script + emoji + validate_pdf copy
- [ ] Examples in `examples/*.json` parse as JSON and reference valid tool names
- [ ] Upgrade guide in `release-notes/v1.1.0.md` covers new tools and script support
- [ ] No new `any` types in `src/`
- [ ] No CodeQL alerts
- [ ] `npm audit` exits 0
- [ ] Test coverage ≥ 88.95% (stmts), ≥ 76.02% (branches), ≥ 97.70% (funcs), ≥ 91.77% (lines)
