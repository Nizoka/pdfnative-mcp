## Description

This PR implements the complete v0.2.0 roadmap for pdfnative-mcp.

Main additions:
- 4 new tools: add_table, add_form, embed_image, prepare_signature_placeholder.
- Complete two-step signing workflow: prepare_signature_placeholder -> sign_pdf.
- Optional Streamable HTTP MCP transport via PDFNATIVE_MCP_PORT.
- Release/documentation updates: README, CHANGELOG, release-notes/v0.2.0.md.

Validation summary:
- Full quality gate passes: typecheck, lint, tests, coverage, build.
- Coverage thresholds are met (Statements 94.91%, Branches 81.22%, Functions 97.72%, Lines 96%).
- Sandbox protections validated in output tests (path traversal, absolute path, NUL byte, non-.pdf extension blocked; file output blocked when sandbox env is unset).

Compatibility:
- No breaking changes for v0.1.0 users.
- Existing tool contracts remain stable; tools/list now returns 8 tools instead of 4.

## Related Issues

Fixes #<issue-v0.2.0>
Relates to roadmap v0.2.0.

## Checklist

- [x] Tests pass (`npm run test`)
- [x] Type check passes (`npm run typecheck:all`)
- [x] Lint passes (`npm run lint`)
- [x] New code has tests
- [x] CHANGELOG.md updated (if user-facing change)
- [x] No breaking changes (or documented in description)
