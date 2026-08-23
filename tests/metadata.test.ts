import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { __serverMetadata } from '../src/server.js';

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
});
