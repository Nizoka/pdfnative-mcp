# pdfnative-mcp - Project Guidelines

## Overview

MCP server bridging pdfnative to AI clients over stdio.
Target quality: production-grade open source quality (strict TypeScript, strong validation, secure file IO, deterministic release process).

## Architecture

- src/cli.ts: stdio entry point.
- src/server.ts: tool registry and MCP request handlers.
- src/tools/: one file per tool (schema + runtime validation + handler).
- src/output.ts: output mode (base64 or sandboxed file write).
- src/errors.ts: ToolError and SecurityError.
- tests/: unit tests for tool behavior and sandbox security.

## Core conventions

- Strict TypeScript only.
- No any. Use unknown + narrowing.
- Validate all tool inputs at boundaries with Zod.
- Keep JSON schema and runtime schema aligned.
- Never write files outside PDFNATIVE_MCP_OUTPUT_DIR sandbox.
- For outputMode=file:
  - reject absolute paths
  - reject path traversal
  - reject NUL byte paths
  - enforce .pdf extension

## Build and quality gate

- npm run typecheck:all
- npm run lint
- npm run test
- npm run test:coverage
- npm run build

All PRs must pass the full quality gate.

## Release process

- release-notes/vX.Y.Z.md is mandatory for each release.
- CHANGELOG.md mirrors release bullets.
- GitHub Release title format: vX.Y.Z - short description.
- npm publish runs through GitHub Actions Trusted Publishing (OIDC), no NPM_TOKEN.
