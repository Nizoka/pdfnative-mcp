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
 * tests/scripts.test.ts; one new limit is pinned below.
 *
 * Upstream changes are proposed as local drafts (draft_governance_issue /
 * .github/drafts/issue-*.md) and submitted by a human — never by an agent.
 */
import { DEFAULT_MAX_INFLATE_OUTPUT, setMaxInflateOutputSize } from 'pdfnative';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MAX_INFLATE_ENV, MAX_INFLATE_MIN_BYTES, applyInflateCap } from '../src/inflate-cap.js';
import { ensureCompressionReady } from '../src/server.js';
import { addForm } from '../src/tools/add-form.js';
import { extractText } from '../src/tools/extract-text.js';
import { fillFormTool as fillForm } from '../src/tools/fill-form.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { readFormFieldsTool as readFormFields } from '../src/tools/read-form-fields.js';

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

describe('blocked upstream (pdfnative 1.9.0)', () => {
    // Follow-up when it lands: delete the marker and move the ROADMAP item; the
    // read side (readFormFields → decodePdfTextString) is already in place.
    it.fails('fill_form round-trips a non-Latin-1 value under nonWinAnsi:needAppearances (the engine writes the low bytes of /V)', async () => {
        const VALUE = 'Zürich — Ωmega 漢字';
        const form = await addForm({ title: 'F', fields: [{ fieldType: 'text', name: 'city', label: 'City' }] });
        const filled = await fillForm({ pdfBase64: form.base64!, values: { city: VALUE }, nonWinAnsi: 'needAppearances' });
        const fields = (await readFormFields({ pdfBase64: filled.base64! })) as unknown as { fields: Array<{ name: string; value: unknown }> };
        // Today: 'Zürich \u0014 ©mega "W' — each UTF-16 code unit reduced to its low byte.
        expect(fields.fields.find((f) => f.name === 'city')?.value).toBe(VALUE);
    });
});
