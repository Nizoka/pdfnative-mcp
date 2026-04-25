---
description: "Investigate and fix a GitHub issue or CI failure with minimal, test-backed changes."
agent: "agent"
---
# GitHub Fix Workflow

Given an issue or CI failure, execute this workflow:

1. Reproduce the issue locally.
2. Isolate root cause with file-level evidence.
3. Apply the smallest safe fix.
4. Add or update tests proving the fix.
5. Run quality gate:
   - npm run typecheck:all
   - npm run lint
   - npm run test
   - npm run build
6. Update CHANGELOG and release-notes if user-visible.
7. Provide a concise summary:
   - root cause
   - fix
   - tests added
   - risk assessment
