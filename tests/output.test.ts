import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emitPdf, emitPdfMulti, resolveSandboxedPath, getOutputSandbox, writeSandboxedText } from '../src/output.js';
import { SecurityError, ToolError } from '../src/errors.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

describe('output sandbox', () => {
    let sandboxDir: string;

    beforeEach(async () => {
        sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-mpc-test-'));
        process.env[ENV_KEY] = sandboxDir;
    });

    it('emits base64 by default', async () => {
        delete process.env[ENV_KEY];
        const result = await emitPdf(new Uint8Array([1, 2, 3, 4]), { mode: 'base64' });
        expect(result.mode).toBe('base64');
        expect(result.sizeBytes).toBe(4);
        expect(typeof result.base64).toBe('string');
    });

    it('writes file inside sandbox', async () => {
        const result = await emitPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
            mode: 'file',
            outputPath: 'sub/out.pdf',
        });
        expect(result.mode).toBe('file');
        expect(result.filePath?.startsWith(sandboxDir)).toBe(true);
        const written = await fs.readFile(result.filePath!);
        expect(written.length).toBe(4);
    });

    it('rejects path traversal', () => {
        expect(() => resolveSandboxedPath('../escape.pdf')).toThrow(SecurityError);
    });

    it('rejects absolute paths', () => {
        expect(() => resolveSandboxedPath('C:\\Windows\\System32\\evil.pdf')).toThrow(SecurityError);
        expect(() => resolveSandboxedPath('\\\\server\\share\\evil.pdf')).toThrow(SecurityError);
        expect(() => resolveSandboxedPath('/etc/passwd.pdf')).toThrow(SecurityError);
    });

    it('rejects NUL bytes', () => {
        expect(() => resolveSandboxedPath('foo\0bar.pdf')).toThrow(SecurityError);
    });

    it('rejects non-pdf extension', () => {
        expect(() => resolveSandboxedPath('foo.exe')).toThrow(ToolError);
    });

    it('accepts a custom extension for text artifacts', () => {
        const resolved = resolveSandboxedPath('drafts/issue.md', '.md');
        expect(resolved.startsWith(sandboxDir)).toBe(true);
        expect(resolved.toLowerCase().endsWith('.md')).toBe(true);
    });

    it('writes a sandboxed .md text artifact', async () => {
        const { filePath, sizeBytes } = await writeSandboxedText('# Draft\n\nbody', 'drafts/issue.md', '.md');
        expect(filePath.startsWith(sandboxDir)).toBe(true);
        const written = await fs.readFile(filePath, 'utf8');
        expect(written).toBe('# Draft\n\nbody');
        expect(sizeBytes).toBe(Buffer.byteLength('# Draft\n\nbody', 'utf8'));
    });

    it('rejects a text artifact whose extension does not match', async () => {
        await expect(writeSandboxedText('x', 'issue.txt', '.md')).rejects.toThrow(ToolError);
    });

    it('rejects a traversal path for a text artifact', async () => {
        await expect(writeSandboxedText('x', '../escape.md', '.md')).rejects.toThrow(SecurityError);
    });

    it('refuses file output when sandbox is unset', async () => {
        delete process.env[ENV_KEY];
        expect(getOutputSandbox()).toBeNull();
        await expect(emitPdf(new Uint8Array([1]), { mode: 'file', outputPath: 'a.pdf' })).rejects.toThrow(SecurityError);
    });
});

describe('emitPdfMulti', () => {
    const ENV = 'PDFNATIVE_MCP_OUTPUT_DIR';
    let sandboxDir: string;

    beforeEach(async () => {
        sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-multi-'));
    });

    afterEach(() => {
        delete process.env[ENV];
    });

    it('returns a base64 part per PDF with a size recap', async () => {
        delete process.env[ENV];
        const result = await emitPdfMulti([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])], { mode: 'base64' });
        expect(result.mode).toBe('base64');
        expect(result.count).toBe(2);
        expect(result.totalBytes).toBe(5);
        expect(result.parts.map((p) => p.index)).toEqual([0, 1]);
        expect(typeof result.parts[0]?.base64).toBe('string');
        expect(result.parts[1]?.sizeBytes).toBe(3);
    });

    it('writes 1-based indexed files inside the sandbox', async () => {
        process.env[ENV] = sandboxDir;
        const result = await emitPdfMulti([new Uint8Array([0x25]), new Uint8Array([0x50])], {
            mode: 'file',
            outputPath: 'doc.pdf',
        });
        expect(result.mode).toBe('file');
        expect(result.parts[0]?.filePath?.endsWith('doc-1.pdf')).toBe(true);
        expect(result.parts[1]?.filePath?.endsWith('doc-2.pdf')).toBe(true);
        for (const part of result.parts) {
            const written = await fs.readFile(part.filePath as string);
            expect(written.length).toBe(1);
        }
    });

    it('rejects when a part exceeds the per-PDF cap', async () => {
        delete process.env[ENV];
        const huge = new Uint8Array(51 * 1024 * 1024);
        await expect(emitPdfMulti([huge], { mode: 'base64' })).rejects.toThrow(ToolError);
    });
});

describe('output sandbox env-var aliasing (v1.0.0)', () => {
    const DEPRECATED = 'PDFNATIVE_MPC_OUTPUT_DIR';
    const CANONICAL = 'PDFNATIVE_MCP_OUTPUT_DIR';
    let warnings: string[];
    const origWrite = process.stderr.write.bind(process.stderr);

    beforeEach(async () => {
        delete process.env[CANONICAL];
        delete process.env[DEPRECATED];
        warnings = [];
        (process.stderr.write as unknown) = (chunk: string | Uint8Array): boolean => {
            warnings.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
            return true;
        };
        // Reset the one-shot latch so each test sees a fresh deprecation warning state.
        const { __resetDeprecationWarning } = await import('../src/output.js');
        __resetDeprecationWarning();
    });

    afterEach(() => {
        (process.stderr.write as unknown) = origWrite;
    });

    it('canonical PDFNATIVE_MCP_OUTPUT_DIR is honoured without warnings', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-mcp-canonical-'));
        process.env[CANONICAL] = dir;
        expect(getOutputSandbox()).toBe(path.resolve(dir));
        expect(warnings.join('')).toBe('');
    });

    it('deprecated PDFNATIVE_MPC_OUTPUT_DIR still resolves but emits one warning', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-mcp-legacy-'));
        process.env[DEPRECATED] = dir;
        expect(getOutputSandbox()).toBe(path.resolve(dir));
        // Repeated lookups must not re-emit the warning.
        getOutputSandbox();
        getOutputSandbox();
        const joined = warnings.join('');
        expect(joined).toContain('deprecated');
        expect(joined).toContain('PDFNATIVE_MCP_OUTPUT_DIR');
        expect(warnings.length).toBe(1);
    });

    it('canonical takes precedence over the deprecated alias when both are set', async () => {
        const canonicalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-mcp-pri-'));
        const legacyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-mcp-leg-'));
        process.env[CANONICAL] = canonicalDir;
        process.env[DEPRECATED] = legacyDir;
        expect(getOutputSandbox()).toBe(path.resolve(canonicalDir));
        expect(warnings.join('')).toBe('');
    });
});
