/**
 * Offline mock PKI for LTV / PAdES tests — deterministic root CA, signer,
 * TSA and OCSP-responder certificates plus in-process RFC 3161 and OCSP/CRL
 * providers. Real DER, real RSA signatures, fixed pre-generated keys: zero
 * network, zero binary fixtures, byte-reproducible across runs.
 *
 * Built solely on pdfnative's public DER/crypto exports; the handful of DER
 * primitives the engine does not export (SET, NULL, UTF8String, UTCTime,
 * BOOLEAN, context tags) are hand-rolled below.
 *
 * FOR TESTS ONLY — the keys below are public by definition.
 */
import { createHash } from 'node:crypto';

import {
    addDocumentTimestamp,
    addSignaturePlaceholder,
    addValidationInfo,
    derBitString,
    derDecode,
    derGeneralizedTime,
    derInteger,
    derOctetString,
    derOid,
    derSequence,
    derSetOf,
    estimateContentsSize,
    parseCertificate,
    rsaSignHash,
    sha1,
    sha384,
    sha512,
    signPdfBytes,
    signPdfBytesWithTimestamp,
    type Asn1Node,
    type RevocationProvider,
    type RsaDigest,
    type RsaPrivateKey,
    type TimestampProvider,
    type X509Certificate,
} from 'pdfnative';

// ── Deterministic key material (RSA-2048, pre-generated — TEST ONLY) ──

const ROOT_KEY: RsaPrivateKey = {
    n: BigInt('0x9AE8E641BB96D39923C20545F2D0DBCA0F3355D5B0BAEC6EC4AE2C2831EC2B7D65B5ACECABFFC798268B32A2A5680235327972FF31EC444303B4340C21F724C3578CFBE86C094C38D51835B121938194A7B6E3ECF963B03AB81FEF190BE9D9908C7908A70B61E8701797E361FA165BC882113EE13B6E7B6491AB262130FE07804E5E689956BEA6402CFD6A2984AABF74DCE7B24668696493DDB26FADB96AB268B1196FFB4EF148835B935D787D618BEB61A8D8E98792EE27E6A7ABF9D47A758792B10B5DEB6031653119ED2280EB19387D51DEAC14BE7C4CC7D059B964B0707A1E97DCC8380DE669D58D1536AAF69702F7C818893BA04300A6E96DEF3015CE9D'),
    d: BigInt('0x87CA304CDE8B4FE0A59FA5CFB311B218654AB2AB26C83408C50F885593AD5A52099E3F7F17269767A021D4B90E15261A4BAC7A4989117AA4E3D24AED77B894D9471DA6940E5FF818B973075DC5F8EF55C7CE61ED908EFA23FED2BF5C4D3D2821B581433C6A95E092A19BDB0E3F92E9D1D1721C9482EC4DEDD2631C816BD8C1E9317FA5C58FD02582C7A64174F4FB33B33A5089057E3AF54C6811AF9F52270CDE2AA26F8BC2965FE4652515F1ACB5F6CCD7EA620F68A313463CB864DC199FFA9DA11846C26CCFC9D5F8102E8EC18CDC1D37A712983EA62E52B367002B364B757ADD390EDAD5021B551A2A43B1A8581464BF34E2A871369F48DA975F1CA2FD7D7'),
    p: BigInt('0xCD41C7BFE14222AF3B927AF5869A7840B93E1827FD6A34B1C1305B7F37C0696BF1AFCCA95573C1EC1C8981D95CDB5FDE6FECF6A804D696602D75228C028077A759FCB45719F025532E460E7D2D44DF43869465F135B115E026B8A9179E41E9FAFFEA088C98204E1084491C6B7E0F1AE3AA6753DE2AA1C220AD6DD71E2A69643B'),
    q: BigInt('0xC134C430CFB0AE676C82E2D17FDCF9AC375307A4AD845BBC311F426A2D136B9470690ECFD80A9DADEEBFBA82340FCCB60023CB2EBF38D980DA1BADAA256A0504360A4196D3A35A5DEFB1273291F2E22DA144D2BF924E42A0D00917E628704161205F6AD5D3EB3D9FC5B3354F2B01CF0EB589F88CE3B929A480AA485573802307'),
    dp: BigInt('0x773512FB9FA9B7572A34027182414841DED3EF579A580A4E8A32B99103221E97F07FF74F092FF79A57608D275E4492432FA1E206E6F871D15DD53FC12CDACBA34821F9E2F44F827DF2CC0132360E5FD469DED9EDE30EFBF378C99A7AFB10B101738BCA774D0AC60BD5A858771D794C5698EAF5CC7BDA0252D4268CDF1A26A76D'),
    dq: BigInt('0x96CAE62CEA8C8D322F60E0427EB72B2E9C677359B60BCDC54DD985EE748BE9B50B1F13EE6841B0DB65B1C29188ACA42B90645F5A76E899E9955170F3910BF42A5B3B1A01EBE05CD1601835EDA4379B0BDE08672C19B6770E281050D4D3CEF95822FA15DA19F24A407EFEE5A68A7C78EC9407C133C530692DF935EE0AB380D8D5'),
    qi: BigInt('0x927A0F6D39CFBCAFE8B5123A8B7D719EBA3FECEB7F96296A72C0A47F35364ACCC044237064938A7E9CC04F2849DD0E8C8AD8BE1061E6E57A9FCEA82A0E25D2F12AC3BEC573B12C7FD5DDF510216E3943820A5DD32B3E5F05ACFDC566AAB1836B9E14B81BC557E04FB6EA1C454CDCF3DC377BBB08E26BBD24B2D08A286413207C'),
};

