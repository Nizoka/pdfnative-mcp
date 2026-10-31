/**
 * The boundary this server defends, gathered for the fuzz targets (`fuzz/`).
 *
 * Nothing here is new: every export is the function a `tools/call` argument,
 * a base64 payload, an image, an output path or an HTTP request already meets
 * on its way in. The targets import this module from `dist/` in the
 * ClusterFuzzLite container (relative path, after `npm run build`) and from
 * `src/` under vitest (`tests/fuzzing/targets.test.ts`, through an alias), so
 * one target file is proved callable locally before it fuzzes anything. The
 * module is not part of the public API (`src/index.ts` is) — it is a named
 * door onto internal functions, for one consumer.
 */
export { decodeBase64Field, decodePdfBase64 } from './base64.js';
export { ToolError, SecurityError } from './errors.js';
export { guardBearer, readHttpToken } from './auth.js';
export { guardLoopback } from './http.js';
export { decodeImageBase64, IMAGE_MIME_ENUM } from './image.js';
export { resolveSandboxedPath } from './output.js';
export { callToolDirect, ensureCompressionReady, listToolsPayload } from './server.js';
