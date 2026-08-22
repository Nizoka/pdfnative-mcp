/**
 * MCP server wiring: registers the four pdfnative tools on a low-level
 * `Server` instance and exposes a `createServer()` factory so the runtime
 * (CLI, tests, embedded host) can choose how to connect a transport.
 */
// MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, spec 2026-07-28 with a
// legacy 2025-xx fallback). We deliberately stay on the low-level `Server` +
// method-string `setRequestHandler` surface: `McpServer.registerTool` requires
// Standard-Schema inputs and validates `structuredContent` against the advertised
// `outputSchema`, which would break the hand-written JSON Schemas, the
// `verbosity`/`fields` projections and the `isError` contract this server promises.
import {
    Server,
    ProtocolError,
    ProtocolErrorCode,
    ResourceNotFoundError,
    type CacheHint,
    type CallToolResult,
    type GetPromptResult,
    type ListToolsResult,
    type ServerOptions,
    type Tool,
} from '@modelcontextprotocol/server';
import { initCrypto, initNodeCompression } from 'pdfnative';

import { ToolError } from './errors.js';
import { getCached, setCached } from './cache.js';
import { PDFNATIVE_MCP_VERSION } from './version.js';
import { listResources, listResourceTemplates, readResource, resourceLinkForPath } from './resources.js';
import {
    GOVERNANCE_CONTRACT_SUMMARY,
    DRAFT_ISSUE_WORKFLOW,
} from './governance.js';
import { type OutputResult, type MultiOutputResult } from './output.js';
import { DIAGNOSTICS_OUTPUT_PROPERTY } from './diagnostics.js';
import { readFields, readVerbosity, selectFields } from './projection.js';
import {
    GENERATE_BASIC_PDF_NAME,
    GENERATE_BASIC_PDF_INPUT_SCHEMA,
    generateBasicPdf,
} from './tools/generate-basic-pdf.js';
import {
    ADD_BARCODE_NAME,
    ADD_BARCODE_INPUT_SCHEMA,
    addBarcode,
} from './tools/add-barcode.js';
import {
    SIGN_PDF_NAME,
    SIGN_PDF_INPUT_SCHEMA,
    signPdf,
} from './tools/sign-pdf.js';
import {
    ADD_INTERNATIONAL_TEXT_NAME,
    ADD_INTERNATIONAL_TEXT_INPUT_SCHEMA,
    addInternationalText,
} from './tools/add-international-text.js';
import {
    ADD_TABLE_NAME,
    ADD_TABLE_INPUT_SCHEMA,
    addTable,
} from './tools/add-table.js';
import {
    ADD_FORM_NAME,
    ADD_FORM_INPUT_SCHEMA,
    addForm,
} from './tools/add-form.js';
import {
    EMBED_IMAGE_NAME,
    EMBED_IMAGE_INPUT_SCHEMA,
    embedImage,
} from './tools/embed-image.js';
import {
    PREPARE_SIGNATURE_PLACEHOLDER_NAME,
    PREPARE_SIGNATURE_PLACEHOLDER_INPUT_SCHEMA,
    prepareSignaturePlaceholder,
} from './tools/prepare-signature-placeholder.js';
import {
    INSPECT_PDF_NAME,
    INSPECT_PDF_INPUT_SCHEMA,
    INSPECT_PDF_OUTPUT_SCHEMA,
    inspectPdf,
    type InspectPdfResult,
} from './tools/inspect-pdf.js';
import {
    VERIFY_PDF_NAME,
    VERIFY_PDF_INPUT_SCHEMA,
    VERIFY_PDF_OUTPUT_SCHEMA,
    verifyPdf,
    type VerifyPdfResult,
} from './tools/verify-pdf.js';
import {
    ADD_ATTACHMENT_NAME,
    ADD_ATTACHMENT_INPUT_SCHEMA,
    addAttachment,
} from './tools/add-attachment.js';
import {
    EXTRACT_TEXT_NAME,
    EXTRACT_TEXT_INPUT_SCHEMA,
    EXTRACT_TEXT_OUTPUT_SCHEMA,
    extractText,
    type ExtractTextResult,
} from './tools/extract-text.js';
import {
    VALIDATE_PDF_NAME,
    VALIDATE_PDF_INPUT_SCHEMA,
    VALIDATE_PDF_OUTPUT_SCHEMA,
    validatePdf,
    type ValidatePdfResult,
} from './tools/validate-pdf.js';
import {
    EXTRACT_ATTACHMENTS_NAME,
    EXTRACT_ATTACHMENTS_INPUT_SCHEMA,
    EXTRACT_ATTACHMENTS_OUTPUT_SCHEMA,
    extractAttachments,
    type ExtractAttachmentsResult,
} from './tools/extract-attachments.js';
import {
    MERGE_PDFS_NAME,
    MERGE_PDFS_INPUT_SCHEMA,
    mergePdfsTool,
} from './tools/merge-pdfs.js';
import {
    SPLIT_PDF_NAME,
    SPLIT_PDF_INPUT_SCHEMA,
    splitPdfTool,
} from './tools/split-pdf.js';
import {
    EXTRACT_PAGES_NAME,
    EXTRACT_PAGES_INPUT_SCHEMA,
    extractPagesTool,
} from './tools/extract-pages.js';
import {
    ANNOTATE_PDF_NAME,
    ANNOTATE_PDF_INPUT_SCHEMA,
    annotatePdf,
} from './tools/annotate-pdf.js';
import {
    DRAFT_GOVERNANCE_ISSUE_NAME,
    DRAFT_GOVERNANCE_ISSUE_INPUT_SCHEMA,
    DRAFT_GOVERNANCE_ISSUE_OUTPUT_SCHEMA,
    draftGovernanceIssue,
    type DraftGovernanceIssueResult,
} from './tools/draft-governance-issue.js';
import {
    READ_FORM_FIELDS_NAME,
    READ_FORM_FIELDS_INPUT_SCHEMA,
    READ_FORM_FIELDS_OUTPUT_SCHEMA,
    readFormFieldsTool,
    type ReadFormFieldsResult,
} from './tools/read-form-fields.js';
import {
    FILL_FORM_NAME,
    FILL_FORM_INPUT_SCHEMA,
    fillFormTool,
} from './tools/fill-form.js';
import {
    ADD_CHART_NAME,
    ADD_CHART_INPUT_SCHEMA,
    addChart,
} from './tools/add-chart.js';
import {
    ENCRYPT_PDF_NAME,
    ENCRYPT_PDF_INPUT_SCHEMA,
    encryptPdf,
} from './tools/encrypt-pdf.js';
import {
    DECRYPT_PDF_NAME,
    DECRYPT_PDF_INPUT_SCHEMA,
    decryptPdf,
} from './tools/decrypt-pdf.js';
import {
    UPDATE_METADATA_NAME,
    UPDATE_METADATA_INPUT_SCHEMA,
    updateMetadata,
} from './tools/update-metadata.js';

// JSON import attribute (Node 22+, TS 5.3+) keeps version in lock-step with package.json.
// Hardcoded here to keep the build rootDir limited to ./src; tests assert it stays in sync.
const SERVER_VERSION = PDFNATIVE_MCP_VERSION;
const SERVER_NAME = 'pdfnative-mcp';

/**
 * Human-readable server identity surfaced in `serverInfo` (MCP `Implementation`).
 * `title` is a display name; `description` mirrors `server.json` so hosts and the
 * MCP registry present consistent metadata during initialization.
 */
const SERVER_TITLE = 'pdfnative MCP — PDF generation, signing & introspection';
const SERVER_DESCRIPTION =
    'Production-grade MCP server for PDF generation, PDF/A archival, PDF/UA structural validation, native vector charts, ' +
    'digital signatures (PAdES sign + verify, constant-time node:crypto), encryption round-trip (decrypt + AES-128/256 re-encrypt), ' +
    'AcroForm fill & flatten, page-tree ops (merge / split / extract), markup annotations, Factur-X invoices, ' +
    'Unicode text extraction with positioned runs, PDF introspection, MCP resources for generated PDFs, ' +
    'and human-in-the-loop AI-governance issue drafting. ' +
    '24 tools, 24 scripts, zero runtime dependencies beyond pdfnative and the MCP SDK.';

/**
 * Per-tool API version used by the opt-in cache key and by `_meta.apiVersion`.
 * Bump when the input or output schema of any tool changes in a way that would
 * make a cached response unsafe to serve. Independent from SERVER_VERSION
 * (which tracks the npm package).
 */
const TOOL_API_VERSION = '1.6.0';

/**
 * MCP 2026-07-28 cache hints (`ttlMs` / `cacheScope`) emitted on the cacheable
 * results. The catalogue (tools, prompts, discovery) is static for a given
 * package version; the sandbox resource listing and generated PDFs are live,
 * per-host user data and must never be cached by shared intermediaries.
 * 2025-era clients never see these fields.
 */
