/**
 * Single source of truth for the pdfnative-mcp package version.
 *
 * Kept in lock-step with package.json and server.json (asserted by
 * tests/metadata.test.ts). Centralised here so both server.ts and the
 * governance tooling reference one constant without importing package.json
 * (the build rootDir is limited to ./src).
 */
export const PDFNATIVE_MCP_VERSION = '1.6.0';
