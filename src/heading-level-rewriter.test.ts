// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import type { HeadingLevelRewrite } from './heading-level-rewriter.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible structure type imports compact.
import type { HeadingLevel, MarkdownHeading } from './markdown-structure.ts';

import { planHeadingLevelRewrite } from './heading-level-rewriter.ts';
import { parseMarkdownStructure } from './markdown-structure.ts';

function applyRewrite(source: string, rewrite: HeadingLevelRewrite): string {
  return source.slice(0, rewrite.range.from)
    + rewrite.replacement
    + source.slice(rewrite.range.to);
}

function getOnlyHeading(source: string): MarkdownHeading {
  const [heading, unexpectedHeading] = parseMarkdownStructure(source).headings;
  if (heading === undefined || unexpectedHeading !== undefined) {
    throw new Error('Expected exactly one Markdown heading');
  }
  return heading;
}

describe('planHeadingLevelRewrite', () => {
  describe('ATX headings', () => {
    it.each(
      [
        ['# Title\n', 2, '## Title\n'],
        ['### Title ##  \n', 2, '## Title ##  \n'],
        ['> ### Title ##  \r\n', 2, '> ## Title ##  \r\n'],
        ['###### Title', 5, '##### Title']
      ] as const
    )('rewrites only the ATX opener in %j', (source, level, expected) => {
      const heading = getOnlyHeading(source);
      const rewrite = planHeadingLevelRewrite(source, heading, level);

      expect(applyRewrite(source, rewrite)).toBe(expected);
      expect(rewrite.range).toEqual(
        heading.syntax.kind === 'atx'
          ? heading.syntax.openingMarkerRange
          : undefined
      );
    });

    it.each(
      [
        ['one indentation space with LF', ' ### Title\n', 4, ' #### Title\n'],
        [
          'two indentation spaces, closing hashes, and CRLF',
          '  ### Title ##  \r\n',
          1,
          '  # Title ##  \r\n'
        ],
        [
          'three indentation spaces at EOF',
          '   # Title',
          6,
          '   ###### Title'
        ],
        [
          'nested quote prefix with LF',
          '> > ### Title ###\n',
          4,
          '> > #### Title ###\n'
        ],
        [
          'indented nested quote prefix with CRLF',
          '   > > ### Title ##\r\n',
          2,
          '   > > ## Title ##\r\n'
        ],
        [
          'callout body prefix with LF',
          '> [!note]\n>\n> ### Title ##\n',
          2,
          '> [!note]\n>\n> ## Title ##\n'
        ],
        [
          'callout body prefix at EOF',
          '> [!note]\n>\n> ###### Title',
          5,
          '> [!note]\n>\n> ##### Title'
        ]
      ] as const
    )('preserves %s', (_name, source, level, expected) => {
      const heading = getOnlyHeading(source);
      const rewrite = planHeadingLevelRewrite(source, heading, level);

      expect(applyRewrite(source, rewrite)).toBe(expected);
    });

    it('maps prefix, opener, title, closing markers, and CRLF offsets after shrinking', () => {
      const source = 'before\n\n  > > ### Title ##  \r\nafter\n';
      const heading = getOnlyHeading(source);
      const rewrite = planHeadingLevelRewrite(source, heading, 2);

      expect(rewrite).toMatchObject({
        range: { from: 14, to: 17 },
        replacement: '##'
      });
      expect(applyRewrite(source, rewrite)).toBe(
        'before\n\n  > > ## Title ##  \r\nafter\n'
      );
      expect([
        rewrite.mapOffset(8),
        rewrite.mapOffset(10),
        rewrite.mapOffset(13)
      ]).toEqual([8, 10, 13]);
      expect([
        rewrite.mapOffset(14),
        rewrite.mapOffset(15),
        rewrite.mapOffset(16),
        rewrite.mapOffset(17)
      ]).toEqual([14, 15, 16, 16]);
      expect([
        rewrite.mapOffset(18),
        rewrite.mapOffset(22),
        rewrite.mapOffset(24),
        rewrite.mapOffset(28),
        rewrite.mapOffset(29),
        rewrite.mapOffset(30)
      ]).toEqual([17, 21, 23, 27, 28, 29]);
      expect(() => rewrite.mapOffset(7)).toThrow(RangeError);
      expect(() => rewrite.mapOffset(31)).toThrow(RangeError);
    });

    it('keeps retained characters aligned after expanding the opener', () => {
      const source = 'before\n\n  > > ### Title ##  \r\nafter\n';
      const heading = getOnlyHeading(source);
      const rewrite = planHeadingLevelRewrite(source, heading, 5);

      expect(rewrite.replacement).toBe('#####');
      expect([
        rewrite.mapOffset(14),
        rewrite.mapOffset(15),
        rewrite.mapOffset(16),
        rewrite.mapOffset(17),
        rewrite.mapOffset(18),
        rewrite.mapOffset(24),
        rewrite.mapOffset(28),
        rewrite.mapOffset(29),
        rewrite.mapOffset(30)
      ]).toEqual([14, 15, 16, 19, 20, 26, 30, 31, 32]);
    });
  });

  describe('Setext headings', () => {
    it.each(
      [
        ['Title\n=====  \n', 2, 'Title\n-----  \n'],
        ['Title\r\n-----\r\n', 1, 'Title\r\n=====\r\n'],
        ['Title\n-----\n', 3, '### Title\n'],
        ['First\nsecond\n-----\n', 3, '### First second\n'],
        ['> Title\r\n> -----  \r\n', 3, '> ### Title\r\n']
      ] as const
    )('rewrites Setext syntax exactly in %j', (source, level, expected) => {
      const heading = getOnlyHeading(source);
      const rewrite = planHeadingLevelRewrite(source, heading, level);

      expect(applyRewrite(source, rewrite)).toBe(expected);
    });

    it.each(
      [
        [
          'three-space indentation with LF',
          '   Title\n   -----\n',
          4,
          '   #### Title\n'
        ],
        [
          'nested quote prefix and multiline title at EOF',
          '> > First  \n> > second\n> > -----',
          3,
          '> > ### First second'
        ],
        [
          'callout body prefix with LF',
          '> [!note]\n>\n> Title\n> -----\n',
          3,
          '> [!note]\n>\n> ### Title\n'
        ],
        [
          'quote prefix, title whitespace, and CRLF',
          '>   First  \r\n> second \t\r\n> -----  \r\n',
          6,
          '>   ###### First second\r\n'
        ]
      ] as const
    )('collapses %s deterministically', (_name, source, level, expected) => {
      const heading = getOnlyHeading(source);
      const rewrite = planHeadingLevelRewrite(source, heading, level);

      expect(applyRewrite(source, rewrite)).toBe(expected);
    });

    it('owns only the underline marker for Setext level one-to-two changes', () => {
      const source = 'before\n\n> Title\r\n> -----  \r\nafter';
      const heading = getOnlyHeading(source);
      const rewrite = planHeadingLevelRewrite(source, heading, 1);

      expect(rewrite).toMatchObject({
        range: { from: 19, to: 24 },
        replacement: '====='
      });
      expect(applyRewrite(source, rewrite)).toBe(
        'before\n\n> Title\r\n> =====  \r\nafter'
      );
      expect([
        rewrite.mapOffset(8),
        rewrite.mapOffset(10),
        rewrite.mapOffset(14),
        rewrite.mapOffset(15),
        rewrite.mapOffset(16),
        rewrite.mapOffset(17),
        rewrite.mapOffset(19),
        rewrite.mapOffset(23),
        rewrite.mapOffset(24),
        rewrite.mapOffset(26),
        rewrite.mapOffset(27),
        rewrite.mapOffset(28)
      ]).toEqual([8, 10, 14, 15, 16, 17, 19, 23, 24, 26, 27, 28]);
      expect(() => rewrite.mapOffset(7)).toThrow(RangeError);
      expect(() => rewrite.mapOffset(29)).toThrow(RangeError);
    });

    it('maps retained title and final line-ending bytes through multiline conversion', () => {
      const source = 'before\n\n>   First  \r\n> second \t\r\n> -----  \r\nafter';
      const heading = getOnlyHeading(source);
      const rewrite = planHeadingLevelRewrite(source, heading, 3);
      const replacementEnd = rewrite.range.from + rewrite.replacement.length;

      expect(rewrite).toMatchObject({
        range: { from: 8, to: 44 },
        replacement: '>   ### First second\r\n'
      });
      expect(applyRewrite(source, rewrite)).toBe(
        'before\n\n>   ### First second\r\nafter'
      );
      expect([
        rewrite.mapOffset(8),
        rewrite.mapOffset(9),
        rewrite.mapOffset(10),
        rewrite.mapOffset(11)
      ]).toEqual([8, 9, 10, 11]);
      expect([
        rewrite.mapOffset(12),
        rewrite.mapOffset(16),
        rewrite.mapOffset(23),
        rewrite.mapOffset(28)
      ]).toEqual([16, 20, 22, 27]);
      expect([rewrite.mapOffset(42), rewrite.mapOffset(43), rewrite.mapOffset(44)])
        .toEqual([28, 29, 30]);
      expect([
        rewrite.mapOffset(17),
        rewrite.mapOffset(18),
        rewrite.mapOffset(19),
        rewrite.mapOffset(20),
        rewrite.mapOffset(21),
        rewrite.mapOffset(22),
        rewrite.mapOffset(29),
        rewrite.mapOffset(30),
        rewrite.mapOffset(31),
        rewrite.mapOffset(32),
        rewrite.mapOffset(33),
        rewrite.mapOffset(34),
        rewrite.mapOffset(35),
        rewrite.mapOffset(39),
        rewrite.mapOffset(40),
        rewrite.mapOffset(41)
      ]).toEqual(Array.from({ length: 16 }, () => replacementEnd));
      for (let offset = rewrite.range.from; offset <= rewrite.range.to; offset += 1) {
        expect(rewrite.mapOffset(offset)).toBeGreaterThanOrEqual(rewrite.range.from);
        expect(rewrite.mapOffset(offset)).toBeLessThanOrEqual(replacementEnd);
      }
      expect(() => rewrite.mapOffset(7)).toThrow(RangeError);
      expect(() => rewrite.mapOffset(45)).toThrow(RangeError);
    });
  });

  it.each([0, 7, 1.5, NaN, Infinity])(
    'rejects invalid target level %s',
    (targetLevel) => {
      const source = '# Title\n';
      const heading = getOnlyHeading(source);

      expect(() =>
        planHeadingLevelRewrite(
          source,
          heading,
          targetLevel as HeadingLevel
        )
      ).toThrow(RangeError);
    }
  );

  it.each(
    [
      ['ATX', '# Title\n', 'x Title\n', 2],
      ['Setext', 'Title\n-----\n', 'Title\nxxxxx\n', 1]
    ] as const
  )(
    'rejects %s heading ranges that do not belong to the source',
    (_name, parsedSource, foreignSource, targetLevel) => {
      const heading = getOnlyHeading(parsedSource);

      expect(() =>
        planHeadingLevelRewrite(
          foreignSource,
          heading,
          targetLevel as HeadingLevel
        )
      ).toThrow(TypeError);
    }
  );
});
