import { describe, it, expect } from 'vitest';
import { splitParagraphSegments } from '../src/text.js';

describe('splitParagraphSegments', () => {
    it('returns a single segment for text without line breaks', () => {
        expect(splitParagraphSegments('Hello world')).toEqual(['Hello world']);
    });

    it('splits on \\n into separate trimmed segments', () => {
        expect(splitParagraphSegments('line one\nline two\nline three')).toEqual([
            'line one',
            'line two',
            'line three',
        ]);
    });

    it('normalises \\r\\n and bare \\r line endings', () => {
        expect(splitParagraphSegments('a\r\nb\rc')).toEqual(['a', 'b', 'c']);
    });

    it('drops blank and whitespace-only segments', () => {
        expect(splitParagraphSegments('a\n\n   \nb')).toEqual(['a', 'b']);
    });

    it('returns an empty array for newline-only / whitespace-only input', () => {
        expect(splitParagraphSegments('\n\n')).toEqual([]);
        expect(splitParagraphSegments('   ')).toEqual([]);
    });

    it('trims leading and trailing whitespace on each line', () => {
        expect(splitParagraphSegments('  padded  \n\ttabbed\t')).toEqual(['padded', 'tabbed']);
    });
});
