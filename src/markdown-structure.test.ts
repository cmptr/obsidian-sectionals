// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import { parseMarkdownStructure } from './markdown-structure.ts';

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
});
