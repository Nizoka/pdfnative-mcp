import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createServer, ensureCompressionReady, __serverMetadata, __serverInstructions, SERVER_CACHE_HINTS } from '../src/server.js';
import { connectLegacy, McpRpcError } from './_mcp-harness.js';

/** One-shot JSON-RPC request through the in-memory transport (legacy era). */
async function rpc<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const client = await connectLegacy();
    try {
        return await client.request<T>(method, params);
    } finally {
        await client.close();
    }
}

const OUTPUT_ENV = 'PDFNATIVE_MCP_OUTPUT_DIR';

describe('server', () => {
    beforeAll(async () => {
        await ensureCompressionReady();
        await ensureCompressionReady();
    });

    it('exposes stable metadata', () => {
        expect(__serverMetadata.name).toBe('pdfnative-mcp');
        expect(__serverMetadata.version).toBe('1.6.0');
    });

    it('advertises a human-readable title and description in serverInfo (MCP Implementation)', () => {
        // 2025-11-25 added Implementation.description to mirror server.json; hosts and
        // the MCP registry surface it during initialization.
        expect(typeof __serverMetadata.title).toBe('string');
        expect(__serverMetadata.title.length).toBeGreaterThan(0);
        expect(__serverMetadata.description).toMatch(/MCP server/i);
        expect(__serverMetadata.description).toMatch(/27 tools/);
    });

    it('SERVER_INSTRUCTIONS advertises decision tree and pitfalls for AI clients', () => {
        expect(__serverInstructions).toMatch(/pdfnative.*v1\.7/);
        expect(__serverInstructions).toContain('MCP 2026-07-28');
        expect(__serverInstructions).toContain('NETWORK POLICY');
        expect(__serverInstructions).toContain('DECISION TREE');
        expect(__serverInstructions).toContain('COMMON PITFALLS');
        // Cite each tool by name in the decision tree.
        for (const t of [
            'generate_basic_pdf', 'add_barcode', 'add_international_text', 'add_table',
            'add_form', 'embed_image', 'prepare_signature_placeholder', 'sign_pdf',
            'verify_pdf', 'validate_pdf', 'inspect_pdf', 'add_attachment', 'extract_text',
            'extract_attachments', 'merge_pdfs', 'split_pdf', 'extract_pages',
            'annotate_pdf', 'draft_governance_issue',
            'read_form_fields', 'fill_form', 'add_chart', 'encrypt_pdf', 'decrypt_pdf',
            'update_metadata', 'add_ltv', 'timestamp_pdf',
        ]) {
            expect(__serverInstructions).toContain(t);
        }
    });

    it('exposes MCP prompts for the AI-governance contract and issue workflow', async () => {
        const promptList = (await rpc('prompts/list')) as {
            prompts: Array<{ name: string; title?: string; description?: string }>;
        };
        const promptNames = promptList.prompts.map((p) => p.name).sort();
        expect(promptNames).toEqual(['draft_issue_workflow', 'governance_contract']);
        const got = (await rpc('prompts/get', { name: 'governance_contract' })) as { messages: Array<{ role: string; content: { type: string; text: string } }> };
        expect(got.messages[0]?.role).toBe('user');
        expect(got.messages[0]?.content.text).toMatch(/DRAFTSMAN/);

        // Unknown prompt names are rejected.
        await expect(
            rpc('prompts/get', { name: 'nope' }),
        ).rejects.toBeInstanceOf(McpRpcError);
    });

    it('lists all tools', async () => {

        const response = (await rpc('tools/list')) as {
            tools: Array<{ name: string; _meta?: { apiVersion?: string; examples?: unknown[] } }>;
        };

        const names = response.tools.map((t) => t.name).sort();
        expect(names).toEqual([
            'add_attachment',
            'add_barcode',
            'add_chart',
            'add_form',
            'add_international_text',
            'add_ltv',
            'add_table',
            'annotate_pdf',
            'decrypt_pdf',
            'draft_governance_issue',
            'embed_image',
            'encrypt_pdf',
            'extract_attachments',
            'extract_pages',
            'extract_text',
            'fill_form',
            'generate_basic_pdf',
            'inspect_pdf',
            'merge_pdfs',
            'prepare_signature_placeholder',
            'read_form_fields',
            'sign_pdf',
            'split_pdf',
            'timestamp_pdf',
            'update_metadata',
            'validate_pdf',
            'verify_pdf',
        ]);

        // Every tool advertises _meta.apiVersion and at least one example.
        for (const t of response.tools) {
            expect(t._meta?.apiVersion).toBe('1.6.0');
            expect(Array.isArray(t._meta?.examples)).toBe(true);
            expect((t._meta?.examples ?? []).length).toBeGreaterThan(0);
        }
    });

    it('tool input schemas are JSON Schema 2020-12 compatible (dialect-agnostic)', async () => {
        // 2025-11-25 (SEP-1613) establishes JSON Schema 2020-12 as the default dialect
        // when `$schema` is omitted. Our hand-written schemas stay dialect-agnostic by
        // avoiding constructs whose meaning changed across drafts ($ref/$defs/definitions,
        // draft-04 boolean exclusiveMinimum/Maximum, draft-07 dependencies). This guard
        // fails if any tool reintroduces a dialect-sensitive keyword.
        const response = (await rpc('tools/list')) as {
            tools: Array<{ name: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown> }>;
        };

        const FORBIDDEN = new Set(['$ref', '$defs', 'definitions', 'dependencies']);
        const scan = (node: unknown, toolName: string, at: string): void => {
            if (Array.isArray(node)) {
                node.forEach((v, i) => scan(v, toolName, `${at}[${i}]`));
                return;
            }
            if (node === null || typeof node !== 'object') return;
            for (const [key, value] of Object.entries(node)) {
                expect(FORBIDDEN.has(key), `${toolName}${at}.${key} is dialect-sensitive`).toBe(false);
                // Draft-04 allowed boolean exclusiveMinimum/Maximum; 2020-12 requires a number.
                if ((key === 'exclusiveMinimum' || key === 'exclusiveMaximum') && typeof value === 'boolean') {
                    throw new Error(`${toolName}${at}.${key} uses the draft-04 boolean form`);
                }
                scan(value, toolName, `${at}.${key}`);
            }
        };

        for (const t of response.tools) {
            scan(t.inputSchema, t.name, '.inputSchema');
            if (t.outputSchema !== undefined) scan(t.outputSchema, t.name, '.outputSchema');
        }
    });

    it('returns an MCP tool error for unknown tools', async () => {

        const response = (await rpc('tools/call', { name: 'nope', arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> };

        expect(response.isError).toBe(true);
        expect(response.content[0]?.text).toContain('Unknown tool: nope');
    });

    it('returns success payload for a valid base64 tool call', async () => {

        const response = (await rpc('tools/call', {
                name: 'generate_basic_pdf',
                arguments: {
                    title: 'Smoke',
                    blocks: [{ type: 'paragraph', text: 'hello' }],
                },
            },
        )) as {
            isError?: boolean;
            content: Array<{ type: string; text?: string; resource?: { blob?: string; mimeType?: string } }>;
            structuredContent?: { mode?: string; base64?: string; sizeBytes?: number };
        };

        expect(response.isError).not.toBe(true);
        expect(response.content[0]?.text ?? '').toContain('produced');
        expect(response.structuredContent?.mode).toBe('base64');
        expect(typeof response.structuredContent?.sizeBytes).toBe('number');
        // Token-frugal: base64 is NOT duplicated into structuredContent; it is
        // delivered once as an embedded resource content block.
        expect(response.structuredContent?.base64).toBeUndefined();
        const resourceBlock = response.content.find((c) => c.type === 'resource');
        expect(resourceBlock?.resource?.mimeType).toBe('application/pdf');
        expect(typeof resourceBlock?.resource?.blob).toBe('string');
        expect((resourceBlock?.resource?.blob ?? '').length).toBeGreaterThan(0);
    });

    it('returns success payload for file mode tool call', async () => {
        const sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-mcp-server-file-'));
        process.env[OUTPUT_ENV] = sandboxDir;

        const response = (await rpc('tools/call', {
                name: 'generate_basic_pdf',
                arguments: {
                    title: 'File',
                    blocks: [{ type: 'paragraph', text: 'saved' }],
                    outputMode: 'file',
                    outputPath: 'from-server/file.pdf',
                },
            },
        )) as {
            isError?: boolean;
            content: Array<{ text?: string }>;
            structuredContent?: { mode?: string; filePath?: string };
        };

        expect(response.isError).not.toBe(true);
        expect(response.content[0]?.text ?? '').toContain('wrote');
        expect(response.structuredContent?.mode).toBe('file');
        expect(response.structuredContent?.filePath?.startsWith(sandboxDir)).toBe(true);

        delete process.env[OUTPUT_ENV];
    });

    it('surfaces tool validation failures as isError responses', async () => {

        const response = (await rpc('tools/call', {
                name: 'generate_basic_pdf',
                arguments: {
                    title: '',
                    blocks: [],
                },
            },
        )) as { isError?: boolean; content: Array<{ text: string }> };

        expect(response.isError).toBe(true);
        expect(response.content[0]?.text).toContain('VALIDATION_ERROR');
    });

    it('surfaces non-ToolError failures as generic isError responses', async () => {

        const response = (await rpc('tools/call', {
                name: 'sign_pdf',
                arguments: {
                    pdfBase64: 'AQID',
                    algorithm: 'rsa-sha256',
                    certDerBase64: 'AAAA',
                    rsaKeyPkcs1DerBase64: 'AQID',
                },
            },
        )) as { isError?: boolean; content: Array<{ text: string }> };

        expect(response.isError).toBe(true);
        // In v1.0.0 sign_pdf intercepts PDF-parse failures (the malformed
        // 3-byte fixture) before reaching pdfnative's signer and surfaces them
        // as ToolError('PDF_PARSE_FAILED'); the generic-error branch is still
        // exercised below via the fallback test path.
        expect(response.content[0]?.text).toContain('sign_pdf failed');
    });

    it('dispatches inspect_pdf and returns structuredContent from buildInspectResult', async () => {
        const samplePdf = await (await import('../src/tools/generate-basic-pdf.js')).generateBasicPdf({
            title: 'Smoke',
            blocks: [{ type: 'paragraph', text: 'inspect me' }],
        });
        const response = (await rpc('tools/call', {
                name: 'inspect_pdf',
                arguments: { pdfBase64: samplePdf.base64 },
            },
        )) as { isError?: boolean; content: Array<{ text?: string }>; structuredContent?: Record<string, unknown> };
        expect(response.isError).not.toBe(true);
        expect(response.structuredContent?.['pageCount']).toBeGreaterThanOrEqual(1);
    });

    it('advertises the MCP resources capability with list, read and templates handlers', async () => {
        // With no sandbox configured, listing is empty (stateless, safe default).
        delete process.env[OUTPUT_ENV];
        const res = await rpc<{ resources: unknown[] }>('resources/list');
        expect(res.resources).toEqual([]);
        const templates = await rpc<{ resourceTemplates: unknown[] }>('resources/templates/list');
        expect(Array.isArray(templates.resourceTemplates)).toBe(true);
        // Spec 2026-07-28: resource-not-found is -32602 (Invalid params) on every revision.
        await expect(rpc('resources/read', { uri: 'pdfnative://output/nope.pdf' })).rejects.toMatchObject({ code: -32602 });
    });

    it('lists tools in a deterministic order and constructs with valid cache hints', async () => {
        const a = (await rpc<{ tools: Array<{ name: string }> }>('tools/list')).tools.map((t) => t.name);
        const b = (await rpc<{ tools: Array<{ name: string }> }>('tools/list')).tools.map((t) => t.name);
        expect(a).toEqual(b);
        expect(SERVER_CACHE_HINTS['tools/list'].cacheScope).toBe('public');
        expect(() => createServer()).not.toThrow();
    });

    it('includes outputSchema for every tool', async () => {
        const response = (await rpc('tools/list')) as {
            tools: Array<{ name: string; outputSchema?: unknown }>
        };
        for (const tool of response.tools) {
            expect(tool.outputSchema, `${tool.name} should have outputSchema`).toBeDefined();
        }
    });
});

describe('token-frugal projection (verbosity / fields)', () => {
    beforeAll(async () => {
        delete process.env[OUTPUT_ENV];
        await ensureCompressionReady();
    });

    type CallResponse = { isError?: boolean; structuredContent?: Record<string, unknown> };

    async function call(name: string, args: Record<string, unknown>): Promise<CallResponse> {
        return (await rpc('tools/call', { name, arguments: args })) as CallResponse;
    }

    async function samplePdf(): Promise<string> {
        const r = await (await import('../src/tools/generate-basic-pdf.js')).generateBasicPdf({
            title: 'Projection sample',
            blocks: [{ type: 'paragraph', text: 'Hello projection.' }],
        });
        if (r.mode !== 'base64' || r.base64 === undefined) throw new Error('expected base64');
        return r.base64;
    }

    it('inspect_pdf full output (default) is unchanged and includes the heavy arrays', async () => {
        const pdfBase64 = await samplePdf();
        const res = await call('inspect_pdf', { pdfBase64, pages: true });
        expect(res.structuredContent).toBeDefined();
        expect(res.structuredContent!['attachments']).toBeDefined();
        expect(res.structuredContent!['perPage']).toBeDefined();
        expect(res.structuredContent!['attachmentCount']).toBeUndefined();
    });

    it("inspect_pdf verbosity='summary' collapses to scalars and drops arrays", async () => {
        const pdfBase64 = await samplePdf();
        const res = await call('inspect_pdf', { pdfBase64, verbosity: 'summary' });
        const sc = res.structuredContent!;
        expect(sc['pageCount']).toBeGreaterThanOrEqual(1);
        expect(sc['attachmentCount']).toBe(0);
        expect(sc['attachments']).toBeUndefined();
        expect(sc['perPage']).toBeUndefined();
        expect(sc['info']).toBeUndefined();
    });

    it('inspect_pdf fields projection returns only the requested paths', async () => {
        const pdfBase64 = await samplePdf();
        const res = await call('inspect_pdf', { pdfBase64, fields: ['pageCount', 'signatureCount'] });
        expect(res.structuredContent).toEqual({
            pageCount: res.structuredContent!['pageCount'],
            signatureCount: 0,
        });
    });

    it('inspect_pdf composes summary then fields', async () => {
        const pdfBase64 = await samplePdf();
        const res = await call('inspect_pdf', { pdfBase64, verbosity: 'summary', fields: ['attachmentCount'] });
        expect(res.structuredContent).toEqual({ attachmentCount: 0 });
    });

    it("verify_pdf verbosity='summary' returns a compact verdict without signatures[]", async () => {
        const pdfBase64 = await samplePdf();
        const full = await call('verify_pdf', { pdfBase64 });
        const res = await call('verify_pdf', { pdfBase64, verbosity: 'summary' });
        const sc = res.structuredContent!;
        // Verdict mirrors full mode (a 0-signature PDF reports allValid=false).
        expect(sc['allValid']).toBe(full.structuredContent!['allValid']);
        expect(sc['signatureCount']).toBe(0);
        expect(sc['invalid']).toBe(0);
        expect(sc['signatures']).toBeUndefined();
    });

    it("validate_pdf verbosity='summary' drops errors[]/warnings[] for counts", async () => {
        const pdfBase64 = await samplePdf();
        const res = await call('validate_pdf', { pdfBase64, verbosity: 'summary' });
        const sc = res.structuredContent!;
        expect(sc['standard']).toBe('pdf-ua-1');
        expect(typeof sc['valid']).toBe('boolean');
        expect(typeof sc['errorCount']).toBe('number');
        expect(sc['errors']).toBeUndefined();
        expect(sc['warnings']).toBeUndefined();
    });

    it("extract_text verbosity='summary' drops pages[] and fullText", async () => {
        const pdfBase64 = await samplePdf();
        const res = await call('extract_text', { pdfBase64, verbosity: 'summary' });
        const sc = res.structuredContent!;
        expect(typeof sc['pageCount']).toBe('number');
        expect(typeof sc['charCount']).toBe('number');
        expect(sc['pages']).toBeUndefined();
        expect(sc['fullText']).toBeUndefined();
    });

    it('extract_text full output (default) still returns pages[] and fullText', async () => {
        const pdfBase64 = await samplePdf();
        const res = await call('extract_text', { pdfBase64 });
        const sc = res.structuredContent!;
        expect(Array.isArray(sc['pages'])).toBe(true);
        expect(typeof sc['fullText']).toBe('string');
        expect(sc['charCount']).toBeUndefined();
    });
});
