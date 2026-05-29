/**
 * Test fixture helpers — build minimal self-signed X.509 certificates entirely
 * in-process using Node's crypto + pdfnative's DER primitives. No external
 * `openssl` dependency, no committed `.der` blobs, fully deterministic per
 * test run.
 *
 * Two flavours:
 *   - `buildRsaSelfSignedCert()` — RSA-2048 + SHA-256
 *   - `buildEcdsaSelfSignedCert()` — ECDSA P-256 + SHA-256
 *
 * The returned `{ certDer, privateKeyPem, signerCert }` triple is enough to
 * drive `signPdfBytes` end-to-end against `verify_pdf`.
 */
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

import {
    derBitString,
    derInteger,
    derOid,
    derSequence,
    parseCertificate,
    parseRsaPrivateKey,
    type EcPrivateKey,
    type RsaPrivateKey,
    type X509Certificate,
} from 'pdfnative';

import { parseEcPrivateKeyDer } from '../src/ec-key.js';

const ALG_NULL = new Uint8Array([0x05, 0x00]);

/** Encode a dotted OID (`1.2.840.113549.1.1.11`) to BER content bytes. */
function encodeOidBytes(dotted: string): Uint8Array {
    const parts = dotted.split('.').map((p) => Number(p));
    const out: number[] = [parts[0]! * 40 + parts[1]!];
    for (let i = 2; i < parts.length; i++) {
        let v = parts[i]!;
        const stack: number[] = [v & 0x7f];
        v >>>= 7;
        while (v > 0) {
            stack.push((v & 0x7f) | 0x80);
            v >>>= 7;
        }
        for (let j = stack.length - 1; j >= 0; j--) out.push(stack[j]!);
    }
    return new Uint8Array(out);
}

function oid(dotted: string): Uint8Array {
    return derOid(encodeOidBytes(dotted));
}

function derUtf8String(text: string): Uint8Array {
    const data = new TextEncoder().encode(text);
    const out = new Uint8Array(data.length + 2);
    out[0] = 0x0c;
    out[1] = data.length;
    out.set(data, 2);
    return out;
}

function derUtcTime(date: Date): Uint8Array {
    const pad = (n: number): string => String(n).padStart(2, '0');
    const s =
        String(date.getUTCFullYear()).slice(2) +
        pad(date.getUTCMonth() + 1) +
        pad(date.getUTCDate()) +
        pad(date.getUTCHours()) +
        pad(date.getUTCMinutes()) +
        pad(date.getUTCSeconds()) +
        'Z';
    const data = new TextEncoder().encode(s);
    const out = new Uint8Array(data.length + 2);
    out[0] = 0x17;
    out[1] = data.length;
    out.set(data, 2);
    return out;
}

function buildX509Name(cn: string): Uint8Array {
    // RDN = SET { ATV { OID, UTF8String } }
    const atv = derSequence(oid('2.5.4.3'), derUtf8String(cn));
    // Wrap atv in SET tag (0x31)
    const setHeader = new Uint8Array([0x31, atv.length]);
    const rdn = new Uint8Array(setHeader.length + atv.length);
    rdn.set(setHeader, 0);
    rdn.set(atv, setHeader.length);
    return derSequence(rdn);
}

function bigIntFromBytes(buf: Uint8Array): bigint {
    const padded = (buf[0]! & 0x80) !== 0
        ? Uint8Array.of(0, ...buf)
        : buf;
    let hex = '';
    for (const b of padded) hex += b.toString(16).padStart(2, '0');
    return BigInt('0x' + hex);
}

function buildRsaSpki(privateKey: KeyObject): Uint8Array {
    const jwk = privateKey.export({ format: 'jwk' });
    const n = bigIntFromBytes(Buffer.from(jwk.n!, 'base64url'));
    const e = bigIntFromBytes(Buffer.from(jwk.e!, 'base64url'));
    const rsaPubKey = derSequence(derInteger(n), derInteger(e));
    const algId = derSequence(oid('1.2.840.113549.1.1.1'), ALG_NULL);
    return derSequence(algId, derBitString(rsaPubKey));
}

function buildEcSpki(privateKey: KeyObject): Uint8Array {
    const jwk = privateKey.export({ format: 'jwk' });
    const x = Buffer.from(jwk.x!, 'base64url');
    const y = Buffer.from(jwk.y!, 'base64url');
    const point = new Uint8Array(1 + x.length + y.length);
    point[0] = 0x04;
    point.set(x, 1);
    point.set(y, 1 + x.length);
    const algId = derSequence(oid('1.2.840.10045.2.1'), oid('1.2.840.10045.3.1.7'));
    return derSequence(algId, derBitString(point));
}

export interface RsaCertFixture {
    readonly certDer: Uint8Array;
    readonly signerCert: X509Certificate;
    readonly rsaKey: RsaPrivateKey;
    readonly privateKey: KeyObject;
}

export function buildRsaSelfSignedCert(cn = 'Test RSA CA'): RsaCertFixture {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const spki = buildRsaSpki(privateKey);
    const sigAlg = derSequence(oid('1.2.840.113549.1.1.11'), ALG_NULL);
    const name = buildX509Name(cn);
    const validity = derSequence(
        derUtcTime(new Date(Date.now() - 60_000)),
        derUtcTime(new Date(Date.now() + 365 * 86_400_000)),
    );
    const tbs = derSequence(derInteger(1n), sigAlg, name, validity, name, spki);
    const sig = createSign('sha256').update(Buffer.from(tbs)).sign(privateKey);
    const certDer = derSequence(tbs, sigAlg, derBitString(new Uint8Array(sig)));
    const signerCert = parseCertificate(certDer);
    const rsaKey = parseRsaPrivateKey(new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs1' })));
    return { certDer, signerCert, rsaKey, privateKey };
}

export interface EcCertFixture {
    readonly certDer: Uint8Array;
    readonly signerCert: X509Certificate;
    readonly ecKey: EcPrivateKey;
    readonly privateKey: KeyObject;
}

export function buildEcdsaSelfSignedCert(cn = 'Test EC CA'): EcCertFixture {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const spki = buildEcSpki(privateKey);
    const sigAlg = derSequence(oid('1.2.840.10045.4.3.2'));
    const name = buildX509Name(cn);
    const validity = derSequence(
        derUtcTime(new Date(Date.now() - 60_000)),
        derUtcTime(new Date(Date.now() + 365 * 86_400_000)),
    );
    const tbs = derSequence(derInteger(1n), sigAlg, name, validity, name, spki);
    const sig = createSign('sha256').update(Buffer.from(tbs)).sign({ key: privateKey, dsaEncoding: 'der' });
    const certDer = derSequence(tbs, sigAlg, derBitString(new Uint8Array(sig)));
    const signerCert = parseCertificate(certDer);
    const d = parseEcPrivateKeyDer(new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs8' })));
    return { certDer, signerCert, ecKey: { d }, privateKey };
}
