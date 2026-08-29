// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import {
  createNumberedFilename,
  deriveExtractionTitle,
  MAX_FILENAME_STEM_BYTES,
  sanitizeFilenameStem
} from './extraction-title.ts';

describe('deriveExtractionTitle', () => {
  it('returns a plain heading unchanged', () => {
    expect(deriveExtractionTitle('Beta').displayTitle).toBe('Beta');
    expect(deriveExtractionTitle('Beta').headingMarkup).toBe('Beta');
  });

  it('derives visible text while preserving meaningful inline Markdown', () => {
    const headingMarkup = '**Beta** and `code`';

    expect(deriveExtractionTitle(headingMarkup)).toEqual({
      displayTitle: 'Beta and code',
      headingMarkup
    });
  });

  it.each([
    ['link', '[Beta](notes/beta.md)', 'Beta'],
    ['link title', '[Beta](notes/beta.md "Details")', 'Beta'],
    ['reference link', '[Beta][reference]', 'Beta'],
    ['autolink', '<https://example.com>', 'https://example.com'],
    ['image', '![Map](map.png)', 'Map'],
    ['nested emphasis', '***Beta _title_***', 'Beta title'],
    ['escaped punctuation', String.raw`Beta \*draft\*`, 'Beta *draft*'],
    ['Unicode and emoji', '**Café 東京** 🚀', 'Café 東京 🚀'],
    ['empty link label', 'Beta [](notes/empty.md) title', 'Beta title'],
    [
      'inline HTML text',
      '<span>Beta <strong>title</strong></span>',
      'Beta title'
    ]
  ])('derives visible text from %s', (_name, headingMarkup, displayTitle) => {
    expect(deriveExtractionTitle(headingMarkup)).toEqual({
      displayTitle,
      headingMarkup
    });
  });

  it('normalizes multiline whitespace and removes a terminal block ID', () => {
    expect(deriveExtractionTitle('Beta\n  title  ^beta')).toEqual({
      displayTitle: 'Beta title',
      headingMarkup: 'Beta title'
    });
  });

  it.each([
    [
      'code span text',
      'Alpha  `a  b`  Omega',
      'Alpha `a  b` Omega',
      'Alpha a b Omega'
    ],
    [
      'link destination',
      'Alpha  [Beta](<notes/beta  file.md>)  Omega',
      'Alpha [Beta](<notes/beta  file.md>) Omega',
      'Alpha Beta Omega'
    ],
    [
      'link title',
      'Alpha  [Beta](notes/beta.md "a  b")  Omega',
      'Alpha [Beta](notes/beta.md "a  b") Omega',
      'Alpha Beta Omega'
    ],
    [
      'HTML attribute',
      'Alpha  <span data-label="a  b">Beta</span>  Omega',
      'Alpha <span data-label="a  b">Beta</span> Omega',
      'Alpha Beta Omega'
    ]
  ])(
    'normalizes title whitespace without mutating %s',
    (_name, inputMarkup, headingMarkup, displayTitle) => {
      expect(deriveExtractionTitle(inputMarkup)).toEqual({
        displayTitle,
        headingMarkup
      });
    }
  );

  it.each([
    ['HTML comment', 'Beta <!--draft  note-->', 'Beta'],
    ['processing instruction', 'Beta <?draft  test?>', 'Beta']
  ])('omits a non-rendered %s from the display title', (_name, headingMarkup, displayTitle) => {
    expect(deriveExtractionTitle(headingMarkup)).toEqual({
      displayTitle,
      headingMarkup
    });
  });

  it.each([
    [
      'named entities',
      'Fish &amp; Chips &NotEqualTilde;',
      'Fish & Chips ≂̸'
    ],
    ['decimal entity', 'Letter &#65;', 'Letter A'],
    ['hexadecimal entity', 'Letter &#x41;', 'Letter A']
  ])('decodes %s in the display title', (_name, headingMarkup, displayTitle) => {
    expect(deriveExtractionTitle(headingMarkup)).toEqual({
      displayTitle,
      headingMarkup
    });
  });

  it('removes only a terminal valid block ID', () => {
    expect(deriveExtractionTitle('Beta ^block-id')).toEqual({
      displayTitle: 'Beta',
      headingMarkup: 'Beta'
    });
    expect(deriveExtractionTitle('Beta ^block-id  ')).toEqual({
      displayTitle: 'Beta',
      headingMarkup: 'Beta'
    });
    expect(deriveExtractionTitle('Beta ^not_valid')).toEqual({
      displayTitle: 'Beta ^not_valid',
      headingMarkup: 'Beta ^not_valid'
    });
    expect(deriveExtractionTitle('Beta^block-id')).toEqual({
      displayTitle: 'Beta^block-id',
      headingMarkup: 'Beta^block-id'
    });
  });

  it('returns empty titles for whitespace-only markup', () => {
    expect(deriveExtractionTitle(' \n\t ')).toEqual({
      displayTitle: '',
      headingMarkup: ''
    });
  });
});

