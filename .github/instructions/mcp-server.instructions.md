---
description: "Use when editing MCP transport, tool registration, JSON schemas, or request/response handling."
applyTo: "src/server.ts,src/tools/**,src/cli.ts"
---
# MCP Server Standards

## Transport and lifecycle
- stdio transport by default; Streamable HTTP when `PDFNATIVE_MCP_PORT` is set.
- Gracefully close the server on SIGINT/SIGTERM.
- Avoid writing to stdout except MCP protocol payloads (use stderr for logs).

## Tool contract
- Each tool module exports:
  - `TOOL_NAME`, `TOOL_INPUT_SCHEMA`, optional `TOOL_OUTPUT_SCHEMA`
  - `handler(args: unknown)`
- Keep JSON schema and Zod validation aligned.
- Return tool-level errors as `isError` responses with actionable messages — never throw across the MCP boundary.
- Every tool registered in `src/server.ts` must ship `_meta.apiVersion` (current `TOOL_API_VERSION`, see `docs/API_STABILITY.md`) and at least one worked `_meta.examples` entry.
- Update `SERVER_INSTRUCTIONS` (decision tree + pitfalls) whenever you add a tool or change its behaviour.

## Safety
- Never trust tool arguments — validate at the boundary with Zod.
- Validate size limits and enum boundaries.
- Keep output bounded (50 MiB cap) and deterministic when possible.
- Never echo key material in error messages or stderr.

## Compatibility
- Keep tool names stable across patch releases.
- Follow `docs/API_STABILITY.md` for `_meta.apiVersion` bump rules.
- Breaking changes require explicit migration notes in release-notes.
