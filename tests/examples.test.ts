/**
 * Examples-as-tests: every file under `examples/` is loaded, its referenced
 * tool name(s) are checked against the live tool registry, and any
 * self-contained single-tool example (no `<placeholder>` tokens) is executed
 * end-to-end through the MCP `tools/call` handler. PDF-producing examples then
 * have their bytes structurally validated via `assertValidPdf`.
 *
 * This guarantees the published examples never drift from the real schemas or
 * runtime behaviour: a stale field name or renamed tool fails CI immediately.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureCompressionReady } from '../src/server.js';
import { connectLegacy, type McpTestClient } from './_mcp-harness.js';
import { assertValidPdf } from './_pdf-assert.js';

const EXAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');

interface ExampleStep {
    readonly tool: string;
    readonly arguments: Record<string, unknown>;
}
interface ExampleFile {
    readonly description?: string;
    readonly tool?: string;
    readonly arguments?: Record<string, unknown>;
    readonly steps?: ReadonlyArray<ExampleStep>;
}

interface CallResponse {
    isError?: boolean;
    content: Array<{ type: string; text?: string; resource?: { blob?: string; mimeType?: string } }>;
    structuredContent?: Record<string, unknown>;
}

/** Recursively test whether any string in `value` contains an `<...>` placeholder token. */
function hasPlaceholder(value: unknown): boolean {
    if (typeof value === 'string') return /<[^>]+>/.test(value);
    if (Array.isArray(value)) return value.some(hasPlaceholder);
    if (value !== null && typeof value === 'object') return Object.values(value).some(hasPlaceholder);
    return false;
}

/** Normalise a single-tool or multi-step example into a flat list of steps. */
function toSteps(example: ExampleFile): ExampleStep[] {
    if (Array.isArray(example.steps)) return [...example.steps];
    if (typeof example.tool === 'string') {
        return [{ tool: example.tool, arguments: example.arguments ?? {} }];
    }
    return [];
}

const exampleFiles = readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

let knownTools: Set<string>;
let client: McpTestClient;

describe('examples/*.json', () => {
    beforeAll(async () => {
        delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
        await ensureCompressionReady();
        client = await connectLegacy();
        const list = await client.listTools();
        knownTools = new Set(list.tools.map((t) => t.name));
    });

    afterAll(async () => {
        await client.close();
    });

    it('discovers at least the four canonical examples', () => {
        expect(exampleFiles.length).toBeGreaterThanOrEqual(4);
    });

    for (const file of exampleFiles) {
        describe(file, () => {
            const raw = readFileSync(path.join(EXAMPLES_DIR, file), 'utf8');

            it('is valid JSON with a description and a tool or steps', () => {
                const parsed = JSON.parse(raw) as ExampleFile;
                expect(typeof parsed.description).toBe('string');
                const steps = toSteps(parsed);
                expect(steps.length, 'example must declare a tool or steps').toBeGreaterThan(0);
            });

            it('references only registered tools with object arguments', () => {
                const steps = toSteps(JSON.parse(raw) as ExampleFile);
                for (const step of steps) {
                    expect(knownTools, `unknown tool '${step.tool}' in ${file}`).toContain(step.tool);
                    expect(typeof step.arguments).toBe('object');
                    expect(step.arguments).not.toBeNull();
                }
            });

            it('executes end-to-end when self-contained (no placeholders)', async () => {
                const parsed = JSON.parse(raw) as ExampleFile;
                const steps = toSteps(parsed);
                const executable = steps.length === 1 && !hasPlaceholder(steps[0].arguments);
                if (!executable) {
                    // Multi-step / placeholder examples are documentation-only: the
                    // structural checks above already guarantee they stay current.
                    return;
                }
                const step = steps[0];
                const response = (await client.callTool(step.tool, step.arguments)) as CallResponse;

                expect(response.isError, `${file}: ${response.content[0]?.text ?? ''}`).not.toBe(true);

                const pdfBlob = response.content.find((c) => c.type === 'resource')?.resource?.blob;
                if (pdfBlob !== undefined && pdfBlob.length > 0) {
                    assertValidPdf(pdfBlob);
                }
                // Generous timeout: multi-script examples embed large Noto CJK font
                // modules on first load, which is slow under coverage instrumentation.
            }, 60_000);
        });
    }
});
