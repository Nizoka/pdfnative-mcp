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
import { describeNetworkPolicy } from './network.js';
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
    ADD_LTV_NAME,
    ADD_LTV_INPUT_SCHEMA,
    addLtv,
} from './tools/add-ltv.js';
import {
    TIMESTAMP_PDF_NAME,
    TIMESTAMP_PDF_INPUT_SCHEMA,
    timestampPdf,
} from './tools/timestamp-pdf.js';
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
/** Mirrors server.json `websiteUrl` (asserted by tests/metadata.test.ts). */
export const SERVER_WEBSITE_URL = 'https://github.com/Nizoka/pdfnative-mcp#readme';
const SERVER_DESCRIPTION =
    'Production-grade MCP server for PDF generation, PDF/A archival, PDF/UA structural validation, native vector charts, ' +
    'digital signatures (PAdES B-B → B-LTA; DER keys signed through constant-time node:crypto, pure-JS fallback for raw P-256 scalars; verification in pure JS), encryption round-trip (decrypt + AES-128/256 re-encrypt), ' +
    'AcroForm fill & flatten, page-tree ops (merge / split / extract), markup annotations, Factur-X invoices, ' +
    'Unicode text extraction with positioned runs, PDF introspection, MCP resources for generated PDFs, ' +
    'and human-in-the-loop AI-governance issue drafting. ' +
    '27 tools, 24 scripts, three runtime dependencies (pdfnative, the MCP SDK, zod).';

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
const NON_CACHEABLE_TOOLS: ReadonlySet<string> = new Set([
    ENCRYPT_PDF_NAME,
    DECRYPT_PDF_NAME,
    // Signing is a fresh act: the default signingTime is the wall clock, a
    // timestamp embeds a TSA token minted at call time, and private-key
    // material must never feed a persisted key — never served from cache.
    SIGN_PDF_NAME,
    // Time-dependent (TSA tokens, /ModDate) or network-dependent outputs.
    ADD_LTV_NAME,
    TIMESTAMP_PDF_NAME,
    UPDATE_METADATA_NAME,
]);

/**
 * Cache key namespace: the tool API version *and* the package version (which
 * moves in lock-step with the pdfnative engine), so an engine upgrade can
 * never serve bytes rendered by the previous engine.
 */
const CACHE_API_VERSION = `${TOOL_API_VERSION}/${PDFNATIVE_MCP_VERSION}`;

/** True when this call's output must bypass the response cache. */
function isCacheable(name: string, input: unknown): boolean {
    return !isFileOutput(input) && !NON_CACHEABLE_TOOLS.has(name);
}

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

/**
 * Surface `fields` paths that matched nothing (a typo such as `allvalid`, or a
 * field that is only present with another option, e.g. `ltvLevel` without
 * `ltv: true`). Additive: `_meta.unmatchedFields` appears only in that case, so
 * a structured consumer is never left with an empty object and no explanation.
 */
function projectionMeta(
    full: Record<string, unknown>,
    summary: Record<string, unknown>,
    input: unknown,
): { _meta?: { unmatchedFields: string[]; availableFields: string[] } } {
    const fields = readFields(input);
    if (fields.length === 0) return {};
    const base = readVerbosity(input) === 'summary' ? summary : full;
    const unmatched = fields.filter((f) => {
        const head = f.split('.')[0]?.trim() ?? '';
        return head.length > 0 && !(head in base);
    });
    return unmatched.length === 0 ? {} : { _meta: { unmatchedFields: unmatched, availableFields: Object.keys(base) } };
}

/**
 * MCP 2026-07-28 (server/tools, Output Schema): "Servers MUST provide
 * structured results that conform to [the output] schema". The read-only
 * tools can project their result (`verbosity: 'summary'` collapses to
 * scalars, `fields` keeps a dot-path subset), so their advertised schema
 * describes the *full* shape with every property optional at every level —
 * `additionalProperties: false` stays, `required` is removed recursively —
 * and declares the summary-only scalars. A validating host then accepts the
 * full result, the summary and any projection alike.
 */
function projectableOutputSchema(
    schema: Readonly<Record<string, unknown>>,
    summaryProperties: Readonly<Record<string, unknown>>,
    description: string,
): Record<string, unknown> {
    const strip = (node: unknown): unknown => {
        if (Array.isArray(node)) return node.map(strip);
        if (node === null || typeof node !== 'object') return node;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
            // The schema keyword is an array; a *property* named "required" is an object.
            if (k === 'required' && Array.isArray(v)) continue;
            out[k] = strip(v);
        }
        return out;
    };
    const stripped = strip(schema) as Record<string, unknown>;
    return {
        ...stripped,
        description,
        properties: { ...(stripped['properties'] as Record<string, unknown>), ...summaryProperties },
    };
}

const PROJECTION_NOTE =
    " Every property is optional because the result can be projected: verbosity:'summary' returns only the scalar summary fields, fields:[...] keeps a dot-path subset. Defaults return the full shape.";