export const SERVER_CACHE_HINTS = {
    'tools/list': { ttlMs: 86_400_000, cacheScope: 'public' },
    'prompts/list': { ttlMs: 86_400_000, cacheScope: 'public' },
    'server/discover': { ttlMs: 3_600_000, cacheScope: 'public' },
    'resources/list': { ttlMs: 0, cacheScope: 'private' },
    'resources/templates/list': { ttlMs: 0, cacheScope: 'private' },
    'resources/read': { ttlMs: 0, cacheScope: 'private' },
} as const satisfies Record<string, CacheHint>;

/**
 * Tools whose output must never be persisted to the opt-in response cache
 * (`PDFNATIVE_MCP_CACHE_DIR`, which writes tool output as plaintext at rest).
 * `decrypt_pdf` produces the *unencrypted* bytes of a deliberately-encrypted
 * document; `encrypt_pdf` produces protected bytes plus takes a source
 * password — neither should linger on disk. They are cheap to recompute.
 */
const NON_CACHEABLE_TOOLS: ReadonlySet<string> = new Set([ENCRYPT_PDF_NAME, DECRYPT_PDF_NAME]);

/** True when the call's input requests a file-mode output (filesystem side-effect). */
function isFileOutput(input: unknown): boolean {
    if (input === null || typeof input !== 'object') return false;
    const mode = (input as { outputMode?: unknown }).outputMode;
    return mode === 'file';
}

function dispatchOutput(output: unknown, name: string, input: unknown): CallToolResult {
    if (output !== null && typeof output === 'object') {
        if ('draftMarkdown' in output && 'compliance' in output) {
            return buildDraftGovernanceIssueResult(output as DraftGovernanceIssueResult, name);
        }
        if ('parts' in output && 'count' in output) {
            return buildMultiSuccessResult(output as MultiOutputResult, name);
        }
        if ('mode' in output) {
            return buildSuccessResult(output as OutputResult, name);
        }
        if ('signatureCount' in output && 'allValid' in output) {
            return buildVerifyResult(output as VerifyPdfResult, name, input);
        }
        if ('extractedPageCount' in output) {
            return buildExtractTextResult(output as ExtractTextResult, name, input);
        }
        if ('warnings' in output && 'valid' in output) {
            return buildValidateResult(output as ValidatePdfResult, name, input);
        }
        if ('attachmentCount' in output && 'attachments' in output) {
            return buildExtractAttachmentsResult(output as ExtractAttachmentsResult, name, input);
        }
        if ('fieldCount' in output && 'fields' in output) {
            return buildReadFormFieldsResult(output as ReadFormFieldsResult, name, input);
        }
    }
    return buildInspectResult(output as InspectPdfResult, name, input);
}


/**
 * Apply the opt-in token-frugal projection to a read-only tool's
 * `structuredContent`. `verbosity: 'summary'` swaps the full result for a
 * canonical scalar-only subset; `fields: [...]` then projects to named dot-paths.
 * Defaults (`verbosity: 'full'`, no `fields`) return the full result unchanged.
 */
function projectStructured(
    full: Record<string, unknown>,
    summary: Record<string, unknown>,
    input: unknown,
): Record<string, unknown> {
    const base = readVerbosity(input) === 'summary' ? summary : full;
    const fields = readFields(input);
    if (fields.length === 0) return base;
    return selectFields(base, fields) as Record<string, unknown>;
}


/** Common output schema for tools that return a generated PDF (base64 inline or sandboxed file path). */
const PDF_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'sizeBytes'],
    description:
        "Structured result of a PDF-producing tool. In base64 mode the PDF bytes are delivered out-of-band as an embedded `resource` content block (data: URI), NOT duplicated here, to keep responses token-frugal. In file mode `filePath` is the sandboxed absolute path.",
    properties: {
        mode: { type: 'string', enum: ['base64', 'file'] },
        sizeBytes: { type: 'integer', minimum: 0 },
        filePath: { type: 'string', description: "Absolute sandboxed file path (when mode='file')." },
        ...DIAGNOSTICS_OUTPUT_PROPERTY,
        summary: {
            type: 'object',
            description: 'Tool-specific summary (e.g. add_ltv material counts). Only present when the tool produces one.',
            additionalProperties: true,
        },
    },
} as const;

/** Output schema for tools that return several PDFs at once (e.g. split_pdf). */
const MULTI_PDF_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'count', 'totalBytes', 'parts'],
    description:
        'Structured result of a tool producing several PDFs. In base64 mode each PDF is delivered out-of-band as its own embedded `resource` content block (data: URI); `parts[]` here carries only the per-PDF size (and `filePath` in file mode) to stay token-frugal.',
    properties: {
        mode: { type: 'string', enum: ['base64', 'file'] },
        count: { type: 'integer', minimum: 0 },
        totalBytes: { type: 'integer', minimum: 0 },
        parts: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['index', 'sizeBytes'],
                properties: {
                    index: { type: 'integer', minimum: 0 },
                    sizeBytes: { type: 'integer', minimum: 0 },
                    filePath: { type: 'string', description: "Absolute sandboxed file path (when mode='file')." },
                },
            },
        },
    },
} as const;

interface ToolDefinition {
    name: string;
    title: string;
    description: string;
    inputSchema: unknown;
    outputSchema?: unknown;
    annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
    };
    /** Minimal MCP `_meta.examples` payload — each entry is a self-contained input. */
    examples?: ReadonlyArray<{ readonly title: string; readonly input: Record<string, unknown> }>;
    handler: (args: unknown) => Promise<OutputResult | MultiOutputResult | InspectPdfResult | VerifyPdfResult | ExtractTextResult | ValidatePdfResult | ExtractAttachmentsResult | DraftGovernanceIssueResult | ReadFormFieldsResult>;
}

