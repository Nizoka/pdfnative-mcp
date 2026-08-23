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
  - npm run validate:pdfa (veraPDF, 24-file corpus with negative canaries; `VERAPDF_REQUIRED=1` to fail closed)

## Catalogue parity
- `tests/catalogue-parity.test.ts` compares the live `tools/list` structure with `tests/_fixtures/tool-shape.json`.
- After a deliberate schema change: `npm run build && node scripts/tool-shape.mjs --write`, then review the fixture diff under docs/API_STABILITY.md §5. Never refresh it to silence an accidental change.

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
