import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emitPdf, resolveSandboxedPath, getOutputSandbox } from '../src/output.js';
import { SecurityError, ToolError } from '../src/errors.js';

const ENV_KEY = 'PDFNATIVE_MPC_OUTPUT_DIR';

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

    it('refuses file output when sandbox is unset', async () => {
        delete process.env[ENV_KEY];
        expect(getOutputSandbox()).toBeNull();
        await expect(emitPdf(new Uint8Array([1]), { mode: 'file', outputPath: 'a.pdf' })).rejects.toThrow(SecurityError);
    });
});
