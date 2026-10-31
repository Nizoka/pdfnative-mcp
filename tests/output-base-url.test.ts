/**
 * PDFNATIVE_MCP_OUTPUT_BASE_URL (1.8.0, issue #66): file-mode results carry a
 * public URL when the operator serves the sandbox over HTTP, the text block
 * names that URL instead of the host's path, and the variable is validated
 * like every operator knob — an invalid value refuses to start.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { assertOutputBaseUrl, emitPdf, emitPdfMulti, publicUrlFor, readOutputBaseUrl, writeSandboxedText } from '../src/output.js';
import { callToolDirect, ensureCompressionReady } from '../src/server.js';

const DIR = 'PDFNATIVE_MCP_OUTPUT_DIR';
const BASE = 'PDFNATIVE_MCP_OUTPUT_BASE_URL';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

let sandbox: string;

beforeAll(async () => {
    await ensureCompressionReady();
});

beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-mcp-url-'));
    process.env[DIR] = sandbox;
    process.env[BASE] = 'https://files.example.com/pdf';
});

afterEach(async () => {
    delete process.env[DIR];
    delete process.env[BASE];
    await fs.rm(sandbox, { recursive: true, force: true });
});

describe('readOutputBaseUrl — the boot validator', () => {
    it('is null when unset or blank', () => {
        expect(readOutputBaseUrl({})).toBeNull();
        expect(readOutputBaseUrl({ [BASE]: '  ' })).toBeNull();
    });

    it('normalises to a trailing slash and keeps the path', () => {
        expect(readOutputBaseUrl({ [BASE]: 'https://files.example.com/pdf' })).toBe('https://files.example.com/pdf/');
        expect(readOutputBaseUrl({ [BASE]: 'http://127.0.0.1:8080/' })).toBe('http://127.0.0.1:8080/');
    });

    it.each([
        ['not a URL', 'files.example.com/pdf', /absolute http: or https: URL/],
        ['a file URL', 'file:///srv/pdf/', /must use http: or https:/],
        ['credentials', 'https://user:pw@files.example.com/pdf/', /must not carry credentials/],
        ['a query string', 'https://files.example.com/pdf/?token=1', /query string or a fragment/],
        ['a fragment', 'https://files.example.com/pdf/#x', /query string or a fragment/],
        ['a bare ? (WHATWG keeps it in href with an empty search)', 'https://files.example.com/pdf?', /query string or a fragment/],
        ['a bare #', 'https://files.example.com/pdf/#', /query string or a fragment/],
    ])('refuses %s', (_label, value, message) => {
        expect(() => readOutputBaseUrl({ [BASE]: value })).toThrow(message);
    });

    it('assertOutputBaseUrl refuses a base URL without an output directory (a URL that maps nothing)', () => {
        delete process.env[DIR];
        expect(() => assertOutputBaseUrl(process.env)).toThrow(/is set but PDFNATIVE_MCP_OUTPUT_DIR is not/);
        process.env[DIR] = sandbox;
        expect(assertOutputBaseUrl(process.env)).toBe('https://files.example.com/pdf/');
        delete process.env[BASE];
        expect(assertOutputBaseUrl(process.env)).toBeNull();
    });

    it('assertOutputBaseUrl reads both variables from the environment it is given, never from process.env', () => {
        delete process.env[DIR];
        delete process.env[BASE];
        expect(assertOutputBaseUrl({ [BASE]: 'https://files.example.com/pdf', [DIR]: sandbox })).toBe('https://files.example.com/pdf/');
        process.env[DIR] = sandbox;
        expect(() => assertOutputBaseUrl({ [BASE]: 'https://files.example.com/pdf' })).toThrow(/is set but PDFNATIVE_MCP_OUTPUT_DIR is not/);
    });
});

describe('publicUrlFor — base + sandbox-relative path, percent-encoded per segment', () => {
    it('maps a nested path and encodes spaces and non-ASCII', () => {
        expect(publicUrlFor(path.join(sandbox, 'reports', 'Q3 plan.pdf'))).toBe('https://files.example.com/pdf/reports/Q3%20plan.pdf');
        expect(publicUrlFor(path.join(sandbox, 'été.pdf'))).toBe('https://files.example.com/pdf/%C3%A9t%C3%A9.pdf');
    });

    it('is undefined without a base URL', () => {
        delete process.env[BASE];
        expect(publicUrlFor(path.join(sandbox, 'a.pdf'))).toBeUndefined();
    });
});

describe('every file writer carries url beside filePath', () => {
    it('emitPdf', async () => {
        const out = await emitPdf(PDF, { mode: 'file', outputPath: 'sub/out.pdf' });
        expect(out.filePath).toBe(path.join(sandbox, 'sub', 'out.pdf'));
        expect(out.url).toBe('https://files.example.com/pdf/sub/out.pdf');
    });

    it('emitPdf without the variable has no url key at all (the 1.7.0 shape)', async () => {
        delete process.env[BASE];
        const out = await emitPdf(PDF, { mode: 'file', outputPath: 'plain.pdf' });
        expect('url' in out).toBe(false);
    });

    it('emitPdfMulti, per part', async () => {
        const out = await emitPdfMulti([PDF, PDF], { mode: 'file', outputPath: 'parts/out.pdf' });
        expect(out.parts.map((p) => p.url)).toEqual(['https://files.example.com/pdf/parts/out-1.pdf', 'https://files.example.com/pdf/parts/out-2.pdf']);
    });

    it('writeSandboxedText', async () => {
        const out = await writeSandboxedText('# draft', 'drafts/issue.md', '.md');
        expect(out.url).toBe('https://files.example.com/pdf/drafts/issue.md');
    });

    it('base64 mode is untouched', async () => {
        const out = await emitPdf(PDF, { mode: 'base64' });
        expect('url' in out).toBe(false);
    });
});

describe('tools/call — the text names the URL, structuredContent keeps filePath and adds url', () => {
    const DOC = { title: 'U', blocks: [{ type: 'paragraph', text: 'Hello' }], creationDate: '2026-01-15T09:00:00Z' };

    it('generate_basic_pdf in file mode', async () => {
        const r = await callToolDirect('generate_basic_pdf', { ...DOC, outputMode: 'file', outputPath: 'reports/Q3 plan.pdf' });
        expect(r.isError).not.toBe(true);
        const text = (r.content.find((c) => c.type === 'text') as { text: string }).text;
        expect(text).toContain('wrote');
        expect(text).toContain('https://files.example.com/pdf/reports/Q3%20plan.pdf');
        expect(text).not.toContain(sandbox);
        const sc = r.structuredContent as { filePath: string; url: string };
        expect(sc.filePath).toBe(path.join(sandbox, 'reports', 'Q3 plan.pdf'));
        expect(sc.url).toBe('https://files.example.com/pdf/reports/Q3%20plan.pdf');
        // The resource link still points at the pdfnative:// resource, not the URL.
        expect(r.content.some((c) => c.type === 'resource_link')).toBe(true);
    });

    it('split_pdf in file mode names every part', async () => {
        const two = await callToolDirect('generate_basic_pdf', { ...DOC, blocks: [{ type: 'paragraph', text: 'One' }, { type: 'pageBreak' }, { type: 'paragraph', text: 'Two' }] });
        const pdfBase64 = ((two.content.find((c) => c.type === 'resource') as { resource: { blob: string } }).resource.blob);
        const r = await callToolDirect('split_pdf', { pdfBase64, ranges: [{ start: 0 }, { start: 1 }], outputMode: 'file', outputPath: 'split/part.pdf' });
        expect(r.isError).not.toBe(true);
        const text = (r.content.find((c) => c.type === 'text') as { text: string }).text;
        expect(text).toContain('https://files.example.com/pdf/split/part-1.pdf, https://files.example.com/pdf/split/part-2.pdf');
        const sc = r.structuredContent as { parts: Array<{ filePath: string; url: string }> };
        expect(sc.parts.map((p) => p.url)).toEqual(['https://files.example.com/pdf/split/part-1.pdf', 'https://files.example.com/pdf/split/part-2.pdf']);
        expect(sc.parts.every((p) => p.filePath.startsWith(sandbox))).toBe(true);
    });

    it('draft_governance_issue in file mode', async () => {
        const r = await callToolDirect('draft_governance_issue', {
            title: 'Test draft',
            issueType: 'bug',
            targetRepo: 'pdfnative',
            summary: 'A reproducible problem seen through the server.',
            reproduction: { command: 'generate_basic_pdf with the attached input', result: 'the engine throws' },
            expectedBehavior: 'The document builds.',
            actualBehavior: 'GENERATION_FAILED.',
            affectedPackages: ['pdfnative'],
            duplicateSearchPerformed: true,
            outputMode: 'file',
            outputPath: 'drafts/test draft.md',
        });
        expect(r.isError, JSON.stringify(r.content[0])).not.toBe(true);
        const text = (r.content.find((c) => c.type === 'text') as { text: string }).text;
        expect(text).toContain('https://files.example.com/pdf/drafts/test%20draft.md');
        expect((r.structuredContent as { url: string }).url).toBe('https://files.example.com/pdf/drafts/test%20draft.md');
    });

    it('without the variable the text names the host path, as in 1.7.0', async () => {
        delete process.env[BASE];
        const r = await callToolDirect('generate_basic_pdf', { ...DOC, outputMode: 'file', outputPath: 'plain.pdf' });
        const text = (r.content.find((c) => c.type === 'text') as { text: string }).text;
        expect(text).toContain(path.join(sandbox, 'plain.pdf'));
        expect('url' in (r.structuredContent as object)).toBe(false);
    });
});
