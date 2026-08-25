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
    const source = 'Title\n===\nbody\nNext\n===\nkeep\n';
    expect(rangeText(source, source.indexOf('==='), 'section')).toBe(
      'Title\n===\nbody\n'
    );
  });

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
