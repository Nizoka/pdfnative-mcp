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
import { type OutputResult } from './output.js';
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

// JSON import attribute (Node 22+, TS 5.3+) keeps version in lock-step with package.json.
// Hardcoded here to keep the build rootDir limited to ./src; tests assert it stays in sync.
const SERVER_VERSION = '1.0.0';
const SERVER_NAME = 'pdfnative-mcp';


/** Common output schema for tools that return a generated PDF (base64 inline or sandboxed file path). */
const PDF_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'sizeBytes'],
    properties: {
        mode: { type: 'string', enum: ['base64', 'file'] },
        sizeBytes: { type: 'integer', minimum: 0 },
        filePath: { type: 'string', description: "Absolute sandboxed file path (when mode='file')." },
        base64: { type: 'string', description: "Base64-encoded PDF bytes (when mode='base64')." },
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
    handler: (args: unknown) => Promise<OutputResult | InspectPdfResult | VerifyPdfResult>;
}

const TOOLS: readonly ToolDefinition[] = [
    {
        name: GENERATE_BASIC_PDF_NAME,
        title: 'Generate basic PDF',
        description:
            'Generate a multi-page A4 PDF from structured blocks (headings, paragraphs, lists, page breaks, spacers). Optional pdfA flag enables Tagged PDF / PDF/A-1b/2b/2u/3b output (auto-embeds Noto Sans for non-WinAnsi Latin per ISO 19005 §6.3.4). Returns the PDF as base64 by default, or writes it to a sandboxed file path when outputMode=file.',
        inputSchema: GENERATE_BASIC_PDF_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: generateBasicPdf,
    },
    {
        name: ADD_BARCODE_NAME,
        title: 'Add barcode / QR code',
        description:
            'Generate a single-page PDF embedding a barcode or QR code (formats: qr, code128, ean13, datamatrix, pdf417). Useful for tickets, labels, vouchers, inventory tags.',
        inputSchema: ADD_BARCODE_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: addBarcode,
    },
    {
        name: SIGN_PDF_NAME,
        title: 'Sign PDF (RSA / ECDSA)',
        description:
            "Apply a PAdES-compatible CMS digital signature to a PDF that already contains a /Sig placeholder. Supports RSA-SHA256 and ECDSA-SHA256 (P-256). The signer's certificate (DER) and private key material must be supplied by the caller.",
        inputSchema: SIGN_PDF_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        handler: signPdf,
    },
    {
        name: ADD_INTERNATIONAL_TEXT_NAME,
        title: 'Add international text',
        description:
            'Generate a PDF rendering text in a non-Latin script (Arabic, Hebrew, Thai, CJK, Devanagari, Bengali, Tamil, Cyrillic, Greek, Georgian, Armenian, Vietnamese, Turkish, Polish, Latin fallback) with optional emoji rendering. BiDi reordering (incl. UAX#9 isolates), Arabic harakat positioning, and OpenType shaping are handled automatically by the embedded Noto fonts. Pass `lang` as a single code or an array (e.g. ["ar","emoji"]) for multi-script runs.',
        inputSchema: ADD_INTERNATIONAL_TEXT_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: addInternationalText,
    },
    {
        name: ADD_TABLE_NAME,
        title: 'Add table / report',
        description:
            'Generate a tabular PDF report from column headers and data rows. Ideal for data exports, financial summaries, schedules, and any content that fits naturally into rows and columns. Supports v1.1 auto-fit columns and per-cell clipping.',
        inputSchema: ADD_TABLE_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
        handler: embedImage,
    },
    {
        name: PREPARE_SIGNATURE_PLACEHOLDER_NAME,
        title: 'Prepare signature placeholder',
        description:
            "Create a PDF with an embedded /Sig AcroForm placeholder ready to be digitally signed by the sign_pdf tool. Optionally accepts document body blocks and signer metadata (name, reason, location). Use this as step 1 of a two-step sign workflow: prepare → sign.",
        inputSchema: PREPARE_SIGNATURE_PLACEHOLDER_INPUT_SCHEMA,
        outputSchema: PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: prepareSignaturePlaceholder,
    },
    {
        name: INSPECT_PDF_NAME,
        title: 'Inspect PDF metadata',
        description:
            'Read-only inspection of an existing PDF: version, page count, encryption state, PDF/A claim, signature count, document info / metadata. Optional `pages` flag returns per-page sizes; optional `check` array (pdfa | signed | encrypted) ANDs assertions and reports a CI-friendly pass/fail.',
        inputSchema: INSPECT_PDF_INPUT_SCHEMA,
        outputSchema: INSPECT_PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: inspectPdf,
    },
    {
        name: VERIFY_PDF_NAME,
        title: 'Verify PDF signatures',
        description:
            'Read-only verification of every PAdES Baseline / adbe.pkcs7.detached signature in a PDF. For each /Sig widget, recomputes the ByteRange SHA-256, validates the CMS messageDigest (integrity), and verifies the CMS signatureValue with the embedded signer certificate. Optional trustedRootsDerBase64 enables chain trust (otherwise chainTrust is self-signed or unverified). Supports RSA-SHA256 and ECDSA-SHA256 (P-256).',
        inputSchema: VERIFY_PDF_INPUT_SCHEMA,
        outputSchema: VERIFY_PDF_OUTPUT_SCHEMA,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: verifyPdf,
    },
];