const LEAF_KEY: RsaPrivateKey = {
    n: BigInt('0xC931B6D31ADB9B544B083B67FF539C5A9A37BB09E89A8D6326271CBDD658C4F3A0A2FF93E4BD33A3934C07BD15C11E21A16F57909C8E53B8570CB3A4D3BFFDEDFE7C1D87D310B4EBA719FD1B7D7CFD8895660228B0D6573681702EDAEDAAA434F1D4F11FD88F3953F32383F8AC861DB6552A42F13E0D95241310814CC06A203E12154AE610CF599A051B37F9E53110A6DDF76DC7195AE7CF582DE5077C9D6AB86102B4C5584B69826F53307E186C4701BB948BDE6678434082D71209FD7663D7CB24DFE5D721C0FB4702A183D42BA7A25E55E645147177AD5E79EE2D794D292BF797004C9C5FE357AAA782075395180C6E265EC9D981A61FF4237B8157BFC3F7'),
    d: BigInt('0x16C3139A8D9AD3D77507B0E4E2AB9C7059AB3D737107EF400CE476E9795320B12976D7706D7C045818C58CC89529FC953474EAD4B709992A2D5B0805F958EACB1EB3FF094B55440AB7248710B1A14EF3C167418E45F771F57E2E6976A655DC6F0AFF1AEA8DEF223EBFAEC073055DC505C85BD827FFEBBC7850D9D8AF0CC3D4F2CD5D4F33C9116C13542BCFA289F44C0499180E98443D635E3E282039245A7FB0766078C5CB11640BD4DE9B86FA889D6FBED99A7D1B8B883153A09EBD4626713291F9A5379D4AFB55B46402EF93FD2603EB89BECF451E6DD06336FF72C62F6EB3CC9D5E91D59912DAC2A73C303044B2627B0CC287A80AB22C66DFCC6F89C159C5'),
    p: BigInt('0xEFF7015A1E22E1E844AB9CD0BDA635BD6EA47D802AE336A2908DA1426045D25077E40588C374C2FDE3E4271CB694B3AACD25B8369985D24C95B9817A8FCEBD02A47A1D116CD407628B7FDC13609B339A8A8579A26FCA856164E280580A0B3FB4FC9D21486B53968513982A38AD59EFEE3B882710F176C2DFD1F6939F9E20F80B'),
    q: BigInt('0xD6A379002C6E1B60BE3442CFBE6E48F858BCEE058B0F240AA1BCBC805D6BABD88D6F937358BCEC87DCB6569D3B87FDF24218CEF843B297BB41A812F8E09F4453AB470ED087D68D0411A5E88CD16227087B4807EB72190B063F2F3D053FF2CC204A1F8D0AD9794061A28A50F062378B19BEFAA053158099911020CF8753B35B45'),
    dp: BigInt('0xB946C4D378DB44039B29C9CD5DF0BC23840F1B1B5F81C988610609917F55C999F9C7A40241AFA07279878A2F604596277577FF30A0FEB32E109887814311C3DC0B74818717B8E9EECB78B04A81D7B3534A4ADE6C6DD6377FC86E1DDC5BFCED76676946EE6C77C08B0563028E7A422BBF8C55869C4D637DF9645AF7065208709B'),
    dq: BigInt('0xCB652E0CD40DA334120A4425C937893E8E18BB15D5A90B6667CE0A733A14064CB7FABBA7DAB76D0D7241F7E217BFCF0DFB44B71CDC4A292EF210EBA99C7250B558E1855066E911C88150CF066284B8A878EAD1567450F6F97C76AF44824CFAD2BE6B17A4E860D679AF25937DB8151A63D36E7CEF3EB916CD38935F15C6637861'),
    qi: BigInt('0x89AE4FE4144A3C4B848F0CC9660FEA368C630C758CEFA8E315198028CFCD2A75109BAABCEC5546FF2A16BF740256C56EE4928015B6359D964988B9350922AF28FAA82609E9B31F144F04FC287B30DBD7D7BC7A614C2B67D9C101BB1835149CA7E627AF7491083A755C1999C0714FD192DD79CFA562F5428B8861019E5BFD8AAB'),
};