/** Common output schema for tools that return a generated PDF (base64 inline or sandboxed file path). */
const PDF_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'sizeBytes'],
    description:
        "Result of a PDF-producing tool. base64 mode: the PDF arrives as an embedded `resource` content block (not duplicated here); file mode: `filePath`.",
    properties: {
        mode: { type: 'string', enum: ['base64', 'file'] },
        sizeBytes: { type: 'integer', minimum: 0 },
        filePath: { type: 'string', description: "Sandboxed absolute path (file mode)." },
        ...DIAGNOSTICS_OUTPUT_PROPERTY,
        summary: {
            type: 'object',
            description: 'Tool-specific summary, when produced.',
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
                    filePath: { type: 'string', description: "Sandboxed absolute path (file mode)." },
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
            "Multi-page A4 PDF from structured blocks (heading, paragraph, list, table, chart, image, page break, spacer). DEFAULT for plain documents — reach for add_table / add_chart / add_barcode / add_attachment / add_international_text only when the document IS that thing or needs non-Latin scripts. `pdfA` + `embedFonts:true` for a valid PDF/A-1b/2b/2u/3b claim; `outline` / `pageLabels` / `viewerPreferences` / `watermark` for navigation and presentation; `print`, `metadata`, `outputIntent`, `creationDate` as on every document tool. The 'chart' block takes the same body as add_chart.",
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
            "Single-page PDF with a barcode: qr (URLs, vCards, UTF-8 ≤ 4296 chars; ecLevel 'H' for print, 'M' default), code128 (ASCII SKUs), ean13 (12–13 digits, checksum auto), datamatrix (dense industrial marks), pdf417 (ID cards, boarding passes). `data` is the raw payload — never pre-encode. Typical: { format:'qr', data:'https://example.com', caption:'Scan me' }. PDF/A, print, metadata and creationDate options as on every document tool.",
        inputSchema: ADD_BARCODE_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'QR code pointing to a URL (most common case)', input: { format: 'qr', data: 'https://google.com', caption: 'Scan to visit Google' } },
            { title: 'QR code with high error correction (printed media)', input: { format: 'qr', data: 'https://example.com/page?id=123', ecLevel: 'H', caption: 'Scan me' } },
        ],
        handler: addBarcode,
    },
    {
        name: SIGN_PDF_NAME,
        title: 'Sign PDF (RSA / ECDSA, PAdES)',
        description:
            "CMS / PAdES signature in ONE call: a missing /Sig placeholder is auto-injected (prepare_signature_placeholder is optional). Inputs: pdfBase64, algorithm (rsa-sha256/384/512, ecdsa-sha256 P-256), certDerBase64 (+ certChainDerBase64 intermediates) and the DER key (rsaKeyPkcs1DerBase64 for rsa-*, ecPrivateKeyDerBase64 or ecPrivateScalarHex for ECDSA; PEM is rejected with the openssl remedy). `profile:'pades'` (ETSI EN 319 142-1 baseline) is the right choice when add_ltv / timestamp_pdf follow; `timestamp:true` = PAdES B-T through the operator TSA (TSA_NOT_CONFIGURED otherwise, no network without it). signerName/reason/location/contactInfo/signingTime are baked into the placeholder THIS call injects (a pre-built placeholder keeps its own). Several unsigned placeholders → pass fieldName (PLACEHOLDER_AMBIGUOUS); `allowMultiple:true` + a new fieldName adds a further signature. Verify with verify_pdf.",
        inputSchema: SIGN_PDF_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        // openWorldHint: timestamp=true performs egress to the operator-configured TSA.
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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
            "PDF rendering text in 24 scripts (Arabic, Hebrew, Thai, CJK, Devanagari, Bengali, Tamil, Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic, Cyrillic, Greek, Georgian, Armenian, Vietnamese, …), COLRv1 colour emoji and mathematical symbols ('math': ∀ ∃ √ ∑ ∫ ∞). BiDi (UAX #9), Arabic joining and complex-script shaping are automatic; input is NFC-normalised; newlines split paragraphs. `lang` is a code or an array for mixed runs (['ar','emoji'], ['latin','math']). Fonts are always embedded, so `embedFonts` does not exist here. PDF/A, print, metadata and creationDate options as on every document tool.",
        inputSchema: ADD_INTERNATIONAL_TEXT_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Arabic', input: { title: 'Hello in Arabic', lang: 'ar', paragraphs: ['مرحبا بالعالم'] } },
            { title: 'Latin + math symbols', input: { title: 'Math', lang: ['latin', 'math'], paragraphs: ['For all x ∈ ℝ, √(x²) = |x| and ∑ i = n(n+1)/2.'] } },
        ],
        handler: addInternationalText,
    },
    {
        name: ADD_TABLE_NAME,
        title: 'Add table / report',
        description:
            "Tabular PDF report from `headers` + `rows` (every row the same length). Smart-table options: wrap, repeatHeader (header on every page), zebra, caption (tagged for PDF/A), minRowHeight, cellPadding, cellBorders, cellVAlign, autoFitColumns, clipCells. Use a 'table' block in generate_basic_pdf when the table sits inside a longer document. PDF/A (pdfA + embedFonts:true), print, metadata, watermark and creationDate options as on every document tool.",
        inputSchema: ADD_TABLE_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Sales report', input: { title: 'Sales', headers: ['Item', 'Qty', 'Total'], rows: [['Widget', '100', '$1,000']] } },
            { title: 'Smart table with caption + zebra + repeated header', input: { title: 'Q4', headers: ['Month', 'Revenue'], rows: [['Oct', '$1,000'], ['Nov', '$1,500'], ['Dec', '$2,100']], caption: 'Quarterly revenue', zebra: true, repeatHeader: true, wrap: 'auto' } },
        ],
        handler: addTable,
    },
    {
        name: ADD_FORM_NAME,
        title: 'Add interactive form',
        description:
            'New PDF with an interactive AcroForm: text fields, text areas, checkboxes, radio buttons, dropdowns (data capture, surveys, fillable templates). To fill or flatten an EXISTING form use read_form_fields + fill_form. PDF/A, print, metadata and creationDate options as on every document tool.',
        inputSchema: ADD_FORM_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Simple form', input: { title: 'Survey', fields: [{ fieldType: 'text', name: 'name', label: 'Your name' }, { fieldType: 'checkbox', name: 'subscribe', label: 'Subscribe' }] } },
        ],
        handler: addForm,
    },
    {
        name: EMBED_IMAGE_NAME,
        title: 'Embed image in PDF',
        description:
            "PDF with one embedded JPEG or PNG (base64; PNG without alpha channel) plus optional caption and render width/height. For an image inside a longer document use an 'image' block in generate_basic_pdf. PDF/A, print, metadata and creationDate options as on every document tool.",
        inputSchema: EMBED_IMAGE_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Embed a PNG logo', input: { title: 'Company logo', imageBase64: '<base64-png>', mimeType: 'image/png', caption: 'Company logo' } },
        ],
        handler: embedImage,
    },
    {
        name: PREPARE_SIGNATURE_PLACEHOLDER_NAME,
        title: 'Prepare signature placeholder',
        description:
            "New PDF carrying an unsigned /Sig placeholder for a LATER sign_pdf call. OPTIONAL — sign_pdf auto-injects one. Use it to size the placeholder (placeholderBytes for > 4096-bit keys, reserveTimestamp for an RFC 3161 token), to pin the widget page (pageIndex), to choose subFilter 'ETSI.CAdES.detached' (PAdES), or to ship the placeholder separately. signerName/reason/location/contactInfo/signingTime are frozen into /Sig here — sign_pdf cannot rewrite them later. NOTE: the unsigned file is not yet a conformant PDF/A (empty /Contents); it becomes one once signed. PDF/A, print, metadata and creationDate options as on every document tool.",
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
            "Read-only facts about a PDF: version, pageCount, encryption, pdfA claim (the claim, not its validity — use veraPDF for that), signatureCount, hasSignaturePlaceholder, attachments[], info; presence-gated dss / docTimestampCount / trapped; `signatures:true` lists every field (subFilter, isDocTimestamp, isPlaceholder, byteRange, vriKey); `pages:true` adds per-page sizes and boxes. `check:[…]` turns it into a CI assertion ('pdfa','signed','encrypted','placeholder','attachments','dss','docTimestamp','trapped') → checks (requested keys only) + checksPassed. Encrypted sources: pass `password`. Token-frugal: verbosity:'summary', fields:[…].",
        inputSchema: INSPECT_PDF_INPUT_SCHEMA,
        outputSchema: projectableOutputSchema(
            INSPECT_PDF_OUTPUT_SCHEMA,
            {
                attachmentCount: { type: 'integer', minimum: 0, description: "summary only: number of embedded files." },
                checksPassed: { type: 'boolean', description: 'Present when check[] was supplied: true when every requested check holds.' },
            },
            `Structured inspection result.${PROJECTION_NOTE}`,
        ),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'CI: assert PDF/A + signed', input: { pdfBase64: '<base64>', check: ['pdfa', 'signed'] } },
            { title: 'Detect Factur-X attachments', input: { pdfBase64: '<base64>', check: ['attachments'] } },
        ],
        handler: inspectPdf,
    },
    {
        name: VERIFY_PDF_NAME,
        title: 'Verify PDF signatures',
        description:
            "Read-only verification of every signature: ByteRange digest vs CMS messageDigest (integrity), CMS signatureValue vs the embedded signer certificate (RSA-SHA256/384/512, ECDSA P-256), chain trust when trustedRootsDerBase64 is given ('self-signed' | 'unverified' | 'trusted' otherwise). /DocTimeStamp entries are verified as RFC 3161 tokens and count in allValid like any signature. Result: { allValid, signatureCount, summary, signatures:[{ valid, integrity, signerSubject, signingTime, chainTrust, errors[] }] }. `ltv:true` adds the PAdES view: per-signature profile, timestamp, revocation (read from embedded /DSS only — responder signatures are not re-verified) and ltvLevel B-B / B-T / B-LT / B-LTA with explicit caveats. Token-frugal: verbosity:'summary', fields:['allValid'].",
        inputSchema: VERIFY_PDF_INPUT_SCHEMA,
        outputSchema: projectableOutputSchema(
            VERIFY_PDF_OUTPUT_SCHEMA,
            { invalid: { type: 'integer', minimum: 0, description: 'summary only: number of invalid signatures.' } },
            `Structured signature verification result.${PROJECTION_NOTE}`,
        ),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Verify a signed PDF (no chain trust)', input: { pdfBase64: '<signed-pdf-base64>' } },
            { title: 'Verify with a trusted root certificate', input: { pdfBase64: '<signed-pdf-base64>', trustedRootsDerBase64: ['<root-cert-der-base64>'] } },
        ],
        handler: verifyPdf,
    },
    {
        name: ADD_ATTACHMENT_NAME,
        title: 'Add embedded file attachment (PDF/A-3, Factur-X)',
        description:
            "PDF/A-3b document with embedded files — the tool for Factur-X / ZUGFeRD e-invoices (one XML attachment, relationship 'Source', mimeType application/xml) or any PDF carrying machine-readable side-files (≤ 8 MiB each). Body via `blocks` (same schema as generate_basic_pdf). Pair with `embedFonts:true` for a valid PDF/A-3 claim (strict:true fails otherwise). Read them back with extract_attachments. Print, metadata and creationDate options as on every document tool.",
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
            "Plain-text extraction: decodes Tj/TJ operands through each font's /ToUnicode CMap, /Encoding /Differences or base encoding and returns pages[] + fullText (positioned runs with includeRuns:true; `pages` selects 0-based pages). `extractable` is false only when a page decoded ENTIRELY to U+FFFD (a font with no usable mapping — expected for some subset fonts, not an error; extractableReason explains). Encrypted sources: pass `password` (PASSWORD_REQUIRED / PASSWORD_INVALID otherwise). Token-frugal: verbosity:'summary', fields:[…].",
        inputSchema: EXTRACT_TEXT_INPUT_SCHEMA,
        outputSchema: projectableOutputSchema(
            EXTRACT_TEXT_OUTPUT_SCHEMA,
            {
                charCount: { type: 'integer', minimum: 0, description: 'summary only: length of fullText.' },
                extractableReason: { type: 'string', description: 'Present when extractable is false: why no text could be decoded.' },
            },
            `Structured text-extraction result.${PROJECTION_NOTE}`,
        ),
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
            "Read-only PDF/UA-1 (ISO 14289-1) structural gate for Tagged PDF: /MarkInfo /Marked, /StructTreeRoot (+ /ParentTree), XMP /Metadata, /Lang, per-page MCID uniqueness. Result { standard:'pdf-ua-1', valid, errors[], warnings[], summary }. Fast and structural only — NOT a reference validator (veraPDF): fonts, colour and rendering are not checked. Unparsable input → PDF_PARSE_FAILED. Generate tagged input with pdfA (e.g. 'pdfa2u') first.",
        inputSchema: VALIDATE_PDF_INPUT_SCHEMA,
        outputSchema: projectableOutputSchema(
            VALIDATE_PDF_OUTPUT_SCHEMA,
            {
                errorCount: { type: 'integer', minimum: 0, description: 'summary only: number of errors.' },
                warningCount: { type: 'integer', minimum: 0, description: 'summary only: number of warnings.' },
            },
            `Structured PDF/UA validation result.${PROJECTION_NOTE}`,
        ),
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
            "Read-only extraction of embedded files (PDF/A-3, Factur-X, ZUGFeRD): name, mimeType, AFRelationship, description, sizeBytes and (by default) the payload as dataBase64. `filename` selects one file; `includeData:false` probes metadata only. Encrypted sources: pass `password`. Token-frugal: verbosity:'summary'.",
        inputSchema: EXTRACT_ATTACHMENTS_INPUT_SCHEMA,
        outputSchema: projectableOutputSchema(EXTRACT_ATTACHMENTS_OUTPUT_SCHEMA, {}, `Structured attachment-extraction result.${PROJECTION_NOTE}`),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Extract every embedded file (with payloads)', input: { pdfBase64: '<base64>' } },
            { title: 'Pull just the Factur-X XML payload', input: { pdfBase64: '<base64>', filename: 'factur-x.xml' } },
        ],
        handler: extractAttachments,
    },
    {
        name: MERGE_PDFS_NAME,
        title: 'Merge PDFs',
        description:
            'Concatenate 2–50 PDFs (`pdfsBase64[]`) into one fresh, self-contained document. Page-tree rebuild: signatures and AcroForm are dropped, XMP (and thus a PDF/A claim) does not survive — re-declare PDF/A on the generating tools; page boxes and /UserUnit do survive; URI links kept unless dropAnnotations:true. Encrypted sources open with one `password` (PASSWORD_REQUIRED / PASSWORD_INVALID); output unencrypted unless `encrypt`. Guards: 256 MiB assembly (maxOutputSizeBytes), 50 MiB output (OUTPUT_TOO_LARGE).',
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
            "Split one PDF into several documents, one per `ranges[]` entry ({ start, end? }, 0-based inclusive; end defaults to start). Multi-output result: base64 mode returns one embedded resource per part; file mode writes indexed siblings ('out.pdf' → 'out-1.pdf', 'out-2.pdf', …). Same page-tree caveats as merge_pdfs (signatures/AcroForm/XMP dropped; boxes kept). Encrypted sources: `password`. Need ONE document from a page subset? Use extract_pages.",
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
            'Keep an arbitrary `pages[]` subset (0-based, in the given order) in ONE fresh PDF. Same page-tree caveats as merge_pdfs (signatures/AcroForm/XMP dropped; boxes kept; URI links unless dropAnnotations). Encrypted sources: `password`; output unencrypted unless `encrypt`. Need several documents? Use split_pdf.',
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
            'Append markup annotations (ISO 32000-1 §12.5) to an existing PDF as a non-destructive incremental update (original bytes preserved). Types: text (sticky note), highlight | underline | strikeout | squiggly, square | circle, line (needs start/end), freetext. Each needs a 0-based `page` and `rect` [x1,y1,x2,y2]; optional contents, color, opacity, title and type-specific fields. VISUAL OVERLAY ONLY — nothing is removed or redacted (covered text stays extractable). Encrypted sources → ENCRYPTED_SOURCE (decrypt_pdf first).',
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
            "Produce a LOCAL GitHub issue draft + compliance report for pdfnative / pdfnative-mcp and NEVER submit it — the agent drafts, a human reviews and files it under their own identity (Human-In-The-Loop contract, .github/AGENT_RULES.md). No GitHub write path exists. The draft is checked against the zero-dependency + reproduction policy; a violation (new runtime dependency, missing reproduction, duplicateSearchPerformed:false) throws GOVERNANCE_VIOLATION. Returns markdown inline (outputMode:'file' also writes a .md). Present the draft AND the report to the user, then STOP.",
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
            "Read-only list of an existing PDF's AcroForm fields: fully-qualified name, type (text | checkbox | radio | dropdown | listbox | button | signature | unknown), value, flags (readOnly / required / multiline), options, widget placements. Call it BEFORE fill_form to learn the names. Encrypted sources: `password`. Token-frugal: verbosity:'summary' → { fieldCount }.",
        inputSchema: READ_FORM_FIELDS_INPUT_SCHEMA,
        outputSchema: projectableOutputSchema(READ_FORM_FIELDS_OUTPUT_SCHEMA, {}, `Structured AcroForm field listing.${PROJECTION_NOTE}`),
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
            "Fill and/or flatten the AcroForm of an EXISTING PDF (add_form creates one) as an incremental update — prior signatures stay valid for their revision. `values`: fully-qualified name → string (array for multi-select), boolean or export state for checkbox/radio. `flatten:true` stamps appearances and drops the interactive layer (with no values = pure flatten). Unknown names → FORM_FIELD_NOT_FOUND unless onUnknownField:'ignore'; signature fields cannot be filled (FORM_UNSUPPORTED). Encrypted sources: `password`.",
        inputSchema: FILL_FORM_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Fill a couple of fields', input: { pdfBase64: '<base64>', values: { fullName: 'Alice Martin', subscribe: true } } },
            { title: 'Fill and flatten (final, non-editable)', input: { pdfBase64: '<base64>', values: { fullName: 'Alice Martin' }, flatten: true } },
        ],
        handler: fillFormTool,
    },
    {
        name: ADD_CHART_NAME,
        title: 'Add native vector chart',
        description:
            "Single-page PDF with a native vector chart (pure path operators, no raster): bar, barH, stackedBar, stackedBarH, line (markers), area, scatter, pie, donut. Multi-series, legends, 'nice' ticks, gridlines, negatives; per-series xValues with xAxis.type 'linear' | 'time' (ISO-8601), secondary right axis (axis2 + yAxis:'right'), axis.scale 'log', dataLabels, labelStride / labelRotation. Pie/donut take exactly one series. Colours are hex ('#3366cc'). Tagged /Figure + /Alt (auto when altText is omitted). Engine cross-field rules surface as CHART_ERROR with the remedy. Inside a longer document use a 'chart' block in generate_basic_pdf. PDF/A (pdfA + embedFonts:true), print, metadata and creationDate as on every document tool.",
        inputSchema: ADD_CHART_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        examples: [
            { title: 'Grouped bar chart (2 series)', input: { chartType: 'bar', title: 'Quarterly revenue', categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ label: '2025', values: [12, 18, 15, 22] }, { label: '2026', values: [14, 20, 19, 25] }], axis: { grid: true } } },
            { title: 'Pie chart', input: { chartType: 'pie', title: 'Market share', categories: ['A', 'B', 'C'], series: [{ label: 'Share', values: [55, 30, 15] }] } },
        ],
        handler: addChart,
    },
    {
        name: ENCRYPT_PDF_NAME,
        title: 'Encrypt / re-secure a PDF',
        description:
            'Encrypt an existing PDF with the Standard Security Handler: AES-128 (default) or AES-256; RC4 is never emitted. ownerPassword required; optional userPassword (open password), permissions { print, copy, modify, extractText }. Rotate the password of an already-encrypted source by passing its current `password`. CAVEAT: the page tree is rebuilt — signatures and AcroForm are DROPPED, only URI links kept; encrypt BEFORE signing. Never cached.',
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
            'Emit an UNENCRYPTED copy of an encrypted PDF (RC4 V1–V4, AES-128, AES-256) given `password` (user or owner; empty user password needs none). CAVEAT: the page tree is rebuilt — signatures and AcroForm are DROPPED. To merely READ an encrypted PDF pass `password` to inspect_pdf / extract_text / extract_attachments / read_form_fields instead. Never cached.',
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
            'Rewrite /Info (title, author, subject, keywords) of an EXISTING PDF as an incremental update; XMP stays in sync on PDF/A documents; /ModDate is refreshed (pin `modDate` for reproducible bytes on the same host TZ). Earlier revisions and signatures stay byte-identical — the new revision is unsigned (sign_pdf / timestamp_pdf again if needed). Encrypted sources → ENCRYPTED_SOURCE. For metadata at generation time use the `metadata` option of the document tools.',
        inputSchema: UPDATE_METADATA_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        examples: [
            { title: 'Set author and keywords', input: { pdfBase64: '<any-pdf-base64>', author: 'Ada Lovelace', keywords: 'invoice, 2026', modDate: '2026-08-22T10:00:00Z' } },
        ],
        handler: updateMetadata,
    },
    {
        name: ADD_LTV_NAME,
        title: 'Embed LTV validation material (PAdES B-LT)',
        description:
            "PAdES B-LT: embed a Document Security Store (/DSS + per-signature /VRI) with the certificates and OCSP/CRL material future verifiers need ('LTV enabled' in Adobe Reader once the root is trusted). Ladder step 3: sign_pdf (profile:'pades', timestamp:true) → add_ltv → timestamp_pdf. mode 'online' (default) fetches through the OPERATOR revocation provider (PDFNATIVE_MCP_REVOCATION + PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS; REVOCATION_NOT_CONFIGURED otherwise — no network without it); mode 'offline' embeds caller-supplied DER certificates / OCSP responses / CRLs with zero network. Incremental (existing /DSS merged). Needs ≥ 1 signed signature; unencrypted PDFs only.",
        inputSchema: ADD_LTV_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        examples: [
            { title: 'Collect OCSP/CRL through the configured provider', input: { pdfBase64: '<signed-pdf-base64>', mode: 'online' } },
            { title: 'Air-gapped: embed exported material', input: { pdfBase64: '<signed-pdf-base64>', mode: 'offline', certificatesDerBase64: ['<intermediate-ca-der-base64>'], crlsDerBase64: ['<crl-der-base64>'] } },
        ],
        handler: addLtv,
    },
    {
        name: TIMESTAMP_PDF_NAME,
        title: 'Add a document timestamp (PAdES B-LTA)',
        description:
            "PAdES B-LTA: append an RFC 3161 document timestamp (/DocTimeStamp, ETSI.RFC3161) over the whole document. Ladder step 4 after add_ltv; re-run before the TSA certificate expires. fieldName omitted → DocTimeStamp1, 2, …; a fieldName colliding with a signed field fails. Uses the OPERATOR TSA (PDFNATIVE_MCP_TSA_URL; TSA_NOT_CONFIGURED otherwise, no network without it). The token's status, imprint and nonce are checked before embedding (its own signature is verified by verify_pdf). Unencrypted PDFs only.",
        inputSchema: TIMESTAMP_PDF_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        examples: [
            { title: 'Archive-timestamp a B-LT document', input: { pdfBase64: '<ltv-pdf-base64>' } },
            { title: 'Re-timestamp with a larger token reservation', input: { pdfBase64: '<ltv-pdf-base64>', placeholderBytes: 24576 } },
        ],
        handler: timestampPdf,
    },
];

