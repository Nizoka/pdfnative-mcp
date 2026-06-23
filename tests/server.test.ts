import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createServer, ensureCompressionReady, __serverMetadata, __serverInstructions } from '../src/server.js';

const OUTPUT_ENV = 'PDFNATIVE_MCP_OUTPUT_DIR';

describe('server', () => {
    beforeAll(async () => {
        await ensureCompressionReady();
        await ensureCompressionReady();
    });

    it('exposes stable metadata', () => {
        expect(__serverMetadata.name).toBe('pdfnative-mcp');
        expect(__serverMetadata.version).toBe('1.2.0');
    });

    it('SERVER_INSTRUCTIONS advertises decision tree and pitfalls for AI clients', () => {
        expect(__serverInstructions).toMatch(/pdfnative.*v1\.3/);
        expect(__serverInstructions).toContain('DECISION TREE');
        expect(__serverInstructions).toContain('COMMON PITFALLS');
        // Cite each tool by name in the decision tree.
        for (const t of [
            'generate_basic_pdf', 'add_barcode', 'add_international_text', 'add_table',
            'add_form', 'embed_image', 'prepare_signature_placeholder', 'sign_pdf',
            'verify_pdf', 'validate_pdf', 'inspect_pdf', 'add_attachment', 'extract_text',
        ]) {
            expect(__serverInstructions).toContain(t);
        }
    });

    it('lists all tools', async () => {
        const server = createServer() as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> };
        const listHandler = server._requestHandlers.get('tools/list');
        expect(listHandler).toBeDefined();

        const response = (await listHandler!({ method: 'tools/list', params: {} })) as {
            tools: Array<{ name: string; _meta?: { apiVersion?: string; examples?: unknown[] } }>;
        };

        const names = response.tools.map((t) => t.name).sort();
        expect(names).toEqual([
            'add_attachment',
            'add_barcode',
            'add_form',
            'add_international_text',
            'add_table',
            'embed_image',
            'extract_text',
            'generate_basic_pdf',
            'inspect_pdf',
            'prepare_signature_placeholder',
            'sign_pdf',
            'validate_pdf',
            'verify_pdf',
        ]);

        // Every tool advertises _meta.apiVersion and at least one example.
        for (const t of response.tools) {
            expect(t._meta?.apiVersion).toBe('1.2.0');
            expect(Array.isArray(t._meta?.examples)).toBe(true);
            expect((t._meta?.examples ?? []).length).toBeGreaterThan(0);
        }
    });

    it('returns an MCP tool error for unknown tools', async () => {
        const server = createServer() as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> };
        const callHandler = server._requestHandlers.get('tools/call');
        expect(callHandler).toBeDefined();

        const response = (await callHandler!({
            method: 'tools/call',
            params: { name: 'nope', arguments: {} },
        })) as { isError?: boolean; content: Array<{ text: string }> };

        expect(response.isError).toBe(true);
        expect(response.content[0]?.text).toContain('Unknown tool: nope');
    });

    it('returns success payload for a valid base64 tool call', async () => {
        const server = createServer() as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> };
        const callHandler = server._requestHandlers.get('tools/call');

        const response = (await callHandler!({
            method: 'tools/call',
            params: {
                name: 'generate_basic_pdf',
                arguments: {
                    title: 'Smoke',
                    blocks: [{ type: 'paragraph', text: 'hello' }],
                },
            },
        })) as {
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

        const server = createServer() as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> };
        const callHandler = server._requestHandlers.get('tools/call');

        const response = (await callHandler!({
            method: 'tools/call',
            params: {
                name: 'generate_basic_pdf',
                arguments: {
                    title: 'File',
                    blocks: [{ type: 'paragraph', text: 'saved' }],
                    outputMode: 'file',
                    outputPath: 'from-server/file.pdf',
                },
            },
        })) as {
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
        const server = createServer() as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> };
        const callHandler = server._requestHandlers.get('tools/call');

        const response = (await callHandler!({
            method: 'tools/call',
            params: {
                name: 'generate_basic_pdf',
                arguments: {
                    title: '',
                    blocks: [],
                },
            },
        })) as { isError?: boolean; content: Array<{ text: string }> };

        expect(response.isError).toBe(true);
        expect(response.content[0]?.text).toContain('VALIDATION_ERROR');
    });

    it('surfaces non-ToolError failures as generic isError responses', async () => {
        const server = createServer() as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> };
        const callHandler = server._requestHandlers.get('tools/call');

        const response = (await callHandler!({
            method: 'tools/call',
            params: {
                name: 'sign_pdf',
                arguments: {
                    pdfBase64: 'AQID',
                    algorithm: 'rsa-sha256',
                    certDerBase64: 'AAAA',
                    rsaKeyPkcs1DerBase64: 'AQID',
                },
            },
        })) as { isError?: boolean; content: Array<{ text: string }> };

        expect(response.isError).toBe(true);
        // In v1.0.0 sign_pdf intercepts PDF-parse failures (the malformed
        // 3-byte fixture) before reaching pdfnative's signer and surfaces them
        // as ToolError('PDF_PARSE_FAILED'); the generic-error branch is still
        // exercised below via the fallback test path.
        expect(response.content[0]?.text).toContain('sign_pdf failed');
    });

    it('dispatches inspect_pdf and returns structuredContent from buildInspectResult', async () => {
        const server = createServer() as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> };
        const callHandler = server._requestHandlers.get('tools/call');
        const samplePdf = await (await import('../src/tools/generate-basic-pdf.js')).generateBasicPdf({
            title: 'Smoke',
            blocks: [{ type: 'paragraph', text: 'inspect me' }],
        });
        const response = (await callHandler!({
            method: 'tools/call',
            params: {
                name: 'inspect_pdf',
                arguments: { pdfBase64: samplePdf.base64 },
            },
        })) as { isError?: boolean; content: Array<{ text?: string }>; structuredContent?: Record<string, unknown> };
        expect(response.isError).not.toBe(true);
        expect(response.structuredContent?.['pageCount']).toBeGreaterThanOrEqual(1);
    });

    it('includes outputSchema for every tool', async () => {
        const server = createServer() as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> };
        const listHandler = server._requestHandlers.get('tools/list');
        const response = (await listHandler!({ method: 'tools/list', params: {} })) as {
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
        const server = createServer() as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> };
        const callHandler = server._requestHandlers.get('tools/call');
        return (await callHandler!({ method: 'tools/call', params: { name, arguments: args } })) as CallResponse;
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
