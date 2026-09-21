/**
 * Structural fingerprint of the tool catalogue (`tools/list`) with every
 * `description` doc string removed (a schema *property* named description is
 * kept): names, titles, annotations, input/output schema shapes (types,
 * enums, defaults, constraints, required, additionalProperties) and the
 * number of `_meta.examples`.
 *
 * Pure: shared by scripts/tool-shape.ts (print / --write) and the gate's
 * `tool-shape` step, which holds the BUILT catalogue to the committed fixture
 * the way tests/catalogue-parity.test.ts holds the source one.
 */

export interface ListedTool {
    readonly name: string;
    readonly title?: string;
    readonly annotations?: unknown;
    readonly inputSchema?: unknown;
    readonly outputSchema?: unknown;
    readonly _meta?: { readonly examples?: readonly unknown[] };
}

export interface ToolShape {
    readonly name: string;
    readonly title?: string;
    readonly annotations?: unknown;
    readonly inputSchema: unknown;
    readonly outputSchema: unknown;
    readonly exampleCount: number;
}

export function strip(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(strip);
    if (node === null || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (!(k === 'description' && typeof v === 'string')) out[k] = strip(v);
    }
    return out;
}

export function toolShape(tools: readonly ListedTool[]): ToolShape[] {
    return tools.map((t) => ({
        name: t.name,
        title: t.title,
        annotations: t.annotations,
        inputSchema: strip(t.inputSchema),
        outputSchema: strip(t.outputSchema),
        exampleCount: (t._meta?.examples ?? []).length,
    }));
}

/** The exact text of tests/_fixtures/tool-shape.json for a catalogue. */
export function serializeShape(tools: readonly ListedTool[]): string {
    return `${JSON.stringify(toolShape(tools), null, 1)}\n`;
}
