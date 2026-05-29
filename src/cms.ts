/**
 * Minimal CMS / PKCS#7 SignedData parser used by `verify_pdf`.
 *
 * Walks the ASN.1 tree produced by pdfnative's exported `derDecode()` and
 * extracts the bits needed to verify a PAdES Baseline / adbe.pkcs7.detached
 * signature:
 *
 *   - the signer certificate (first cert in the `certificates [0]` field)
 *   - the digest + signature algorithm OIDs
 *   - the signed attributes blob (raw DER), if present, so the verifier can
 *     re-encode it as a SET for hashing
 *   - the `messageDigest` signed attribute value
 *   - the signature value bytes
 *
 * Only RSA-SHA256 and ECDSA-SHA256 are supported in v1.0.0, matching the
 * algorithms `sign_pdf` is able to produce.
 */
import { derDecode } from 'pdfnative';

import { ToolError } from './errors.js';

export type CmsAlgorithm = 'rsa-sha256' | 'ecdsa-sha256';

export interface ParsedCms {
    readonly algorithm: CmsAlgorithm;
    readonly signerCertDer: Uint8Array;
    readonly signedAttrsValueDer: Uint8Array | null;
    readonly messageDigest: Uint8Array | null;
    readonly signatureValue: Uint8Array;
}

interface DerNode {
    readonly tag: number;
    readonly value: Uint8Array;
    readonly children: readonly DerNode[];
    readonly offset: number;
    readonly totalLength: number;
}

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const OID_SHA256_RSA = '1.2.840.113549.1.1.11';
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';

function decodeOid(value: Uint8Array): string {
    if (value.length === 0) throw new ToolError('CMS_PARSE_FAILED', 'empty OID');
    const first = value[0]!;
    const parts: string[] = [String(Math.floor(first / 40)), String(first % 40)];
    let acc = 0n;
    for (let i = 1; i < value.length; i++) {
        const b = value[i]!;
        acc = (acc << 7n) | BigInt(b & 0x7f);
        if ((b & 0x80) === 0) {
            parts.push(acc.toString());
            acc = 0n;
        }
    }
    return parts.join('.');
}

function expectTag(node: DerNode, tag: number, label: string): void {
    if (node.tag !== tag) {
        throw new ToolError('CMS_PARSE_FAILED', `${label}: expected tag 0x${tag.toString(16)}, got 0x${node.tag.toString(16)}`);
    }
}

function safeDecode(bytes: Uint8Array, label: string): DerNode {
    try {
        return derDecode(bytes) as DerNode;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ToolError('CMS_PARSE_FAILED', `${label}: ${msg}`);
    }
}

function rawBytes(node: DerNode, source: Uint8Array): Uint8Array {
    return source.subarray(node.offset, node.offset + node.totalLength);
}

function findAttribute(attrs: readonly DerNode[], oid: string): DerNode | null {
    for (const attr of attrs) {
        if (attr.tag !== 0x30 || attr.children.length < 2) continue;
        const oidNode = attr.children[0]!;
        if (oidNode.tag !== 0x06) continue;
        if (decodeOid(oidNode.value) !== oid) continue;
        const setNode = attr.children[1]!;
        if (setNode.tag !== 0x31 || setNode.children.length === 0) continue;
        return setNode.children[0]!;
    }
    return null;
}

function algorithmFromOid(oid: string): CmsAlgorithm {
    if (oid === OID_SHA256_RSA || oid === OID_RSA_ENCRYPTION) return 'rsa-sha256';
    if (oid === OID_ECDSA_SHA256 || oid === OID_EC_PUBLIC_KEY) return 'ecdsa-sha256';
    throw new ToolError('CMS_PARSE_FAILED', `unsupported signature algorithm OID ${oid}`);
}

/**
 * Re-encodes a `[0] IMPLICIT SET` of signed attributes as an explicit SET
 * (`tag 0x31`) — the bytes that were actually digested during signing.
 */
