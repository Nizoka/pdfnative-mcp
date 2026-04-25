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