const TOOL_INDEX: ReadonlyMap<string, ToolDefinition> = new Map(TOOLS.map((t) => [t.name, t]));

const SERVER_INSTRUCTIONS = `pdfnative-mcp bridges the zero-dependency 'pdfnative' v1.1 library to MCP.
Available tools (10):
  • ${GENERATE_BASIC_PDF_NAME} — multi-page documents from structured blocks (headings, paragraphs, lists). Optional pdfA flag (pdfa1b/2b/2u/3b).
  • ${ADD_BARCODE_NAME} — barcodes / QR codes (tickets, labels, vouchers).
  • ${ADD_INTERNATIONAL_TEXT_NAME} — 18 scripts via embedded Noto fonts (BiDi isolates + Arabic harakat + emoji handled).
  • ${SIGN_PDF_NAME} — apply a CMS PAdES signature (RSA-SHA256 / ECDSA-SHA256 P-256) to a PDF that already has a /Sig placeholder.
  • ${ADD_TABLE_NAME} — tabular PDF reports from headers + data rows. v1.1 autoFitColumns and clipCells supported.
  • ${ADD_FORM_NAME} — interactive AcroForm PDFs (text fields, checkboxes, dropdowns).
  • ${EMBED_IMAGE_NAME} — embed a JPEG or PNG image into a PDF document.
  • ${PREPARE_SIGNATURE_PLACEHOLDER_NAME} — create a PDF with a /Sig placeholder ready for sign_pdf (step 1 of two-step signing).
  • ${INSPECT_PDF_NAME} — read-only inspection (version, pages, encryption, PDF/A claim, signature count).
  • ${VERIFY_PDF_NAME} — verify every PAdES signature in a PDF (integrity + signature value + optional chain trust).
Output is always returned as base64 unless the host has set the PDFNATIVE_MCP_OUTPUT_DIR env var, in which case outputMode='file' writes to a sandboxed path.`;

function buildInspectResult(output: InspectPdfResult, toolName: string): CallToolResult {
    return {
        content: [
            {
                type: 'text',
                text: `${toolName}: PDF v${output.version}, ${output.pageCount} page(s), encryption=${output.encryption}, pdfA=${output.pdfA ?? 'none'}, signatures=${output.signatureCount}.`,
            },
        ],
        structuredContent: output as unknown as Record<string, unknown>,
    };
}

function buildVerifyResult(output: VerifyPdfResult, toolName: string): CallToolResult {
    return {
        content: [{ type: 'text', text: `${toolName}: ${output.summary}` }],
        structuredContent: output as unknown as Record<string, unknown>,
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
                text: `${toolName}: produced ${output.sizeBytes} bytes (base64-encoded below).`,
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
            base64: output.base64,
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
            const output = await tool.handler(args ?? {});
            if ('mode' in output) {
                return buildSuccessResult(output, name);
            }
            if ('signatureCount' in output && 'allValid' in output) {
                return buildVerifyResult(output, name);
            }
            return buildInspectResult(output, name);
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