const RSA_E = 65537n;

// ── Local DER primitives (not exported by pdfnative) ─────────────────

const ASN1_SEQUENCE = 0x30;
const ASN1_INTEGER = 0x02;
const ASN1_OID = 0x06;
const ASN1_BOOLEAN = 0x01;

function derLength(len: number): Uint8Array {
    if (len < 0x80) return Uint8Array.of(len);
    const bytes: number[] = [];
    let v = len;
    while (v > 0) {
        bytes.unshift(v & 0xff);
        v >>>= 8;
    }
    return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

/** Generic TLV with an arbitrary tag byte. */
function derWrap(tag: number, value: Uint8Array): Uint8Array {
    const len = derLength(value.length);
    const out = new Uint8Array(1 + len.length + value.length);
    out[0] = tag;
    out.set(len, 1);
    out.set(value, 1 + len.length);
    return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}

/** SET (0x31) with the children in the given order (schema-fixed SET / single element). */
function derSet(...children: Uint8Array[]): Uint8Array {
    return derWrap(0x31, concat(children));
}

function derNull(): Uint8Array {
    return Uint8Array.of(0x05, 0x00);
}

function derBoolean(value: boolean): Uint8Array {
    return Uint8Array.of(0x01, 0x01, value ? 0xff : 0x00);
}

function derUtf8String(text: string): Uint8Array {
    return derWrap(0x0c, new TextEncoder().encode(text));
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
    return derWrap(0x17, new TextEncoder().encode(s));
}

/** [n] EXPLICIT — constructed context tag wrapping a full TLV. */
function derContextExplicit(n: number, inner: Uint8Array): Uint8Array {
    return derWrap(0xa0 | n, inner);
}

/** [n] IMPLICIT — primitive context tag carrying raw value bytes. */
function derContextImplicit(n: number, value: Uint8Array): Uint8Array {
    return derWrap(0x80 | n, value);
}

/** The full TLV bytes of a decoded node, sliced from the source buffer. */
function derRawBytes(source: Uint8Array, node: Asn1Node): Uint8Array {
    return source.subarray(node.offset, node.offset + node.totalLength);
}

function asn1Integer(node: Asn1Node): bigint {
    let hex = '';
    for (const b of node.value) hex += b.toString(16).padStart(2, '0');
    return hex.length === 0 ? 0n : BigInt('0x' + hex);
}

function sha256(input: Uint8Array): Uint8Array {
    return new Uint8Array(createHash('sha256').update(input).digest());
}

function ia5Bytes(text: string): Uint8Array {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
}

function toBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

// ── Well-known OIDs ──────────────────────────────────────────────────

const OID_CN = Uint8Array.of(0x55, 0x04, 0x03);
const OID_RSA_ENCRYPTION = Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01);
const OID_SHA256_RSA = Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b);
const OID_SHA384_RSA = Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0c);
const OID_SHA512_RSA = Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0d);
const OID_SHA256 = Uint8Array.of(0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01);

const OID_BASIC_CONSTRAINTS = Uint8Array.of(0x55, 0x1d, 0x13);
const OID_SUBJECT_KEY_ID = Uint8Array.of(0x55, 0x1d, 0x0e);
const OID_AUTHORITY_KEY_ID = Uint8Array.of(0x55, 0x1d, 0x23);
const OID_EXT_KEY_USAGE = Uint8Array.of(0x55, 0x1d, 0x25);
const OID_CRL_DISTRIBUTION_POINTS = Uint8Array.of(0x55, 0x1d, 0x1f);
const OID_AUTHORITY_INFO_ACCESS = Uint8Array.of(0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x01, 0x01);
const OID_AD_OCSP = Uint8Array.of(0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x01);
const OID_AD_CA_ISSUERS = Uint8Array.of(0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x02);
const OID_OCSP_NOCHECK = Uint8Array.of(0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x01, 0x05);
const OID_OCSP_BASIC = Uint8Array.of(0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x01, 0x01);

/** id-kp-timeStamping — 1.3.6.1.5.5.7.3.8 */
export const OID_KP_TIME_STAMPING = Uint8Array.of(0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x08);
/** id-kp-OCSPSigning — 1.3.6.1.5.5.7.3.9 */
export const OID_KP_OCSP_SIGNING = Uint8Array.of(0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x09);

const OID_SIGNED_DATA = Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02);
const OID_CONTENT_TYPE = Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x03);
const OID_MESSAGE_DIGEST = Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04);
const OID_CT_TST_INFO = Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x10, 0x01, 0x04);
/** Arbitrary mock TSA policy — 1.2.3.4. */
export const MOCK_TSA_POLICY_OID = Uint8Array.of(0x2a, 0x03, 0x04);

