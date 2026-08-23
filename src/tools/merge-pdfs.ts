/**
 * Tool: merge_pdfs
 *
 * Concatenates 2–50 source PDFs into a single document using pdfnative's
 * page-tree manipulation API (`mergePdfs`, new in pdfnative v1.4.0). Each
 * kept page's transitive object graph is deep-copied into a fresh object-number
 * space, so the output is fully self-contained.
 *
 * Faithful-wrapper notes (pdfnative semantics, surfaced verbatim):
 *   - Encrypted sources are rejected (decrypt outside the server first) →
 *     `ENCRYPTED_SOURCE`.
 *   - Any existing signatures and the `/AcroForm` are dropped — a page-tree
 *     edit necessarily invalidates `/ByteRange`. Self-contained URI `/Link`
 *     annotations are preserved unless `dropAnnotations` is set.
 *   - A secure-by-default 256 MiB *assembly* guard (`maxOutputSizeBytes`, the
 *     pdfnative `maxOutputSize`) rejects oversized object graphs before they are
 *     materialised. The emitted PDF is additionally capped at 50 MiB by the
 *     output layer (the effective per-PDF ceiling) → `OUTPUT_TOO_LARGE`.
 */
import { mergePdfs, type MergeOptions } from 'pdfnative';
import { z } from 'zod';

import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { decodePdfBase64 } from '../base64.js';
import { mapPageTreeError } from '../pagetree.js';
import {
    ENCRYPT_INPUT_SCHEMA,
    EncryptSchema,
    PASSWORD_INPUT_SCHEMA,
    PasswordSchema,
    toEncryptionOptions,
} from '../encryption.js';

export const MERGE_PDFS_NAME = 'merge_pdfs';

export const MERGE_PDFS_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfsBase64'],
    properties: {
        pdfsBase64: {
            type: 'array',
            description:
                'Base64-encoded source PDFs to concatenate, in order. 2–50 documents. Signatures and AcroForms are dropped (a page-tree edit invalidates them); encrypted PDFs are rejected.',
            minItems: 2,
            maxItems: 50,
            items: { type: 'string', minLength: 4 },
        },
        password: {
            ...PASSWORD_INPUT_SCHEMA,
            description:
                'Password applied to every encrypted source (pdfnative v1.6.0). Sources with an empty user password open without it. The merged output is unencrypted unless `encrypt` is set.',
        },
        encrypt: ENCRYPT_INPUT_SCHEMA,
        dropAnnotations: {
            type: 'boolean',
            default: false,
            description:
                'When true, drop ALL annotations. Default (false) keeps self-contained URI link annotations and drops cross-document/widget annotations.',
        },
        maxOutputSizeBytes: {
            type: 'integer',
            minimum: 1,
            description:
                'In-memory assembly guard (pdfnative maxOutputSize): the merge throws before materialising an object graph larger than this. Defaults to 268435456 (256 MiB). Note the emitted PDF is separately capped at 50 MiB by the output layer.',
        },
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64' },
        outputPath: { type: 'string' },
    },
} as const;

const InputSchema = z.strictObject({
    pdfsBase64: z.array(z.string().min(4)).min(2).max(50),
    password: PasswordSchema.optional(),
    encrypt: EncryptSchema.optional(),
    dropAnnotations: z.boolean().default(false),
    maxOutputSizeBytes: z.number().int().positive().optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

function decodeBase64(value: string, field: string): Uint8Array {
    return decodePdfBase64(value, field);
}

export async function mergePdfsTool(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const input = parsed.data;

    const sources = input.pdfsBase64.map((b64, i) => decodeBase64(b64, `pdfsBase64[${i}]`));

    const opts: MergeOptions = {
        dropAnnotations: input.dropAnnotations,
        ...(input.maxOutputSizeBytes !== undefined ? { maxOutputSize: input.maxOutputSizeBytes } : {}),
        ...(input.password !== undefined ? { password: input.password } : {}),
        ...(input.encrypt !== undefined ? { encrypt: toEncryptionOptions(input.encrypt) } : {}),
    };

    let merged: Uint8Array;
    try {
        merged = mergePdfs(sources, opts);
    } catch (err) {
        mapPageTreeError(err, input.password !== undefined);
    }

    return emitPdf(merged, {
        mode: input.outputMode,
        ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
    });
}
