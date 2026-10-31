/**
 * Known upstream limits, pinned — and the ones the engine has since lifted.
 *
 * Each `it.fails` states the behaviour this server WANTS and cannot have until
 * pdfnative changes. While the limit stands the assertion fails, so the test
 * passes; the day the engine lifts it the marker turns the suite red — delete
 * the marker, keep the assertion, and do the follow-up named in ROADMAP.md
 * ("Blocked upstream"). tests/_fixtures/engine-surface.json lists the same
 * limits under `upstreamLimits`, and tests/engine-surface.test.ts holds the
 * two together. The pdfnative-cli convention.
 *
 * pdfnative 1.9.0 lifted both limits pinned at 1.8.0; the assertions stay as
 * plain tests so the behaviour cannot regress. The remaining extraction limit
 * (a Thai above vowel + tone mark pair in geometric order) is pinned in
 * tests/scripts.test.ts. No limit is pinned here at 1.9.0.
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

describe('lifted by pdfnative 1.9.0 (pinned as limits at 1.8.0)', () => {
    // verify_pdf's ECDSA path now calls the engine's verifier: the local P-256 reimplementation is gone.
    it('pdfnative exports ecdsaVerifyHash', async () => {
        const engine = (await import('pdfnative')) as Record<string, unknown>;
        expect(typeof engine['ecdsaVerifyHash']).toBe('function');
    });

    it('extract_text raises PDF_PARSE_FAILED when a page stream exceeds the inflate cap, and onStreamError:skip reads the rest', async () => {
        const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40);
        const source = await generateBasicPdf({ title: 'Compressed', compress: true, blocks: Array.from({ length: 12 }, () => ({ type: 'paragraph', text: paragraph })) });
        // Sanity: the text is there under the default cap.
        expect((await extractText({ pdfBase64: source.base64! })).fullText).toContain('Lorem ipsum');

        applyInflateCap({ [MAX_INFLATE_ENV]: String(MAX_INFLATE_MIN_BYTES) });
        // 1.9.0: PdfStreamLimitError (code PDF_STREAM_LIMIT) instead of an empty page — mapped with the operator remedy.
        await expect(extractText({ pdfBase64: source.base64! })).rejects.toMatchObject({ code: 'PDF_PARSE_FAILED', message: expect.stringContaining(MAX_INFLATE_ENV) });
        // The 1.7.0 behaviour is one opt-in away: the over-cap stream is skipped and the page reads as empty.
        const skipped = await extractText({ pdfBase64: source.base64!, onStreamError: 'skip' });
        expect(skipped.pageCount).toBeGreaterThan(0);
        expect(skipped.fullText).not.toContain('Lorem ipsum');
    });
});
