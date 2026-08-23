/**
 * Minimal CMS / PKCS#7 SignedData parser used by `verify_pdf`.
 *
 * Walks the ASN.1 tree produced by pdfnative's exported `derDecode()` and
 * extracts the bits needed to verify a PAdES Baseline / adbe.pkcs7.detached
 * signature:
 *
 *   - the signer certificate (selected from `certificates [0]` by matching
 *     SignerInfo.sid's serial number — RFC 5652 imposes no order)
 *   - the digest + signature algorithm OIDs
 *   - the signed attributes blob (raw DER), if present, so the verifier can
 *     re-encode it as a SET for hashing
 *   - the `messageDigest` signed attribute value
 *   - the signature value bytes
 *   - the PAdES markers: ESS signing-certificate-v2 and an RFC 3161 signature
 *     timestamp token carried as an unsigned attribute
 *
 * Supports RSA with SHA-256/384/512 and ECDSA-P256 with SHA-256, matching the
 * algorithms `sign_pdf` is able to produce (digest agility since v1.6.0).
 */
import { derDecode } from 'pdfnative';

import { ToolError } from './errors.js';

export type CmsAlgorithm = 'rsa-sha256' | 'rsa-sha384' | 'rsa-sha512' | 'ecdsa-sha256';
export type CmsDigest = 'sha256' | 'sha384' | 'sha512';