describe('sanitizeFilenameStem', () => {
  it('keeps an already portable title unchanged', () => {
    expect(sanitizeFilenameStem('Beta')).toBe('Beta');
  });

  it('replaces every reserved filename character with whitespace', () => {
    expect(sanitizeFilenameStem(String.raw`A/B\C:D*E?F"G<H>I|J#K^L[M]N`)).toBe(
      'A B C D E F G H I J K L M N'
    );
  });

  it('removes ASCII controls and collapses repeated whitespace', () => {
    const asciiControls = String.fromCodePoint(
      ...Array.from({ length: 32 }, (_value, index) => index),
      127
    );

    expect(sanitizeFilenameStem(`Alpha${asciiControls}Beta   title`)).toBe(
      'Alpha Beta title'
    );
  });

  it('trims leading and trailing spaces and periods', () => {
    expect(sanitizeFilenameStem('  ...Beta... title...  ')).toBe(
      'Beta... title'
    );
  });

  it('preserves case, Unicode, and emoji', () => {
    expect(sanitizeFilenameStem('Résumé 東京 🚀')).toBe('Résumé 東京 🚀');
  });

  it.each(['  ...  ', String.raw` / \ : * ? " < > | # ^ [ ] `])(
    'returns null when sanitizing %j leaves no usable text',
    (displayTitle) => {
      expect(sanitizeFilenameStem(displayTitle)).toBeNull();
    }
  );
});

describe('createNumberedFilename', () => {
  const encoder = new TextEncoder();

  it('adds the Markdown extension and an optional collision suffix', () => {
    expect(createNumberedFilename('Beta', 0)).toBe('Beta.md');
    expect(createNumberedFilename('Beta', 1)).toBe('Beta 1.md');
  });

  it.each([-1, 1.5, NaN, Infinity, 9_007_199_254_740_992])(
    'rejects the non-safe collision index %s',
    (collisionIndex) => {
      expect(() => createNumberedFilename('Beta', collisionIndex)).toThrow(
        RangeError
      );
    }
  );

  it('caps the complete filename stem at exactly the byte budget', () => {
    const exactStem = 'a'.repeat(MAX_FILENAME_STEM_BYTES);

    expect(createNumberedFilename(exactStem, 0)).toBe(`${exactStem}.md`);

    const numberedFilename = createNumberedFilename(exactStem, 1);
    const numberedStem = numberedFilename.slice(0, -'.md'.length);
    expect(numberedStem).toBe(`${'a'.repeat(178)} 1`);
    expect(encoder.encode(numberedStem)).toHaveLength(MAX_FILENAME_STEM_BYTES);
  });

  it('prefers a fitting word boundary when shortening multibyte text', () => {
    const firstWord = 'é'.repeat(80);
    const filename = createNumberedFilename(
      `${firstWord} ${'東京'.repeat(20)}`,
      0
    );

    expect(filename).toBe(`${firstWord}.md`);
    expect(encoder.encode(filename.slice(0, -'.md'.length)).byteLength).toBeLessThanOrEqual(
      MAX_FILENAME_STEM_BYTES
    );
  });

  it('never splits a code point when reserving bytes for a suffix', () => {
    const filename = createNumberedFilename('🚀'.repeat(60), 12);
    const stem = filename.slice(0, -'.md'.length);

    expect(filename).toBe(`${'🚀'.repeat(44)} 12.md`);
    expect(stem).not.toContain('\u{FFFD}');
    expect(encoder.encode(stem).byteLength).toBeLessThanOrEqual(
      MAX_FILENAME_STEM_BYTES
    );
  });
});