const TOOLS: readonly ToolDefinition[] = [
    {
        name: GENERATE_BASIC_PDF_NAME,
        title: 'Generate basic PDF',
        description:
            'Generate a multi-page A4 PDF from structured blocks (headings, paragraphs, lists, page breaks, spacers). DEFAULT TOOL for plain documents — prefer this over specialized tools unless you need barcodes, tables, attachments, or non-Latin scripts. Optional pdfA flag enables Tagged PDF / PDF/A-1b/2b/2u/3b output (auto-embeds Noto Sans for non-WinAnsi Latin per ISO 19005 §6.3.4). Returns the PDF as base64 by default, or writes it to a sandboxed file path when outputMode=file.',
        inputSchema: GENERATE_BASIC_PDF_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Plain document', input: { title: 'Hello', blocks: [{ type: 'paragraph', text: 'Hi world' }] } },
            { title: 'PDF/A-2b archival', input: { title: 'Archival', blocks: [{ type: 'paragraph', text: 'Conformant' }], pdfA: 'pdfa2b' } },
        ],
        handler: generateBasicPdf,
    },
    {
        name: ADD_BARCODE_NAME,
        title: 'Add barcode / QR code',
        description:
            "Generate a single-page PDF embedding a barcode or QR code. Supported formats:\n  • qr        — URLs, vCards, any UTF-8 text ≤ 4296 chars. Use ecLevel='H' for printed media (logos/dirt-tolerant); 'M' (default) for screens.\n  • code128   — alphanumeric SKUs, ASCII payloads.\n  • ean13     — retail product codes (must be 12 or 13 digits; 13th is auto-computed).\n  • datamatrix— dense industrial / aerospace markings.\n  • pdf417    — ID cards, boarding passes.\nCommon recipe for a QR code pointing to a URL: { format: 'qr', data: 'https://example.com', caption: 'Scan me' }. The `data` field is the raw payload — do NOT pre-encode URLs.",
        inputSchema: ADD_BARCODE_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'QR code pointing to a URL (most common case)', input: { format: 'qr', data: 'https://google.com', caption: 'Scan to visit Google' } },
            { title: 'QR code with high error correction (printed media)', input: { format: 'qr', data: 'https://example.com/page?id=123', ecLevel: 'H', caption: 'Scan me' } },
            { title: 'Code 128 for an inventory SKU', input: { format: 'code128', data: 'SKU-2025-001', title: 'Warehouse label' } },
            { title: 'EAN-13 retail product code', input: { format: 'ean13', data: '4006381333931' } },
        ],
        handler: addBarcode,
    },
    {
        name: SIGN_PDF_NAME,
        title: 'Sign PDF (RSA / ECDSA, PAdES)',
        description:
            "Apply a PAdES-compatible CMS digital signature to a PDF. Since v1.0.0 you can sign ANY PDF in ONE call — autoInjectPlaceholder defaults to true, so you do NOT need to run prepare_signature_placeholder first unless you want to customize the placeholder appearance. Supports RSA-SHA256 and ECDSA-SHA256 (P-256). Required inputs: pdfBase64, algorithm, certDerBase64, plus EITHER rsaKeyPkcs1DerBase64 (when algorithm='rsa-sha256') OR ecPrivateScalarHex / ecPrivateKeyDerBase64 (when algorithm='ecdsa-sha256'). To convert PEM keys to DER base64: `openssl pkey -in key.pem -outform DER | base64 -w0`. To convert a PEM X.509 cert: `openssl x509 -in cert.pem -outform DER | base64 -w0`. After signing, call verify_pdf to confirm validity.",
        inputSchema: SIGN_PDF_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        examples: [
            { title: 'Sign with RSA-SHA256 (auto-injects placeholder)', input: { pdfBase64: '<any-pdf-base64>', algorithm: 'rsa-sha256', certDerBase64: '<cert-der-base64>', rsaKeyPkcs1DerBase64: '<rsa-pkcs1-der-base64>', signerName: 'Alice', reason: 'Approved' } },
            { title: 'Sign with ECDSA-P256 (PKCS#8 DER key)', input: { pdfBase64: '<any-pdf-base64>', algorithm: 'ecdsa-sha256', certDerBase64: '<cert-der-base64>', ecPrivateKeyDerBase64: '<pkcs8-der-base64>' } },
        ],
        handler: signPdf,
    },
    {
        name: ADD_INTERNATIONAL_TEXT_NAME,
        title: 'Add international text',
        description:
            'Generate a PDF rendering text in any of 24 scripts (Arabic, Hebrew, Thai, CJK, Devanagari, Bengali, Tamil, Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic, Cyrillic, Greek, Georgian, Armenian, Vietnamese, Turkish, Polish, Latin fallback) with optional COLRv1 colour emoji and mathematical / technical symbols (the "math" font — Noto Sans Math, ∀ ∃ √ ∑ ∫ ∞ ± ÷ ×). BiDi reordering (incl. UAX#9 isolates), Arabic harakat positioning, and complex-script OpenType shaping are handled automatically by the embedded Noto fonts; input is NFC-normalised for maximal glyph coverage and embedded newlines auto-split into paragraphs. Pass `lang` as a single code or an array (e.g. ["ar","emoji"] or ["latin","math"]) for multi-script / symbol runs.',
        inputSchema: ADD_INTERNATIONAL_TEXT_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Arabic', input: { text: 'مرحبا', lang: 'ar', title: 'Hello in Arabic' } },
            { title: 'Latin + math symbols', input: { title: 'Math', lang: ['latin', 'math'], paragraphs: ['For all x ∈ ℝ, √(x²) = |x| and ∑ i = n(n+1)/2.'] } },
        ],
        handler: addInternationalText,
    },
    {
        name: ADD_TABLE_NAME,
        title: 'Add table / report',
        description:
            'Generate a tabular PDF report from column headers and data rows. Ideal for data exports, financial summaries, schedules. Smart-table fields (pdfnative v1.2) automatically engage the document backend: `wrap` (auto/always/never), `repeatHeader` (header row on every page), `zebra` (alternate-row tint), `caption` (above the table, tagged for PDF/A), `minRowHeight` (points), `cellPadding` (points). Every row must have the same length as `headers`. For PDF/A output, set pdfA="pdfa2b" (most compatible).',
        inputSchema: ADD_TABLE_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Sales report', input: { title: 'Sales', headers: ['Item', 'Qty', 'Total'], rows: [['Widget', '100', '$1,000']] } },
            { title: 'Smart table with caption + zebra + repeated header', input: { title: 'Q4', headers: ['Month', 'Revenue'], rows: [['Oct', '$1,000'], ['Nov', '$1,500'], ['Dec', '$2,100']], caption: 'Quarterly revenue', zebra: true, repeatHeader: true, wrap: 'auto' } },
            { title: 'Archival PDF/A-2b table', input: { title: 'Q4', headers: ['Item', 'Qty'], rows: [['Widget', '100']], pdfA: 'pdfa2b', clipCells: true } },
        ],
        handler: addTable,
    },
    {
        name: ADD_FORM_NAME,
        title: 'Add interactive form',
        description:
            'Generate a PDF containing an interactive AcroForm with text fields, text areas, checkboxes, radio buttons, and dropdowns. Suitable for data-capture forms, surveys, and fillable templates.',
        inputSchema: ADD_FORM_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Simple form', input: { title: 'Survey', fields: [{ type: 'text', name: 'name', label: 'Your name' }, { type: 'checkbox', name: 'subscribe', label: 'Subscribe' }] } },
        ],
        handler: addForm,
    },
    {
        name: EMBED_IMAGE_NAME,
        title: 'Embed image in PDF',
        description:
            'Generate a PDF document with an embedded JPEG or PNG image. The image is accepted as a base64-encoded string and can include an optional caption and custom render dimensions.',
        inputSchema: EMBED_IMAGE_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Embed a PNG logo', input: { imageBase64: '<base64-png>', imageType: 'png', caption: 'Company logo' } },
        ],
        handler: embedImage,
    },
    {
        name: PREPARE_SIGNATURE_PLACEHOLDER_NAME,
        title: 'Prepare signature placeholder',
        description:
            "Create a PDF with an embedded /Sig AcroForm placeholder ready to be digitally signed by the sign_pdf tool. NOTE: as of v1.0.0, sign_pdf auto-injects a placeholder when missing (autoInjectPlaceholder defaults to true), so this tool is OPTIONAL. Use it only when you need to: (a) customize the placeholder size for >4096-bit RSA keys via placeholderBytes, (b) attach the signature widget to a specific page via pageIndex, or (c) precompute and ship the placeholder PDF separately from the signing step. Otherwise call sign_pdf directly with any PDF.",
        inputSchema: PREPARE_SIGNATURE_PLACEHOLDER_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Custom placeholder for a large RSA key', input: { title: 'Contract', signerName: 'Alice', reason: 'I approve', placeholderBytes: 32768 } },
        ],
        handler: prepareSignaturePlaceholder,
    },
    {
        name: INSPECT_PDF_NAME,
        title: 'Inspect PDF metadata',
        description:
            "Read-only inspection of an existing PDF: version, page count, encryption state, PDF/A claim, signature count, hasSignaturePlaceholder, embedded attachments[], document info / metadata. Use the `check` array for CI-style assertions — supported values: 'pdfa', 'signed' (true when at least one signature has signed content), 'encrypted', 'placeholder' (unsigned /Sig widget present), 'attachments' (at least one /EmbeddedFile). The checksPassed boolean is true only when ALL requested checks hold.",
        inputSchema: INSPECT_PDF_INPUT_SCHEMA,
        outputSchema: INSPECT_PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'CI: assert PDF/A + signed', input: { pdfBase64: '<base64>', check: ['pdfa', 'signed'] } },
            { title: 'Detect Factur-X attachments', input: { pdfBase64: '<base64>', check: ['attachments'] } },
            { title: 'Detect an unsigned placeholder ready for sign_pdf', input: { pdfBase64: '<base64>', check: ['placeholder'] } },
            { title: 'Token-frugal summary verdict', input: { pdfBase64: '<base64>', verbosity: 'summary' } },
        ],
        handler: inspectPdf,
    },
    {
        name: VERIFY_PDF_NAME,
        title: 'Verify PDF signatures',
        description:
            "Read-only verification of every PAdES Baseline / adbe.pkcs7.detached signature in a PDF. For each /Sig widget, recomputes the ByteRange SHA-256, validates the CMS messageDigest (integrity), and verifies the CMS signatureValue with the embedded signer certificate. Supports RSA-SHA256 and ECDSA-SHA256 (P-256). The response shape: { allValid, signatureCount, summary, signatures: [{ valid, integrity, signerSubject, signingTime, reason, chainTrust: 'self-signed'|'unverified'|'trusted', errors: [] }] }. Read `allValid` for an overall yes/no; iterate `signatures[]` for per-signature detail. Without trustedRootsDerBase64, chainTrust is 'self-signed' (single-cert chain) or 'unverified' (signer rooted in an external CA).",
        inputSchema: VERIFY_PDF_INPUT_SCHEMA,
        outputSchema: VERIFY_PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Verify a signed PDF (no chain trust)', input: { pdfBase64: '<signed-pdf-base64>' } },
            { title: 'Verify with a trusted root certificate', input: { pdfBase64: '<signed-pdf-base64>', trustedRootsDerBase64: ['<root-cert-der-base64>'] } },
            { title: 'Token-frugal yes/no verdict', input: { pdfBase64: '<signed-pdf-base64>', verbosity: 'summary', fields: ['allValid'] } },
        ],
        handler: verifyPdf,
    },
    {
        name: ADD_ATTACHMENT_NAME,
        title: 'Add embedded file attachment (PDF/A-3, Factur-X)',
        description:
            "Generate a PDF/A-3 (ISO 19005-3) document with one or more embedded files. USE THIS INSTEAD OF generate_basic_pdf when you need a Factur-X / ZUGFeRD electronic invoice (single XML payload with relationship='Source'), or any PDF that must carry machine-readable side-files. The visible document body is supplied via the optional `blocks` parameter (same block schema as generate_basic_pdf). The tool auto-emits PDF/A-3b conformance — PDF/A-3 is the only PDF/A part that legally permits embedded files. Each attachment is capped at 8 MiB.",
        inputSchema: ADD_ATTACHMENT_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Factur-X / ZUGFeRD invoice (most common case)', input: { title: 'Invoice INV-2025-001', blocks: [{ type: 'heading', text: 'Invoice INV-2025-001', level: 1 }, { type: 'paragraph', text: 'Total due: 1\u00a0234,56 EUR' }], attachments: [{ filename: 'factur-x.xml', mimeType: 'application/xml', dataBase64: '<base64-of-xml>', relationship: 'Source', description: 'Factur-X structured invoice' }] } },
        ],
        handler: addAttachment,
    },
    {
        name: EXTRACT_TEXT_NAME,
        title: 'Extract plain text from PDF',
        description:
            "Best-effort plain-text extraction from a non-encrypted PDF. Walks each page's content stream and pulls the operands of Tj/'/\"/TJ text operators. The result.extractable boolean is FALSE when one or more pages have non-empty content but yielded no text (this is EXPECTED for PDFs using subset fonts without /ToUnicode CMaps — it is not an error). The accompanying `extractableReason` field explains why. Encrypted PDFs are rejected with EXTRACTION_UNSUPPORTED. Tagged-mode structure-tree extraction (cleaner output for tagged PDFs) is tracked on the roadmap.",
        inputSchema: EXTRACT_TEXT_INPUT_SCHEMA,
        outputSchema: EXTRACT_TEXT_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Extract all pages', input: { pdfBase64: '<base64>' } },
            { title: 'Extract a single page (first page only)', input: { pdfBase64: '<base64>', pages: [0] } },
        ],
        handler: extractText,
    },
    {
        name: VALIDATE_PDF_NAME,
        title: 'Validate PDF/UA structure',
        description:
            "Read-only PDF/UA (ISO 14289-1) structural conformance check. Verifies the accessibility prerequisites of a Tagged PDF: catalog /MarkInfo /Marked true, /StructTreeRoot (+ /ParentTree), /Metadata (XMP), /Lang, and per-page MCID uniqueness. Response shape: { standard: 'pdf-ua-1', valid, errors: [], warnings: [], summary }. Read `valid` for an overall yes/no; iterate `errors[]` for blocking violations and `warnings[]` for best-practice recommendations. This is a fast structural gate, NOT a full reference validator (veraPDF) — it does not check fonts, colour or rendering. Generate accessible input with any document tool using pdfA (e.g. pdfA='pdfa2u'), then validate the result here.",
        inputSchema: VALIDATE_PDF_INPUT_SCHEMA,
        outputSchema: VALIDATE_PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Validate a tagged PDF for PDF/UA structure', input: { pdfBase64: '<tagged-pdf-base64>' } },
        ],
        handler: validatePdf,
    },
    {
        name: EXTRACT_ATTACHMENTS_NAME,
        title: 'Extract embedded files from PDF',
        description:
            "Read-only extraction of embedded files from a non-encrypted PDF (PDF/A-3 / Factur-X / ZUGFeRD). Walks the catalog /Names → /EmbeddedFiles tree and returns each attachment's metadata (name, mimeType, AFRelationship, description, sizeBytes) plus, by default, its decoded payload as dataBase64. Completes the invoice round-trip: add_attachment → inspect_pdf → extract_attachments. Pass `filename` to pull a single named file, or `includeData: false` for a metadata-only probe. Encrypted PDFs are rejected with EXTRACTION_UNSUPPORTED.",
        inputSchema: EXTRACT_ATTACHMENTS_INPUT_SCHEMA,
        outputSchema: EXTRACT_ATTACHMENTS_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Extract every embedded file (with payloads)', input: { pdfBase64: '<base64>' } },
            { title: 'Pull just the Factur-X XML payload', input: { pdfBase64: '<base64>', filename: 'factur-x.xml' } },
            { title: 'Metadata-only probe (no payloads)', input: { pdfBase64: '<base64>', includeData: false, verbosity: 'summary' } },
        ],
        handler: extractAttachments,
    },
    {
        name: MERGE_PDFS_NAME,
        title: 'Merge PDFs',
        description:
            "Concatenate 2–50 source PDFs into a single document (pdfnative v1.4 page-tree API). Each kept page's object graph is deep-copied into a fresh, self-contained PDF. Signatures and AcroForms are dropped (a page-tree edit invalidates /ByteRange); self-contained URI link annotations are preserved unless dropAnnotations=true. Encrypted sources are rejected (ENCRYPTED_SOURCE) — decrypt first. A secure-by-default 256 MiB in-memory assembly guard (maxOutputSizeBytes) guards against memory exhaustion; the emitted PDF is separately capped at 50 MiB (OUTPUT_TOO_LARGE). Returns one PDF (base64 or sandboxed file).",
        inputSchema: MERGE_PDFS_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Merge two PDFs', input: { pdfsBase64: ['<pdf-a-base64>', '<pdf-b-base64>'] } },
        ],
        handler: mergePdfsTool,
    },
    {
        name: SPLIT_PDF_NAME,
        title: 'Split PDF into ranges',
        description:
            "Split one PDF into several documents — one per requested page range (pdfnative v1.4 page-tree API). Ranges are 0-based and inclusive; `end` defaults to `start` (a single page). Each output is a fresh, self-contained PDF (signatures/AcroForm dropped; URI links kept unless dropAnnotations=true). Encrypted sources are rejected (ENCRYPTED_SOURCE). In base64 mode every produced PDF is returned as its own embedded resource block; in file mode each is written to a 1-based indexed sibling of outputPath ('out.pdf' → 'out-1.pdf', 'out-2.pdf', …). Use extract_pages instead when you want a single PDF from an arbitrary page subset.",
        inputSchema: SPLIT_PDF_INPUT_SCHEMA,
        outputSchema: MULTI_PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'First page and the rest', input: { pdfBase64: '<base64>', ranges: [{ start: 0 }, { start: 1, end: 9 }] } },
        ],
        handler: splitPdfTool,
    },
    {
        name: EXTRACT_PAGES_NAME,
        title: 'Extract pages into one PDF',
        description:
            "Extract an arbitrary subset of pages (0-based, in the order given) from a PDF into a SINGLE new document (pdfnative v1.4 page-tree API). The output is a fresh, self-contained PDF (signatures/AcroForm dropped; URI links kept unless dropAnnotations=true). Encrypted sources are rejected (ENCRYPTED_SOURCE). Use split_pdf instead when you need several output PDFs (one per range).",
        inputSchema: EXTRACT_PAGES_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Keep pages 0, 2 and 4', input: { pdfBase64: '<base64>', pages: [0, 2, 4] } },
        ],
        handler: extractPagesTool,
    },
    {
        name: ANNOTATE_PDF_NAME,
        title: 'Annotate PDF (markup / drawing)',
        description:
            "Add markup / drawing annotations (ISO 32000-1 §12.5) to an existing PDF via pdfnative v1.5's annotation writer. Non-destructive incremental update: original content is preserved byte-for-byte and each annotation is appended to the target page's /Annots. Types: text (sticky note), highlight | underline | strikeout | squiggly (text-markup), square | circle (shapes), line, freetext. Each annotation needs a 0-based `page` and a `rect` [x1,y1,x2,y2]; line also needs `start`/`end`. Optional per-annotation: contents, color, opacity, title, plus type-specific fields (open/icon, quadPoints, interiorColor/borderWidth, fontSize). Encrypted sources are rejected (ENCRYPTED_SOURCE). NOTE: annotations are visual overlays — they do NOT remove or redact the underlying content.",
        inputSchema: ANNOTATE_PDF_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Highlight a region on page 1', input: { pdfBase64: '<base64>', annotations: [{ page: 0, type: 'highlight', rect: [72, 700, 300, 720], color: '#ffe600', contents: 'Review this' }] } },
            { title: 'Sticky note + red square', input: { pdfBase64: '<base64>', annotations: [{ page: 0, type: 'text', rect: [520, 700, 540, 720], contents: 'Check figures', icon: 'Note' }, { page: 0, type: 'square', rect: [72, 500, 300, 560], color: '#d00000', borderWidth: 2 }] } },
        ],
        handler: annotatePdf,
    },
    {
        name: DRAFT_GOVERNANCE_ISSUE_NAME,
        title: 'Draft a governance-compliant GitHub issue (HITL)',
        description:
            "Produce a LOCAL, governance-compliant GitHub issue draft plus a structured compliance report — and NEVER submit anything. This is the MCP-native embodiment of the pdfnative AI-governance / Human-In-The-Loop contract (.github/ai-governance.json, .github/AGENT_RULES.md): the agent is a DRAFTSMAN, the human is the only gate. The server makes NO outbound network call and has NO GitHub write path. The assembled draft is validated against the zero-dependency + reproduction policy; a violation (proposing a runtime dependency, missing reproduction, or duplicateSearchPerformed=false) throws GOVERNANCE_VIOLATION so the human must fix it before submitting under their own identity. Returns the draft markdown inline by default; outputMode='file' also writes a .md to the sandbox. After calling this, present BOTH the draft and the compliance report to the user, then STOP.",
        inputSchema: DRAFT_GOVERNANCE_ISSUE_INPUT_SCHEMA,
        outputSchema: DRAFT_GOVERNANCE_ISSUE_OUTPUT_SCHEMA,
        // Not readOnlyHint: outputMode='file' writes a .md into the sandbox (like every
        // other file-producing tool). The default inline mode is side-effect-free.
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Draft a bug report (never submitted)', input: { title: 'add_table clips descenders on wrapped cells', summary: 'Wrapped table cells clip the descenders of g/j/p/q/y at the default cellPadding.', issueType: 'bug', targetRepo: 'pdfnative', reproduction: { command: "add_table with a wrapped cell containing 'paragraphy'", result: 'The descenders of g/p/y are visibly clipped in the rendered PDF.' }, expectedBehavior: 'Descenders render fully within the cell.', affectedPackages: ['pdfnative'], duplicateSearchPerformed: true } },
            { title: 'Draft an upstream feature request for true redaction', input: { title: 'Expose a content-removal API for true redaction', summary: 'pdfnative 1.5 can only overlay annotations; a content-stream removal API is needed for genuine redaction.', issueType: 'feature', targetRepo: 'pdfnative', reproduction: { command: 'annotate_pdf overlay then extract_text', result: 'Text under the overlay is still extractable.' }, expectedBehavior: 'A supported API removes the underlying bytes so redacted text is unextractable.', affectedPackages: ['pdfnative', 'pdfnative-mcp'], duplicateSearchPerformed: true } },
        ],
        handler: draftGovernanceIssue,
    },
    {
        name: READ_FORM_FIELDS_NAME,
        title: 'Read AcroForm fields',
        description:
            "Read-only enumeration of an existing PDF's interactive AcroForm fields (pdfnative v1.6.0). Returns each terminal field's fully-qualified name, classified type (text | checkbox | radio | dropdown | listbox | button | signature | unknown), current value, flags (readOnly / required / multiline), choice options, and widget placements. Call this FIRST to discover field names before driving fill_form. Encrypted sources are supported via `password`. Token-frugal: verbosity:'summary' returns just { fieldCount }.",
        inputSchema: READ_FORM_FIELDS_INPUT_SCHEMA,
        outputSchema: READ_FORM_FIELDS_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'List every field', input: { pdfBase64: '<base64>' } },
            { title: 'Just the field count', input: { pdfBase64: '<base64>', verbosity: 'summary' } },
        ],
        handler: readFormFieldsTool,
    },
    {
        name: FILL_FORM_NAME,
        title: 'Fill / flatten an existing AcroForm',
        description:
            "Fill (and optionally flatten) the AcroForm of an EXISTING PDF (pdfnative v1.6.0) — the counterpart to add_form, which CREATES a new form. Non-destructive incremental update: original bytes are preserved (a prior signature stays valid for its revision). `values` maps fully-qualified field name → value: text/choice take a string (array for multi-select listboxes); checkbox/radio take a boolean or the export-state string. Set flatten:true to stamp appearances into page content and drop the interactive layer (pass no values + flatten:true for a pure flatten). Encrypted documents are supported via `password` (appended objects are encrypted under the existing scheme). Signature fields cannot be filled (FORM_UNSUPPORTED). Discover field names with read_form_fields first.",
        inputSchema: FILL_FORM_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Fill a couple of fields', input: { pdfBase64: '<base64>', values: { fullName: 'Alice Martin', subscribe: true } } },
            { title: 'Fill and flatten (final, non-editable)', input: { pdfBase64: '<base64>', values: { fullName: 'Alice Martin' }, flatten: true } },
            { title: 'Pure flatten (no value changes)', input: { pdfBase64: '<base64>', flatten: true } },
        ],
        handler: fillFormTool,
    },
    {
        name: ADD_CHART_NAME,
        title: 'Add native vector chart',
        description:
            "Generate a single-page PDF with a native vector chart (pdfnative v1.6.0): bar, barH (horizontal bar), line (optional markers), pie or donut — rendered as pure PDF path operators, zero rasterisation. Multi-series bar/line, legends, 'nice' 1/2/5×10ⁿ axis ticks, gridlines, negative values, and a tagged-PDF /Figure + /Alt (auto-generated when altText omitted, so PDF/A stays conformant). Pie/donut use exactly one series (each value = a slice). Colours are hex strings (e.g. '#3366cc'). For a chart embedded amongst headings/paragraphs/tables, use a 'chart' block inside generate_basic_pdf instead.",
        inputSchema: ADD_CHART_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Grouped bar chart (2 series)', input: { chartType: 'bar', title: 'Quarterly revenue', categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ label: '2025', values: [12, 18, 15, 22] }, { label: '2026', values: [14, 20, 19, 25] }], axis: { grid: true } } },
            { title: 'Pie chart', input: { chartType: 'pie', title: 'Market share', categories: ['A', 'B', 'C'], series: [{ label: 'Share', values: [55, 30, 15] }] } },
            { title: 'Archival PDF/A-2b line chart', input: { chartType: 'line', markers: true, categories: ['Jan', 'Feb', 'Mar'], series: [{ label: 'Signups', values: [120, 180, 260] }], pdfA: 'pdfa2b' } },
        ],
        handler: addChart,
    },
    {
        name: ENCRYPT_PDF_NAME,
        title: 'Encrypt / re-secure a PDF',
        description:
            "Re-secure an existing PDF with the PDF Standard Security Handler (pdfnative v1.6.0): AES-128 (V4/R4, default) or AES-256 (V5/R6). RC4 is never emitted. Set ownerPassword (required) and optionally userPassword (open password), algorithm, and permissions { print, copy, modify, extractText }. Re-encrypt an already-encrypted source under a NEW password by passing its current `password` (password rotation in one call). CAVEAT: encryption rebuilds the page tree, so existing signatures and the interactive AcroForm are DROPPED and only self-contained URI links are kept — encrypt BEFORE signing, not after.",
        inputSchema: ENCRYPT_PDF_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        examples: [
            { title: 'Encrypt with AES-256 (owner + user password)', input: { pdfBase64: '<base64>', ownerPassword: 'owner-secret', userPassword: 'open-me', algorithm: 'aes256' } },
            { title: 'Owner-locked, no-print (empty user password)', input: { pdfBase64: '<base64>', ownerPassword: 'owner-secret', permissions: { print: false } } },
        ],
        handler: encryptPdf,
    },
    {
        name: DECRYPT_PDF_NAME,
        title: 'Decrypt a PDF',
        description:
            "Open an encrypted PDF (pdfnative v1.6.0 reader/decryptor — RC4 V1–V4, AES-128 V4/R4, AES-256 V5/R6) and emit an UNENCRYPTED copy. Pass `password` (user or owner); documents with an empty user password decrypt without one. CAVEAT: decryption rebuilds the page tree, so existing signatures and the interactive AcroForm are DROPPED and only self-contained URI links are kept. To READ an encrypted PDF without rebuilding it, pass `password` directly to inspect_pdf / extract_text / extract_attachments instead.",
        inputSchema: DECRYPT_PDF_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Decrypt with a user password', input: { pdfBase64: '<encrypted-base64>', password: 'open-me' } },
        ],
        handler: decryptPdf,
    },
    {
        name: UPDATE_METADATA_NAME,
        title: 'Update document metadata',
        description:
            "Rewrite the /Info dictionary (title, author, subject, keywords) of an EXISTING PDF as a non-destructive incremental update (pdfnative v1.7 PdfModifier.updateMetadata); XMP stays in sync on PDF/A documents and /ModDate is refreshed (pin modDate for reproducible bytes). Earlier revisions and their signatures are preserved verbatim — the new revision is unsigned, so sign_pdf / timestamp_pdf again if needed. Encrypted sources are rejected (decrypt_pdf first). For metadata at GENERATION time use the `metadata` option of the document tools instead.",
        inputSchema: UPDATE_METADATA_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        examples: [
            { title: 'Set author and keywords', input: { pdfBase64: '<any-pdf-base64>', author: 'Ada Lovelace', keywords: 'invoice, 2026', modDate: '2026-08-22T10:00:00Z' } },
        ],
        handler: updateMetadata,
    },
];

