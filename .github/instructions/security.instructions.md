---
description: "Use when touching file IO, path handling, or sensitive key/certificate inputs."
applyTo: "src/output.ts,src/tools/sign-pdf.ts,src/server.ts"
---
# Security Standards

## Filesystem confinement
- All file writes must stay inside PDFNATIVE_MCP_OUTPUT_DIR.
- Reject:
  - absolute paths
  - .. path traversal
  - NUL byte paths
  - non-.pdf output extensions
- Use safe path resolution and canonicalization before writing.

## Signing input handling
- Treat cert/key fields as sensitive input.
- Validate base64/hex strictly before use.
- Provide clear validation errors without leaking sensitive payload content.

## Dependency and CI security
- npm publish via OIDC Trusted Publishing only.
- Keep lockfile committed and audit in CI.
- Run CodeQL and Scorecard workflows.
