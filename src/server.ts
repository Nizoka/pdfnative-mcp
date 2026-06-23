/**
 * MCP server wiring: registers the four pdfnative tools on a low-level
 * `Server` instance and exposes a `createServer()` factory so the runtime
 * (CLI, tests, embedded host) can choose how to connect a transport.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type CallToolRequest,
    type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { initCrypto, initNodeCompression } from 'pdfnative';

import { ToolError } from './errors.js';
import { getCached, setCached } from './cache.js';
import { type OutputResult } from './output.js';
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

// JSON import attribute (Node 22+, TS 5.3+) keeps version in lock-step with package.json.
// Hardcoded here to keep the build rootDir limited to ./src; tests assert it stays in sync.
const SERVER_VERSION = '1.2.0';
const SERVER_NAME = 'pdfnative-mcp';

/**
 * Per-tool API version used by the opt-in cache key and by `_meta.apiVersion`.
 * Bump when the input or output schema of any tool changes in a way that would
 * make a cached response unsafe to serve. Independent from SERVER_VERSION
 * (which tracks the npm package).
 */
const TOOL_API_VERSION = '1.2.0';

/** True when the call's input requests a file-mode output (filesystem side-effect). */
function isFileOutput(input: unknown): boolean {
    if (input === null || typeof input !== 'object') return false;
    const mode = (input as { outputMode?: unknown }).outputMode;
    return mode === 'file';
}

