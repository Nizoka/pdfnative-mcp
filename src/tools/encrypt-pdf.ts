/**
 * Tool: encrypt_pdf
 *
 * Re-secure an existing PDF with the PDF Standard Security Handler (AES-128
 * V4/R4 default, or AES-256 V5/R6), backed by pdfnative v1.6.0's page-tree
 * re-encryption path (`mergePdfs` with `MergeOptions.encrypt`). RC4 is never
 * emitted; a Web Crypto CSPRNG is required.
 *
 * An already-encrypted source can be re-secured under a *new* password by
 * supplying its current `password` (password rotation in one call).
 *
 * FAITHFUL-WRAPPER CAVEAT: encryption is applied while rebuilding the page tree.
 * Like merge/split/extract, this drops any existing digital signatures and the
 * interactive `/AcroForm` (a page-tree edit invalidates `/ByteRange`), and keeps
 * only self-contained URI link annotations. Encrypt BEFORE signing, not after.
 */
import { mergePdfs, type MergeOptions } from 'pdfnative';
import { z } from 'zod';

import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { mapPageTreeError } from '../pagetree.js';
import { ENCRYPT_INPUT_SCHEMA, EncryptSchema, PASSWORD_INPUT_SCHEMA, PasswordSchema, toEncryptionOptions } from '../encryption.js';

export const ENCRYPT_PDF_NAME = 'encrypt_pdf';

export const ENCRYPT_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64', 'ownerPassword'],
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded source PDF to encrypt. NOTE: existing signatures and AcroForm are dropped (page-tree rebuild).',
        },
        password: {
            ...PASSWORD_INPUT_SCHEMA,
            description: 'Current password of an already-encrypted source (enables password rotation). Omit for an unencrypted source.',
        },
        // Flattened encryption parameters (same shape as the `encrypt` option elsewhere).
        ownerPassword: ENCRYPT_INPUT_SCHEMA.properties.ownerPassword,
        userPassword: ENCRYPT_INPUT_SCHEMA.properties.userPassword,
        algorithm: ENCRYPT_INPUT_SCHEMA.properties.algorithm,
        permissions: ENCRYPT_INPUT_SCHEMA.properties.permissions,
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64' },
        outputPath: { type: 'string', description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf." },
    },
} as const;

const InputSchema = EncryptSchema.extend({
    pdfBase64: z.string().min(4),
    password: PasswordSchema.optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

function decodeBase64(value: string): Uint8Array {
    try {
        return new Uint8Array(Buffer.from(value, 'base64'));
        /* v8 ignore next 3 */
    } catch {
        throw new ToolError('VALIDATION_ERROR', 'pdfBase64 is not valid base64.');
    }
}

export async function encryptPdf(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { pdfBase64, password, outputMode, outputPath, ...encryptFields } = parsed.data;

    const bytes = decodeBase64(pdfBase64);
    if (bytes.length === 0) {
        throw new ToolError('VALIDATION_ERROR', 'pdfBase64 decoded to an empty buffer.');
    }
    const source = password !== undefined ? { bytes, password } : bytes;
    const opts: MergeOptions = { encrypt: toEncryptionOptions(encryptFields) };

    let encrypted: Uint8Array;
    try {
        encrypted = mergePdfs([source], opts);
    } catch (err) {
        mapPageTreeError(err, password !== undefined);
    }

    return emitPdf(encrypted, {
        mode: outputMode,
        ...(outputPath !== undefined ? { outputPath } : {}),
    });
}
