/**
 * Tool: decrypt_pdf
 *
 * Open an encrypted PDF (pdfnative v1.6.0 Standard Security Handler
 * reader/decryptor) and emit an unencrypted copy, via the page-tree rebuild
 * path (`mergePdfs` with a `{ bytes, password }` source and no `encrypt`).
 * Supports RC4 (V1–V4), AES-128 (V4/R4) and AES-256 (V5/R6). Documents with an
 * empty user password decrypt without a `password`.
 *
 * FAITHFUL-WRAPPER CAVEAT: decryption is applied while rebuilding the page tree,
 * so existing digital signatures and the interactive `/AcroForm` are dropped and
 * only self-contained URI link annotations are kept. To read an encrypted PDF
 * without rebuilding it (e.g. to inspect metadata or extract text/attachments),
 * pass the `password` input to inspect_pdf / extract_text / extract_attachments
 * instead.
 */
import { mergePdfs } from 'pdfnative';
import { z } from 'zod';

import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { decodePdfBase64 } from '../base64.js';
import { mapPageTreeError } from '../pagetree.js';
import { PASSWORD_INPUT_SCHEMA, PasswordSchema } from '../encryption.js';

export const DECRYPT_PDF_NAME = 'decrypt_pdf';

export const DECRYPT_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64'],
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded encrypted PDF to decrypt. NOTE: signatures and AcroForm are dropped (page-tree rebuild).',
        },
        password: {
            ...PASSWORD_INPUT_SCHEMA,
            description: 'Password to open the encrypted source (user or owner). Omit only for documents with an empty user password.',
        },
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64' },
        outputPath: { type: 'string', description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf." },
    },
} as const;

const InputSchema = z.object({
    pdfBase64: z.string().min(4),
    password: PasswordSchema.optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

function decodeBase64(value: string): Uint8Array {
    return decodePdfBase64(value, 'pdfBase64');
}

export async function decryptPdf(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { pdfBase64, password, outputMode, outputPath } = parsed.data;

    const bytes = decodeBase64(pdfBase64);
    if (bytes.length === 0) {
        throw new ToolError('VALIDATION_ERROR', 'pdfBase64 decoded to an empty buffer.');
    }
    const source = password !== undefined ? { bytes, password } : bytes;

    let decrypted: Uint8Array;
    try {
        // No `encrypt` option → the rebuilt document is emitted unencrypted.
        decrypted = mergePdfs([source], {});
    } catch (err) {
        mapPageTreeError(err, password !== undefined);
    }

    return emitPdf(decrypted, {
        mode: outputMode,
        ...(outputPath !== undefined ? { outputPath } : {}),
    });
}