const TOOL_INDEX: ReadonlyMap<string, ToolDefinition> = new Map(TOOLS.map((t) => [t.name, t]));

const SERVER_INSTRUCTIONS = `pdfnative-mcp bridges the zero-dependency 'pdfnative' v1.6 library to MCP. API version: 1.5.0 (stable). 24 tools.

DECISION TREE — pick the right tool in one step:
  • Plain document (headings, paragraphs, lists, charts)     → ${GENERATE_BASIC_PDF_NAME}
  • Native vector chart (bar / line / pie / donut)           → ${ADD_CHART_NAME}
  • QR code / barcode (URL, SKU, EAN)                        → ${ADD_BARCODE_NAME}
  • Non-Latin script (Arabic, Hindi, Chinese, Japanese…)     → ${ADD_INTERNATIONAL_TEXT_NAME}
  • Tabular / report data                                    → ${ADD_TABLE_NAME}
  • Create a NEW interactive form                            → ${ADD_FORM_NAME}
  • Read fields of an EXISTING form                          → ${READ_FORM_FIELDS_NAME}
  • Fill / flatten an EXISTING form                          → ${FILL_FORM_NAME}
  • Embed a JPEG/PNG into a PDF                              → ${EMBED_IMAGE_NAME}
  • Add markup annotations (highlight, note, shapes, line)   → ${ANNOTATE_PDF_NAME}
  • Sign any PDF (auto-injects placeholder)                  → ${SIGN_PDF_NAME}
  • Customize signature placeholder before signing           → ${PREPARE_SIGNATURE_PLACEHOLDER_NAME} → ${SIGN_PDF_NAME}
  • Factur-X / ZUGFeRD invoice or any PDF with attachments   → ${ADD_ATTACHMENT_NAME}   (NOT generate_basic_pdf)
  • Encrypt / re-secure a PDF (AES-128 / AES-256)            → ${ENCRYPT_PDF_NAME}
  • Decrypt an encrypted PDF                                 → ${DECRYPT_PDF_NAME}
  • Concatenate several PDFs into one                        → ${MERGE_PDFS_NAME}
  • Split a PDF into per-range PDFs                          → ${SPLIT_PDF_NAME}
  • Pull a subset of pages into one PDF                      → ${EXTRACT_PAGES_NAME}
  • Inspect / assert PDF metadata in CI                      → ${INSPECT_PDF_NAME}
  • Verify all PAdES signatures                              → ${VERIFY_PDF_NAME}
  • Validate PDF/UA accessibility structure                  → ${VALIDATE_PDF_NAME}
  • Pull Unicode text (optionally positioned runs) from a PDF → ${EXTRACT_TEXT_NAME}
  • Pull embedded files back out (Factur-X XML, side-cars)   → ${EXTRACT_ATTACHMENTS_NAME}
  • Draft a GitHub issue for human review (never submits)    → ${DRAFT_GOVERNANCE_ISSUE_NAME}

AI-GOVERNANCE & HUMAN-IN-THE-LOOP (non-negotiable):
  • This server is a DRAFTSMAN, never an autonomous submitter. It makes NO outbound network call and has NO GitHub write path.
  • To propose a bug/feature/issue, call ${DRAFT_GOVERNANCE_ISSUE_NAME}: it returns a local, policy-checked draft + a compliance report. Present BOTH to the user, then STOP. The user reviews and submits manually under their own GitHub identity.
  • Never propose adding a runtime dependency (hard blocker, GOVERNANCE_VIOLATION). Search open AND closed issues first (duplicateSearchPerformed must be true). Include a minimal, locally-executed reproduction.

COMMON PITFALLS (read these to avoid retry loops):
  • Barcode 'data' is the RAW payload — do NOT URL-encode URLs. For a QR pointing to https://google.com just pass data: 'https://google.com'.
  • Barcode 'ecLevel' (L|M|Q|H) applies ONLY to format='qr' and is ignored elsewhere. Use 'H' for printed media.
  • EAN-13 'data' must be exactly 12 or 13 digits (the 13th check digit is auto-computed if you pass 12).
  • sign_pdf accepts ONLY DER-encoded inputs in base64. Convert from PEM with: openssl pkey -in key.pem -outform DER | base64 -w0  (and openssl x509 -in cert.pem -outform DER | base64 -w0 for the cert).
  • sign_pdf RSA key must be PKCS#1 DER (field 'rsaKeyPkcs1DerBase64'). ECDSA key may be SEC1 or PKCS#8 DER (field 'ecPrivateKeyDerBase64') or the raw 32-byte scalar as 64 hex chars (field 'ecPrivateScalarHex'). DER keys are signed with a native constant-time node:crypto provider; the raw scalar uses the pure-JS path.
  • sign_pdf auto-injects a placeholder when missing — call it directly on ANY PDF unless you specifically need to customize the placeholder.
  • merge_pdfs / split_pdf / extract_pages now ACCEPT encrypted sources via 'password' (pdfnative 1.6) and can re-encrypt output via 'encrypt' { ownerPassword, userPassword?, algorithm?, permissions? }. A missing/wrong password yields PASSWORD_REQUIRED / PASSWORD_INVALID. They ALWAYS drop signatures + AcroForm (a page-tree edit invalidates them) and keep self-contained URI links unless dropAnnotations=true. Page indices/ranges are 0-based. split_pdf returns one PDF per range (file mode writes 'out-1.pdf', 'out-2.pdf', …); extract_pages returns a single PDF.
  • ENCRYPTION: encrypt_pdf re-secures a PDF (AES-128 default / AES-256; ownerPassword required; RC4 never emitted) and decrypt_pdf emits an unencrypted copy — BOTH rebuild the page tree, so they drop signatures + AcroForm. To merely READ an encrypted PDF, pass 'password' to inspect_pdf / extract_text / extract_attachments / verify_pdf instead of decrypting. inspect_pdf surfaces precise cipher details in 'encryptionInfo'.
  • FORMS: add_form CREATES a new interactive form; read_form_fields lists an EXISTING form's fields (call it first to get names); fill_form fills/flattens an EXISTING form (values map field name → string | boolean | string[]; flatten:true bakes it in; pure flatten = flatten:true with no values). Signature fields cannot be filled (FORM_UNSUPPORTED). Encrypted forms work via 'password'.
  • CHARTS: add_chart draws bar / barH / line / pie / donut as native vectors (colours are hex strings; pie/donut use one series). For a chart amongst other content, add a 'chart' block to generate_basic_pdf. Alt text is auto-generated for PDF/A when omitted.
  • extract_text now returns real Unicode (pdfnative 1.6 resolves /ToUnicode); pass includeRuns:true for positioned runs and 'password' for encrypted PDFs. 'extractable' is false only when a page decodes entirely to U+FFFD (a font with no usable mapping).
  • annotate_pdf adds VISUAL OVERLAY markup only (highlight, sticky note, square/circle, line, freetext) via a non-destructive incremental update; it does NOT remove/redact underlying content (the covered text stays extractable). Encrypted sources are rejected (ENCRYPTED_SOURCE). Each annotation needs a 0-based 'page' and a 'rect' [x1,y1,x2,y2]; 'line' also needs 'start'/'end'.
  • For Factur-X / ZUGFeRD invoices, use add_attachment (PDF/A-3) — generate_basic_pdf cannot embed files.
  • PDF/A: pass pdfA='pdfa2b' for the widest reader compatibility. PDF/A-3 is required when you have attachments.
  • PDF/A text is now robust: embedded newlines ('\\n') in paragraphs are auto-split into separate paragraphs; the Euro sign and other CP-1252 symbols extract correctly (pdfnative 1.3); wrapped table cells get unique per-line MCIDs. Write naturally — no manual workarounds needed.
  • Math / technical symbols (∀ ∃ √ ∑ ∫ ∞ ± ÷ ×) render via add_international_text with the 'math' font: pass lang:['latin','math'] (or add 'math' to any script list) to route math codepoints to the bundled Noto Sans Math (OFL-1.1).
  • generate_basic_pdf supports nested lists (a list item may be { text, items: [...] }), a document 'outline' (bookmarks; pass 'auto' to derive from headings) and 'pageLabels' (e.g. roman front-matter then decimal body). All PDF/A-safe. inspect_pdf now surfaces those page labels back as a 'pageLabels' array.
  • add_table supports per-cell 'cellBorders' and 'cellVAlign' (top/middle/bottom) — both engage the document backend. generate_basic_pdf, add_table and add_international_text accept 'viewerPreferences' (reader presentation hints, /ViewerPreferences).
  • add_international_text covers 24 scripts and COLRv1 colour emoji; pass 'lang' as a single code or an array (e.g. ["ar","emoji"]) for multi-script runs. Input is NFC-normalised by default; override with normalize ('NFC'|'NFD'|'NFKC'|'NFKD'|false).
  • generate_basic_pdf and add_table accept an optional text 'watermark' (e.g. { text: 'DRAFT' }). Opacity < 1.0 is rejected under pdfA='pdfa1b' (ISO 19005-1 forbids transparency) — use pdfa2b/2u/3b instead.
  • Round-trip: build an invoice with add_attachment, confirm with inspect_pdf (check:['attachments']), then pull the XML back with extract_attachments (filename:'factur-x.xml').
  • outputMode='file' is only available when the host sets PDFNATIVE_MCP_OUTPUT_DIR; otherwise PDFs are returned as base64. draft_governance_issue writes a .md there when outputMode='file'.
  • TOKEN-FRUGAL READS: the read-only tools (inspect_pdf, verify_pdf, validate_pdf, extract_text, extract_attachments) accept verbosity:'summary' for a compact scalar-only verdict (drops large arrays / full text) and fields:[...] for dot-path projection (e.g. fields:['allValid']). Defaults are unchanged (full output). Generated PDFs are returned as an embedded resource block, not duplicated in structuredContent.

  • TOKEN-FRUGAL READS also apply to read_form_fields (verbosity:'summary' → { fieldCount }).
  • MCP RESOURCES: when the host sets PDFNATIVE_MCP_OUTPUT_DIR, every PDF written in outputMode='file' is exposed as an MCP resource (resources/list + resources/read, uri 'pdfnative://output/<name>.pdf'); file-mode tool results also carry a resource_link so you can re-reference the artifact across calls.

Every tool ships JSON-Schema-typed inputs/outputs, _meta.apiVersion = '1.5.0', and worked-example _meta.examples. The server also exposes MCP prompts ('governance_contract', 'draft_issue_workflow') and MCP resources for generated PDFs. See docs/AI_GUIDE.md for a longer walk-through and docs/guides/AI_GOVERNANCE.md for the HITL contract.`;

