---
description: "Run the full quality gate for pdfnative-mcp and report pass/fail by step."
agent: "agent"
---
# Quality Gate

Run the full project quality gate and report results.

## Steps

1. npm run typecheck:all
2. npm run lint
3. npm run test
4. npm run test:coverage
5. npm run build
6. Verify dist output contains:
   - dist/index.js
   - dist/index.d.ts
   - dist/cli.js
7. Summarize pass/fail for each step

## Thresholds
- Zero TypeScript errors
- Zero ESLint errors
- All tests passing
- Coverage thresholds respected
- Build output present
