/**
 * Synthetic ICC profiles for the corpus, the examples and the tests.
 *
 * pdfnative-mcp ships no press profile and must not: a real job uses the
 * profile of the printing condition (ISO Coated v2, GRACoL, …) supplied by
 * the printer. These builders produce the smallest profiles a validator
 * accepts, so conformance fixtures need no binary blob and no third-party
 * licence. They describe no real device — never use them for production.
 */

/**
 * Minimal valid RGB ICC v2 profile (custom OutputIntent entry).
 *
 * Structurally the same display-class matrix/TRC profile pdfnative emits for
 * its built-in sRGB intent (9 tags: desc, wtpt, cprt, rXYZ/gXYZ/bXYZ, rTRC/
 * gTRC/bTRC), with a distinct description so the corpus file is recognisably
 * a caller-supplied intent. veraPDF parses the ICC header and tag table
 * (ISO 19005 6.2.2 / 6.2.3), so a bare 128-byte header would not do.
 */
export function buildMinimalRgbIccProfile(description = 'Corpus RGB'): string {
    const tags: Array<[string, Buffer]> = [];
    const typeTag = (sig: string, body: Buffer): Buffer => Buffer.concat([Buffer.from(sig, 'ascii'), Buffer.alloc(4), body]);
    const s15 = (v: number): Buffer => {
        const b = Buffer.alloc(4);
        b.writeInt32BE(Math.round(v * 65536));
        return b;
    };
    const xyz = (x: number, y: number, z: number): Buffer => typeTag('XYZ ', Buffer.concat([s15(x), s15(y), s15(z)]));
    // desc: ascii count + ascii (NUL-terminated) + unicode code/count (8) +
    // scriptcode code/count (3) + 67-byte scriptcode field.
    const descBody = Buffer.alloc(4 + description.length + 1 + 8 + 3 + 67);
    descBody.writeUInt32BE(description.length + 1, 0);
    descBody.write(description, 4, 'ascii');
    tags.push(['desc', typeTag('desc', descBody)]);
    tags.push(['wtpt', xyz(0.9642, 1.0, 0.8249)]);
    tags.push(['cprt', typeTag('text', Buffer.from('No Copyright\0', 'ascii'))]);
    tags.push(['rXYZ', xyz(0.4361, 0.2225, 0.0139)]);
    tags.push(['gXYZ', xyz(0.3851, 0.7169, 0.0971)]);
    tags.push(['bXYZ', xyz(0.1431, 0.0606, 0.7141)]);
    const curv = Buffer.alloc(4 + 2); // count = 1 → single u8Fixed8 gamma value
    curv.writeUInt32BE(1, 0);
    curv.writeUInt16BE(563, 4); // gamma 2.2 as u8Fixed8
    const trc = typeTag('curv', curv);
    for (const sig of ['rTRC', 'gTRC', 'bTRC']) tags.push([sig, trc]);

    const table = Buffer.alloc(4 + tags.length * 12);
    table.writeUInt32BE(tags.length, 0);
    let offset = 128 + table.length;
    const bodies: Buffer[] = [];
    tags.forEach(([sig, body], i) => {
        const padded = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
        table.write(sig, 4 + i * 12, 'ascii');
        table.writeUInt32BE(offset, 8 + i * 12);
        table.writeUInt32BE(body.length, 12 + i * 12);
        bodies.push(padded);
        offset += padded.length;
    });
    const header = Buffer.alloc(128);
    header.writeUInt32BE(offset, 0); // profile size
    header.writeUInt8(2, 8); // version 2.1.0
    header.writeUInt8(0x10, 9);
    header.write('mntr', 12, 'ascii'); // display device class
    header.write('RGB ', 16, 'ascii'); // data colour space
    header.write('XYZ ', 20, 'ascii'); // PCS
    header.writeUInt16BE(2025, 24); // creation year
    header.writeUInt16BE(1, 26);
    header.writeUInt16BE(1, 28);
    header.write('acsp', 36, 'ascii');
    header.write('MSFT', 40, 'ascii');
    header.writeUInt32BE(63190, 68); // illuminant D50
    header.writeUInt32BE(65536, 72);
    header.writeUInt32BE(54061, 76);
    return Buffer.concat([header, table, ...bodies]).toString('base64');
}
