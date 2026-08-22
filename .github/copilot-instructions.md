# pdfnative-mcp - Project Guidelines

> Full context (architecture, tool schemas, output system, security design):
> [`docs/KNOWLEDGE_BASE.md`](../docs/KNOWLEDGE_BASE.md). Don't duplicate it here.

## Overview

MCP server bridging pdfnative (v1.7.x) to AI clients over stdio or Streamable
HTTP, on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, MCP
2026-07-28 with automatic 2025-era fallback). 27 tools. Current release 1.6.0.
Quality bar: production-grade OSS (strict TypeScript, strong validation, secure
file IO, no egress except operator-configured TSA / OCSP / CRL endpoints,
deterministic releases).

## Architecture (one line each)

- src/cli.ts — stdio (`serveStdio`) / Streamable HTTP (`createMcpHandler`) entry point.
- src/http.ts — Node http ↔ Web Request/Response bridge + Host/Origin loopback guard.
- src/server.ts — tool registry (+ MCP annotations) + request handlers on the low-level `Server` + SERVER_INSTRUCTIONS + SERVER_CACHE_HINTS; resources & prompts capabilities.
- src/tools/* — one file per tool (JSON schema `as const` + parallel Zod + handler).
- src/network.ts — the only egress path: operator-configured TSA / OCSP / CRL providers + SSRF guard; URLs never come from tool arguments.
- src/print.ts — shared print-production schema (boxes, bleed, marks, userUnit, outputIntent, metadata).
- src/diagnostics.ts — PDF/A diagnostics sink (`strict` / `includeDiagnostics` / `embedFonts`) + `mapBuildError`.
- src/encryption.ts — shared password/encrypt schema + decrypt error mapper.
- src/chart.ts — shared charts v2 schema + mapper (add_chart and the generate_basic_pdf chart block).
- src/resources.ts — native MCP resources over the sandbox output dir (pdfnative://output/…).
- src/text.ts — newline sanitizer (Safe PDF/A).
- src/output.ts — output mode (base64 or sandboxed file write).
- src/errors.ts — ToolError, SecurityError, GovernanceError.
- tests/* — unit tests for tool behavior and sandbox security; tests/_encrypted-fixtures.ts builds encrypted PDFs in-process.

## Core conventions

- Strict TypeScript; no `any` (use `unknown` + narrowing).
- Validate every tool input at the boundary with Zod; keep JSON schema and Zod aligned.
- Never write outside PDFNATIVE_MCP_OUTPUT_DIR. For outputMode=file: reject absolute
  paths, path traversal, NUL bytes; enforce `.pdf`.
- Never echo key/cert material or PDFNATIVE_MCP_TSA_AUTH in errors or logs.
- Never add a network path outside src/network.ts; never accept a URL from a tool argument.

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
