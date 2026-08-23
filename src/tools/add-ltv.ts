/**
 * Tool: add_ltv — PAdES B-LT: embed a Document Security Store (`/DSS` +
 * per-signature `/VRI`) carrying the certificates and revocation material
 * (OCSP responses / CRLs) that future verifiers need once the issuing CAs
 * and responders have disappeared.
 *
 * Two modes, both faithful to pdfnative 1.7:
 *   - `online` — `addValidationInfo()`: the engine walks every signed
 *     signature (and the TSA certificates inside embedded timestamp tokens),
 *     asks the **operator-configured** revocation provider for OCSP/CRL
 *     material (`PDFNATIVE_MCP_REVOCATION` + allow-list) and embeds it.
 *     Every response is parse-validated (RFC 6960 / RFC 5280) before the
 *     engine sees it, so an HTTP-200 error page from a responder never lands
 *     in `/DSS`. Fails fast with `REVOCATION_NOT_CONFIGURED` when nothing is
 *     configured: the server never contacts the network otherwise.
 *   - `offline` — `embedValidationInfo()`: the caller supplies DER material
 *     collected out-of-band (air-gapped pipelines, corporate PKI exports);
 *     every blob is parsed before embedding so garbage never lands in `/DSS`.
 *     The `/VRI` entry of every signed signature references all supplied
 *     items (the Adobe-tolerant superset).
 *
 * Incremental and idempotent-ish: an existing `/DSS` is merged, never
 * replaced; earlier revisions (and their signatures) stay byte-identical.
 */
import {
    addValidationInfo,
    embedValidationInfo,
    listSignatures,
    parseCertificate,
    parseCrl,
    parseOcspResponse,
    vriKeyForContents,
    type LtvData,
    type RevocationProvider,
} from 'pdfnative';
import { z } from 'zod';

import { ToolError } from '../errors.js';
import { requireRevocationProvider } from '../network.js';
import { emitPdf, type OutputResult } from '../output.js';

export const ADD_LTV_NAME = 'add_ltv';

const DER_LIST = (max: number, description: string) =>
    ({
        type: 'array',
        maxItems: max,
        items: { type: 'string', minLength: 4, maxLength: 1_400_000 },
        description,
    }) as const;

export const ADD_LTV_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['pdfBase64'],
    properties: {
        pdfBase64: { type: 'string', minLength: 4, description: 'Base64-encoded SIGNED PDF (unencrypted). Sign with sign_pdf (profile=pades recommended) first.' },
        mode: {
            type: 'string',
            enum: ['online', 'offline'],
            default: 'online',
            description:
                "'online' collects OCSP/CRL material through the operator-configured revocation provider (PDFNATIVE_MCP_REVOCATION + PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS; REVOCATION_NOT_CONFIGURED otherwise — no network call is ever made without it). 'offline' embeds caller-supplied DER material without any network access.",
        },
        extraCertificatesDerBase64: DER_LIST(32, 'online: additional DER certificates (intermediates / roots) to complete chains the CMS does not carry.'),
        preferOcsp: { type: 'boolean', default: true, description: 'online: try OCSP before CRL for each certificate (default true).' },
        certificatesDerBase64: DER_LIST(64, 'offline: DER X.509 certificates to embed in /DSS /Certs.'),
        ocspResponsesDerBase64: DER_LIST(64, 'offline: DER OCSPResponse (RFC 6960) blobs to embed in /DSS /OCSPs.'),
        crlsDerBase64: DER_LIST(16, 'offline: DER CertificateList (RFC 5280) blobs to embed in /DSS /CRLs.'),
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64', description: "'base64' (default) returns the PDF inline; 'file' writes it inside the PDFNATIVE_MCP_OUTPUT_DIR sandbox (SECURITY_VIOLATION when the sandbox is not configured)." },
        outputPath: { type: 'string', description: "Relative path inside PDFNATIVE_MCP_OUTPUT_DIR (required when outputMode='file')." },
    },
} as const;

const derList = (max: number) => z.array(z.string().min(4).max(1_400_000)).max(max).optional();

const InputSchema = z
    .strictObject({
        pdfBase64: z.string().min(4),
        mode: z.enum(['online', 'offline']).default('online'),
        extraCertificatesDerBase64: derList(32),
        preferOcsp: z.boolean().default(true),
        certificatesDerBase64: derList(64),
        ocspResponsesDerBase64: derList(64),
        crlsDerBase64: derList(16),
        outputMode: z.enum(['base64', 'file']).default('base64'),
        outputPath: z.string().optional(),
    })
    .superRefine((v, ctx) => {
        if (v.mode === 'offline') {
            const n = (v.certificatesDerBase64?.length ?? 0) + (v.ocspResponsesDerBase64?.length ?? 0) + (v.crlsDerBase64?.length ?? 0);
            if (n === 0) {
                ctx.addIssue({ code: 'custom', message: "mode='offline' needs at least one of certificatesDerBase64, ocspResponsesDerBase64 or crlsDerBase64." });
            }
        }
    });

function decodeList(field: string, items: readonly string[] | undefined): Uint8Array[] {
    return (items ?? []).map((b64, i) => {
        const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
        if (bytes.byteLength === 0) throw new ToolError('VALIDATION_ERROR', `${field}[${i}] is not valid base64.`);
        return bytes;
    });
}

