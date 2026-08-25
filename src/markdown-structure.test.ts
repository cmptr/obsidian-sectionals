// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import { parseMarkdownStructure } from './markdown-structure.ts';

describe('parseMarkdownStructure', () => {
  it('returns ATX and Setext headings in source order', () => {
    const source = '# Root\nbody\nTitle\n---\n';
    const structure = parseMarkdownStructure(source);

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

    expect(
      structure.headings.map((heading) => ({
        depth: heading.container.depth,
        level: heading.level,
        lineStart: heading.lineStart
      }))
    ).toEqual([
      { depth: 0, level: 1, lineStart: 0 },
      { depth: 1, level: 2, lineStart: 7 },
      { depth: 2, level: 3, lineStart: 18 }
    ]);
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
