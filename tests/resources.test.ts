/**
 * Tests for the native MCP resources layer (v1.5.0) — sandboxed generated PDFs
 * exposed as pdfnative://output/… resource URIs.
 */
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { listResources, listResourceTemplates, readResource, resourceUriForPath, RESOURCE_URI_PREFIX } from '../src/resources.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { ensureCompressionReady } from '../src/server.js';
import { assertValidPdf } from './_pdf-assert.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

async function writeSamplePdf(name = 'report.pdf'): Promise<void> {
    await generateBasicPdf({
        title: 'Resource sample',
        blocks: [{ type: 'paragraph', text: 'hello resources' }],
        outputMode: 'file',
        outputPath: name,
    });
}

describe('MCP resources', () => {
    beforeAll(async () => {
        await ensureCompressionReady();
    });
    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it('returns no resources when file output is disabled', async () => {
        delete process.env[ENV_KEY];
        expect(await listResources()).toEqual([]);
        expect(resourceUriForPath('/anywhere/x.pdf')).toBeNull();
    });

    it('lists sandboxed PDFs as resources', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-res-'));
        process.env[ENV_KEY] = dir;
        await writeSamplePdf('report.pdf');
        await writeSamplePdf('nested/deep.pdf');
        const resources = await listResources();
        const uris = resources.map((r) => r.uri).sort();
        expect(uris).toContain(`${RESOURCE_URI_PREFIX}report.pdf`);
        expect(uris).toContain(`${RESOURCE_URI_PREFIX}nested/deep.pdf`);
        for (const r of resources) {
            expect(r.mimeType).toBe('application/pdf');
            expect(r.size).toBeGreaterThan(0);
        }
    });

    it('reads a resource back as a base64 PDF blob', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-res-'));
        process.env[ENV_KEY] = dir;
        await writeSamplePdf('report.pdf');
        const contents = await readResource(`${RESOURCE_URI_PREFIX}report.pdf`);
        expect(contents.mimeType).toBe('application/pdf');
        assertValidPdf(contents.blob, 1);
    });

    it('maps an absolute sandbox path to a resource URI', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-res-'));
        process.env[ENV_KEY] = dir;
        const uri = resourceUriForPath(path.join(dir, 'sub', 'a.pdf'));
        expect(uri).toBe(`${RESOURCE_URI_PREFIX}sub/a.pdf`);
        expect(resourceUriForPath(path.join(os.tmpdir(), 'outside.pdf'))).toBeNull();
    });

    it('rejects a path-traversal URI with SECURITY_VIOLATION', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-res-'));
        process.env[ENV_KEY] = dir;
        await expect(readResource(`${RESOURCE_URI_PREFIX}../escape.pdf`)).rejects.toMatchObject({ code: 'SECURITY_VIOLATION' });
    });

    it('rejects an unknown scheme with UNKNOWN_RESOURCE', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-res-'));
        process.env[ENV_KEY] = dir;
        await expect(readResource('file:///etc/passwd')).rejects.toMatchObject({ code: 'UNKNOWN_RESOURCE' });
    });

    it('reports a missing file as UNKNOWN_RESOURCE', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-res-'));
        process.env[ENV_KEY] = dir;
        await expect(readResource(`${RESOURCE_URI_PREFIX}nope.pdf`)).rejects.toMatchObject({ code: 'UNKNOWN_RESOURCE' });
    });

    it('rejects a non-.pdf URI with INVALID_EXTENSION', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-res-'));
        process.env[ENV_KEY] = dir;
        await expect(readResource(`${RESOURCE_URI_PREFIX}notes.txt`)).rejects.toMatchObject({ code: 'INVALID_EXTENSION' });
    });

    it('lists a resource template for the output address space', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-res-'));
        process.env[ENV_KEY] = dir;
        const templates = listResourceTemplates();
        expect(templates).toHaveLength(1);
        expect(templates[0]!.uriTemplate).toBe(`${RESOURCE_URI_PREFIX}{path}`);
        expect(templates[0]!.mimeType).toBe('application/pdf');
    });

    it('returns no templates when file output is disabled', () => {
        delete process.env[ENV_KEY];
        expect(listResourceTemplates()).toEqual([]);
    });

    it('emits a resource_link with a human-readable name in file-mode results', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-res-'));
        process.env[ENV_KEY] = dir;
        const { createServer } = await import('../src/server.js');
        const { connectLegacy } = await import('./_mcp-harness.js');
        const client = await connectLegacy(createServer());
        const res = (await client.callTool('generate_basic_pdf', { title: 'R', blocks: [{ type: 'paragraph', text: 'hi' }], outputMode: 'file', outputPath: 'sub/r.pdf' })) as { content: Array<{ type: string; uri?: string; name?: string; title?: string }> };
        await client.close();
        const link = res.content.find((c) => c.type === 'resource_link');
        expect(link).toBeDefined();
        expect(link!.uri).toBe(`${RESOURCE_URI_PREFIX}sub/r.pdf`);
        expect(link!.name).toBe('sub/r.pdf');
        expect(link!.title).toBe('r.pdf');
    });
});