const TOOL_INDEX: ReadonlyMap<string, ToolDefinition> = new Map(TOOLS.map((t) => [t.name, t]));

const SERVER_INSTRUCTIONS = `pdfnative-mcp: 27 tools over the pdfnative v1.7 PDF engine. Tool API 1.6.0. MCP 2026-07-28 (stateless) with automatic fallback to the 2025-era handshake. Every tool has typed input/output schemas and executable _meta.examples; read-only tools never modify input; document tools are byte-identical by default and every new option is opt-in.

DECISION TREE:
  • Plain document (headings, paragraphs, lists, tables, charts, images) → generate_basic_pdf
  • Standalone chart / table / barcode / image → add_chart / add_table / add_barcode / embed_image
  • Non-Latin script, emoji or math symbols → add_international_text (lang:['latin','math'] for formulas)
  • Files inside the PDF (Factur-X / ZUGFeRD invoice, side-cars) → add_attachment (PDF/A-3), read back with extract_attachments
  • NEW interactive form → add_form; EXISTING form → read_form_fields (names) then fill_form (fill / flatten)
  • Markup on an existing PDF (highlight, note, shapes) → annotate_pdf (overlay only, never redaction)
  • Change /Info of an existing PDF → update_metadata
  • Sign → sign_pdf (auto-injects the placeholder; prepare_signature_placeholder only to customise it)
  • PAdES ladder: sign_pdf profile:'pades' (B-B) → timestamp:true (B-T) → add_ltv (B-LT) → timestamp_pdf (B-LTA); check with verify_pdf ltv:true
  • Encrypt / decrypt → encrypt_pdf / decrypt_pdf (both rebuild the page tree: signatures + AcroForm are dropped)
  • Combine / carve → merge_pdfs (many → one), split_pdf (one → many), extract_pages (subset → one)
  • Facts / CI assertions → inspect_pdf (check:[…]); signatures → verify_pdf; PDF/UA structure → validate_pdf; text → extract_text
  • Propose an upstream change → draft_governance_issue (local draft, never submitted)

NETWORK POLICY & HUMAN-IN-THE-LOOP:
  • No outbound network by default. The only possible egress goes to OPERATOR-configured endpoints: an RFC 3161 TSA (PDFNATIVE_MCP_TSA_URL — sign_pdf timestamp:true, timestamp_pdf) and OCSP/CRL responders (PDFNATIVE_MCP_REVOCATION + allow-list PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS — add_ltv mode:'online'). Tool arguments can never carry a URL. Unconfigured → TSA_NOT_CONFIGURED / REVOCATION_NOT_CONFIGURED. Current policy: ${describeNetworkPolicy()}.
  • This server is a DRAFTSMAN: no GitHub write path. draft_governance_issue returns a draft + compliance report — show both to the user, then STOP; a human submits. Never propose a runtime dependency (GOVERNANCE_VIOLATION).

COMMON PITFALLS:
  • Page indices and ranges are 0-based everywhere (pages, ranges.start/end, annotations[].page, pageIndex); only viewerPreferences.printPageRange is 1-based (PDF spec).
  • Keys and certificates are DER base64, never PEM: openssl x509 -in cert.pem -outform DER | base64 -w0; openssl pkey -in key.pem -outform DER | base64 -w0 (RSA PKCS#1 or PKCS#8, EC SEC1 or PKCS#8). pdfBase64 is the raw PDF, not a data: URI.
  • PDF/A claim ≠ PDF/A validity: Latin text uses the unembedded base-14 Helvetica unless embedFonts:true (add_international_text always embeds). Pass embedFonts:true with pdfA for a claim veraPDF accepts; strict:true fails instead of producing a non-conformant file; includeDiagnostics:true echoes the engine diagnostics. pdfa2b is the most compatible level; attachments need pdfa3b; an unsigned placeholder is only conformant once signed.
  • Page-tree tools (merge / split / extract) and encrypt / decrypt drop signatures and AcroForm; page-tree tools also drop XMP (re-declare PDF/A on generation); page boxes survive. To READ an encrypted PDF pass password to the read tools instead of decrypting.
  • inspect_pdf check:'signed' is structural (a signed field exists) — use verify_pdf for validity. checks lists only the keys you requested.
  • verbosity:'summary' keeps scalars (inspect: docTimestampCount/trapped/checksPassed when present; verify: ltvLevel with ltv:true) and drops arrays; use fields:[…] for dot-path projection — unmatched paths are reported in _meta.unmatchedFields.
  • Signer metadata (name, reason, location, contactInfo, signingTime) is frozen at placeholder time: set it on sign_pdf (auto-inject) or on prepare_signature_placeholder, not afterwards. Several unsigned placeholders → fieldName; extra signature → allowMultiple:true + new fieldName.
  • outputMode:'file' needs PDFNATIVE_MCP_OUTPUT_DIR on the host (SECURITY_VIOLATION otherwise); paths are relative, .pdf, no '..'. With the opt-in response cache a hit carries _meta.cached:true (earlier bytes, same inputs).
  • Barcode data is the raw payload (never URL-encode); ecLevel applies to qr only; ean13 needs 12–13 digits.

REPRODUCIBILITY: outputs differ on every call because /CreationDate (and /ID) follow the wall clock. For byte-identical output pass creationDate (document tools), signingTime (sign_pdf / prepare_signature_placeholder) and modDate (update_metadata) as fixed ISO-8601 instants — identical on the same host time zone. Timestamps (TSA tokens) are inherently fresh.

TOKEN-FRUGAL READS & RESOURCES: read tools accept verbosity:'summary' and fields:[…]. Generated PDFs arrive as an embedded resource block (not duplicated in structuredContent); in file mode the result carries a resource_link and the file is listed under resources/list as pdfnative://output/<path>. Prompts: governance_contract, draft_issue_workflow, pades_ladder, print_ready, reproducible_output, pdfa_valid. Docs: docs/AI_GUIDE.md, docs/guides/*.md.`;

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
        // Presence-gated scalars survive the summary: they are the signal an agent asked for.
        ...(output.docTimestampCount !== undefined ? { docTimestampCount: output.docTimestampCount } : {}),
        ...(output.trapped !== undefined ? { trapped: output.trapped } : {}),
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
        ...projectionMeta(full, summary, input),
    };
}

