// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import {
  collectDeletionTargets,
  formatDeletionTarget,
  planContextualDeletion,
  planSectionDeletion
} from './deletion-planner.ts';

function contextualRangeText(
  source: string,
  cursor: number,
  mode: 'blockquote' | 'callout' | 'fenced-code'
): null | string {
  const range = planContextualDeletion(source, cursor, mode);
  return range === null ? null : source.slice(range.from, range.to);
}

function rangeText(
  source: string,
  cursor: number,
  mode: 'heading-block' | 'section'
): null | string {
  const range = planSectionDeletion(source, cursor, mode);
  return range === null ? null : source.slice(range.from, range.to);
}

describe('collectDeletionTargets', () => {
  const nestedSource = [
    '# Setup',
    '> Outer quote',
    '> > [!note]',
    '> > ```ts',
    '> > code',
    '> > ```',
    '> Tail',
    '## Child',
    'child',
    '# Keep',
    ''
  ].join('\n');

  it('returns existing command scopes from smallest to largest', () => {
    const targets = collectDeletionTargets(
      nestedSource,
      nestedSource.indexOf('code')
    );

    expect(
      targets.map(({ kinds, range }) => ({ kinds, range }))
    ).toEqual([
      {
        kinds: ['fenced-code'],
        range: {
          from: nestedSource.indexOf('> > ```ts'),
          to: nestedSource.indexOf('> Tail')
        }
      },
      {
        kinds: ['callout'],
        range: {
          from: nestedSource.indexOf('> > [!note]'),
          to: nestedSource.indexOf('> Tail')
        }
      },
      {
        kinds: ['blockquote'],
        range: {
          from: nestedSource.indexOf('> Outer quote'),
          to: nestedSource.indexOf('## Child')
        }
      },
      {
        kinds: ['heading-block'],
        range: { from: 0, to: nestedSource.indexOf('## Child') }
      },
      {
        kinds: ['section'],
        range: { from: 0, to: nestedSource.indexOf('# Keep') }
      }
    ]);
  });

  it('formats source-derived details and physical line counts', () => {
    const targets = collectDeletionTargets(
      nestedSource,
      nestedSource.indexOf('code')
    );

    expect(targets.map((target) => formatDeletionTarget(target))).toEqual([
      'Fenced code · ts · 3 lines',
      'Callout · note · 4 lines',
      'Blockquote · Outer quote · 6 lines',
      'Heading block · Setup · 7 lines',
      'Section · Setup · 9 lines'
    ]);
  });

  it('formats merged heading semantics and singular lines', () => {
    const source = '# Installation\n# Keep\n';

    expect(
      collectDeletionTargets(source, source.indexOf('Installation')).map(
        (target) => formatDeletionTarget(target)
      )
    ).toEqual(['Section + heading block · Installation · 1 line']);
  });

  it.each([
    {
      expected: 'Section + heading block · First title · 4 lines',
      name: 'multiline Setext heading',
      source: 'First title\nsecond title\n===\nbody\n'
    },
    {
      expected: 'Fenced code · rust · 3 lines',
      name: 'tilde fence info token',
      source: '~~~rust extra\nfn main() {}\n~~~\n'
    },
    {
      expected: 'Fenced code · foo~bar · 3 lines',
      name: 'backtick fence info token containing a tilde',
      source: '```foo~bar\ncode\n```\n'
    },
    {
      expected: 'Fenced code · foo`bar · 3 lines',
      name: 'tilde fence info token containing a backtick',
      source: '~~~foo`bar\ncode\n~~~\n'
    },
    {
      expected: 'Fenced code · 3 lines',
      name: 'fence without info string',
      source: '```\ncode\n```\n'
    },
    {
      expected: 'Blockquote · Quoted text · 2 lines',
      name: 'blockquote after empty marker line',
      source: '>\n> Quoted text\n'
    },
    {
      expected: 'Section + heading block · **Install** · 2 lines',
      name: 'ATX heading with inline Markdown and closing hashes',
      source: '# **Install** ###\nbody\n'
    },
    {
      expected: 'Section + heading block · Title # · 3 lines',
      name: 'Setext heading ending in a content hash',
      source: 'Title #\n===\nbody\n'
    },
    {
      expected: 'Section + heading block · 2 lines',
      name: 'ATX heading containing only closing hashes',
      source: '# #\nbody\n'
    },
    {
      expected: 'Callout · NOTE · 2 lines',
      name: 'callout type with source spelling',
      source: '> [!NOTE] Title\n> body\n'
    },
    {
      expected: 'Section + heading block · Setup · 2 lines',
      name: 'CRLF physical line counting',
      source: '# Setup\r\nbody\r\n'
    }
  ])('formats $name', ({ expected, source }) => {
    /* eslint-disable unicorn/no-nested-ternary -- Keep the required table fixture cursor selection local. */
    const cursor = source.includes('code')
      ? source.indexOf('code')
      : source.includes('main')
      ? source.indexOf('main')
      : source.includes('Quoted')
      ? source.indexOf('Quoted')
      : source.indexOf('body');
    /* eslint-enable unicorn/no-nested-ternary -- Required table fixture cursor selection ends here. */

    expect(
      collectDeletionTargets(source, cursor).map((target) => formatDeletionTarget(target))
    ).toContain(expected);
  });

  it('omits a detail for a marker-only ATX heading', () => {
    const source = '# \nbody\n';

    expect(
      collectDeletionTargets(source, source.indexOf('body')).map((target) => formatDeletionTarget(target))
    ).toEqual(['Section + heading block · 2 lines']);
  });

  it('omits a detail for an empty blockquote', () => {
    const source = '>\n';

    expect(
      collectDeletionTargets(source, 0).map((target) => formatDeletionTarget(target))
    ).toEqual(['Blockquote · 1 line']);
  });

  it('merges identical section and heading-block ranges', () => {
    const source = '# Installation\nbody\n# Keep\n';
    const keepStart = source.indexOf('# Keep');

    expect(collectDeletionTargets(source, source.indexOf('body'))).toEqual([
      {
        detail: 'Installation',
        kinds: ['section', 'heading-block'],
        lineCount: 2,
        range: { from: 0, to: keepStart }
      }
    ]);
  });

  it('suppresses contextual targets inside a protected nested span', () => {
    const source = [
      '# Setup',
      '> Outer quote',
      '> %%',
      '> hidden',
      '> %%',
      '> tail',
      '# Keep',
      ''
    ].join('\n');

    expect(
      collectDeletionTargets(source, source.indexOf('hidden')).map(
        ({ kinds, range }) => ({ kinds, range })
      )
    ).toEqual([
      {
        kinds: ['section', 'heading-block'],
        range: { from: 0, to: source.indexOf('# Keep') }
      }
    ]);
  });

  it('returns only the nearest blockquote of the existing command semantic', () => {
    const source = '> outer\n> > inner\n> > cursor\n';
    const targets = collectDeletionTargets(source, source.indexOf('cursor'));

    expect(targets.map(({ kinds, range }) => ({ kinds, range }))).toEqual([
      {
        kinds: ['blockquote'],
        range: { from: source.indexOf('> > inner'), to: source.length }
      }
    ]);
  });

  it.each([-1, 4])('returns no targets for invalid offset %i', (cursor) => {
    expect(collectDeletionTargets('abc', cursor)).toEqual([]);
  });

  it('returns no targets for a non-integer offset', () => {
    expect(collectDeletionTargets('abc', 1.5)).toEqual([]);
  });

  it('counts a final line without a trailing line break', () => {
    const source = '# Final\nbody';

    expect(collectDeletionTargets(source, source.indexOf('body'))).toEqual([
      {
        detail: 'Final',
        kinds: ['section', 'heading-block'],
        lineCount: 2,
        range: { from: 0, to: source.length }
      }
    ]);
  });

  it('returns no targets in unterminated single-line frontmatter', () => {
    expect(collectDeletionTargets('---', 0)).toEqual([]);
  });
});

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

