# pdfnative-mcp - Project Guidelines

> Full context (architecture, tool schemas, output system, security design):
> [`docs/KNOWLEDGE_BASE.md`](../docs/KNOWLEDGE_BASE.md). Don't duplicate it here.

## Overview

MCP server bridging pdfnative (v1.3.x) to AI clients over stdio. 13 tools.
Quality bar: production-grade OSS (strict TypeScript, strong validation, secure
file IO, deterministic releases).

## Architecture (one line each)

- src/cli.ts — stdio entry point.
- src/server.ts — tool registry + MCP request handlers + SERVER_INSTRUCTIONS.
- src/tools/* — one file per tool (JSON schema + Zod + handler).
- src/text.ts — newline sanitizer (Safe PDF/A).
- src/output.ts — output mode (base64 or sandboxed file write).
- src/errors.ts — ToolError and SecurityError.
- tests/* — unit tests for tool behavior and sandbox security.

## Core conventions

- Strict TypeScript; no `any` (use `unknown` + narrowing).
- Validate every tool input at the boundary with Zod; keep JSON schema and Zod aligned.
- Never write outside PDFNATIVE_MCP_OUTPUT_DIR. For outputMode=file: reject absolute
  paths, path traversal, NUL bytes; enforce `.pdf`.
- Never echo key/cert material in errors or logs.

## Quality gate (all PRs)

`npm run typecheck:all && npm run lint && npm run test && npm run test:coverage && npm run build`

## Release process

- release-notes/vX.Y.Z.md is mandatory; CHANGELOG.md mirrors it.
- GitHub Release title: `vX.Y.Z - short description`.
- npm publish via GitHub Actions Trusted Publishing (OIDC), no NPM_TOKEN.

## Working efficiently (token-aware)

Optimize for minimal tokens in both planning and implementation, without lowering
quality:

- Gather context in parallel, then act; don't re-read files already in context.
- Make targeted edits — don't reprint whole files or restate unchanged code.
- Keep replies concise: no preambles, no change-summary essays, no new markdown
  docs unless asked. Let the diff speak.
- Reuse the scoped `.github/instructions/*.md` rather than re-deriving conventions.
