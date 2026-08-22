import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { ensureCompressionReady, SERVER_CACHE_HINTS } from '../src/server.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { startHttpFixture, send, modernRequest, JSON_HEADERS, type HttpFixture } from './_http-fixture.js';
import { connectLegacy } from './_mcp-harness.js';

const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';

/**
 * MCP 2026-07-28 conformance over Streamable HTTP: stateless per-request
 * envelope (`_meta` protocol fields + `Mcp-Method`/`Mcp-Name` headers),
 * `server/discover`, `resultType`, cacheable-result hints (`ttlMs` /
 * `cacheScope`), per-result `serverInfo`, and the −32602 resource-not-found code.
 */
describe('HTTP transport — MCP 2026-07-28 clients', () => {
    let fx: HttpFixture;

    beforeAll(async () => {
        await ensureCompressionReady();
        fx = await startHttpFixture();
    });
    afterAll(async () => {
        await fx.close();
    });

    async function modern(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        const { headers, body } = modernRequest(method, params);
        const r = await send(fx.port, { headers, body });
        expect(r.status, `${method}: ${r.text.slice(0, 300)}`).toBe(200);
        expect(r.json, `${method}: no JSON-RPC body in ${r.text.slice(0, 300)}`).toBeDefined();
        return r.json!;
    }

    it('answers server/discover with supported versions, capabilities, instructions and cache hints', async () => {
        const msg = await modern('server/discover');
        const result = msg['result'] as Record<string, unknown>;
        expect(result['resultType']).toBe('complete');
        expect(result['supportedVersions']).toContain('2026-07-28');
        const caps = result['capabilities'] as Record<string, unknown>;
        expect(Object.keys(caps)).toEqual(expect.arrayContaining(['tools', 'prompts', 'resources']));
        expect(caps['logging']).toBeUndefined(); // deprecated in 2026-07-28 — never advertised
        expect(String(result['instructions'])).toContain('DECISION TREE');
        expect(result['ttlMs']).toBe(SERVER_CACHE_HINTS['server/discover'].ttlMs);
        expect(result['cacheScope']).toBe('public');
        const meta = result['_meta'] as Record<string, unknown>;
        expect((meta[SERVER_INFO_KEY] as { name: string }).name).toBe('pdfnative-mcp');
    });

    it('tools/list is cacheable (public, 24h), deterministic, and keeps _meta.apiVersion / examples', async () => {
        const a = (await modern('tools/list'))['result'] as Record<string, unknown>;
        const b = (await modern('tools/list'))['result'] as Record<string, unknown>;
        expect(a['resultType']).toBe('complete');
        expect(a['ttlMs']).toBe(86_400_000);
        expect(a['cacheScope']).toBe('public');
        const tools = a['tools'] as Array<Record<string, unknown>>;
        expect(tools.map((t) => t['name'])).toEqual((b['tools'] as Array<Record<string, unknown>>).map((t) => t['name']));
        for (const t of tools) {
            expect((t['_meta'] as { apiVersion?: string }).apiVersion).toMatch(/^\d+\.\d+\.\d+$/);
            expect(t['execution']).toBeUndefined();
            expect(t['inputSchema']).toBeDefined();
            expect(t['outputSchema']).toBeDefined();
        }
    });

    it('prompts/list and resources/* carry the configured cache scopes', async () => {
        const prompts = (await modern('prompts/list'))['result'] as Record<string, unknown>;
        expect(prompts['cacheScope']).toBe('public');
        const resources = (await modern('resources/list'))['result'] as Record<string, unknown>;
        expect(resources['ttlMs']).toBe(0);
        expect(resources['cacheScope']).toBe('private');
        const templates = (await modern('resources/templates/list'))['result'] as Record<string, unknown>;
        expect(templates['cacheScope']).toBe('private');
    });

    it('tools/call returns resultType=complete with a payload identical to the legacy path', async () => {
        const sample = await generateBasicPdf({ title: 'Modern', blocks: [{ type: 'paragraph', text: 'modern era' }] });
        const args = { pdfBase64: sample.base64, verbosity: 'summary' };
        const msg = await modern('tools/call', { name: 'inspect_pdf', arguments: args });
        const result = msg['result'] as Record<string, unknown>;
        expect(result['resultType']).toBe('complete');
        expect(result['isError']).not.toBe(true);
        expect((result['_meta'] as Record<string, unknown>)[SERVER_INFO_KEY]).toBeDefined();

        const client = await connectLegacy();
        const legacy = await client.callTool<{ structuredContent?: unknown; content?: unknown }>('inspect_pdf', args);
        await client.close();
        expect(result['structuredContent']).toEqual(legacy.structuredContent);
        expect(result['content']).toEqual(legacy.content);
    });

    it('keeps the isError contract for unknown tools and validation failures', async () => {
        const unknown = (await modern('tools/call', { name: 'nope', arguments: {} }))['result'] as Record<string, unknown>;
        expect(unknown['isError']).toBe(true);
        const invalid = (await modern('tools/call', { name: 'generate_basic_pdf', arguments: { title: '', blocks: [] } }))['result'] as Record<string, unknown>;
        expect(invalid['isError']).toBe(true);
        expect(String((invalid['content'] as Array<{ text: string }>)[0]?.text)).toContain('VALIDATION_ERROR');
    });

    it('reports an unknown resource as -32602 (Invalid params)', async () => {
        const { headers, body } = modernRequest('resources/read', { uri: 'pdfnative://output/missing.pdf' });
        const r = await send(fx.port, { headers, body });
        const err = r.json?.['error'] as { code: number } | undefined;
        expect(err?.code).toBe(-32602);
    });

    it('rejects a 2026-07-28 request missing the Mcp-Method header', async () => {
        const { headers, body } = modernRequest('tools/list');
        const { 'mcp-method': _dropped, ...rest } = headers;
        void _dropped;
        const r = await send(fx.port, { headers: rest, body });
        expect(r.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects a modern-looking request whose _meta envelope lacks the protocol version', async () => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/clientCapabilities': {} } } });
        const r = await send(fx.port, { headers: { ...JSON_HEADERS, 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' }, body });
        expect(r.status).toBeGreaterThanOrEqual(400);
    });
});
