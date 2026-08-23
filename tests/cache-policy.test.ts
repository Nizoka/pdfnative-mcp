/**
 * Server-level cache policy (review round 2, A-5): what the opt-in response
 * cache may serve, how a hit is signalled, and what the key is namespaced by.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { callToolDirect, ensureCompressionReady } from '../src/server.js';
import { PDFNATIVE_MCP_VERSION } from '../src/version.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { buildRsaSelfSignedCert } from './_cert-fixtures.js';

let cacheDir: string;

beforeAll(async () => {
    await ensureCompressionReady();
});

beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'pdfnative-cache-policy-'));
    process.env['PDFNATIVE_MCP_CACHE_DIR'] = cacheDir;
});

afterEach(() => {
    delete process.env['PDFNATIVE_MCP_CACHE_DIR'];
    rmSync(cacheDir, { recursive: true, force: true });
});

const DOC = { title: 'C', blocks: [{ type: 'paragraph', text: 'cache' }], creationDate: '2026-01-15T09:00:00Z' };

describe('response cache policy', () => {
    it('marks a served-from-cache result with _meta.cached=true and leaves the first (fresh) result unmarked', async () => {
        const fresh = await callToolDirect('generate_basic_pdf', DOC);
        expect(fresh.isError).not.toBe(true);
        expect((fresh._meta as Record<string, unknown> | undefined)?.['cached']).toBeUndefined();
        expect(readdirSync(cacheDir).filter((f) => f.endsWith('.json'))).toHaveLength(1);

        const hit = await callToolDirect('generate_basic_pdf', DOC);
        expect((hit._meta as Record<string, unknown>)['cached']).toBe(true);
        expect(hit.structuredContent).toEqual(fresh.structuredContent);
    });

    it('namespaces the key by tool API version and package version (engine lock-step)', async () => {
        await callToolDirect('generate_basic_pdf', DOC);
        const [file] = readdirSync(cacheDir).filter((f) => f.endsWith('.json'));
        const entry = JSON.parse(readFileSync(join(cacheDir, file!), 'utf8')) as { apiVersion: string; tool: string };
        expect(entry.tool).toBe('generate_basic_pdf');
        expect(entry.apiVersion).toMatch(new RegExp(`^\\d+\\.\\d+\\.\\d+/${PDFNATIVE_MCP_VERSION.replace(/\./g, '\\.')}$`));
    });

    it('never caches sign_pdf (wall-clock signingTime, key material) even with a pinned signingTime', async () => {
        const pdf = (await generateBasicPdf(DOC)).base64!;
        const fx = buildRsaSelfSignedCert();
        const args = {
            pdfBase64: pdf,
            algorithm: 'rsa-sha256',
            certDerBase64: Buffer.from(fx.certDer).toString('base64'),
            rsaKeyPkcs1DerBase64: Buffer.from(fx.privateKey.export({ format: 'der', type: 'pkcs1' })).toString('base64'),
            signingTime: '2026-01-15T09:00:00Z',
        };
        const a = await callToolDirect('sign_pdf', args);
        expect(a.isError).not.toBe(true);
        const b = await callToolDirect('sign_pdf', args);
        expect((b._meta as Record<string, unknown> | undefined)?.['cached']).toBeUndefined();
        expect(readdirSync(cacheDir).filter((f) => f.endsWith('.json'))).toHaveLength(0);
    });

    it('never caches file-mode output (the write is the effect)', async () => {
        const outDir = mkdtempSync(join(tmpdir(), 'pdfnative-cache-out-'));
        process.env['PDFNATIVE_MCP_OUTPUT_DIR'] = outDir;
        try {
            const r = await callToolDirect('generate_basic_pdf', { ...DOC, outputMode: 'file', outputPath: 'a.pdf' });
            expect(r.isError).not.toBe(true);
            expect(readdirSync(cacheDir).filter((f) => f.endsWith('.json'))).toHaveLength(0);
        } finally {
            delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
            rmSync(outDir, { recursive: true, force: true });
        }
    });
});