export function reencodeSignedAttrsAsSet(implicitBytes: Uint8Array): Uint8Array {
    const len = implicitBytes.length;
    let header: Uint8Array;
    if (len < 0x80) {
        header = new Uint8Array([0x31, len]);
    } else if (len <= 0xff) {
        header = new Uint8Array([0x31, 0x81, len]);
    } else if (len <= 0xffff) {
        header = new Uint8Array([0x31, 0x82, (len >> 8) & 0xff, len & 0xff]);
    } else if (len <= 0xffffff) {
        header = new Uint8Array([0x31, 0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
    } else {
        header = new Uint8Array([0x31, 0x84, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
    }
    const out = new Uint8Array(header.length + len);
    out.set(header, 0);
    out.set(implicitBytes, header.length);
    return out;
}

/**
 * Parses a detached CMS SignedData blob extracted from a PAdES `/Contents`
 * field. Throws `ToolError('CMS_PARSE_FAILED')` on any structural mismatch.
 */
export function parseCmsSignedData(cms: Uint8Array): ParsedCms {
    const contentInfo = safeDecode(cms, 'ContentInfo');
    expectTag(contentInfo, 0x30, 'ContentInfo');
    if (contentInfo.children.length < 2) {
        throw new ToolError('CMS_PARSE_FAILED', 'ContentInfo: missing children');
    }
    const ciOid = contentInfo.children[0]!;
    expectTag(ciOid, 0x06, 'ContentInfo.contentType');
    if (decodeOid(ciOid.value) !== OID_SIGNED_DATA) {
        throw new ToolError('CMS_PARSE_FAILED', 'ContentInfo is not SignedData');
    }
    const explicitWrap = contentInfo.children[1]!;
    if (explicitWrap.tag !== 0xa0 || explicitWrap.children.length === 0) {
        throw new ToolError('CMS_PARSE_FAILED', 'ContentInfo: missing [0] EXPLICIT');
    }
    const signedData = explicitWrap.children[0]!;
    expectTag(signedData, 0x30, 'SignedData');
    if (signedData.children.length < 5) {
        throw new ToolError('CMS_PARSE_FAILED', 'SignedData: insufficient fields');
    }
    // version, digestAlgs, encapContent, [0] certs, signerInfos
    let cursor = 0;
    const sdChildren = signedData.children;
    cursor++; // version
    cursor++; // digestAlgorithms
    cursor++; // encapContentInfo

    // Optional certs [0] IMPLICIT, optional crls [1] IMPLICIT, then signerInfos SET
    let certsNode: DerNode | null = null;
    while (cursor < sdChildren.length) {
        const node = sdChildren[cursor]!;
        if (node.tag === 0xa0) {
            certsNode = node;
            cursor++;
            continue;
        }
        if (node.tag === 0xa1) {
            cursor++; // skip CRLs
            continue;
        }
        break;
    }
    if (cursor >= sdChildren.length) {
        throw new ToolError('CMS_PARSE_FAILED', 'SignedData: missing signerInfos');
    }
    const signerInfos = sdChildren[cursor]!;
    if (signerInfos.tag !== 0x31 || signerInfos.children.length === 0) {
        throw new ToolError('CMS_PARSE_FAILED', 'SignedData: empty signerInfos');
    }
    if (certsNode === null || certsNode.children.length === 0) {
        throw new ToolError('CMS_PARSE_FAILED', 'SignedData: no signer certificate');
    }
    const signerCertNode = certsNode.children[0]!;
    expectTag(signerCertNode, 0x30, 'Certificate');
    const signerCertDer = rawBytes(signerCertNode, cms);

    const signerInfo = signerInfos.children[0]!;
    expectTag(signerInfo, 0x30, 'SignerInfo');
    if (signerInfo.children.length < 5) {
        throw new ToolError('CMS_PARSE_FAILED', 'SignerInfo: insufficient fields');
    }
    // version, sid, digestAlgorithm, [signedAttrs?], signatureAlgorithm, signature, [unsignedAttrs?]
    let siCursor = 0;
    siCursor++; // version
    siCursor++; // sid
    siCursor++; // digestAlgorithm

    let signedAttrsValueDer: Uint8Array | null = null;
    let messageDigest: Uint8Array | null = null;
    const maybeSignedAttrs = signerInfo.children[siCursor]!;
    if (maybeSignedAttrs.tag === 0xa0) {
        // [0] IMPLICIT SET OF Attribute — value bytes are concatenated Attribute SEQUENCEs.
        // `derDecode` does not populate `.value` for constructed nodes, so slice the
        // content range out of `cms` using the first/last child offsets.
        if (maybeSignedAttrs.children.length > 0) {
            const firstChild = maybeSignedAttrs.children[0]!;
            const lastChild = maybeSignedAttrs.children[maybeSignedAttrs.children.length - 1]!;
            signedAttrsValueDer = cms.subarray(
                firstChild.offset,
                lastChild.offset + lastChild.totalLength,
            );
        } else {
            signedAttrsValueDer = new Uint8Array(0);
        }
        const md = findAttribute(maybeSignedAttrs.children, OID_MESSAGE_DIGEST);
        if (md !== null) {
            if (md.tag !== 0x04) {
                throw new ToolError('CMS_PARSE_FAILED', 'messageDigest is not OCTET STRING');
            }
            messageDigest = md.value;
        }
        siCursor++;
    }

    const sigAlg = signerInfo.children[siCursor++]!;
    expectTag(sigAlg, 0x30, 'SignerInfo.signatureAlgorithm');
    if (sigAlg.children.length === 0) {
        throw new ToolError('CMS_PARSE_FAILED', 'signatureAlgorithm missing OID');
    }
    const algOidNode = sigAlg.children[0]!;
    expectTag(algOidNode, 0x06, 'signatureAlgorithm.OID');
    const algorithm = algorithmFromOid(decodeOid(algOidNode.value));

    const signatureNode = signerInfo.children[siCursor]!;
    expectTag(signatureNode, 0x04, 'SignerInfo.signature');
    const signatureValue = signatureNode.value;

    return {
        algorithm,
        signerCertDer,
        signedAttrsValueDer,
        messageDigest,
        signatureValue,
    };
}

/** Decode an `ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s INTEGER }`. */
export function decodeEcdsaSignature(der: Uint8Array): { r: bigint; s: bigint } {
    const root = safeDecode(der, 'ECDSA-Sig-Value');
    expectTag(root, 0x30, 'ECDSA-Sig-Value');
    if (root.children.length < 2) {
        throw new ToolError('CMS_PARSE_FAILED', 'ECDSA-Sig-Value: missing r/s');
    }
    const rNode = root.children[0]!;
    const sNode = root.children[1]!;
    expectTag(rNode, 0x02, 'ECDSA-Sig-Value.r');
    expectTag(sNode, 0x02, 'ECDSA-Sig-Value.s');
    return { r: asn1Int(rNode.value), s: asn1Int(sNode.value) };
}

function asn1Int(bytes: Uint8Array): bigint {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    return n;
}