function validateMaterial(field: string, items: readonly Uint8Array[], parse: (der: Uint8Array) => unknown): void {
    items.forEach((der, i) => {
        try {
            parse(der);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new ToolError('LTV_MATERIAL_INVALID', `${field}[${i}] does not parse: ${message}`);
        }
    });
}

/**
 * Wrap the operator provider so that every fetched blob is parsed before the
 * engine embeds it — the engine stores provider output verbatim.
 */
function validatingProvider(raw: RevocationProvider): RevocationProvider {
    const rawOcsp = raw.fetchOcsp;
    const rawCrl = raw.fetchCrl;
    const hostOf = (u: string): string => {
        try {
            return new URL(u).host;
        } catch {
            return 'responder';
        }
    };
    return {
        ...(rawOcsp !== undefined
            ? {
                  fetchOcsp: async (url: string, request: Uint8Array): Promise<Uint8Array> => {
                      const bytes = await rawOcsp(url, request);
                      try {
                          parseOcspResponse(bytes);
                      } catch (err) {
                          const message = err instanceof Error ? err.message : String(err);
                          throw new ToolError('LTV_MATERIAL_INVALID', `OCSP response from ${hostOf(url)} does not parse: ${message}`);
                      }
                      return bytes;
                  },
              }
            : {}),
        ...(rawCrl !== undefined
            ? {
                  fetchCrl: async (url: string): Promise<Uint8Array> => {
                      const bytes = await rawCrl(url);
                      try {
                          parseCrl(bytes);
                      } catch (err) {
                          const message = err instanceof Error ? err.message : String(err);
                          throw new ToolError('LTV_MATERIAL_INVALID', `CRL from ${hostOf(url)} does not parse: ${message}`);
                      }
                      return bytes;
                  },
              }
            : {}),
    };
}

function mapLtvError(err: unknown): ToolError {
    if (err instanceof ToolError) return err;
    const message = err instanceof Error ? err.message : String(err);
    if (/no signed signature/i.test(message)) {
        return new ToolError('LTV_NO_SIGNATURE', 'The document has no signed signature to enable LTV for — run sign_pdf first.');
    }
    if (/LtvData is empty|nothing to embed/i.test(message)) {
        return new ToolError('LTV_EMPTY', `No validation material could be collected (self-signed chains and certificates without AIA / CRL-DP yield nothing): ${message}`);
    }
    if (/encrypt/i.test(message)) {
        return new ToolError('ENCRYPTED_SOURCE', 'add_ltv does not support encrypted PDFs, and decrypt_pdf would drop the signatures it needs — sign an unencrypted document (sign_pdf) and apply the LTV ladder before any encryption.');
    }
    if (/xref|startxref|trailer|%PDF|parse/i.test(message)) {
        return new ToolError('PDF_PARSE_FAILED', `Failed to parse PDF: ${message}`);
    }
    return new ToolError('LTV_ERROR', `Failed to embed validation information: ${message}`);
}

export async function addLtv(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const input = parsed.data;
    const pdf = new Uint8Array(Buffer.from(input.pdfBase64, 'base64'));

    let out: Uint8Array;
    let summary: Record<string, unknown>;
    try {
        if (input.mode === 'online') {
            // Fail fast (before touching the document) when no provider is configured.
            const revocationProvider = validatingProvider(requireRevocationProvider());
            const extraCertificates = decodeList('extraCertificatesDerBase64', input.extraCertificatesDerBase64);
            validateMaterial('extraCertificatesDerBase64', extraCertificates, parseCertificate);
            const before = listSignatures(pdf);
            out = await addValidationInfo(pdf, {
                revocationProvider,
                preferOcsp: input.preferOcsp,
                ...(extraCertificates.length > 0 ? { extraCertificates } : {}),
            });
            summary = { mode: 'online', signatures: before.filter((s) => !s.isPlaceholder).length };
        } else {
            const certificates = decodeList('certificatesDerBase64', input.certificatesDerBase64);
            const ocspResponses = decodeList('ocspResponsesDerBase64', input.ocspResponsesDerBase64);
            const crls = decodeList('crlsDerBase64', input.crlsDerBase64);
            validateMaterial('certificatesDerBase64', certificates, parseCertificate);
            validateMaterial('ocspResponsesDerBase64', ocspResponses, parseOcspResponse);
            validateMaterial('crlsDerBase64', crls, parseCrl);

            // Every signed field — including document timestamps, which PAdES
            // re-timestamping chains also validate through /VRI — gets an entry.
            const signed = listSignatures(pdf).filter((s) => !s.isPlaceholder);
            if (signed.length === 0) {
                throw new ToolError('LTV_NO_SIGNATURE', 'The document has no signed signature to enable LTV for — run sign_pdf first.');
            }
            const all = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
            const data: LtvData = {
                certificates,
                ocspResponses,
                crls,
                vri: signed.map((s) => ({
                    key: vriKeyForContents(s.contents),
                    certs: all(certificates.length),
                    ocsps: all(ocspResponses.length),
                    crls: all(crls.length),
                })),
            };
            out = embedValidationInfo(pdf, data);
            summary = {
                mode: 'offline',
                signatures: signed.length,
                certificates: certificates.length,
                ocspResponses: ocspResponses.length,
                crls: crls.length,
            };
        }
    } catch (err) {
        throw mapLtvError(err);
    }

    const result = await emitPdf(out, {
        mode: input.outputMode,
        ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
    });
    return { ...result, summary };
}
