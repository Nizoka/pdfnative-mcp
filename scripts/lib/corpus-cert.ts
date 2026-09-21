/**
 * Self-signed RSA test certificate (node:crypto + a tiny DER encoder).
 *
 * Mirrors tests/_cert-fixtures.ts without importing test code: a throwaway
 * RSA-2048 key signs a v1 certificate with CN=Corpus Signer. Generated per
 * run, never written to disk or printed — which is why the signed corpus
 * entry is fingerprinted semantically, not by bytes.
 */

import { createSign, generateKeyPairSync } from 'node:crypto';

type Part = Buffer | readonly number[];

function derLength(n: number): number[] {
    if (n < 0x80) return [n];
    const bytes: number[] = [];
    for (let v = n; v > 0; v >>>= 8) bytes.unshift(v & 0xff);
    return [0x80 | bytes.length, ...bytes];
}

function der(tag: number, ...parts: readonly Part[]): Buffer {
    const body = Buffer.concat(parts.map((p) => Buffer.from(p)));
    return Buffer.concat([Buffer.from([tag, ...derLength(body.length)]), body]);
}

const derSeq = (...parts: readonly Part[]): Buffer => der(0x30, ...parts);
const derSet = (...parts: readonly Part[]): Buffer => der(0x31, ...parts);

function derInt(buf: Buffer): Buffer {
    return der(0x02, (buf[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
}

function derOid(dotted: string): Buffer {
    const p = dotted.split('.').map(Number);
    const out = [(p[0] ?? 0) * 40 + (p[1] ?? 0)];
    for (const v0 of p.slice(2)) {
        let v = v0;
        const stack = [v & 0x7f];
        for (v >>>= 7; v > 0; v >>>= 7) stack.push((v & 0x7f) | 0x80);
        out.push(...stack.reverse());
    }
    return der(0x06, Buffer.from(out));
}

const derNull = Buffer.from([0x05, 0x00]);
const derBitString = (bytes: Buffer): Buffer => der(0x03, Buffer.from([0]), bytes);

function derUtcTime(date: Date): Buffer {
    const s = `${date.toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`;
    return der(0x17, Buffer.from(s, 'ascii'));
}

export interface SigningMaterial {
    readonly certDerBase64: string;
    readonly rsaKeyPkcs1DerBase64: string;
}

export function buildRsaSelfSignedCert(cn = 'Corpus Signer'): SigningMaterial {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = privateKey.export({ format: 'jwk' });
    const rsaPub = derSeq(derInt(Buffer.from(jwk.n ?? '', 'base64url')), derInt(Buffer.from(jwk.e ?? '', 'base64url')));
    const spki = derSeq(derSeq(derOid('1.2.840.113549.1.1.1'), derNull), derBitString(rsaPub));
    const sigAlg = derSeq(derOid('1.2.840.113549.1.1.11'), derNull);
    const name = derSeq(derSet(derSeq(derOid('2.5.4.3'), der(0x0c, Buffer.from(cn, 'utf8')))));
    const validity = derSeq(derUtcTime(new Date(Date.now() - 60_000)), derUtcTime(new Date(Date.now() + 365 * 86_400_000)));
    const tbs = derSeq(derInt(Buffer.from([1])), sigAlg, name, validity, name, spki);
    const sig = createSign('sha256').update(tbs).sign(privateKey);
    const certDer = derSeq(tbs, sigAlg, derBitString(sig));
    return {
        certDerBase64: certDer.toString('base64'),
        rsaKeyPkcs1DerBase64: privateKey.export({ format: 'der', type: 'pkcs1' }).toString('base64'),
    };
}
