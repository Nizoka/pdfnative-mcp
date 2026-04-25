---
description: "Use when editing MCP transport, tool registration, JSON schemas, or request/response handling."
applyTo: "src/server.ts,src/tools/**,src/cli.ts"
---
# MCP Server Standards

## Transport and lifecycle
- Use stdio transport for local host integration.
- Gracefully close server on SIGINT/SIGTERM.
- Avoid writing to stdout except MCP protocol payloads.

## Tool contract
- Each tool module exports:
  - TOOL_NAME
  - TOOL_INPUT_SCHEMA (JSON schema sent to MCP clients)
  - handler(args: unknown)
- Keep JSON schema and Zod validation aligned.
- Return tool-level errors as isError responses with actionable messages.

## Safety
- Never trust tool arguments.
- Validate size limits and enum boundaries.
- Keep output bounded (size cap) and deterministic when possible.

## Compatibility
- Keep tool names stable across patch releases.
- Breaking changes require explicit migration notes in release-notes.