// ── Mock URLs (.invalid TLD per RFC 2606 — never resolvable) ─────────

export const MOCK_OCSP_URL = 'http://mock.invalid/ocsp';
export const MOCK_CA_ISSUERS_URL = 'http://mock.invalid/ca.der';
export const MOCK_CRL_URL = 'http://mock.invalid/crl';

/** Deterministic TSTInfo genTime used by {@link createMockTimestampProvider}. */
export const MOCK_TSA_GEN_TIME = new Date('2026-01-01T00:00:00Z');

// ── Types ────────────────────────────────────────────────────────────

/** One certificate of the mock PKI, in every shape the MCP tools consume. */
export interface MockCert {
    readonly cert: X509Certificate;
    readonly certDer: Uint8Array;
    readonly certDerBase64: string;
    /** Private key as pdfnative's RsaPrivateKey (for `signPdfBytes` & friends). */
    readonly rsaKey: RsaPrivateKey;
    /** PKCS#1 RSAPrivateKey DER — the shape `sign_pdf`'s `rsaKeyPkcs1DerBase64` input expects. */
    readonly rsaKeyPkcs1Der: Uint8Array;
    readonly rsaKeyPkcs1DerBase64: string;
}

export interface MockPki {
    readonly root: MockCert;
    readonly signer: MockCert;
    readonly tsa: MockCert;
    readonly ocsp: MockCert;
    /** Issuer chain for the signer (root only — the mock PKI has no intermediate), base64 DER. */
    readonly chainDerBase64: readonly string[];
    /** Issuer chain as parsed certificates (for `signPdfBytes({ certChain })`). */
    readonly chain: readonly X509Certificate[];
}

export interface MockCertificateOptions {
    readonly subjectCn: string;
    /** Issuer name DER + key; omit for self-signed. */
    readonly issuerName?: Uint8Array;
    readonly issuerKey?: RsaPrivateKey;
    readonly serialNumber?: bigint;
    readonly subjectKey?: RsaPrivateKey;
    /** Certificate signature digest (default 'sha256'). */
    readonly digest?: RsaDigest;
    readonly isCa?: boolean;
    readonly eku?: { readonly oids: readonly Uint8Array[]; readonly critical?: boolean };
    readonly ocspUrl?: string;
    readonly caIssuersUrl?: string;
    readonly crlUrl?: string;
    readonly ocspNoCheck?: boolean;
    /** AKI keyIdentifier (typically the issuer's SKI). */
    readonly authorityKeyId?: Uint8Array;
    readonly notBefore?: Date;
    readonly notAfter?: Date;
}

// ── Certificate builder ──────────────────────────────────────────────

function extension(oid: Uint8Array, valueDer: Uint8Array, critical = false): Uint8Array {
    const parts: Uint8Array[] = [derOid(oid)];
    if (critical) parts.push(derBoolean(true));
    parts.push(derOctetString(valueDer));
    return derSequence(...parts);
}

function sigAlgFor(digest: RsaDigest): { readonly der: Uint8Array; readonly hash: (input: Uint8Array) => Uint8Array } {
    const oid = digest === 'sha256' ? OID_SHA256_RSA : digest === 'sha384' ? OID_SHA384_RSA : OID_SHA512_RSA;
    const hash = digest === 'sha256' ? sha256 : digest === 'sha384' ? sha384 : sha512;
    return { der: derSequence(derOid(oid), derNull()), hash };
}

/** SKI = SHA-1 of the RSAPublicKey DER. */
function keyIdentifier(key: RsaPrivateKey): Uint8Array {
    return sha1(derSequence(derInteger(key.n), derInteger(RSA_E)));
}

/** PKCS#1 RSAPrivateKey DER (RFC 8017 A.1.2) for a pdfnative key struct. */
export function rsaKeyToPkcs1Der(key: RsaPrivateKey): Uint8Array {
    return derSequence(
        derInteger(0n),
        derInteger(key.n),
        derInteger(RSA_E),
        derInteger(key.d),
        derInteger(key.p),
        derInteger(key.q),
        derInteger(key.dp),
        derInteger(key.dq),
        derInteger(key.qi),
    );
}

/**
 * Build a real DER X.509 v3 certificate and round-trip it through
 * pdfnative's `parseCertificate()` so every extension field is populated
 * by the engine's own parser.
 */