function dispatchOutput(output: unknown, name: string, input: unknown): CallToolResult {
    if (output !== null && typeof output === 'object') {
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
    handler: (args: unknown) => Promise<OutputResult | InspectPdfResult | VerifyPdfResult | ExtractTextResult | ValidatePdfResult>;
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
            'Generate a PDF rendering text in any of 24 scripts (Arabic, Hebrew, Thai, CJK, Devanagari, Bengali, Tamil, Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic, Cyrillic, Greek, Georgian, Armenian, Vietnamese, Turkish, Polish, Latin fallback) with optional COLRv1 colour emoji. BiDi reordering (incl. UAX#9 isolates), Arabic harakat positioning, and complex-script OpenType shaping are handled automatically by the embedded Noto fonts; input is NFC-normalised for maximal glyph coverage and embedded newlines auto-split into paragraphs. Pass `lang` as a single code or an array (e.g. ["ar","emoji"]) for multi-script runs.',
        inputSchema: ADD_INTERNATIONAL_TEXT_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Arabic', input: { text: 'مرحبا', lang: 'ar', title: 'Hello in Arabic' } },
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
];

const TOOL_INDEX: ReadonlyMap<string, ToolDefinition> = new Map(TOOLS.map((t) => [t.name, t]));

const SERVER_INSTRUCTIONS = `pdfnative-mcp bridges the zero-dependency 'pdfnative' v1.3 library to MCP. API version: 1.2.0 (stable).

DECISION TREE — pick the right tool in one step:
  • Plain document (headings, paragraphs, lists)             → ${GENERATE_BASIC_PDF_NAME}
  • QR code / barcode (URL, SKU, EAN)                        → ${ADD_BARCODE_NAME}
  • Non-Latin script (Arabic, Hindi, Chinese, Japanese…)     → ${ADD_INTERNATIONAL_TEXT_NAME}
  • Tabular / report data                                    → ${ADD_TABLE_NAME}
  • Interactive form (text fields, checkboxes, dropdowns)    → ${ADD_FORM_NAME}
  • Embed a JPEG/PNG into a PDF                              → ${EMBED_IMAGE_NAME}
  • Sign any PDF (auto-injects placeholder)                  → ${SIGN_PDF_NAME}
  • Customize signature placeholder before signing           → ${PREPARE_SIGNATURE_PLACEHOLDER_NAME} → ${SIGN_PDF_NAME}
  • Factur-X / ZUGFeRD invoice or any PDF with attachments   → ${ADD_ATTACHMENT_NAME}   (NOT generate_basic_pdf)
  • Inspect / assert PDF metadata in CI                      → ${INSPECT_PDF_NAME}
  • Verify all PAdES signatures                              → ${VERIFY_PDF_NAME}
  • Validate PDF/UA accessibility structure                  → ${VALIDATE_PDF_NAME}
  • Pull plain text from a PDF                               → ${EXTRACT_TEXT_NAME}

COMMON PITFALLS (read these to avoid retry loops):
  • Barcode 'data' is the RAW payload — do NOT URL-encode URLs. For a QR pointing to https://google.com just pass data: 'https://google.com'.
  • Barcode 'ecLevel' (L|M|Q|H) applies ONLY to format='qr' and is ignored elsewhere. Use 'H' for printed media.
  • EAN-13 'data' must be exactly 12 or 13 digits (the 13th check digit is auto-computed if you pass 12).
  • sign_pdf accepts ONLY DER-encoded inputs in base64. Convert from PEM with: openssl pkey -in key.pem -outform DER | base64 -w0  (and openssl x509 -in cert.pem -outform DER | base64 -w0 for the cert).
  • sign_pdf RSA key must be PKCS#1 DER (field 'rsaKeyPkcs1DerBase64'). ECDSA key may be SEC1 or PKCS#8 DER (field 'ecPrivateKeyDerBase64') or the raw 32-byte scalar as 64 hex chars (field 'ecPrivateScalarHex').
  • sign_pdf auto-injects a placeholder when missing — call it directly on ANY PDF unless you specifically need to customize the placeholder.
  • For Factur-X / ZUGFeRD invoices, use add_attachment (PDF/A-3) — generate_basic_pdf cannot embed files.
  • PDF/A: pass pdfA='pdfa2b' for the widest reader compatibility. PDF/A-3 is required when you have attachments.
  • PDF/A text is now robust: embedded newlines ('\\n') in paragraphs are auto-split into separate paragraphs; the Euro sign and other CP-1252 symbols extract correctly (pdfnative 1.3); wrapped table cells get unique per-line MCIDs. Write naturally — no manual workarounds needed.
  • add_international_text covers 24 scripts and COLRv1 colour emoji; pass 'lang' as a single code or an array (e.g. ["ar","emoji"]) for multi-script runs. Input is NFC-normalised automatically.
  • outputMode='file' is only available when the host sets PDFNATIVE_MCP_OUTPUT_DIR; otherwise PDFs are returned as base64.
  • TOKEN-FRUGAL READS: the read-only tools (inspect_pdf, verify_pdf, validate_pdf, extract_text) accept verbosity:'summary' for a compact scalar-only verdict (drops large arrays / full text) and fields:[...] for dot-path projection (e.g. fields:['allValid']). Defaults are unchanged (full output). Generated PDFs are returned as an embedded resource block, not duplicated in structuredContent.

Every tool ships JSON-Schema-typed inputs/outputs, _meta.apiVersion = '1.2.0', and worked-example _meta.examples. See docs/AI_GUIDE.md for a longer walk-through.`;

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

function buildSuccessResult(output: OutputResult, toolName: string): CallToolResult {
    if (output.mode === 'file') {
        return {
            content: [
                {
                    type: 'text',
                    text: `${toolName}: wrote ${output.sizeBytes} bytes to ${output.filePath}`,
                },
            ],
            structuredContent: {
                mode: output.mode,
                sizeBytes: output.sizeBytes,
                filePath: output.filePath,
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

export function createServer(): Server {
    const server = new Server(
        { name: SERVER_NAME, version: SERVER_VERSION },
        {
            capabilities: { tools: {} },
            instructions: SERVER_INSTRUCTIONS,
        },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: TOOLS.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema as Record<string, unknown>,
            ...(t.outputSchema !== undefined ? { outputSchema: t.outputSchema as Record<string, unknown> } : {}),
            ...(t.annotations !== undefined ? { annotations: t.annotations } : {}),
            _meta: {
                apiVersion: TOOL_API_VERSION,
                ...(t.examples !== undefined ? { examples: t.examples } : {}),
            },
        })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest): Promise<CallToolResult> => {
        const { name, arguments: args } = request.params;
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
            // We skip caching for outputMode='file' since the filesystem write is itself an effect.
            const cacheable = !isFileOutput(input);
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

export const __serverMetadata = { name: SERVER_NAME, version: SERVER_VERSION } as const;
export const __serverInstructions = SERVER_INSTRUCTIONS;
