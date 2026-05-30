/**
 * Tests for `src/cms.ts` — error paths and small helpers that aren't
 * exercised by the verify-pdf round-trip.
 */
import { describe, expect, it } from 'vitest';
import { derInteger, derOctetString, derSequence } from 'pdfnative';

import {
    decodeEcdsaSignature,
    parseCmsSignedData,
    reencodeSignedAttrsAsSet,
} from '../src/cms.js';

function bytes(...nums: number[]): Uint8Array {
    return new Uint8Array(nums);
}

describe('cms', () => {
    describe('parseCmsSignedData', () => {
        it('rejects truncated input', () => {
            expect(() => parseCmsSignedData(bytes(0x30, 0x05, 0x00, 0x00))).toThrowError(/CMS_PARSE_FAILED|ContentInfo/i);
        });

        it('rejects non-SignedData ContentInfo', () => {
            // ContentInfo with OID for "data" (1.2.840.113549.1.7.1) instead of signed-data.
            const oidData = bytes(0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01);
            const wrap = bytes(0xa0, 0x00);
            const ci = derSequence(oidData, wrap);
            expect(() => parseCmsSignedData(ci)).toThrowError(/SignedData/);
        });

        it('rejects an empty wrapper', () => {
            const oidSignedData = bytes(0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02);
            const emptyWrap = bytes(0xa0, 0x00);
            const ci = derSequence(oidSignedData, emptyWrap);
            expect(() => parseCmsSignedData(ci)).toThrowError(/missing|EXPLICIT|SignedData/);
        });
    });

    describe('reencodeSignedAttrsAsSet', () => {
        it('encodes short-form lengths', () => {
            const out = reencodeSignedAttrsAsSet(bytes(1, 2, 3));
            expect(Array.from(out)).toEqual([0x31, 3, 1, 2, 3]);
        });

        it('encodes 1-byte long-form lengths (0x80..0xff)', () => {
            const payload = new Uint8Array(0x80).fill(7);
            const out = reencodeSignedAttrsAsSet(payload);
            expect(out[0]).toBe(0x31);
            expect(out[1]).toBe(0x81);
            expect(out[2]).toBe(0x80);
            expect(out.length).toBe(3 + 0x80);
        });

        it('encodes 2-byte long-form lengths', () => {
            const payload = new Uint8Array(0x0200).fill(9);
            const out = reencodeSignedAttrsAsSet(payload);
            expect(out[0]).toBe(0x31);
            expect(out[1]).toBe(0x82);
            expect(out[2]).toBe(0x02);
            expect(out[3]).toBe(0x00);
            expect(out.length).toBe(4 + 0x0200);
        });
    });

    describe('decodeEcdsaSignature', () => {
        it('decodes a well-formed (r,s) SEQUENCE', () => {
            const der = derSequence(derInteger(7n), derInteger(11n));
            const { r, s } = decodeEcdsaSignature(der);
            expect(r).toBe(7n);
            expect(s).toBe(11n);
        });

        it('rejects a SEQUENCE that does not start with two INTEGERs', () => {
            const der = derSequence(derOctetString(bytes(1, 2)), derInteger(11n));
            expect(() => decodeEcdsaSignature(der)).toThrowError(/ECDSA-Sig-Value\.r/);
        });

        it('rejects a non-SEQUENCE root', () => {
            expect(() => decodeEcdsaSignature(bytes(0x04, 0x02, 1, 2))).toThrowError(/ECDSA-Sig-Value/);
        });
    });
});