export function buildMockCertificate(options: MockCertificateOptions): X509Certificate {
    const subjectKey = options.subjectKey ?? LEAF_KEY;
    const issuerKey = options.issuerKey ?? subjectKey;
    const digest = options.digest ?? 'sha256';
    const { der: sigAlgDer, hash } = sigAlgFor(digest);

    const subjectName = derSequence(derSet(derSequence(derOid(OID_CN), derUtf8String(options.subjectCn))));
    const issuerName = options.issuerName ?? subjectName;

    const notBefore = options.notBefore ?? new Date('2024-01-01T00:00:00Z');
    const notAfter = options.notAfter ?? new Date('2044-01-01T00:00:00Z');
    const validity = derSequence(derUtcTime(notBefore), derUtcTime(notAfter));

    const rsaPubKeyDer = derSequence(derInteger(subjectKey.n), derInteger(RSA_E));
    const spki = derSequence(derSequence(derOid(OID_RSA_ENCRYPTION), derNull()), derBitString(rsaPubKeyDer));

    const exts: Uint8Array[] = [];
    if (options.isCa) {
        exts.push(extension(OID_BASIC_CONSTRAINTS, derSequence(derBoolean(true)), true));
    }
    exts.push(extension(OID_SUBJECT_KEY_ID, derOctetString(keyIdentifier(subjectKey))));
    if (options.authorityKeyId) {
        exts.push(extension(OID_AUTHORITY_KEY_ID, derSequence(derContextImplicit(0, options.authorityKeyId))));
    }
    if (options.eku) {
        exts.push(extension(
            OID_EXT_KEY_USAGE,
            derSequence(...options.eku.oids.map((o) => derOid(o))),
            options.eku.critical ?? false,
        ));
    }
    if (options.ocspUrl !== undefined || options.caIssuersUrl !== undefined) {
        const descriptions: Uint8Array[] = [];
        if (options.ocspUrl !== undefined) {
            descriptions.push(derSequence(derOid(OID_AD_OCSP), derContextImplicit(6, ia5Bytes(options.ocspUrl))));
        }
        if (options.caIssuersUrl !== undefined) {
            descriptions.push(derSequence(derOid(OID_AD_CA_ISSUERS), derContextImplicit(6, ia5Bytes(options.caIssuersUrl))));
        }
        exts.push(extension(OID_AUTHORITY_INFO_ACCESS, derSequence(...descriptions)));
    }
    if (options.crlUrl !== undefined) {
        // DistributionPoint { [0] DistributionPointName { [0] fullName GeneralNames { [6] URI } } }
        const dp = derSequence(derWrap(0xa0, derWrap(0xa0, derContextImplicit(6, ia5Bytes(options.crlUrl)))));
        exts.push(extension(OID_CRL_DISTRIBUTION_POINTS, derSequence(dp)));
    }
    if (options.ocspNoCheck) {
        exts.push(extension(OID_OCSP_NOCHECK, derNull()));
    }

    const tbs = derSequence(
        derContextExplicit(0, derInteger(2n)), // version v3
        derInteger(options.serialNumber ?? 1n),
        sigAlgDer,
        issuerName,
        validity,
        subjectName,
        spki,
        derContextExplicit(3, derSequence(...exts)),
    );

    const signatureBytes = rsaSignHash(hash(tbs), issuerKey, digest);
    const certDer = derSequence(tbs, sigAlgDer, derBitString(signatureBytes));
    return parseCertificate(certDer);
}

function toMockCert(cert: X509Certificate, key: RsaPrivateKey): MockCert {
    const pkcs1 = rsaKeyToPkcs1Der(key);
    return {
        cert,
        certDer: cert.raw,
        certDerBase64: toBase64(cert.raw),
        rsaKey: key,
        rsaKeyPkcs1Der: pkcs1,
        rsaKeyPkcs1DerBase64: toBase64(pkcs1),
    };
}

// ── PKI factory ──────────────────────────────────────────────────────

let _pki: MockPki | undefined;

/**
 * Deterministic four-certificate PKI: self-signed root CA; a signer
 * certificate with AIA OCSP / caIssuers and a CRL distribution point
 * pointing at `http://mock.invalid/...`; a TSA certificate (critical EKU
 * id-kp-timeStamping); an OCSP responder certificate (EKU id-kp-OCSPSigning
 * + id-pkix-ocsp-nocheck). The three leaves share one key pair — the
 * fixture stays small and output is byte-reproducible. Memoised.
 */