function buildDraftGovernanceIssueResult(output: DraftGovernanceIssueResult, toolName: string): CallToolResult {
    const where = output.outputMode === 'file' ? ` and written to ${output.filePath}` : '';
    return {
        content: [
            {
                type: 'text',
                text:
                    `${toolName}: DRAFT ONLY — not submitted${where}. ` +
                    `${output.compliance.humanGate} Present the draft and compliance report below to the user; ` +
                    `they must review and submit it themselves under their own GitHub identity.`,
            },
            { type: 'text', text: output.draftMarkdown },
        ],
        structuredContent: {
            title: output.title,
            issueType: output.issueType,
            targetRepo: output.targetRepo,
            outputMode: output.outputMode,
            ...(output.filePath !== undefined ? { filePath: output.filePath } : {}),
            sizeBytes: output.sizeBytes,
            draftMarkdown: output.draftMarkdown,
            warnings: output.warnings,
            compliance: output.compliance,
        },
    };
}

function buildInspectResult(output: InspectPdfResult, toolName: string, input: unknown): CallToolResult {
    const full = output as unknown as Record<string, unknown>;
    const summary: Record<string, unknown> = {
        version: output.version,
        pageCount: output.pageCount,
        encryption: output.encryption,
        pdfA: output.pdfA,
        signatureCount: output.signatureCount,
        hasSignaturePlaceholder: output.hasSignaturePlaceholder,
        attachmentCount: output.attachments.length,
        ...(output.checksPassed !== undefined ? { checksPassed: output.checksPassed } : {}),
    };
    return {
        content: [
            {
                type: 'text',
                text: `${toolName}: PDF v${output.version}, ${output.pageCount} page(s), encryption=${output.encryption}, pdfA=${output.pdfA ?? 'none'}, signatures=${output.signatureCount}.`,
            },
        ],
        structuredContent: projectStructured(full, summary, input),
    };
}

