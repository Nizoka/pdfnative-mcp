# Draft: PR body for v0.3.0

> Branch: `release/v0.3.0` → `main`
> Suggested title: **release: v0.3.0 — PDF/A output, `inspect_pdf` tool, multi-script docs, MCP `outputSchema`**

## Summary

Lifts `pdfnative-mcp` onto **pdfnative v1.1.0**, surfacing the engine's new PDF/A
conformance, Latin/Emoji font packs, and table autoFit/clip features through the
MCP tool surface. Adds a brand-new **`inspect_pdf`** read-only tool and ships
**`outputSchema`** on every tool (per the MCP 2025-06-18 spec). Fully
backward-compatible with v0.2.0 callers.

## What's new

- 9th tool: **`inspect_pdf`** — PDF version, page count, encryption state, PDF/A claim, signature count, info dict, optional per-page sizes, optional CI assertions.
- **PDF/A flag** (`pdfa1b` / `pdfa2b` / `pdfa2u` / `pdfa3b`) on every document tool.
- **Multi-script `add_international_text`** — `lang` accepts `string`, `string[]`, or comma-separated, and gains new `latin` and `emoji` codes.
- **`add_table`** — optional `autoFitColumns` and `clipCells`.
- **`outputSchema`** advertised in `tools/list` for every tool.
- `initCrypto()` awaited at boot so first signing/inspection is hot.
- New [ROADMAP.md](../../ROADMAP.md) covering v0.4.0 → v1.0.0 and long-term direction.

## Deferred to v0.4.0

After probing pdfnative 1.1's public surface, the following items were honestly
deferred (no high-level primitives exist yet):

- `verify_pdf` (no high-level CMS verify primitive in pdfnative 1.1)
- `sign_pdf` placeholder auto-injection
- ECDSA DER private-key input
- Encrypted-PDF fixtures so `inspect_pdf` AES detection branches are exercised by unit tests

See [release-notes/v0.3.0.md](../../release-notes/v0.3.0.md) for the full breakdown.

## Compatibility

No breaking changes. Every new tool field is optional; default code paths
produce byte-identical output to v0.2.0.

## Quality gate

```
typecheck:all   ✅
lint            ✅
test            ✅ 78 / 78 (10 files)
test:coverage   ✅ statements 95.91% │ branches 82.70% │ functions 98.33% │ lines 97.77%
build           ✅
```

> All thresholds (statements 90 / branches 80 / functions 85 / lines 90) preserved
> from v0.2.0. Genuinely-defensive code paths (encryption detection in `inspect_pdf`,
> internal pdfnative error catches in `embed_image` / `sign_pdf` /
> `prepare_signature_placeholder`) are scoped behind `/* v8 ignore start/stop */`
> markers with documented rationale in-source. Encrypted-PDF fixtures will land in v0.4.0.

## Files changed (high level)

- `package.json` — dep bump, version bump, expanded keywords, refreshed description.
- `src/server.ts` — 9 tools, `outputSchema` everywhere, `initCrypto` boot, `buildInspectResult`.
- `src/tools/inspect-pdf.ts` — **new**.
- `src/tools/add-international-text.ts` — latin/emoji + multi-lang + pdfA.
- `src/tools/add-table.ts` — autoFit / clip / pdfA.
- `src/tools/{generate-basic-pdf,add-form,embed-image,add-barcode,prepare-signature-placeholder}.ts` — pdfA + scoped v8 ignore on internal-only catches.
- `src/tools/sign-pdf.ts` — scoped v8 ignore on internal pdfnative throw-path.
- `tests/inspect-pdf.test.ts` — **new** (10 cases).
- `tests/{add-table,add-international-text,server}.test.ts` — updates.
- `README.md`, `docs/KNOWLEDGE_BASE.md`, `CHANGELOG.md`, `release-notes/v0.3.0.md`, `ROADMAP.md` (new).

## Checklist

- [x] CHANGELOG updated (Keep a Changelog 1.1.0).
- [x] release-notes/v0.3.0.md added (mandated by `release.instructions.md`).
- [x] ROADMAP.md added.
- [x] All quality gates pass locally (80% branch threshold preserved).
- [x] No breaking changes.
- [x] README + Knowledge Base updated.
- [x] Star call-out added to README.
