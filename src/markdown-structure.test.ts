// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import { parseMarkdownStructure } from './markdown-structure.ts';

describe('parseMarkdownStructure', () => {
  it('returns ATX and Setext headings in source order', () => {
    const source = '# Root\nbody\nTitle\n---\n';
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
      { level: 2, lineStart: 12, syntaxEnd: 21 }
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
});
