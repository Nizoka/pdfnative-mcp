#!/bin/bash -eu
# pdfnative-mcp — the ClusterFuzzLite build step.
#
# What the targets fuzz is `dist/`, the bytes a consumer installs, reached
# through `dist/fuzz-surface.js` (src/fuzz-surface.ts: the boundary functions
# a tool call, a base64 payload, an image, an output path or an HTTP request
# meets). `tests/fuzzing/targets.test.ts` runs the same files against `src/`
# through a vitest alias, so the targets are proved callable and proved to
# rethrow a programming error before they ever reach a container. One file,
# two engines, and the half that can be checked anywhere is checked
# everywhere.

cd "$SRC/pdfnative-mcp"

# --ignore-scripts, the same rule as every runner and every contributor
# machine (.npmrc): no dependency's lifecycle script runs while building a
# fuzzing image either. The build needs the dev toolchain (tsc), so the
# project's own lockfile is installed first and replaced by the engine's
# afterwards.
npm ci --ignore-scripts
npm run build

# Seed corpora, built by the server itself (tests/fuzzing/_fuzz-seeds.ts):
# every example of examples/*.json as a tools/call argument object, base64
# payloads in every form the boundary distinguishes (raw PDF, data: URI, PEM,
# doubled), the three image formats, sandbox paths and HTTP request lines.
# Starting a boundary fuzzer from random bytes wastes days rediscovering
# `{"tool":`; starting it from an argument object that validates puts it
# inside the grammar on the first mutation.
seeds="$(mktemp -d)"
npx tsx tests/fuzzing/_fuzz-seeds.ts "$seeds"
for target in base64 http-guards image output-path tool-call; do
  zip -j "$OUT/${target}_seed_corpus.zip" "$seeds/$target"/*.bin >/dev/null
done

# The engine, never in the manifest. .clusterfuzzlite/engine/package.json
# names one exact version, and its package-lock.json pins every package of
# the engine's tree to a version and a sha512 integrity that `npm ci` checks
# before it unpacks anything — no range, no resolution at build time, the
# same supply-chain rule as the project's own lockfile. The project's
# node_modules is then REDUCED to the three runtime dependencies dist/ needs
# (pdfnative, the MCP SDK, zod — `npm ci --omit=dev`), and the engine's tree
# is laid beside them: the OSS-Fuzz wrapper runs
# `<project>/node_modules/@jazzer.js/core/dist/cli.js`.
npm ci --ignore-scripts --omit=dev
(cd .clusterfuzzlite/engine && npm ci --ignore-scripts)
cp -R .clusterfuzzlite/engine/node_modules/. node_modules/

compile_javascript_fuzzer pdfnative-mcp fuzz/base64.js --sync
compile_javascript_fuzzer pdfnative-mcp fuzz/http-guards.js --sync
compile_javascript_fuzzer pdfnative-mcp fuzz/image.js --sync
compile_javascript_fuzzer pdfnative-mcp fuzz/output-path.js --sync
compile_javascript_fuzzer pdfnative-mcp fuzz/tool-call.js --sync
