/**
 * scripts/lib/synthetic-icc.ts — the ICC profiles the corpus, the examples
 * and the tests embed instead of a licensed press profile.
 *
 * pdfnative 1.9.0 exports `buildSyntheticGrayProfile()` and
 * `buildSyntheticCmykProfile()` from `pdfnative/tools` (#86); the server's
 * copies are ports of the same code, so the bytes must agree — the day they
 * drift, the samples that embed them would move for a reason nobody chose.
 */
import { buildSyntheticCmykProfile as engineCmyk, buildSyntheticGrayProfile as engineGray } from 'pdfnative/tools';
import { describe, expect, it } from 'vitest';

import { buildMinimalRgbIccProfile, buildSyntheticCmykProfile, buildSyntheticGrayProfile, iccBase64 } from '../../scripts/lib/synthetic-icc.js';

const u32 = (b: Uint8Array, at: number): number => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));

describe('synthetic ICC profiles', () => {
    it.each([
        ['Gray v2', () => buildSyntheticGrayProfile(), 'GRAY', 'XYZ ', 0x02100000],
        ['Gray v4', () => buildSyntheticGrayProfile({ version: 4 }), 'GRAY', 'XYZ ', 0x04200000],
        ['CMYK', () => buildSyntheticCmykProfile(), 'CMYK', 'Lab ', 0x02100000],
    ])('%s is a structurally valid output profile', (_label, build, space, pcs, version) => {
        const p = build();
        expect(u32(p, 0)).toBe(p.length); // declared size == bytes
        expect(ascii(p, 36, 4)).toBe('acsp');
        expect(ascii(p, 12, 4)).toBe('prtr');
        expect(ascii(p, 16, 4)).toBe(space);
        expect(ascii(p, 20, 4)).toBe(pcs);
        expect(u32(p, 8)).toBe(version);
    });

    it('the RGB profile is a display-class (mntr) profile, base64-encoded', () => {
        const p = new Uint8Array(Buffer.from(buildMinimalRgbIccProfile(), 'base64'));
        expect(ascii(p, 36, 4)).toBe('acsp');
        expect(ascii(p, 12, 4)).toBe('mntr');
        expect(ascii(p, 16, 4)).toBe('RGB ');
    });

    it('is deterministic: the same bytes on every call', () => {
        expect(iccBase64(buildSyntheticCmykProfile())).toBe(iccBase64(buildSyntheticCmykProfile()));
        expect(iccBase64(buildSyntheticGrayProfile())).toBe(iccBase64(buildSyntheticGrayProfile()));
        expect(buildMinimalRgbIccProfile()).toBe(buildMinimalRgbIccProfile());
    });

    it('matches the profiles pdfnative 1.9.0 exports from pdfnative/tools, byte for byte', () => {
        expect(Buffer.from(buildSyntheticCmykProfile()).equals(Buffer.from(engineCmyk()))).toBe(true);
        expect(Buffer.from(buildSyntheticGrayProfile()).equals(Buffer.from(engineGray()))).toBe(true);
    });
});
