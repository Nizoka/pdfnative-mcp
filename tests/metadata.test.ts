import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { __serverMetadata, listToolsPayload } from '../src/server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED_MCP_NAME = 'io.github.Nizoka/pdfnative-mcp';
const EXPECTED_NPM_NAME = 'pdfnative-mcp';

async function readJson(rel: string): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(path.join(ROOT, rel), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
}

describe('registry metadata parity', () => {
    it('mcpName uses the canonical GitHub login casing (Nizoka)', async () => {
        const pkg = await readJson('package.json');
        // npm requires a lowercase package name…
        expect(pkg['name']).toBe(EXPECTED_NPM_NAME);
        // …but the MCP registry compares mcpName to the GitHub namespace with
        // case-sensitive equality, so the login must be spelled "Nizoka".
        expect(pkg['mcpName']).toBe(EXPECTED_MCP_NAME);
    });

    it('server.json name matches package.json mcpName exactly (case-sensitive)', async () => {
        const pkg = await readJson('package.json');
        const server = await readJson('server.json');
        expect(server['name']).toBe(EXPECTED_MCP_NAME);
        expect(server['name']).toBe(pkg['mcpName']);
    });

    it('advertises the same websiteUrl in serverInfo (Implementation) as server.json and package.json homepage', async () => {
        const pkg = await readJson('package.json');
        const server = await readJson('server.json');
        expect(__serverMetadata.websiteUrl).toBe(server['websiteUrl']);
        expect(__serverMetadata.websiteUrl).toBe(pkg['homepage']);
    });

    it('keeps version in lock-step across package.json, server.json and the server runtime', async () => {
        const pkg = await readJson('package.json');
        const server = await readJson('server.json');
        const version = pkg['version'];
        expect(version).toBe(__serverMetadata.version);
        expect(server['version']).toBe(version);
        const packages = server['packages'] as Array<Record<string, unknown>>;
        expect(packages[0]?.['identifier']).toBe(EXPECTED_NPM_NAME);
        expect(packages[0]?.['version']).toBe(version);
    });

    it('advertises the same title in serverInfo as server.json', async () => {
        const server = await readJson('server.json');
        expect(__serverMetadata.title).toBe(server['title']);
    });

    it('quotes the live tool count in every registry-facing description', async () => {
        const pkg = await readJson('package.json');
        const server = await readJson('server.json');
        const phrase = `${listToolsPayload().tools.length} tools`;
        expect(String(server['description'])).toContain(phrase);
        expect(String(pkg['description'])).toContain(phrase);
        expect(__serverMetadata.description).toContain(phrase);
    });

    it('validates server.json against a vendored copy of the schema revision it names', async () => {
        const server = await readJson('server.json');
        const url = String(server['$schema']);
        const revision = /\/schemas\/([^/]+)\/server\.schema\.json$/.exec(url)?.[1];
        expect(revision, 'server.json $schema must name a registry schema revision').toBeDefined();
        const vendored = await readJson(`tests/_fixtures/server.schema.${revision}.json`);
        expect(vendored['$id']).toBe(url);
    });

    it('declares in server.json exactly the operator variables the source reads', async () => {
        const server = await readJson('server.json');
        const packages = server['packages'] as Array<{ environmentVariables?: Array<{ name: string }> }>;
        const declared = (packages[0]?.environmentVariables ?? []).map((v) => v.name).sort();

        const srcDir = path.join(ROOT, 'src');
        const read = new Set<string>();
        const walk = async (dir: string): Promise<void> => {
            for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
                const p = path.join(dir, entry.name);
                if (entry.isDirectory()) await walk(p);
                else if (entry.name.endsWith('.ts')) {
                    for (const m of (await fs.readFile(p, 'utf8')).matchAll(/PDFNATIVE_MCP_[A-Z_]+/g)) read.add(m[0]);
                }
            }
        };
        await walk(srcDir);
        // A TypeScript constant (src/version.ts), not an environment variable.
        read.delete('PDFNATIVE_MCP_VERSION');
        // The deprecated misspelt alias PDFNATIVE_MPC_OUTPUT_DIR is deliberately
        // undeclared: the regex above does not match it, and it must stay out of
        // the registry listing.
        expect(declared).toEqual([...read].sort());
    });
});