describe('planContextualDeletion', () => {
  it.each([
    ['backtick', '```ts\nconst value = 1;\n```\n'],
    ['tilde', '~~~ts\nconst value = 1;\n~~~\n']
  ])('deletes only the current %s fenced code block', (_name, fencedBlock) => {
    const source = `# Heading\nbefore\n${fencedBlock}after\n# Next\n`;
    const cursor = source.indexOf('const value');

    expect(contextualRangeText(source, cursor, 'fenced-code')).toBe(
      fencedBlock
    );
    expect(rangeText(source, cursor, 'section')).toBe(
      `# Heading\nbefore\n${fencedBlock}after\n`
    );
  });

  it('deletes a quoted fenced block without deleting its callout', () => {
    const source = '> [!note]\n> before\n> ```ts\n> const value = 1;\n> ```\n> after\n';

    expect(
      contextualRangeText(source, source.indexOf('const value'), 'fenced-code')
    ).toBe('> ```ts\n> const value = 1;\n> ```\n');
  });

  it('deletes the current callout as a complete line-aligned block', () => {
    const callout = '> [!warning]- Caution\n> body\n';
    const source = `before\n${callout}\nafter\n`;

    expect(contextualRangeText(source, source.indexOf('body'), 'callout')).toBe(
      callout
    );
  });

  it('deletes the current plain blockquote', () => {
    const blockquote = '> quote\n> body\n';
    const source = `before\n${blockquote}\nafter\n`;

    expect(
      contextualRangeText(source, source.indexOf('body'), 'blockquote')
    ).toBe(blockquote);
  });

  it('does not treat a callout as a plain blockquote', () => {
    const source = '> [!note]\n> body\n';

    expect(
      planContextualDeletion(source, source.indexOf('body'), 'blockquote')
    ).toBeNull();
  });

  it('offers distinct nested blockquote and callout ranges', () => {
    const nested = '> > nested\n> > body\n';
    const source = `> [!note]\n> outer\n${nested}>\n> tail\n`;
    const cursor = source.indexOf('body');

    expect(contextualRangeText(source, cursor, 'blockquote')).toBe(nested);
    expect(contextualRangeText(source, cursor, 'callout')).toBe(source);
  });

  it('returns null outside a requested block kind', () => {
    const source = '# Heading\nbody\n';

    expect(
      planContextualDeletion(source, source.indexOf('body'), 'fenced-code')
    ).toBeNull();
  });

  it.each([
    ['Obsidian comment', '> quote\n> %%\n> hidden\n> %%\n> tail\n'],
    ['HTML comment', '> quote\n> <!--\n> hidden\n> -->\n> tail\n']
  ])(
    'does not target an enclosing blockquote from inside an %s',
    (_name, source) => {
      expect(
        planContextualDeletion(source, source.indexOf('hidden'), 'blockquote')
      ).toBeNull();
      expect(
        contextualRangeText(source, source.indexOf('tail'), 'blockquote')
      ).toBe(source);
    }
  );

  it('does not target the empty EOF line after a final block', () => {
    const source = '```\ncode\n```\n';

    expect(
      planContextualDeletion(source, source.length, 'fenced-code')
    ).toBeNull();
  });

  it('targets true EOF inside a final block without a trailing line break', () => {
    const source = '```\ncode\n```';

    expect(contextualRangeText(source, source.length, 'fenced-code')).toBe(
      source
    );
  });

  it.each([-1, 4])(
    'rejects cursor offset %i outside a three-character source',
    (cursor) => {
      expect(planContextualDeletion('```', cursor, 'fenced-code')).toBeNull();
    }
  );
});
