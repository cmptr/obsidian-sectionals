// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import { planSectionDeletion } from './deletion-planner.ts';

function rangeText(
  source: string,
  cursor: number,
  mode: 'heading-block' | 'section'
): null | string {
  const range = planSectionDeletion(source, cursor, mode);
  return range === null ? null : source.slice(range.from, range.to);
}

describe('planSectionDeletion', () => {
  const hierarchy = '# Root\nintro\n## Target\nbody\n### Child\nchild body\n## Next\nkeep\n';

  it('deletes descendants in section mode', () => {
    expect(rangeText(hierarchy, hierarchy.indexOf('body'), 'section')).toBe(
      '## Target\nbody\n### Child\nchild body\n'
    );
  });

  it('stops at any heading in heading-block mode', () => {
    expect(
      rangeText(hierarchy, hierarchy.indexOf('body'), 'heading-block')
    ).toBe('## Target\nbody\n');
  });

  it('targets the nearest nested heading under the cursor', () => {
    expect(
      rangeText(hierarchy, hierarchy.indexOf('child body'), 'section')
    ).toBe('### Child\nchild body\n');
  });

  it('returns null before the first heading', () => {
    expect(
      planSectionDeletion('introduction\n# Heading\nbody\n', 2, 'section')
    ).toBeNull();
  });

  it('targets a Setext heading from its underline', () => {
    const source = 'Title\n===\nbody\n# Next\nkeep\n';
    expect(rangeText(source, source.indexOf('==='), 'section')).toBe(
      'Title\n===\nbody\n'
    );
  });

  it.each([
    {
      after: '# Next\nkeep\n',
      before: '# Before\nkeep\n\n',
      cursorLines: ['First title', 'second title', '==='],
      headingText: 'First title\nsecond title\n===\nbody\n',
      name: 'root LF'
    },
    {
      after: '> # Next\n> keep\n',
      before: '> # Before\n> keep\n>\n',
      cursorLines: ['> First title', '> second title', '> ==='],
      headingText: '> First title\n> second title\n> ===\n> body\n',
      name: 'quoted LF'
    },
    {
      after: '# Next\r\nkeep\r\n',
      before: '# Before\r\nkeep\r\n\r\n',
      cursorLines: ['First title', 'second title', '==='],
      headingText: 'First title\r\nsecond title\r\n===\r\nbody\r\n',
      name: 'root CRLF'
    },
    {
      after: '> # Next\r\n> keep\r\n',
      before: '> # Before\r\n> keep\r\n>\r\n',
      cursorLines: ['> First title', '> second title', '> ==='],
      headingText: '> First title\r\n> second title\r\n> ===\r\n> body\r\n',
      name: 'quoted CRLF'
    }
  ])(
    'targets every line of a multiline Setext heading in $name',
    ({ after, before, cursorLines, headingText }) => {
      const source = before + headingText + after;
      const expectedRange = {
        from: before.length,
        to: before.length + headingText.length
      };

      for (const cursorLine of cursorLines) {
        const cursor = source.indexOf(cursorLine, before.length);
        const range = planSectionDeletion(source, cursor, 'section');

        expect(range).toEqual(expectedRange);
        if (range === null) {
          continue;
        }
        expect(source.slice(0, range.from)).toBe(before);
        expect(source.slice(range.to)).toBe(after);
        expect(source.slice(0, range.from) + source.slice(range.to)).toBe(
          before + after
        );
      }
    }
  );

  it.each([
    ['the heading line', 2],
    ['a blank line in its body', '# Target\nbody\n'.length]
  ])('targets a section from %s', (_name, cursor) => {
    const source = '# Target\nbody\n\n# Next\nkeep\n';
    expect(rangeText(source, cursor, 'section')).toBe('# Target\nbody\n\n');
  });

  it('prefers the deepest quoted section and stops at its container end', () => {
    const source = '# Outer\n> [!note]\n> ## Inner\n> body\n\nafter\n';
    expect(rangeText(source, source.indexOf('body'), 'section')).toBe(
      '> ## Inner\n> body\n'
    );
  });

  it('falls back to the outer heading when a quote has no heading', () => {
    const source = '# Outer\n> quoted body\n# Next\nkeep\n';
    expect(rangeText(source, source.indexOf('quoted body'), 'section')).toBe(
      '# Outer\n> quoted body\n'
    );
  });

  it('keeps a nested quoted deletion inside the nested container', () => {
    const source = '> ## Outer\n> > ### Inner\n> > body\n>\n> outer tail\n';
    expect(rangeText(source, source.indexOf('body'), 'section')).toBe(
      '> > ### Inner\n> > body\n'
    );
  });

  it('uses the next quoted heading as a boundary', () => {
    const source = '> [!note]\n> ## Delete\n> body\n> ## Keep\n> unchanged\n';
    expect(rangeText(source, source.indexOf('body'), 'section')).toBe(
      '> ## Delete\n> body\n'
    );
  });

  it('preserves a same-depth sibling blockquote byte-for-byte', () => {
    const deleted = '> ## Delete\n> body\n';
    const separator = '\n';
    const sibling = '> ## Keep\n>   unchanged  \n> `literal`\n';
    const source = deleted + separator + sibling;
    const range = planSectionDeletion(
      source,
      source.indexOf('body'),
      'section'
    );

    expect(range).toEqual({ from: 0, to: deleted.length });
    if (range === null) {
      return;
    }
    const updated = source.slice(0, range.from) + source.slice(range.to);
    const updatedSiblingStart = updated.indexOf('> ## Keep');
    expect(source.slice(source.indexOf('> ## Keep'))).toBe(sibling);
    expect(updated.slice(updatedSiblingStart)).toBe(sibling);
  });

  it('ignores heading-like code while retaining it in the surrounding section', () => {
    const source = '# Target\n```md\n## not a boundary\n```\n# Next\n';
    expect(rangeText(source, source.indexOf('not a boundary'), 'section')).toBe(
      '# Target\n```md\n## not a boundary\n```\n'
    );
  });

  it('preserves the surviving boundary exactly and removes preceding blank lines', () => {
    const source = '# Delete\nbody\n\n\n# Keep\n  unchanged\n';
    const range = planSectionDeletion(
      source,
      source.indexOf('body'),
      'section'
    );
    expect(range).toEqual({ from: 0, to: source.indexOf('# Keep') });
    expect(source.slice(range?.to)).toBe('# Keep\n  unchanged\n');
  });

  it('supports CRLF without splitting a heading line', () => {
    const source = '# Delete\r\nbody\r\n# Keep\r\n';
    expect(rangeText(source, source.indexOf('body'), 'section')).toBe(
      '# Delete\r\nbody\r\n'
    );
  });

  it('targets the final section when the cursor is at EOF', () => {
    const source = '# Final\nbody';
    expect(rangeText(source, source.length, 'section')).toBe(source);
  });

  it.each([-1, 4])(
    'rejects cursor offset %i outside a three-character source',
    (cursor) => {
      expect(planSectionDeletion('# H', cursor, 'section')).toBeNull();
    }
  );
});
