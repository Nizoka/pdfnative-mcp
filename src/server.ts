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
import { initNodeCompression } from 'pdfnative';

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

// JSON import attribute (Node 22+, TS 5.3+) keeps version in lock-step with package.json.
// Hardcoded here to keep the build rootDir limited to ./src; tests assert it stays in sync.
const SERVER_VERSION = '0.2.0';
const SERVER_NAME = 'pdfnative-mcp';


interface ToolDefinition {
    name: string;
    title: string;
    description: string;
    inputSchema: unknown;
    annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
    };
    handler: (args: unknown) => Promise<OutputResult>;
}

const TOOLS: readonly ToolDefinition[] = [
    {
        name: GENERATE_BASIC_PDF_NAME,
        title: 'Generate basic PDF',
        description:
            'Generate a multi-page A4 PDF from structured blocks (headings, paragraphs, lists, page breaks, spacers). Returns the PDF as base64 by default, or writes it to a sandboxed file path when outputMode=file.',
        inputSchema: GENERATE_BASIC_PDF_INPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: generateBasicPdf,
    },
    {
        name: ADD_BARCODE_NAME,
        title: 'Add barcode / QR code',
        description:
            'Generate a single-page PDF embedding a barcode or QR code (formats: qr, code128, ean13, datamatrix, pdf417). Useful for tickets, labels, vouchers, inventory tags.',
        inputSchema: ADD_BARCODE_INPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: addBarcode,
    },
    {
        name: SIGN_PDF_NAME,
        title: 'Sign PDF (RSA / ECDSA)',
        description:
            "Apply a PAdES-compatible CMS digital signature to a PDF that already contains a /Sig placeholder. Supports RSA-SHA256 and ECDSA-SHA256 (P-256). The signer's certificate (DER) and private key material must be supplied by the caller.",
        inputSchema: SIGN_PDF_INPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        handler: signPdf,
    },
    {
        name: ADD_INTERNATIONAL_TEXT_NAME,
        title: 'Add international text',
        description:
            'Generate a PDF rendering text in a non-Latin script (Arabic, Hebrew, Thai, CJK, Devanagari, Bengali, Tamil, Cyrillic, Greek, Georgian, Armenian, Vietnamese, Turkish, Polish). BiDi reordering and OpenType shaping are handled automatically by the embedded Noto fonts.',
        inputSchema: ADD_INTERNATIONAL_TEXT_INPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: addInternationalText,
    },
    {
        name: ADD_TABLE_NAME,
        title: 'Add table / report',
        description:
            'Generate a tabular PDF report from column headers and data rows. Ideal for data exports, financial summaries, schedules, and any content that fits naturally into rows and columns.',
        inputSchema: ADD_TABLE_INPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: addTable,
    },
    {
        name: ADD_FORM_NAME,
        title: 'Add interactive form',
        description:
            'Generate a PDF containing an interactive AcroForm with text fields, text areas, checkboxes, radio buttons, and dropdowns. Suitable for data-capture forms, surveys, and fillable templates.',
        inputSchema: ADD_FORM_INPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: addForm,
    },
    {
        name: EMBED_IMAGE_NAME,
        title: 'Embed image in PDF',
        description:
            'Generate a PDF document with an embedded JPEG or PNG image. The image is accepted as a base64-encoded string and can include an optional caption and custom render dimensions.',
        inputSchema: EMBED_IMAGE_INPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: embedImage,
    },
    {
        name: PREPARE_SIGNATURE_PLACEHOLDER_NAME,
        title: 'Prepare signature placeholder',
        description:
            "Create a PDF with an embedded /Sig AcroForm placeholder ready to be digitally signed by the sign_pdf tool. Optionally accepts document body blocks and signer metadata (name, reason, location). Use this as step 1 of a two-step sign workflow: prepare → sign.",
        inputSchema: PREPARE_SIGNATURE_PLACEHOLDER_INPUT_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        handler: prepareSignaturePlaceholder,
    },
];

const TOOL_INDEX: ReadonlyMap<string, ToolDefinition> = new Map(TOOLS.map((t) => [t.name, t]));

const SERVER_INSTRUCTIONS = `pdfnative-mcp bridges the zero-dependency 'pdfnative' library to MCP.
Available tools:
  • ${GENERATE_BASIC_PDF_NAME} — multi-page documents from structured blocks (headings, paragraphs, lists).
  • ${ADD_BARCODE_NAME} — barcodes / QR codes (tickets, labels, vouchers).
  • ${ADD_INTERNATIONAL_TEXT_NAME} — non-Latin scripts via embedded Noto fonts (BiDi + shaping handled).
  • ${SIGN_PDF_NAME} — apply a CMS signature to a PDF that already has a /Sig placeholder.
  • ${ADD_TABLE_NAME} — tabular PDF reports from headers + data rows.
  • ${ADD_FORM_NAME} — interactive AcroForm PDFs (text fields, checkboxes, dropdowns).
  • ${EMBED_IMAGE_NAME} — embed a JPEG or PNG image into a PDF document.
  • ${PREPARE_SIGNATURE_PLACEHOLDER_NAME} — create a PDF with a /Sig placeholder ready for sign_pdf (step 1 of two-step signing).
Output is always returned as base64 unless the host has set the PDFNATIVE_MPC_OUTPUT_DIR env var, in which case outputMode='file' writes to a sandboxed path.`;

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
                    uri: `data:application/pdf;base64,${output.base64 ?? ''}`,
                    mimeType: 'application/pdf',
                    blob: output.base64 ?? '',
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
            return buildSuccessResult(output, name);
        } catch (err) {
            return buildErrorResult(err, name);
        }
    });

    return server;
}

let _compressionInitPromise: Promise<void> | null = null;
/**
 * Initialise pdfnative's Node-zlib compression backend exactly once. Safe to call
 * multiple times — the underlying call is idempotent and the promise is memoised.
 */
export function ensureCompressionReady(): Promise<void> {
    if (_compressionInitPromise === null) {
        _compressionInitPromise = (async () => {
            await initNodeCompression();
        })();
    }
    return _compressionInitPromise;
}

export const __serverMetadata = { name: SERVER_NAME, version: SERVER_VERSION } as const;