function buildVerifyResult(output: VerifyPdfResult, toolName: string, input: unknown): CallToolResult {
    const full = output as unknown as Record<string, unknown>;
    const summary: Record<string, unknown> = {
        signatureCount: output.signatureCount,
        allValid: output.allValid,
        invalid: output.signatures.filter((s) => !s.valid).length,
        summary: output.summary,
        ...(output.ltvLevel !== undefined ? { ltvLevel: output.ltvLevel } : {}),
    };
    return {
        content: [{ type: 'text', text: `${toolName}: ${output.summary}` }],
        structuredContent: projectStructured(full, summary, input),
        ...projectionMeta(full, summary, input),
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
        ...projectionMeta(full, summary, input),
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
        ...projectionMeta(full, summary, input),
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
        ...projectionMeta(full, summary, input),
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
        ...projectionMeta(full, summary, input),
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

const PADES_LADDER_RECIPE = `PAdES ladder with pdfnative-mcp (ETSI EN 319 142-1):
1. B-B — sign_pdf { pdfBase64, algorithm:'rsa-sha256' | 'rsa-sha384' | 'rsa-sha512' | 'ecdsa-sha256', certDerBase64, certChainDerBase64:[intermediates], rsaKeyPkcs1DerBase64 | ecPrivateKeyDerBase64, profile:'pades', signerName, reason, signingTime }. Keys/certs are DER base64 (openssl … -outform DER | base64 -w0). The placeholder is injected automatically.
2. B-T — same call with timestamp:true. Requires the operator to set PDFNATIVE_MCP_TSA_URL (and PDFNATIVE_MCP_TSA_AUTH if the TSA needs it); otherwise TSA_NOT_CONFIGURED and no network request is made.
3. B-LT — add_ltv { pdfBase64 }. mode:'online' (default) needs PDFNATIVE_MCP_REVOCATION=online + PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS listing the OCSP/CRL hosts; mode:'offline' takes certificatesDerBase64 / ocspResponsesDerBase64 / crlsDerBase64 you exported yourself (zero network). Existing /DSS is merged.
4. B-LTA — timestamp_pdf { pdfBase64 } (operator TSA again). Re-run before the TSA certificate expires to extend the chain.
Verify at any step: verify_pdf { pdfBase64, ltv:true, trustedRootsDerBase64:[root] } → signatures[].profile / timestamp / revocation and ltvLevel ('B-B' | 'B-T' | 'B-LT' | 'B-LTA'). Caveats: revocation status is read from embedded /DSS material only; TSA trust is evaluated only when its root is in trustedRootsDerBase64. Keep the document unencrypted until the ladder is complete (encryption rebuilds the page tree and drops signatures).`;

const PRINT_READY_RECIPE = `Print-ready output with any document tool (generate_basic_pdf, add_table, add_chart, …):
• print: { bleed: 8.5 } (3 mm; TrimBox = MediaBox inset, BleedBox = MediaBox) or explicit trimBox / bleedBox / artBox / cropBox as [x0, y0, x1, y1] points; marks: true (or { crop, registration, length, offset, weight }) needs a TrimBox; userUnit for pages over 14400 pt (raises the header to PDF 1.7, not allowed under pdfa1b).
• metadata: { author, subject, keywords, trapped:'True' | 'False' | 'Unknown' } → /Info (+ XMP under PDF/A).
• outputIntent: { iccProfileBase64 (RGB ICC), outputConditionIdentifier:'sRGB IEC61966-2.1', registryName?, outputCondition?, info? } replaces the built-in sRGB intent under PDF/A; CMYK profiles are rejected (PRINT_ERROR).
• viewerPreferences: { duplex:'DuplexFlipLongEdge', pickTrayByPDFSize:true, printPageRange:[[1, 4]], numCopies:2 } for print-dialog defaults (printPageRange is 1-based).
• Check the result with inspect_pdf { pages:true } (trimBox / bleedBox / artBox / cropBox / userUnit per page) and check:['trapped'].
• Page boxes and /UserUnit survive merge_pdfs / split_pdf / extract_pages; XMP and PDF/A claims do not.`;

const REPRODUCIBLE_OUTPUT_RECIPE = `Byte-identical output across calls:
• Document tools: pin creationDate:'2026-01-15T09:00:00Z' (ISO-8601). /CreationDate, XMP dates and the /ID are then derived from the inputs only. Two calls with identical inputs return identical base64 (same host time zone — the engine serialises the instant in local time).
• prepare_signature_placeholder: also pin signingTime (the /Sig /M entry is frozen at placeholder time). sign_pdf: pin signingTime; the CMS signature is deterministic for RSA, but ECDSA signatures are randomised by design and RFC 3161 timestamps (timestamp:true, timestamp_pdf) are always fresh.
• update_metadata: pin modDate. encrypt_pdf / decrypt_pdf: never reproducible (fresh IV / salt) and never cached.
• Proof: call twice and compare structuredContent.sizeBytes and the resource blob, or hash the bytes on the host. With PDFNATIVE_MCP_CACHE_DIR set, a repeated call may be served from cache (_meta.cached:true) — the bytes are the earlier render.`;

const PDFA_VALID_RECIPE = `A PDF/A claim that a reference validator (veraPDF) accepts:
1. Choose the level: pdfa2b (widest compatibility), pdfa2u (Unicode mapping guaranteed), pdfa1b (simple text + images; no transparency, no /UserUnit), pdfa3b only when embedding files (add_attachment sets it automatically).
2. ALWAYS pass embedFonts:true on Latin document tools — without it text is rendered through the unembedded base-14 Helvetica and the claim fails ISO 19005 §6.2.11.4.1 (PDFA_NO_FONT_ENTRIES). add_international_text always embeds its fonts.
3. Use strict:true to make the call fail (PDF_A_COMPLIANCE_VIOLATION) instead of producing a non-conformant file, or includeDiagnostics:true to read the engine diagnostics in structuredContent.diagnostics.
4. Avoid watermark opacity < 1 under pdfa1b; keep encryption off (mutually exclusive with PDF/A); prefer a custom outputIntent only with an RGB ICC profile.
5. inspect_pdf reports the CLAIM (pdfA:'2B'), not its validity; validate_pdf checks PDF/UA structure, not PDF/A. An unsigned signature placeholder (prepare_signature_placeholder) is not yet conformant — it becomes conformant once signed with sign_pdf profile:'pades'.
6. merge_pdfs / split_pdf / extract_pages drop the XMP packet: re-declare PDF/A on the generating tools, not after carving.`;


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
    {
        name: 'pades_ladder',
        title: 'PAdES ladder B-B → B-LTA',
        description: 'Step-by-step recipe to sign a PDF and raise it to PAdES B-T / B-LT / B-LTA with this server, including what the operator must configure and how to verify each level.',
        text: PADES_LADDER_RECIPE,
    },
    {
        name: 'print_ready',
        title: 'Print-ready PDF (bleed, marks, OutputIntent)',
        description: 'Recipe for a press-ready document: page boxes / bleed, printer marks, /UserUnit, metadata and a custom OutputIntent, with the PDF/A interactions that matter.',
        text: PRINT_READY_RECIPE,
    },
    {
        name: 'reproducible_output',
        title: 'Byte-identical, reproducible output',
        description: 'How to obtain the same bytes from repeated calls: which inputs to pin (creationDate, signingTime, modDate), what stays non-deterministic (timestamps, encryption), and how to prove it.',
        text: REPRODUCIBLE_OUTPUT_RECIPE,
    },
    {
        name: 'pdfa_valid',
        title: 'PDF/A that veraPDF accepts',
        description: 'Recipe for a PDF/A claim that passes a reference validator: embedFonts, strict diagnostics, level choice, attachments under PDF/A-3, and what inspect_pdf can and cannot tell you.',
        text: PDFA_VALID_RECIPE,
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
        const cacheable = isCacheable(name, input);
        const cacheKey = cacheable ? { tool: name, apiVersion: CACHE_API_VERSION } : null;
        if (cacheKey !== null) {
            const hit = getCached<unknown>(cacheKey.tool, cacheKey.apiVersion, input);
            if (hit !== null) {
                // Tell the agent the bytes were not freshly rendered (additive; only on hits).
                const result = dispatchOutput(hit, name, input);
                return { ...result, _meta: { ...(result._meta ?? {}), cached: true } };
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
        { name: SERVER_NAME, version: SERVER_VERSION, title: SERVER_TITLE, description: SERVER_DESCRIPTION, websiteUrl: SERVER_WEBSITE_URL },
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
        const tool = TOOL_INDEX.get(name);
        if (tool === undefined) {
            // MCP 2026-07-28 server/tools §Error Handling: "Unknown tool" is a protocol
            // error (-32602), not an `isError` execution result.
            throw new ProtocolError(ProtocolErrorCode.InvalidParams, `[UNKNOWN_TOOL] Unknown tool: ${name}`);
        }
        const result = await callToolDirect(name, args);
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

export const __serverMetadata = { name: SERVER_NAME, version: SERVER_VERSION, title: SERVER_TITLE, description: SERVER_DESCRIPTION, websiteUrl: SERVER_WEBSITE_URL } as const;
export const __serverInstructions = SERVER_INSTRUCTIONS;