export function createMockPki(): MockPki {
    if (_pki) return _pki;

    const rootCert = buildMockCertificate({
        subjectCn: 'pdfnative Mock Root CA',
        subjectKey: ROOT_KEY,
        serialNumber: 1n,
        isCa: true,
    });
    const rootName = rootCert.subject.raw;
    const rootKeyId = rootCert.subjectKeyId;

    const signerCert = buildMockCertificate({
        subjectCn: 'pdfnative Mock Signer',
        subjectKey: LEAF_KEY,
        issuerName: rootName,
        issuerKey: ROOT_KEY,
        serialNumber: 2n,
        authorityKeyId: rootKeyId,
        ocspUrl: MOCK_OCSP_URL,
        caIssuersUrl: MOCK_CA_ISSUERS_URL,
        crlUrl: MOCK_CRL_URL,
    });

    const tsaCert = buildMockCertificate({
        subjectCn: 'pdfnative Mock TSA',
        subjectKey: LEAF_KEY,
        issuerName: rootName,
        issuerKey: ROOT_KEY,
        serialNumber: 3n,
        authorityKeyId: rootKeyId,
        eku: { oids: [OID_KP_TIME_STAMPING], critical: true },
    });

    const ocspCert = buildMockCertificate({
        subjectCn: 'pdfnative Mock OCSP Responder',
        subjectKey: LEAF_KEY,
        issuerName: rootName,
        issuerKey: ROOT_KEY,
        serialNumber: 4n,
        authorityKeyId: rootKeyId,
        eku: { oids: [OID_KP_OCSP_SIGNING] },
        ocspNoCheck: true,
    });

    const root = toMockCert(rootCert, ROOT_KEY);
    _pki = {
        root,
        signer: toMockCert(signerCert, LEAF_KEY),
        tsa: toMockCert(tsaCert, LEAF_KEY),
        ocsp: toMockCert(ocspCert, LEAF_KEY),
        chainDerBase64: [root.certDerBase64],
        chain: [rootCert],
    };
    return _pki;
}

// ── Mock RFC 3161 TSA ────────────────────────────────────────────────

export interface MockTimestampOptions {
    /** Force a PKIStatus (e.g. 2 = rejection). Default 0 (granted). */
    readonly status?: number;
    /** TSTInfo genTime (default {@link MOCK_TSA_GEN_TIME}). */
    readonly genTime?: Date;
    /** TSTInfo serialNumber (default 0x1234). */
    readonly serialNumber?: bigint;
    /** Corrupt the echoed message imprint so pdfnative refuses the token. */
    readonly tamper?: boolean;
}

/**
 * Build a DER TimeStampResp for a TimeStampReq, synchronously. Shared by
 * the in-process provider and the HTTP mock server.
 */
export function buildMockTimestampResponse(pki: MockPki, request: Uint8Array, options?: MockTimestampOptions): Uint8Array {
    const status = options?.status ?? 0;
    if (status !== 0) {
        const statusInfo = derSequence(
            derInteger(BigInt(status)),
            derSequence(derUtf8String('rejected by mock TSA')),
        );
        return derSequence(statusInfo);
    }

    // TimeStampReq ::= SEQUENCE { version, messageImprint, reqPolicy?, nonce?, certReq? }
    const req = derDecode(request);
    const imprintNode = req.children[1];
    if (req.tag !== ASN1_SEQUENCE || imprintNode === undefined) {
        throw new Error('mock TSA: malformed TimeStampReq');
    }
    const imprintRaw = new Uint8Array(derRawBytes(request, imprintNode));
    if (options?.tamper) {
        imprintRaw[imprintRaw.length - 1] = (imprintRaw[imprintRaw.length - 1] ?? 0) ^ 0xff;
    }
    let nonce: bigint | undefined;
    let certReq = false;
    for (let i = 2; i < req.children.length; i++) {
        const child = req.children[i];
        if (child === undefined) break;
        if (child.tag === ASN1_INTEGER) nonce = asn1Integer(child);
        else if (child.tag === ASN1_BOOLEAN) certReq = child.value[0] !== 0;
        else if (child.tag !== ASN1_OID) break;
    }

    // ── TSTInfo ──────────────────────────────────────────────────
    const tstFields: Uint8Array[] = [
        derInteger(1n),
        derOid(MOCK_TSA_POLICY_OID),
        imprintRaw,
        derInteger(options?.serialNumber ?? 0x1234n),
        derGeneralizedTime(options?.genTime ?? MOCK_TSA_GEN_TIME),
    ];
    if (nonce !== undefined) tstFields.push(derInteger(nonce));
    const tstInfo = derSequence(...tstFields);

    // ── SignedData over the TSTInfo ──────────────────────────────
    const digestAlgId = derSequence(derOid(OID_SHA256), derNull());
    const encap = derSequence(derOid(OID_CT_TST_INFO), derContextExplicit(0, derOctetString(tstInfo)));
    const signedAttrs = derSetOf(
        derSequence(derOid(OID_CONTENT_TYPE), derSet(derOid(OID_CT_TST_INFO))),
        derSequence(derOid(OID_MESSAGE_DIGEST), derSet(derOctetString(sha256(tstInfo)))),
    );
    const signedAttrsImplicit = new Uint8Array(signedAttrs);
    signedAttrsImplicit[0] = 0xa0;
    const signature = rsaSignHash(sha256(signedAttrs), pki.tsa.rsaKey);

    const signerInfo = derSequence(
        derInteger(1n),
        derSequence(pki.tsa.cert.issuer.raw, derInteger(pki.tsa.cert.serialNumber)),
        digestAlgId,
        signedAttrsImplicit,
        derSequence(derOid(OID_SHA256_RSA), derNull()),
        derOctetString(signature),
    );

    const signedDataFields: Uint8Array[] = [
        derInteger(3n), // version 3 (eContentType ≠ id-data)
        derSet(digestAlgId),
        encap,
    ];
    if (certReq) signedDataFields.push(derWrap(0xa0, pki.tsa.certDer));
    signedDataFields.push(derSet(signerInfo));

    const token = derSequence(derOid(OID_SIGNED_DATA), derContextExplicit(0, derSequence(...signedDataFields)));
    return derSequence(derSequence(derInteger(0n)), token);
}