function buildVerifyResult(output: VerifyPdfResult, toolName: string, input: unknown): CallToolResult {
    const full = output as unknown as Record<string, unknown>;
    const summary: Record<string, unknown> = {
        signatureCount: output.signatureCount,
        allValid: output.allValid,
        invalid: output.signatures.filter((s) => !s.valid).length,
        summary: output.summary,
    };
    return {
        content: [{ type: 'text', text: `${toolName}: ${output.summary}` }],
        structuredContent: projectStructured(full, summary, input),
    };
}

function buildValidateResult(output: ValidatePdfResult, toolName: string, input: unknown): CallToolResult {
    const full = output as unknown as Record<string, unknown>;
    const summary: Record<string, unknown> = {
        standard: output.standard,
        valid: output.valid,
        errorCount: output.errors.length,
        warningCount: output.warnings.length,
        summary: output.summary,
    };
    return {
        content: [{ type: 'text', text: `${toolName}: ${output.summary}` }],
        structuredContent: projectStructured(full, summary, input),
    };
}

function buildExtractTextResult(output: ExtractTextResult, toolName: string, input: unknown): CallToolResult {
    const full = output as unknown as Record<string, unknown>;
    const summary: Record<string, unknown> = {
        pageCount: output.pageCount,
        extractedPageCount: output.extractedPageCount,
        extractable: output.extractable,
        charCount: output.fullText.length,
        ...(output.extractableReason !== undefined ? { extractableReason: output.extractableReason } : {}),
    };
    return {
        content: [
            {
                type: 'text',
                text: `${toolName}: extracted ${output.extractedPageCount}/${output.pageCount} page(s), ${output.fullText.length} char(s)${output.extractable ? '' : ' (some pages had non-empty content streams but no extractable text)'}.`,
            },
        ],
        structuredContent: projectStructured(full, summary, input),
    };
}

