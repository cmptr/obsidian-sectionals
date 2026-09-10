// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import type { MarkdownRange } from './markdown-structure.ts';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible structure imports compact.
import { excludeOffsetsInRanges, parseMarkdownStructure } from './markdown-structure.ts';

function createProtectedMembershipFixture(unitCount: number): string {
  return Array.from({ length: unitCount }, (_, index) =>
    [
      `# Visible ${String(index)}`,
      '```text',
      `visible fence ${String(index)}`,
      '```',
      '%%',
      `# Hidden ${String(index)}`,
      `> hidden quote ${String(index)}`,
      '%%',
      ''
    ].join('\n')).join('');
}

describe('parseMarkdownStructure', () => {
  it('returns ATX and Setext headings in source order', () => {
    const source = '# Root\nbody\n\nTitle\n---\n';
    const structure = parseMarkdownStructure(source);

    expect(structure.containers[0]).toEqual({
      depth: 0,
      end: source.length,
      id: 'root',
      start: 0
    });
    expect(
      structure.headings.map(({ level, lineStart, syntaxEnd }) => ({
        level,
        lineStart,
        syntaxEnd
      }))
    ).toEqual([
      { level: 1, lineStart: 0, syntaxEnd: 6 },
      { level: 2, lineStart: 13, syntaxEnd: 22 }
    ]);
  });

  it.each([
    ['ATX', '# Heading\r\nbody\r\n', '# Heading'],
    ['Setext', 'Heading\r\n=======\r\nbody\r\n', '=======']
  ])(
    'places %s syntaxEnd before the complete terminating CRLF',
    (_name, source, syntaxLine) => {
      const [heading] = parseMarkdownStructure(source).headings;
      const expectedSyntaxEnd = source.indexOf(
        '\r\n',
        source.indexOf(syntaxLine)
      );

      expect(heading?.syntaxEnd).toBe(expectedSyntaxEnd);
      expect(source.slice(heading?.syntaxEnd, expectedSyntaxEnd + 2)).toBe(
        '\r\n'
      );
    }
  );

  it('describes only the opening ATX marker as mutable syntax', () => {
    const source = '### Title ##\n';

    expect(parseMarkdownStructure(source).headings[0]?.syntax).toEqual({
      kind: 'atx',
      openingMarkerRange: { from: 0, to: 3 }
    });
  });

  it.each([
    ['one-space indentation', ' ### Title\n', { from: 1, to: 4 }],
    ['three-space indentation', '   ### Title\r\n', { from: 3, to: 6 }],
    ['nested quote prefix', '> > ### Title ##\n', { from: 4, to: 7 }]
  ])('locates the physical ATX opener with %s', (_name, source, range) => {
    expect(parseMarkdownStructure(source).headings[0]?.syntax).toEqual({
      kind: 'atx',
      openingMarkerRange: range
    });
  });

  it('describes quoted Setext title and underline bytes exactly', () => {
    const source = '> Title\r\n> -----  \r\n';

    expect(parseMarkdownStructure(source).headings[0]?.syntax).toEqual({
      kind: 'setext',
      lineEnding: '\r\n',
      linePrefix: '> ',
      titleRanges: [{ from: 2, to: 7 }],
      underlineMarkerRange: { from: 11, to: 16 }
    });
  });

  it.each(
    [
      [
        'multiline LF',
        'First\nsecond\n-----\n',
        {
          kind: 'setext',
          lineEnding: '\n',
          linePrefix: '',
          titleRanges: [
            { from: 0, to: 5 },
            { from: 6, to: 12 }
          ],
          underlineMarkerRange: { from: 13, to: 18 }
        }
      ],
      [
        'three-space indentation',
        '   Title\n   =====\n',
        {
          kind: 'setext',
          lineEnding: '\n',
          // eslint-disable-next-line unicorn/prefer-string-repeat -- Keep the physical syntax expectation literal.
          linePrefix: '   ',
          titleRanges: [{ from: 3, to: 8 }],
          underlineMarkerRange: { from: 12, to: 17 }
        }
      ],
      [
        'nested quote prefix at EOF',
        '> > First\n> > second\n> > -----',
        {
          kind: 'setext',
          lineEnding: '',
          linePrefix: '> > ',
          titleRanges: [
            { from: 4, to: 9 },
            { from: 14, to: 20 }
          ],
          underlineMarkerRange: { from: 25, to: 30 }
        }
      ],
      [
        'callout body prefix',
        '> [!note]\n>\n> Title\n> -----\n',
        {
          kind: 'setext',
          lineEnding: '\n',
          linePrefix: '> ',
          titleRanges: [{ from: 14, to: 19 }],
          underlineMarkerRange: { from: 22, to: 27 }
        }
      ]
    ] as const
  )('describes physical Setext syntax with %s', (_name, source, syntax) => {
    expect(parseMarkdownStructure(source).headings[0]?.syntax).toEqual(syntax);
  });

  it('recognizes every ATX heading level', () => {
    const source = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n';
    expect(
      parseMarkdownStructure(source).headings.map(({ level }) => level)
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('assigns quoted headings to nested containers', () => {
    const source = '# Root\n> ## Quote\n> > ### Nested\n';
    const structure = parseMarkdownStructure(source);

    expect(structure.containers).toEqual([
      { depth: 0, end: 33, id: 'root', start: 0 },
      { depth: 1, end: 33, id: 'blockquote:7:32', start: 7 },
      { depth: 2, end: 33, id: 'blockquote:20:32', start: 18 }
    ]);
    expect(
      structure.headings.map((heading) => ({
        containerId: heading.container.id,
        depth: heading.container.depth,
        level: heading.level,
        lineStart: heading.lineStart
      }))
    ).toEqual([
      { containerId: 'root', depth: 0, level: 1, lineStart: 0 },
      {
        containerId: 'blockquote:7:32',
        depth: 1,
        level: 2,
        lineStart: 7
      },
      {
        containerId: 'blockquote:20:32',
        depth: 2,
        level: 3,
        lineStart: 18
      }
    ]);
  });

  it('assigns callout headings to the exact line-aligned container', () => {
    const source = '> [!note] Callout\n> ## Heading\n> body\n';
    const structure = parseMarkdownStructure(source);

    expect(structure.blocks).toEqual([
      { depth: 1, end: 38, kind: 'callout', start: 0 }
    ]);
    expect(structure.containers).toEqual([
      { depth: 0, end: 38, id: 'root', start: 0 },
      { depth: 1, end: 38, id: 'blockquote:0:37', start: 0 }
    ]);
    expect(structure.headings[0]?.container).toEqual({
      depth: 1,
      end: 38,
      id: 'blockquote:0:37',
      start: 0
    });
  });

  it('distinguishes plain blockquotes from callouts', () => {
    const source = '> quote\n\n> [!warning]- Collapsed\n> body\n';
    const calloutStart = source.indexOf('> [!warning]');

    expect(parseMarkdownStructure(source).blocks).toEqual([
      {
        depth: 1,
        end: source.indexOf('\n\n') + 1,
        kind: 'blockquote',
        start: 0
      },
      {
        depth: 1,
        end: source.length,
        kind: 'callout',
        start: calloutStart
      }
    ]);
  });

  it.each([
    ['spaces', 'not a callout'],
    ['punctuation', 'note?']
  ])('treats callout-like identifiers with %s as blockquotes', (_name, id) => {
    const source = `> [!${id}]\n> body\n`;

    expect(parseMarkdownStructure(source).blocks[0]?.kind).toBe('blockquote');
  });

  it('returns line-aligned fenced code block ranges', () => {
    const source = 'before\n```ts\nconst value = 1;\n```\nafter\n';
    const blockStart = source.indexOf('```ts');
    const blockEnd = source.indexOf('after');

    expect(parseMarkdownStructure(source).blocks).toContainEqual({
      depth: 0,
      end: blockEnd,
      kind: 'fenced-code',
      start: blockStart
    });
  });

  it('ends a quoted container at source length without a trailing line break', () => {
    const source = '> ## Heading';
    const structure = parseMarkdownStructure(source);

    expect(structure.containers[1]).toEqual({
      depth: 1,
      end: source.length,
      id: 'blockquote:0:12',
      start: 0
    });
  });

  it.each([
    ['backtick fence', '```md\n# hidden\n```\n# visible\n'],
    ['tilde fence', '~~~md\n# hidden\n~~~\n# visible\n'],
    ['indented code', '    # hidden\n# visible\n'],
    ['quoted fence', '> ```md\n> # hidden\n> ```\n> ## visible\n']
  ])('ignores headings in %s', (_name, source) => {
    expect(
      parseMarkdownStructure(source).headings.map(({ level }) => level)
    ).toEqual([source.includes('## visible') ? 2 : 1]);
  });

  it('uses physical line starts for quoted Setext headings', () => {
    const source = '> Title\n> ===\n> body\n';
    const [heading] = parseMarkdownStructure(source).headings;

    expect(heading).toMatchObject({ level: 1, lineStart: 0 });
    expect(heading?.container.depth).toBe(1);
  });

  it.each([
    ['root LF', 'previous\n\nFirst title\nsecond title\n===\n', 'First title'],
    [
      'quoted LF',
      '> previous\n>\n> First title\n> second title\n> ===\n',
      '> First title'
    ],
    [
      'root CRLF',
      'previous\r\n\r\nFirst title\r\nsecond title\r\n===\r\n',
      'First title'
    ],
    [
      'quoted CRLF',
      '> previous\r\n>\r\n> First title\r\n> second title\r\n> ===\r\n',
      '> First title'
    ]
  ])(
    'uses the first physical title line for a multiline Setext heading with %s',
    (_name, source, firstPhysicalLine) => {
      const [heading] = parseMarkdownStructure(source).headings;

      expect(heading).toMatchObject({
        lineStart: source.indexOf(firstPhysicalLine),
        syntaxStart: source.indexOf('First title')
      });
    }
  );

  it.each([
    ['frontmatter', '---\n# hidden\n---\n# visible\n'],
    ['frontmatter with BOM', '\u{FEFF}---\n# hidden\n...\n# visible\n'],
    ['unclosed frontmatter', '---\n# hidden\n'],
    ['frontmatter closing delimiter at EOF', '---\n# hidden\n---'],
    ['closed CRLF frontmatter', '---\r\n# hidden\r\n---\r\n# visible\r\n'],
    ['unclosed CRLF frontmatter', '---\r\n# hidden\r\n'],
    ['HTML comment', '<!--\n# hidden\n-->\n# visible\n'],
    ['paragraph-inline HTML comment', 'text <!-- %% -->\n# visible\n'],
    ['percent delimiters in frontmatter', '---\nvalue: %%\n---\n# visible\n'],
    ['percent delimiters in HTML comments', '<!-- %% -->\n# visible\n'],
    ['Obsidian comment', '%%\n# hidden\n%%\n# visible\n'],
    ['unclosed Obsidian comment', '%%\n# hidden\n']
  ])('ignores headings in %s', (_name, source) => {
    const visibleLevels = source.includes('# visible') ? [1] : [];
    expect(
      parseMarkdownStructure(source).headings.map(({ level }) => level)
    ).toEqual(visibleLevels);
  });

  it.each([
    ['frontmatter', '---\n```\nhidden\n```\n> quote\n---\n'],
    ['HTML comment', '<!--\n```\nhidden\n```\n> quote\n-->\n'],
    ['Obsidian comment', '%%\n```\nhidden\n```\n> quote\n%%\n']
  ])('does not expose structural blocks inside %s', (_name, source) => {
    expect(parseMarkdownStructure(source).blocks).toEqual([]);
  });

  it.each([
    ['fenced code', '```\n%%\n```\n# visible\n'],
    ['indented code', '    %%\n# visible\n'],
    ['inline code', '`%%`\n# visible\n']
  ])(
    'does not treat percent delimiters inside %s as Obsidian comments',
    (_name, source) => {
      expect(
        parseMarkdownStructure(source).headings.map(({ level }) => level)
      ).toEqual([1]);
    }
  );

  it('preserves fenced, HTML, and Obsidian comment structure boundaries', () => {
    const source = [
      '# before',
      '```md',
      '%%',
      '# fenced',
      '> fenced quote',
      '%%',
      '```',
      '<!-- %%',
      '# html',
      '> html quote',
      '%% -->',
      '%%',
      '# obsidian',
      '> obsidian quote',
      '```',
      'obsidian code',
      '```',
      '%%',
      '# after',
      ''
    ].join('\n');
    const structure = parseMarkdownStructure(source);

    expect(
      structure.headings.map(({ level, lineStart }) => ({ level, lineStart }))
    ).toEqual([
      { level: 1, lineStart: 0 },
      { level: 1, lineStart: source.indexOf('# after') }
    ]);
    expect(structure.blocks).toEqual([
      {
        depth: 0,
        end: source.indexOf('<!--'),
        kind: 'fenced-code',
        start: source.indexOf('```md')
      }
    ]);
    expect(structure.protectedRanges).toEqual([
      {
        from: source.indexOf('<!--'),
        to: source.indexOf('-->') + '-->'.length
      },
      {
        from: source.indexOf('%%', source.indexOf('-->') + '-->'.length),
        to: source.lastIndexOf('%%') + '%%'.length
      }
    ]);
  });

  it('protects headings and blocks through EOF for an unclosed Obsidian comment', () => {
    const source = '# visible\n%%\n## hidden\n> hidden quote\n```\nhidden\n```\n';
    const commentStart = source.indexOf('%%');
    const structure = parseMarkdownStructure(source);

    expect(
      structure.headings.map(({ level, lineStart }) => ({ level, lineStart }))
    ).toEqual([{ level: 1, lineStart: 0 }]);
    expect(structure.blocks).toEqual([]);
    expect(structure.protectedRanges).toEqual([
      { from: commentStart, to: source.length }
    ]);
  });

  it('keeps block-versus-block-protected-range membership work linear', () => {
    const unitCount = 128;
    const source = createProtectedMembershipFixture(unitCount);
    let blockRangeVisits = 0;

    const structure = parseMarkdownStructure(source, {
      onBlockRangeVisit() {
        blockRangeVisits += 1;
      }
    });

    expect(structure.blocks).toHaveLength(unitCount);
    expect(structure.protectedRanges).toHaveLength(unitCount);
    expect(blockRangeVisits).toBeGreaterThan(unitCount);
    expect(blockRangeVisits).toBeLessThanOrEqual(4 * unitCount);
  });

  it('keeps heading-versus-protected-range membership work linear', () => {
    const unitCount = 128;
    const source = createProtectedMembershipFixture(unitCount);
    let headingRangeVisits = 0;

    const structure = parseMarkdownStructure(source, {
      onHeadingRangeVisit() {
        headingRangeVisits += 1;
      }
    });

    expect(structure.headings).toHaveLength(unitCount);
    expect(structure.protectedRanges).toHaveLength(unitCount);
    expect(headingRangeVisits).toBeGreaterThan(unitCount);
    expect(headingRangeVisits).toBeLessThanOrEqual(5 * unitCount);
  });
});

describe('excludeOffsetsInRanges', () => {
  it('uses half-open boundaries while merging nested, overlapping, and touching ranges', () => {
    const orderedOffsets = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ranges = [
      { from: 9, to: 10 },
      { from: 4, to: 6 },
      { from: 1, to: 3 },
      { from: 3, to: 7 },
      { from: 2, to: 5 }
    ];

    expect(excludeOffsetsInRanges(orderedOffsets, ranges)).toEqual([
      0,
      7,
      8,
      10
    ]);
    expect(orderedOffsets).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ranges).toEqual(
      [
        { from: 9, to: 10 },
        { from: 4, to: 6 },
        { from: 1, to: 3 },
        { from: 3, to: 7 },
        { from: 2, to: 5 }
      ] satisfies readonly MarkdownRange[]
    );
  });

  it('keeps normalization and membership work linear for ordered delimiter offsets', () => {
    const itemCount = 1000;
    let membershipVisits = 0;
    let propertyReads = 0;
    const ranges = Array.from(
      { length: itemCount },
      (_, index): MarkdownRange => ({
        get from(): number {
          propertyReads += 1;
          return index * 2;
        },
        get to(): number {
          propertyReads += 1;
          return index * 2 + 1;
        }
      })
    );
    const orderedOffsets = Array.from(
      { length: itemCount },
      (_, index) => index * 2 + 1
    );

    expect(
      excludeOffsetsInRanges(orderedOffsets, ranges, () => {
        membershipVisits += 1;
      })
    ).toEqual(orderedOffsets);
    expect(propertyReads).toBeLessThanOrEqual(
      8 * (orderedOffsets.length + ranges.length)
    );
    expect(membershipVisits).toBeGreaterThan(0);
    expect(membershipVisits).toBeLessThanOrEqual(
      orderedOffsets.length + ranges.length
    );
  });
});