/**
 * In-process RFC 3161 TSA: parses the TimeStampReq, echoes its
 * messageImprint and nonce, and returns a TimeStampResp containing a real
 * TimeStampToken signed with the mock TSA key (TSA certificate embedded
 * when `certReq` is set). `status` ≠ 0 yields a rejection without a token;
 * `tamper` corrupts the imprint so the engine refuses the token.
 */
export function createMockTimestampProvider(pki: MockPki, options?: MockTimestampOptions): TimestampProvider {
    return {
        getTimestamp(request: Uint8Array): Promise<Uint8Array> {
            try {
                return Promise.resolve(buildMockTimestampResponse(pki, request, options));
            } catch (err) {
                return Promise.reject(err instanceof Error ? err : new Error(String(err)));
            }
        },
    };
}

// ── Mock OCSP responder + CRL distribution point ─────────────────────

export interface MockRevocationOptions {
    /** Report the signer certificate as revoked (default false = good). */
    readonly revoked?: boolean;
    /**
     * Make `fetchOcsp` reject. pdfnative 1.7.0 propagates provider errors
     * rather than silently falling back — pair with `preferOcsp: false` on
     * the collector (see {@link ltvBLT}) to route through the CRL path.
     */
    readonly failOcsp?: boolean;
    /** Serve validity windows that already expired (default false). */
    readonly staleNextUpdate?: boolean;
}

/**
 * In-process revocation provider serving a real signed BasicOCSPResponse
 * (signed by the mock OCSP responder key, responder certificate embedded,
 * CertID echoed from the request) and a real signed CertificateList
 * (signed by the root). Deterministic dates:
 *  - fresh: thisUpdate 2026-01-01, nextUpdate 2036-01-01
 *  - stale: thisUpdate 2019-12-01, nextUpdate 2020-01-01
 * With `revoked: true` the OCSP status is revoked (2025-06-01) and the CRL
 * lists the mock signer certificate's serial.
 */
export function createMockRevocationProvider(pki: MockPki, options?: MockRevocationOptions): RevocationProvider {
    const stale = options?.staleNextUpdate ?? false;
    const revoked = options?.revoked ?? false;
    const thisUpdate = stale ? new Date('2019-12-01T00:00:00Z') : new Date('2026-01-01T00:00:00Z');
    const nextUpdate = stale ? new Date('2020-01-01T00:00:00Z') : new Date('2036-01-01T00:00:00Z');
    const revocationTime = new Date('2025-06-01T00:00:00Z');
    const sigAlgId = derSequence(derOid(OID_SHA256_RSA), derNull());

    return {
        fetchOcsp(_url: string, request: Uint8Array): Promise<Uint8Array> {
            if (options?.failOcsp) {
                return Promise.reject(new Error('mock OCSP: responder unavailable'));
            }
            // OCSPRequest → tbsRequest → requestList → Request → CertID
            const req = derDecode(request);
            const certIdNode = req.children[0]?.children[0]?.children[0]?.children[0];
            if (certIdNode === undefined || certIdNode.tag !== ASN1_SEQUENCE) {
                return Promise.reject(new Error('mock OCSP: malformed OCSPRequest'));
            }
            const certIdRaw = derRawBytes(request, certIdNode);

            const certStatus = revoked
                ? derWrap(0xa1, derGeneralizedTime(revocationTime)) // [1] RevokedInfo
                : Uint8Array.of(0x80, 0x00);                         // [0] IMPLICIT NULL = good

            const single = derSequence(
                certIdRaw,
                certStatus,
                derGeneralizedTime(thisUpdate),
                derContextExplicit(0, derGeneralizedTime(nextUpdate)),
            );

            const tbsResponseData = derSequence(
                derContextExplicit(1, pki.ocsp.cert.subject.raw), // responderID byName
                derGeneralizedTime(thisUpdate),                   // producedAt
                derSequence(single),
            );

            const basic = derSequence(
                tbsResponseData,
                sigAlgId,
                derBitString(rsaSignHash(sha256(tbsResponseData), pki.ocsp.rsaKey)),
                derContextExplicit(0, derSequence(pki.ocsp.certDer)),
            );

            const responseBytes = derSequence(derOid(OID_OCSP_BASIC), derOctetString(basic));
            const response = derSequence(
                derWrap(0x0a, Uint8Array.of(0x00)), // ENUMERATED successful
                derContextExplicit(0, responseBytes),
            );
            return Promise.resolve(response);
        },

        fetchCrl(_url: string): Promise<Uint8Array> {
            const tbsFields: Uint8Array[] = [
                derInteger(1n), // version v2
                sigAlgId,
                pki.root.cert.subject.raw,
                derUtcTime(thisUpdate),
                derUtcTime(nextUpdate),
            ];
            if (revoked) {
                tbsFields.push(derSequence(
                    derSequence(derInteger(pki.signer.cert.serialNumber), derUtcTime(revocationTime)),
                ));
            }
            const tbsCertList = derSequence(...tbsFields);
            const crl = derSequence(
                tbsCertList,
                sigAlgId,
                derBitString(rsaSignHash(sha256(tbsCertList), pki.root.rsaKey)),
            );
            return Promise.resolve(crl);
        },
    };
}