function buildExtractAttachmentsResult(
    output: ExtractAttachmentsResult,
    toolName: string,
    input: unknown,
): CallToolResult {
    const full = output as unknown as Record<string, unknown>;
    const summary: Record<string, unknown> = { attachmentCount: output.attachmentCount };
    return {
        content: [
            {
                type: 'text',
                text: `${toolName}: ${output.attachmentCount} embedded file(s)${
                    output.attachmentCount > 0 ? ` — ${output.attachments.map((a) => a.name).join(', ')}` : ''
                }.`,
            },
        ],
        structuredContent: projectStructured(full, summary, input),
    };
}

function buildReadFormFieldsResult(output: ReadFormFieldsResult, toolName: string, input: unknown): CallToolResult {
    const full = output as unknown as Record<string, unknown>;
    const summary: Record<string, unknown> = { fieldCount: output.fieldCount };
    return {
        content: [
            {
                type: 'text',
                text: `${toolName}: ${output.fieldCount} form field(s)${
                    output.fieldCount > 0 ? ` — ${output.fields.map((f) => f.name).slice(0, 20).join(', ')}${output.fieldCount > 20 ? ', …' : ''}` : ''
                }.`,
            },
        ],
        structuredContent: projectStructured(full, summary, input),
    };
}

function buildSuccessResult(output: OutputResult, toolName: string): CallToolResult {
    if (output.mode === 'file') {
        const link = output.filePath !== undefined ? resourceLinkForPath(output.filePath) : null;
        return {
            content: [
                {
                    type: 'text',
                    text: `${toolName}: wrote ${output.sizeBytes} bytes to ${output.filePath}`,
                },
                ...(link !== null
                    ? [{ type: 'resource_link' as const, ...link, mimeType: 'application/pdf' }]
                    : []),
            ],
            structuredContent: {
                mode: output.mode,
                sizeBytes: output.sizeBytes,
                filePath: output.filePath,
                ...(output.diagnostics !== undefined ? { diagnostics: output.diagnostics } : {}),
                ...(output.summary !== undefined ? { summary: output.summary } : {}),
            },
        };
    }
    return {
        content: [
            {
                type: 'text',
                text: `${toolName}: produced ${output.sizeBytes} bytes (base64 PDF delivered as the embedded resource below).`,
            },
            {
                type: 'resource',
                resource: {
                    uri: `data:application/pdf;base64,${/* v8 ignore next */ output.base64 ?? ''}`,
                    mimeType: 'application/pdf',
                    blob: /* v8 ignore next */ output.base64 ?? '',
                },
            },
        ],
        structuredContent: {
            mode: output.mode,
            sizeBytes: output.sizeBytes,
            ...(output.diagnostics !== undefined ? { diagnostics: output.diagnostics } : {}),
            ...(output.summary !== undefined ? { summary: output.summary } : {}),
        },
    };
}

