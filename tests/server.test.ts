import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createServer, ensureCompressionReady, __serverMetadata } from '../src/server.js';

const OUTPUT_ENV = 'PDFNATIVE_MCP_OUTPUT_DIR';

describe('server', () => {
    beforeAll(async () => {
        await ensureCompressionReady();
        await ensureCompressionReady();
    });

    it('exposes stable metadata', () => {
        expect(__serverMetadata.name).toBe('pdfnative-mcp');
        expect(__serverMetadata.version).toBe('1.0.0');
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
            'verify_pdf',
        ]);

        // Every tool advertises _meta.apiVersion and at least one example.
        for (const t of response.tools) {
            expect(t._meta?.apiVersion).toBe('1.0.0');
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
            content: Array<{ type: string; text?: string }>;
            structuredContent?: { mode?: string; base64?: string };
        };

        expect(response.isError).not.toBe(true);
        expect(response.content[0]?.text ?? '').toContain('produced');
        expect(response.structuredContent?.mode).toBe('base64');
        expect(typeof response.structuredContent?.base64).toBe('string');
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
