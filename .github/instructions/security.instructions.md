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
- Validate base64/hex strictly before use — decode through `src/base64.ts` (DER expected; PEM is rejected with a `VALIDATION_ERROR` + openssl remedy).
- Provide clear validation errors without leaking sensitive payload content.
- Never log or echo passwords, key/cert material, `PDFNATIVE_MCP_TSA_AUTH` or `PDFNATIVE_MCP_HTTP_TOKEN`.

## Network and HTTP
- The only egress path is `src/network.ts` (operator-configured TSA / OCSP / CRL endpoints behind the SSRF guard); a tool argument never supplies a URL.
- HTTP mode (`PDFNATIVE_MCP_PORT`) binds loopback and checks Host/Origin; `PDFNATIVE_MCP_HTTP_TOKEN` (`src/auth.ts`, ≥ 16 chars, constant-time compare) is the only authentication — recommend it, and document that without it any local process can reach the endpoint.

## Dependency and CI security
- Exactly three runtime dependencies (pdfnative, `@modelcontextprotocol/server`, zod); adding one is a governance blocker.
- npm publish via OIDC Trusted Publishing only.
- Keep lockfile committed and audit in CI.
- Run CodeQL and Scorecard workflows.
