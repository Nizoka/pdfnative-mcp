/**
 * Known upstream limits, pinned.
 *
 * Each `it.fails` states the behaviour this server WANTS and cannot have until
 * pdfnative changes. While the limit stands the assertion fails, so the test
 * passes; the day the engine lifts it the marker turns the suite red — delete
 * the marker, keep the assertion, and do the follow-up named in ROADMAP.md
 * ("Blocked upstream"). tests/_fixtures/engine-surface.json lists the same
 * limits under `upstreamLimits`, and tests/engine-surface.test.ts holds the
 * two together. The pdfnative-cli convention.
 *
 * Upstream changes are proposed as local drafts (draft_governance_issue /
 * .github/drafts/issue-*.md) and submitted by a human — never by an agent.
 */
import { DEFAULT_MAX_INFLATE_OUTPUT, setMaxInflateOutputSize } from 'pdfnative';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MAX_INFLATE_ENV, MAX_INFLATE_MIN_BYTES, applyInflateCap } from '../src/inflate-cap.js';
import { ensureCompressionReady } from '../src/server.js';
import { extractText } from '../src/tools/extract-text.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';

beforeAll(async () => {
    await ensureCompressionReady();
});

afterEach(() => {
    setMaxInflateOutputSize(DEFAULT_MAX_INFLATE_OUTPUT);
});

describe('blocked upstream (pdfnative 1.8.0)', () => {
    // Follow-up when it lands: drop the local P-256 verifier in src/tools/verify-pdf.ts.
    it.fails('pdfnative exports ecdsaVerifyHash', async () => {
        const engine = (await import('pdfnative')) as Record<string, unknown>;
        expect(typeof engine['ecdsaVerifyHash']).toBe('function');
    });

    // Follow-up when it lands: map the engine error through throwIfInflateCapError(), as extract_attachments does.
    it.fails('extract_text raises PDF_PARSE_FAILED when a page stream exceeds the inflate cap', async () => {
        const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40);
        const source = await generateBasicPdf({ title: 'Compressed', compress: true, blocks: Array.from({ length: 12 }, () => ({ type: 'paragraph', text: paragraph })) });
        // Sanity: the text is there under the default cap.
        expect((await extractText({ pdfBase64: source.base64! })).fullText).toContain('Lorem ipsum');

        applyInflateCap({ [MAX_INFLATE_ENV]: String(MAX_INFLATE_MIN_BYTES) });
        // Today the engine skips the stream it cannot inflate and the tool returns empty text.
        await expect(extractText({ pdfBase64: source.base64! })).rejects.toMatchObject({ code: 'PDF_PARSE_FAILED' });
    });
});
