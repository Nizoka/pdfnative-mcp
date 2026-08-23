---
description: "Use when writing tests, extending coverage, or debugging failures for pdfnative-mcp."
applyTo: "tests/**"
---
# Testing Standards

## Framework
- vitest
- Commands:
  - npm run test
  - npm run test:watch
  - npm run test:coverage
  - npm run typecheck:all
  - npm run examples:check (runs every examples/*.json live; multi-step examples are chained)
  - npm run validate:pdfa (veraPDF, 26-file corpus — 24 validated incl. 3 negative canaries, 2 page-tree outputs skipped; `VERAPDF_REQUIRED=1` to fail closed)
  - npm run lint (`eslint src --max-warnings 0` — warnings fail)

## Catalogue parity
- `tests/catalogue-parity.test.ts` compares the live `tools/list` structure with `tests/_fixtures/tool-shape.json`.
- After a deliberate schema change: `npm run build && node scripts/tool-shape.mjs --write`, then review the fixture diff under docs/API_STABILITY.md §5. Never refresh it to silence an accidental change.
- `tests/catalogue-superset.test.ts` compares the live catalogue with the frozen `tests/_fixtures/tool-shape.v1.5.0.json`: no tool / property / enum value removed, no new `required`, no tighter bound; the accepted 1.5.0 → 1.6.0 deltas are enumerated in the test and must each still occur. Never regenerate the 1.5.0 fixture.
- `tests/error-codes.test.ts` inventories every `ToolError` code in `src/` and asserts AGENTS.md §6 documents it and a test names it.

## Test focus
- Validate tool success and tool error paths.
- Validate schema constraints for each MCP tool.
- Validate sandbox protections in output.ts:
  - path traversal blocked
  - absolute paths blocked
  - NUL byte blocked
  - non-.pdf extension blocked
  - file output blocked when sandbox env var is unset

## Style
- Use describe/it structure.
- One behavior per test.
- Avoid brittle snapshot tests for binary output.
- For generated PDF bytes, validate structure markers (%PDF- and EOF) and expected mode/metadata.

## Quality gate
- All tests must pass.
- Coverage must not regress in touched modules.
