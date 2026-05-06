# Tracking issue: v0.3.0 release

> Suggested title: **Release v0.3.0 — PDF/A output, `inspect_pdf` tool, multi-script docs, MCP `outputSchema`**
> Labels: `release`, `enhancement`

## Goal

Cut **pdfnative-mcp v0.3.0** integrating [pdfnative v1.1.0](https://github.com/Nizoka/pdfnative/releases/tag/v1.1.0) and shipping a 9th tool (`inspect_pdf`).

## Scope (in this release)

- [x] Bump `pdfnative` to `^1.1.0`.
- [x] Boot `initCrypto()` alongside compression.
- [x] Add **`inspect_pdf`** tool (read-only).
- [x] Add **`pdfA`** flag to every document tool.
- [x] Extend `add_international_text` with `latin` / `emoji` + polymorphic `lang`.
- [x] Extend `add_table` with `autoFitColumns` / `clipCells`.
- [x] Publish **`outputSchema`** per tool (MCP 2025-06-18).
- [x] Expand npm keywords + refreshed description.
- [x] Star call-out in README.
- [x] New [ROADMAP.md](../../ROADMAP.md).
- [x] Tests + docs sweep + release notes + draft PR.

## Out of scope (deferred to v0.4.0)

- [ ] `verify_pdf` (no high-level CMS verify primitive in pdfnative 1.1).
- [ ] `sign_pdf` placeholder auto-injection.
- [ ] ECDSA DER private-key input.
- [ ] Encrypted-PDF fixtures so `inspect_pdf` AES detection branches are exercised by unit tests (currently `v8 ignore`d).

See [ROADMAP.md](../../ROADMAP.md) for the long-term plan.

## Quality gate

`npm run typecheck:all && npm run lint && npm run test && npm run test:coverage && npm run build` — all green. 78/78 tests pass; coverage stmts 95.91% / branches 82.70% / funcs 98.33% / lines 97.77% (80% branch threshold preserved).

## Links

- Branch: `release/v0.3.0`
- Draft PR body: [pr-v0.3.0.md](pr-v0.3.0.md)
- Release notes: [release-notes/v0.3.0.md](../../release-notes/v0.3.0.md)
- Roadmap: [ROADMAP.md](../../ROADMAP.md)
