/**
 * Shared encryption / decryption helpers for the pdfnative v1.6.0 Standard
 * Security Handler surface.
 *
 * pdfnative 1.6.0 added transparent decryption on read (`openPdf({ password })`,
 * `reader.encryption`) and re-encryption on the page-tree rewrite path
 * (`MergeOptions.encrypt` / `PdfSourceInput`). This module centralises:
 *
 *   - the reusable `password` input fragment (read-only tools + page-tree tools),
 *   - the `encrypt` option schema (JSON Schema + Zod, kept in lock-step) and its
 *     mapper to pdfnative's {@link EncryptionOptions},
 *   - a stable error mapper translating pdfnative's typed `PdfPasswordError` /
 *     `PdfEncryptionUnsupportedError` (and CSPRNG failures) into {@link ToolError}
 *     codes AI clients can branch on.
 *
 * Faithful-wrapper note: RC4 is never emitted for new output (pdfnative only
 * writes AES-128 / AES-256); the source cipher is preserved on incremental
 * updates but never on a page-tree rebuild.
 */
import {
    PdfEncryptionUnsupportedError,
    PdfPasswordError,
    type EncryptionOptions,
} from 'pdfnative';
import { z } from 'zod';

import { ToolError } from './errors.js';

/** Reusable `password` input fragment for opening an encrypted source PDF. */
export const PASSWORD_INPUT_SCHEMA = {
    type: 'string',
    minLength: 1,
    maxLength: 4096,
    description:
        'Password (user or owner) of an encrypted source. Never logged or echoed.',
} as const;

/** Zod counterpart of {@link PASSWORD_INPUT_SCHEMA}. */
export const PasswordSchema = z.string().min(1).max(4096);

/** JSON Schema for the `encrypt` option (re-secure the output document). */
export const ENCRYPT_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['ownerPassword'],
    description:
        'Re-encrypt the output (Standard Security Handler; AES-128 default or AES-256; RC4 never emitted).',
    properties: {
        ownerPassword: {
            type: 'string',
            minLength: 1,
            maxLength: 4096,
            description: 'Owner password (full access).',
        },
        userPassword: {
            type: 'string',
            maxLength: 4096,
            description: 'Open password; omitted/empty = opens without a prompt.',
        },
        algorithm: {
            type: 'string',
            enum: ['aes128', 'aes256'],
            default: 'aes128',
            description: 'aes128 (V4/R4, widest compatibility) or aes256 (V5/R6).',
        },
        permissions: {
            type: 'object',
            additionalProperties: false,
            description: 'Permission flags; each defaults to allowed.',
            properties: {
                print: { type: 'boolean' },
                copy: { type: 'boolean' },
                modify: { type: 'boolean' },
                extractText: { type: 'boolean' },
            },
        },
    },
} as const;

/** Zod counterpart of {@link ENCRYPT_INPUT_SCHEMA}. */
export const EncryptSchema = z.strictObject({
    ownerPassword: z.string().min(1).max(4096),
    userPassword: z.string().max(4096).optional(),
    algorithm: z.enum(['aes128', 'aes256']).optional(),
    permissions: z
        .strictObject({
            print: z.boolean().optional(),
            copy: z.boolean().optional(),
            modify: z.boolean().optional(),
            extractText: z.boolean().optional(),
        })
        .optional(),
});

/** Map the validated `encrypt` input to pdfnative's {@link EncryptionOptions}. */
export function toEncryptionOptions(input: z.infer<typeof EncryptSchema>): EncryptionOptions {
    return {
        ownerPassword: input.ownerPassword,
        ...(input.userPassword !== undefined ? { userPassword: input.userPassword } : {}),
        ...(input.algorithm !== undefined ? { algorithm: input.algorithm } : {}),
        ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
    };
}

/**
 * Translate a decryption / encryption failure into a stable {@link ToolError}.
 * Always throws.
 *
 * - Encrypted source, no password supplied → `PASSWORD_REQUIRED`
 * - Encrypted source, wrong password        → `PASSWORD_INVALID`
 * - Unsupported security handler            → `ENCRYPTION_UNSUPPORTED`
 * - CSPRNG unavailable for re-encryption     → `ENCRYPTION_ERROR`
 * - Anything else                            → `PDF_PARSE_FAILED`
 *
 * @param hadPassword whether the caller supplied a password for the source.
 */
export function mapDecryptError(err: unknown, hadPassword: boolean): never {
    if (err instanceof PdfPasswordError) {
        if (hadPassword) {
            throw new ToolError('PASSWORD_INVALID', 'The supplied password did not open the encrypted PDF (wrong user and owner password).');
        }
        throw new ToolError(
            'PASSWORD_REQUIRED',
            'The source PDF is encrypted with a non-empty password. Supply it via the `password` input.',
        );
    }
    if (err instanceof PdfEncryptionUnsupportedError) {
        throw new ToolError(
            'ENCRYPTION_UNSUPPORTED',
            `The PDF uses an encryption scheme this server cannot open: ${err.message}`,
        );
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/csprng|crypto|random|web ?crypto|getRandomValues/i.test(message)) {
        throw new ToolError(
            'ENCRYPTION_ERROR',
            `Re-encryption failed: a secure random source (Web Crypto CSPRNG) is required. (${message})`,
        );
    }
    throw new ToolError('PDF_PARSE_FAILED', `Failed to process the PDF: ${message}`);
}