export interface ParsedCms {
    readonly algorithm: CmsAlgorithm;
    /** Digest used for the ByteRange hash and the signed-attributes hash. */
    readonly digestAlgorithm: CmsDigest;
    readonly signerCertDer: Uint8Array;
    /** Every certificate carried in `certificates [0]` (signer first), raw DER. */
    readonly certificatesDer: readonly Uint8Array[];
    readonly signedAttrsValueDer: Uint8Array | null;
    readonly messageDigest: Uint8Array | null;
    readonly signatureValue: Uint8Array;
    /** PAdES profile marker: ESS signing-certificate-v2 (RFC 5035) present in signedAttrs. */
    readonly hasEssSigningCertV2: boolean;
    /** Raw DER of the RFC 3161 TimeStampToken (id-aa-signatureTimeStampToken), when present. */
    readonly signatureTimestampTokenDer: Uint8Array | null;
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
const OID_SHA384_RSA = '1.2.840.113549.1.1.12';
const OID_SHA512_RSA = '1.2.840.113549.1.1.13';
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_SHA384 = '2.16.840.1.101.3.4.2.2';
const OID_SHA512 = '2.16.840.1.101.3.4.2.3';
const OID_ESS_SIGNING_CERT_V2 = '1.2.840.113549.1.9.16.2.47';
const OID_SIGNATURE_TIMESTAMP_TOKEN = '1.2.840.113549.1.9.16.2.14';
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';

/** Indexed child of a DER node; a missing child means the structure is shorter than CMS requires. */
function child(children: readonly DerNode[], index: number, what: string): DerNode {
    const node = children[index];
    if (node === undefined) throw new ToolError('CMS_PARSE_FAILED', `${what}: expected element ${index} (structure has ${children.length})`);
    return node;
}

/** Byte at `index`; the caller has already checked the length. */
function byteAt(bytes: Uint8Array, index: number): number {
    const b = bytes[index];
    if (b === undefined) throw new ToolError('CMS_PARSE_FAILED', `unexpected end of data at byte ${index}`);
    return b;
}

function decodeOid(value: Uint8Array): string {
    if (value.length === 0) throw new ToolError('CMS_PARSE_FAILED', 'empty OID');
    const first = byteAt(value, 0);
    const parts: string[] = [String(Math.floor(first / 40)), String(first % 40)];
    let acc = 0n;
    for (let i = 1; i < value.length; i++) {
        const b = byteAt(value, i);
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
        const oidNode = child(attr.children, 0, 'Attribute');
        if (oidNode.tag !== 0x06) continue;
        if (decodeOid(oidNode.value) !== oid) continue;
        const setNode = child(attr.children, 1, 'Attribute');
        if (setNode.tag !== 0x31 || setNode.children.length === 0) continue;
        return child(setNode.children, 0, 'Attribute values');
    }
    return null;
}

function digestFromOid(oid: string): CmsDigest {
    if (oid === OID_SHA256) return 'sha256';
    if (oid === OID_SHA384) return 'sha384';
    if (oid === OID_SHA512) return 'sha512';
    throw new ToolError('CMS_PARSE_FAILED', `unsupported digest algorithm OID ${oid}`);
}

/**
 * Resolve the signature algorithm. `rsaEncryption` (the common PKCS#7 form)
 * carries no digest, so the SignerInfo digestAlgorithm decides.
 */
function algorithmFromOid(oid: string, digest: CmsDigest): CmsAlgorithm {
    if (oid === OID_SHA256_RSA) return 'rsa-sha256';
    if (oid === OID_SHA384_RSA) return 'rsa-sha384';
    if (oid === OID_SHA512_RSA) return 'rsa-sha512';
    if (oid === OID_RSA_ENCRYPTION) return digest === 'sha384' ? 'rsa-sha384' : digest === 'sha512' ? 'rsa-sha512' : 'rsa-sha256';
    if (oid === OID_ECDSA_SHA256 || oid === OID_EC_PUBLIC_KEY) {
        if (digest !== 'sha256') throw new ToolError('CMS_PARSE_FAILED', `ECDSA with ${digest} is not supported (P-256/SHA-256 only)`);
        return 'ecdsa-sha256';
    }
    throw new ToolError('CMS_PARSE_FAILED', `unsupported signature algorithm OID ${oid}`);
}

/** Serial number of a DER Certificate: tbsCertificate → [version?] → serialNumber INTEGER. */
function certificateSerial(certNode: DerNode): Uint8Array | null {
    const tbs = certNode.children[0];
    if (tbs === undefined || tbs.tag !== 0x30) return null;
    const first = tbs.children[0];
    const serial = first !== undefined && first.tag === 0xa0 ? tbs.children[1] : first;
    return serial !== undefined && serial.tag === 0x02 ? serial.value : null;
}

/** Select the signer certificate by matching SignerInfo.sid (issuerAndSerialNumber) against the carried certificates. */
function pickSignerCert(certNodes: readonly DerNode[], sidNode: DerNode, cms: Uint8Array): Uint8Array {
    if (sidNode.tag === 0x30) {
        const serialNode = sidNode.children[1];
        if (serialNode !== undefined && serialNode.tag === 0x02) {
            for (const c of certNodes) {
                const serial = certificateSerial(c);
                if (serial !== null && serial.length === serialNode.value.length && serial.every((b, i) => b === serialNode.value[i])) {
                    return rawBytes(c, cms);
                }
            }
        }
    }
    return rawBytes(child(certNodes, 0, 'certificates'), cms);
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
    const ciOid = child(contentInfo.children, 0, 'ContentInfo');
    expectTag(ciOid, 0x06, 'ContentInfo.contentType');
    if (decodeOid(ciOid.value) !== OID_SIGNED_DATA) {
        throw new ToolError('CMS_PARSE_FAILED', 'ContentInfo is not SignedData');
    }
    const explicitWrap = child(contentInfo.children, 1, 'ContentInfo');
    if (explicitWrap.tag !== 0xa0 || explicitWrap.children.length === 0) {
        throw new ToolError('CMS_PARSE_FAILED', 'ContentInfo: missing [0] EXPLICIT');
    }
    const signedData = child(explicitWrap.children, 0, 'ContentInfo [0]');
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
        const node = child(sdChildren, cursor, 'SignedData');
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
    const signerInfos = child(sdChildren, cursor, 'SignedData');
    if (signerInfos.tag !== 0x31 || signerInfos.children.length === 0) {
        throw new ToolError('CMS_PARSE_FAILED', 'SignedData: empty signerInfos');
    }
    if (certsNode === null || certsNode.children.length === 0) {
        throw new ToolError('CMS_PARSE_FAILED', 'SignedData: no signer certificate');
    }
    const certNodes = certsNode.children.filter((c) => c.tag === 0x30);
    if (certNodes.length === 0) {
        throw new ToolError('CMS_PARSE_FAILED', 'SignedData: no signer certificate');
    }
    const certificatesDer = certNodes.map((c) => rawBytes(c, cms));

    const signerInfo = child(signerInfos.children, 0, 'SignerInfos');
    expectTag(signerInfo, 0x30, 'SignerInfo');
    if (signerInfo.children.length < 5) {
        throw new ToolError('CMS_PARSE_FAILED', 'SignerInfo: insufficient fields');
    }
    // version, sid, digestAlgorithm, [signedAttrs?], signatureAlgorithm, signature, [unsignedAttrs?]
    let siCursor = 0;
    siCursor++; // version
    const sidNode = child(signerInfo.children, siCursor++, 'SignerInfo'); // IssuerAndSerialNumber (SEQUENCE) or [0] SubjectKeyIdentifier
    // RFC 5652 imposes no order on `certificates`: pick the one whose serial number
    // matches SignerInfo.sid (fall back to the first certificate for SKI-form sids).
    const signerCertDer = pickSignerCert(certNodes, sidNode, cms);
    const digestAlgNode = child(signerInfo.children, siCursor++, 'SignerInfo');
    expectTag(digestAlgNode, 0x30, 'SignerInfo.digestAlgorithm');
    const digestOidNode = digestAlgNode.children[0];
    if (digestOidNode === undefined || digestOidNode.tag !== 0x06) {
        throw new ToolError('CMS_PARSE_FAILED', 'digestAlgorithm missing OID');
    }
    const digestAlgorithm = digestFromOid(decodeOid(digestOidNode.value));

    let signedAttrsValueDer: Uint8Array | null = null;
    let messageDigest: Uint8Array | null = null;
    let hasEssSigningCertV2 = false;
    const maybeSignedAttrs = child(signerInfo.children, siCursor, 'SignerInfo');
    if (maybeSignedAttrs.tag === 0xa0) {
        // [0] IMPLICIT SET OF Attribute — value bytes are concatenated Attribute SEQUENCEs.
        // `derDecode` does not populate `.value` for constructed nodes, so slice the
        // content range out of `cms` using the first/last child offsets.
        if (maybeSignedAttrs.children.length > 0) {
            const firstChild = child(maybeSignedAttrs.children, 0, 'signedAttrs');
            const lastChild = child(maybeSignedAttrs.children, maybeSignedAttrs.children.length - 1, 'signedAttrs');
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
        hasEssSigningCertV2 = findAttribute(maybeSignedAttrs.children, OID_ESS_SIGNING_CERT_V2) !== null;
        siCursor++;
    }

    const sigAlg = child(signerInfo.children, siCursor++, 'SignerInfo');
    expectTag(sigAlg, 0x30, 'SignerInfo.signatureAlgorithm');
    if (sigAlg.children.length === 0) {
        throw new ToolError('CMS_PARSE_FAILED', 'signatureAlgorithm missing OID');
    }
    const algOidNode = child(sigAlg.children, 0, 'signatureAlgorithm');
    expectTag(algOidNode, 0x06, 'signatureAlgorithm.OID');
    const algorithm = algorithmFromOid(decodeOid(algOidNode.value), digestAlgorithm);

    const signatureNode = child(signerInfo.children, siCursor++, 'SignerInfo');
    expectTag(signatureNode, 0x04, 'SignerInfo.signature');
    const signatureValue = signatureNode.value;

    // Optional [1] IMPLICIT unsignedAttrs — where PAdES B-T parks the RFC 3161 token.
    let signatureTimestampTokenDer: Uint8Array | null = null;
    const maybeUnsigned = signerInfo.children[siCursor];
    if (maybeUnsigned !== undefined && maybeUnsigned.tag === 0xa1) {
        const tst = findAttribute(maybeUnsigned.children, OID_SIGNATURE_TIMESTAMP_TOKEN);
        if (tst !== null) signatureTimestampTokenDer = rawBytes(tst, cms);
    }

    return {
        algorithm,
        digestAlgorithm,
        signerCertDer,
        certificatesDer,
        signedAttrsValueDer,
        messageDigest,
        signatureValue,
        hasEssSigningCertV2,
        signatureTimestampTokenDer,
    };
}

/** Decode an `ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s INTEGER }`. */
export function decodeEcdsaSignature(der: Uint8Array): { r: bigint; s: bigint } {
    const root = safeDecode(der, 'ECDSA-Sig-Value');
    expectTag(root, 0x30, 'ECDSA-Sig-Value');
    if (root.children.length < 2) {
        throw new ToolError('CMS_PARSE_FAILED', 'ECDSA-Sig-Value: missing r/s');
    }
    const rNode = child(root.children, 0, 'ECDSA-Sig-Value');
    const sNode = child(root.children, 1, 'ECDSA-Sig-Value');
    expectTag(rNode, 0x02, 'ECDSA-Sig-Value.r');
    expectTag(sNode, 0x02, 'ECDSA-Sig-Value.s');
    return { r: asn1Int(rNode.value), s: asn1Int(sNode.value) };
}

function asn1Int(bytes: Uint8Array): bigint {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    return n;
}