function buildMultiSuccessResult(output: MultiOutputResult, toolName: string): CallToolResult {
    if (output.mode === 'file') {
        const links = output.parts
            .map((p) => (p.filePath !== undefined ? resourceLinkForPath(p.filePath) : null))
            .filter((l): l is { uri: string; name: string; title: string } => l !== null)
            .map((l) => ({ type: 'resource_link' as const, ...l, mimeType: 'application/pdf' }));
        return {
            content: [
                {
                    type: 'text',
                    text: `${toolName}: wrote ${output.count} PDF(s) (${output.totalBytes} bytes total) to ${output.parts
                        .map((p) => p.filePath)
                        .join(', ')}`,
                },
                ...links,
            ],
            structuredContent: {
                mode: output.mode,
                count: output.count,
                totalBytes: output.totalBytes,
                parts: output.parts.map((p) => ({ index: p.index, sizeBytes: p.sizeBytes, filePath: p.filePath })),
            },
        };
    }
    return {
        content: [
            {
                type: 'text',
                text: `${toolName}: produced ${output.count} PDF(s) (${output.totalBytes} bytes total), each delivered as an embedded resource below.`,
            },
            ...output.parts.map((p) => ({
                type: 'resource' as const,
                resource: {
                    uri: `data:application/pdf;base64,${/* v8 ignore next */ p.base64 ?? ''}`,
                    mimeType: 'application/pdf',
                    blob: /* v8 ignore next */ p.base64 ?? '',
                },
            })),
        ],
        structuredContent: {
            mode: output.mode,
            count: output.count,
            totalBytes: output.totalBytes,
            parts: output.parts.map((p) => ({ index: p.index, sizeBytes: p.sizeBytes })),
        },
    };
}

function buildErrorResult(err: unknown, toolName: string): CallToolResult {
    if (err instanceof ToolError) {
        return {
            content: [{ type: 'text', text: `${toolName} failed [${err.code}]: ${err.message}` }],
            isError: true,
        };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
        content: [{ type: 'text', text: `${toolName} failed: ${message}` }],
        isError: true,
    };
}

interface PromptDefinition {
    readonly name: string;
    readonly title: string;
    readonly description: string;
    readonly text: string;
}

/**
 * MCP prompts surfacing the AI-governance / Human-In-The-Loop contract so any
 * client can load the rules and the draft workflow directly. Read-only text;
 * no arguments, no side effects.
 */
const PROMPTS: readonly PromptDefinition[] = [
    {
        name: 'governance_contract',
        title: 'AI-governance & HITL contract',
        description:
            'The non-negotiable AI-governance / Human-In-The-Loop contract for pdfnative-mcp: the agent is a draftsman, the human is the only gate, zero runtime dependencies, no autonomous GitHub writes.',
        text: GOVERNANCE_CONTRACT_SUMMARY,
    },
    {
        name: 'draft_issue_workflow',
        title: 'Human-in-the-loop issue workflow',
        description:
            'Step-by-step workflow for drafting a GitHub issue with the draft_governance_issue tool and handing it to a human for review and submission.',
        text: DRAFT_ISSUE_WORKFLOW,
    },
];

const PROMPT_INDEX: ReadonlyMap<string, PromptDefinition> = new Map(PROMPTS.map((p) => [p.name, p]));

/** Wire-level `tools/list` payload (deterministic order = registration order, per MCP 2026-07-28 guidance). */
export function listToolsPayload(): ListToolsResult {
    return { tools: TOOLS.map(describeTool) };
}

function describeTool(t: ToolDefinition): Tool {
    return {
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema as Tool['inputSchema'],
        ...(t.outputSchema !== undefined ? { outputSchema: t.outputSchema as Tool['outputSchema'] } : {}),
        ...(t.annotations !== undefined ? { annotations: t.annotations } : {}),
        _meta: {
            apiVersion: TOOL_API_VERSION,
            ...(t.examples !== undefined ? { examples: t.examples } : {}),
        },
    };
}

/**
 * Execute one tool call exactly as the `tools/call` handler does (cache lookup,
 * handler, result shaping, error → `isError`). Transport-agnostic so tests and
 * the baseline tooling can exercise the contract without a connection.
 */
export async function callToolDirect(name: string, args: unknown): Promise<CallToolResult> {
    const tool = TOOL_INDEX.get(name);
    if (tool === undefined) {
        return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
        };
    }
    try {
        const input = args ?? {};
        // Content-addressed cache (opt-in via PDFNATIVE_MCP_CACHE_DIR).
        // We skip caching for outputMode='file' since the filesystem write is itself an effect,
        // and for the encryption tools so decrypted/protected bytes are never persisted at rest.
        const cacheable = !isFileOutput(input) && !NON_CACHEABLE_TOOLS.has(name);
        const cacheKey = cacheable ? { tool: name, apiVersion: TOOL_API_VERSION } : null;
        if (cacheKey !== null) {
            const hit = getCached<unknown>(cacheKey.tool, cacheKey.apiVersion, input);
            if (hit !== null) {
                return dispatchOutput(hit, name, input);
            }
        }
        const output = await tool.handler(input);
        if (cacheKey !== null) {
            setCached(cacheKey.tool, cacheKey.apiVersion, input, output);
        }
        return dispatchOutput(output, name, input);
    } catch (err) {
        return buildErrorResult(err, name);
    }
}

/**
 * Build a fresh, connection-less `Server`. Cheap and side-effect free, so the
 * HTTP entry point can call it once per request (MCP 2026-07-28 is stateless)
 * while stdio pins a single instance per process. Handlers assume
 * `ensureCompressionReady()` has resolved (the CLI awaits it before serving).
 */
export function createServer(): Server {
    const server = new Server(
        { name: SERVER_NAME, version: SERVER_VERSION, title: SERVER_TITLE, description: SERVER_DESCRIPTION },
        {
            capabilities: { tools: {}, prompts: {}, resources: {} },
            instructions: SERVER_INSTRUCTIONS,
            cacheHints: SERVER_CACHE_HINTS,
        } satisfies ServerOptions,
    );

    // Native MCP resources: expose sandboxed generated PDFs as re-referenceable
    // pdfnative://output/… URIs (empty when file output is disabled).
    server.setRequestHandler('resources/list', async () => ({
        resources: (await listResources()).map((r) => ({
            uri: r.uri,
            name: r.name,
            title: r.title,
            description: r.description,
            mimeType: r.mimeType,
            size: r.size,
        })),
    }));

    server.setRequestHandler('resources/templates/list', async () => ({
        resourceTemplates: listResourceTemplates(),
    }));

    server.setRequestHandler('resources/read', async (request) => {
        const uri = request.params.uri;
        try {
            return { contents: [await readResource(uri)] };
        } catch (err) {
            // Spec 2026-07-28: resource-not-found is -32602 (Invalid params) on every revision.
            if (err instanceof ToolError) {
                if (err.code === 'UNKNOWN_RESOURCE') throw new ResourceNotFoundError(uri, err.message);
                throw new ProtocolError(ProtocolErrorCode.InvalidParams, `[${err.code}] ${err.message}`);
            }
            throw err;
        }
    });

    server.setRequestHandler('prompts/list', async () => ({
        prompts: PROMPTS.map((p) => ({ name: p.name, title: p.title, description: p.description })),
    }));

    server.setRequestHandler('prompts/get', async (request): Promise<GetPromptResult> => {
        const prompt = PROMPT_INDEX.get(request.params.name);
        if (prompt === undefined) {
            throw new ProtocolError(ProtocolErrorCode.InvalidParams, `[UNKNOWN_PROMPT] Unknown prompt: ${request.params.name}`);
        }
        return {
            description: prompt.description,
            messages: [
                {
                    role: 'user',
                    content: { type: 'text', text: prompt.text },
                },
            ],
        };
    });

    server.setRequestHandler('tools/list', async () => listToolsPayload());

    server.setRequestHandler('tools/call', async (request): Promise<CallToolResult> => {
        const { name, arguments: args } = request.params;
        const result = await callToolDirect(name, args);
        const tool = TOOL_INDEX.get(name);
        // Identity for object-shaped structuredContent; keeps the wire projection the
        // SDK expects for the negotiated protocol revision.
        return server.projectCallToolResult(result, tool?.outputSchema as Record<string, unknown> | undefined);
    });

    return server;
}

let _compressionInitPromise: Promise<void> | null = null;
/**
 * Initialise pdfnative's Node-zlib compression backend and async crypto subsystem
 * exactly once. Safe to call multiple times — the underlying calls are idempotent
 * and the promise is memoised. (`initCrypto` is required since pdfnative v1.1 for
 * any code path that uses ASN.1 / RSA / ECDSA primitives.)
 */
export function ensureCompressionReady(): Promise<void> {
    if (_compressionInitPromise === null) {
        _compressionInitPromise = (async () => {
            await initNodeCompression();
            await initCrypto();
        })();
    }
    return _compressionInitPromise;
}

export const __serverMetadata = { name: SERVER_NAME, version: SERVER_VERSION, title: SERVER_TITLE, description: SERVER_DESCRIPTION } as const;
export const __serverInstructions = SERVER_INSTRUCTIONS;
