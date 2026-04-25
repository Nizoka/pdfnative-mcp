/**
 * Public library entry: re-exports the server factory and type surface so that
 * pdfnative-mpc can be embedded in another Node process if desired.
 */
export { createServer, ensureCompressionReady } from './server.js';
export type { OutputMode, OutputResult } from './output.js';
export { ToolError, SecurityError } from './errors.js';