// ── PAdES ladder conveniences ────────────────────────────────────────

export interface LadderOptions {
    readonly pki?: MockPki;
    readonly timestampProvider?: TimestampProvider;
    readonly revocationProvider?: RevocationProvider;
    /** `/Reason` written to the signature dictionary. */
    readonly reason?: string;
    /** Forwarded to `addValidationInfo` (default `true` = OCSP first). */
    readonly preferOcsp?: boolean;
}

function resolvePki(opts?: LadderOptions): MockPki {
    return opts?.pki ?? createMockPki();
}

/**
 * Inject a CAdES placeholder sized for a timestamped CMS carrying the mock
 * signer + root certificates.
 */
export function placeholderForPades(pdfBytes: Uint8Array, opts?: LadderOptions): Uint8Array {
    const pki = resolvePki(opts);
    return addSignaturePlaceholder(pdfBytes, {
        placeholderBytes: estimateContentsSize(
            [pki.signer.certDer.length, pki.root.certDer.length],
            'rsa-sha256',
            { timestamp: true },
        ),
        metadata: { subFilter: 'ETSI.CAdES.detached', ...(opts?.reason !== undefined ? { reason: opts.reason } : {}) },
    });
}

/** PAdES B-B: placeholder + `signPdfBytes` with `profile: 'pades'`. */
export function signedBB(pdfBytes: Uint8Array, opts?: LadderOptions): Uint8Array {
    const pki = resolvePki(opts);
    return signPdfBytes(placeholderForPades(pdfBytes, opts), {
        signerCert: pki.signer.cert,
        certChain: pki.chain,
        rsaKey: pki.signer.rsaKey,
        algorithm: 'rsa-sha256',
        profile: 'pades',
    });
}

/** PAdES B-T: placeholder + `signPdfBytesWithTimestamp` through the per-call mock TSA. */
export async function signedBT(pdfBytes: Uint8Array, opts?: LadderOptions): Promise<Uint8Array> {
    const pki = resolvePki(opts);
    return signPdfBytesWithTimestamp(placeholderForPades(pdfBytes, opts), {
        signerCert: pki.signer.cert,
        certChain: pki.chain,
        rsaKey: pki.signer.rsaKey,
        algorithm: 'rsa-sha256',
        profile: 'pades',
        timestampProvider: opts?.timestampProvider ?? createMockTimestampProvider(pki),
    });
}

/** PAdES B-LT: `addValidationInfo` (/DSS + /VRI) on an already-signed document. */
export async function ltvBLT(signedBytes: Uint8Array, opts?: LadderOptions): Promise<Uint8Array> {
    const pki = resolvePki(opts);
    return addValidationInfo(signedBytes, {
        revocationProvider: opts?.revocationProvider ?? createMockRevocationProvider(pki),
        ...(opts?.preferOcsp !== undefined ? { preferOcsp: opts.preferOcsp } : {}),
    });
}

/** PAdES B-LTA: `addDocumentTimestamp` on a B-LT document. */
export async function archivedBLTA(bltBytes: Uint8Array, opts?: LadderOptions): Promise<Uint8Array> {
    const pki = resolvePki(opts);
    return addDocumentTimestamp(bltBytes, {
        timestampProvider: opts?.timestampProvider ?? createMockTimestampProvider(pki),
    });
}

/** Full ladder from an unsigned PDF: B-T → B-LT → B-LTA. Returns every rung. */
export async function fullLadder(pdfBytes: Uint8Array, opts?: LadderOptions): Promise<{
    readonly bt: Uint8Array;
    readonly blt: Uint8Array;
    readonly blta: Uint8Array;
}> {
    const bt = await signedBT(pdfBytes, opts);
    const blt = await ltvBLT(bt, opts);
    const blta = await archivedBLTA(blt, opts);
    return { bt, blt, blta };
}
