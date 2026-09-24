/**
 * Operator creation-date pin (src/reproducible.ts): PDFNATIVE_MCP_CREATION_DATE,
 * then SOURCE_DATE_EPOCH, over pdfnative 1.8.0 setDefaultCreationDate().
 *
 * The pin is process-wide engine state: every test that sets it clears it in
 * afterEach, and the vitest `forks` pool keeps it from leaking across files.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getDefaultCreationDate, setDefaultCreationDate } from 'pdfnative';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { CREATION_DATE_ENV, SOURCE_DATE_EPOCH_ENV, applyPinnedCreationDate, creationDateCacheTag, readPinnedCreationDate } from '../src/reproducible.js';
import { cacheNamespace, callToolDirect, ensureCompressionReady } from '../src/server.js';
import { addTable } from '../src/tools/add-table.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import type { OutputResult } from '../src/output.js';
import { PDFNATIVE_MCP_VERSION } from '../src/version.js';

const latin1 = (out: OutputResult): string => Buffer.from(out.base64!, 'base64').toString('latin1');
const DOC = { title: 'Pinned', blocks: [{ type: 'paragraph', text: 'Body.' }], footerTemplate: { left: 'Built {date}' } };

beforeAll(async () => {
    await ensureCompressionReady();
});

afterEach(() => {
    setDefaultCreationDate(null);
    delete process.env['PDFNATIVE_MCP_CACHE_DIR'];
});

describe('readPinnedCreationDate — parsing and precedence', () => {
    it('returns null when nothing (or only empty values) is configured', () => {
        expect(readPinnedCreationDate({})).toBeNull();
        expect(readPinnedCreationDate({ [CREATION_DATE_ENV]: '', [SOURCE_DATE_EPOCH_ENV]: '  ' })).toBeNull();
    });

    it('reads an ISO 8601 instant with any time zone, exactly as the creationDate tool input does', () => {
        expect(readPinnedCreationDate({ [CREATION_DATE_ENV]: '2026-01-01T00:00:00Z' })).toEqual({ date: new Date('2026-01-01T00:00:00Z'), source: CREATION_DATE_ENV });
        expect(readPinnedCreationDate({ [CREATION_DATE_ENV]: ' 2026-01-01T02:00:00+02:00 ' })?.date.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('reads SOURCE_DATE_EPOCH as integer seconds (reproducible-builds.org)', () => {
        expect(readPinnedCreationDate({ [SOURCE_DATE_EPOCH_ENV]: '1767225600' })).toEqual({ date: new Date('2026-01-01T00:00:00Z'), source: SOURCE_DATE_EPOCH_ENV });
        expect(readPinnedCreationDate({ [SOURCE_DATE_EPOCH_ENV]: '0' })?.date.getTime()).toBe(0);
    });

    it("the server's own variable wins over SOURCE_DATE_EPOCH", () => {
        const pin = readPinnedCreationDate({ [CREATION_DATE_ENV]: '2030-06-01T12:00:00Z', [SOURCE_DATE_EPOCH_ENV]: '1767225600' });
        expect(pin).toEqual({ date: new Date('2030-06-01T12:00:00Z'), source: CREATION_DATE_ENV });
    });

    it.each([
        [CREATION_DATE_ENV, '01/01/2026'],
        [CREATION_DATE_ENV, '2026-01-01'],
        [CREATION_DATE_ENV, '2026-01-01T00:00:00'], // no time zone: ambiguous, refused
        [CREATION_DATE_ENV, '2026-13-45T00:00:00Z'],
        [SOURCE_DATE_EPOCH_ENV, 'abc'],
        [SOURCE_DATE_EPOCH_ENV, '-1'],
        [SOURCE_DATE_EPOCH_ENV, '1.5'],
        [SOURCE_DATE_EPOCH_ENV, '1767225600000000'], // milliseconds-and-more: 13+ digits
    ])('%s=%j refuses to start instead of falling back to the wall clock', (name, value) => {
        expect(() => readPinnedCreationDate({ [name]: value })).toThrow(new RegExp(name));
    });

    it('an invalid server variable is an error even when SOURCE_DATE_EPOCH is valid (no silent fallback)', () => {
        expect(() => readPinnedCreationDate({ [CREATION_DATE_ENV]: 'tomorrow', [SOURCE_DATE_EPOCH_ENV]: '1767225600' })).toThrow(/PDFNATIVE_MCP_CREATION_DATE/);
    });
});

describe('applyPinnedCreationDate — effect on generated documents', () => {
    it('pins /CreationDate, the {date} placeholder and therefore the bytes, in UTC', async () => {
        expect(applyPinnedCreationDate({ [SOURCE_DATE_EPOCH_ENV]: '1767225600' })?.source).toBe(SOURCE_DATE_EPOCH_ENV);
        expect(getDefaultCreationDate()?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
        const a = await generateBasicPdf(DOC);
        const b = await generateBasicPdf(DOC);
        expect(a.base64).toBe(b.base64);
        expect(latin1(a)).toMatch(/\/CreationDate\s*\(D:20260101000000\+00'00'\)/);
        expect(latin1(a)).toContain('Built 2026-01-01');
    });

    it('covers the table builder too (add_table uses a different engine entry point)', async () => {
        applyPinnedCreationDate({ [CREATION_DATE_ENV]: '2026-01-01T00:00:00Z' });
        const table = { title: 'T', headers: ['a'], rows: [['1']] };
        expect((await addTable(table)).base64).toBe((await addTable(table)).base64);
    });

    it("a call's own creationDate wins over the operator pin", async () => {
        applyPinnedCreationDate({ [CREATION_DATE_ENV]: '2026-01-01T00:00:00Z' });
        const out = latin1(await generateBasicPdf({ ...DOC, creationDate: '2031-03-04T05:06:07Z' }));
        expect(out).toMatch(/\/CreationDate\s*\(D:20310304050607\+00'00'\)/);
        expect(out).toContain('Built 2031-03-04');
    });

    it('the pinned bytes equal the bytes of the same instant passed per call', async () => {
        const perCall = await generateBasicPdf({ ...DOC, creationDate: '2026-01-01T00:00:00Z' });
        applyPinnedCreationDate({ [CREATION_DATE_ENV]: '2026-01-01T00:00:00Z' });
        expect((await generateBasicPdf(DOC)).base64).toBe(perCall.base64);
    });

    it('returns null and leaves the engine on the wall clock when nothing is configured', async () => {
        expect(applyPinnedCreationDate({})).toBeNull();
        expect(getDefaultCreationDate()).toBeNull();
        expect(latin1(await generateBasicPdf(DOC))).toContain(`Built ${new Date().toISOString().slice(0, 4)}`);
    });
});

describe('response cache — the pin is part of the namespace', () => {
    it('is the plain API / server version without a pin, and carries the instant with one', () => {
        expect(creationDateCacheTag()).toBe('');
        expect(cacheNamespace()).toMatch(new RegExp(`^\\d+\\.\\d+\\.\\d+/${PDFNATIVE_MCP_VERSION.replace(/\./g, '\\.')}$`));
        setDefaultCreationDate(new Date('2026-01-01T00:00:00Z'));
        expect(creationDateCacheTag()).toBe('/cd=1767225600000');
        expect(cacheNamespace().endsWith('/cd=1767225600000')).toBe(true);
    });

    it('never serves bytes cached under one pinned instant to a call made under another', async () => {
        const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'repro-cache-'));
        process.env['PDFNATIVE_MCP_CACHE_DIR'] = cacheDir;
        try {
            const blob = async (): Promise<string> => {
                const result = await callToolDirect('generate_basic_pdf', DOC);
                const block = result.content.find((c) => c.type === 'resource') as { resource: { blob: string } };
                return block.resource.blob;
            };
            setDefaultCreationDate(new Date('2026-01-01T00:00:00Z'));
            const first = await blob();
            expect(await blob()).toBe(first); // cache hit under the same pin
            setDefaultCreationDate(new Date('2027-01-01T00:00:00Z'));
            const second = await blob();
            expect(second).not.toBe(first);
            expect(Buffer.from(second, 'base64').toString('latin1')).toContain('Built 2027-01-01');
            const namespaces = readdirSync(cacheDir)
                .filter((f) => f.endsWith('.json'))
                .map((f) => (JSON.parse(readFileSync(path.join(cacheDir, f), 'utf8')) as { apiVersion: string }).apiVersion);
            expect(new Set(namespaces).size).toBe(2);
        } finally {
            rmSync(cacheDir, { recursive: true, force: true });
        }
    });
});
