// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

import type { DestinationFile } from './section-extraction-destination.ts';
import type { SectionExtractionDraft } from './section-extraction-planner.ts';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible destination imports compact.
import { createExtractionWikilink, prepareExtractionDestination } from './section-extraction-destination.ts';
import { planSectionExtraction } from './section-extraction-planner.ts';

function createDraft(title = 'Beta'): SectionExtractionDraft {
  return createDraftFromSource(`# ${title}\nbody\n`);
}

function createDraftFromSource(source: string): SectionExtractionDraft {
  const plan = planSectionExtraction(source, source.indexOf('\n') + 1);
  if (plan.kind !== 'ready') {
    throw new Error(`Expected ready extraction plan, received ${plan.kind}.`);
  }
  return plan.draft;
}

describe('prepareExtractionDestination paths', () => {
  it.each([
    {
      expectedPath: 'Beta.md',
      name: 'vault root',
      parentPath: '',
      sourcePath: 'Projects/Alpha.md'
    },
    {
      expectedPath: 'Notes/Beta.md',
      name: 'configured folder',
      parentPath: 'Notes',
      sourcePath: 'Projects/Alpha.md'
    },
    {
      expectedPath: 'Projects/Beta.md',
      name: 'source folder',
      parentPath: 'Projects',
      sourcePath: 'Projects/Alpha.md'
    }
  ])('prepares a destination in the $name', ({
    expectedPath,
    parentPath,
    sourcePath
  }) => {
    const getNewFileParent = vi.fn(() => ({ path: parentPath }));
    const fileExists = vi.fn(() => false);
    const draft = createDraft();

    expect(
      prepareExtractionDestination(draft, sourcePath, {
        fileExists,
        getNewFileParent,
        resolveLink: vi.fn()
      })
    ).toEqual({
      content: draft.destinationContent,
      filename: 'Beta.md',
      kind: 'ready',
      path: expectedPath,
      suffixIndex: 0
    });
    expect(getNewFileParent).toHaveBeenCalledExactlyOnceWith(
      sourcePath,
      'Beta.md'
    );
    expect(fileExists).toHaveBeenCalledExactlyOnceWith(expectedPath);
  });

  it('asks for each candidate parent and selects the first available numbered path', () => {
    const getNewFileParent = vi.fn(() => ({ path: 'Notes' }));
    const fileExists = vi.fn((path: string) => path === 'Notes/Beta.md' || path === 'Notes/Beta 1.md');
    const draft = createDraft();

    expect(
      prepareExtractionDestination(draft, 'Projects/Alpha.md', {
        fileExists,
        getNewFileParent,
        resolveLink: vi.fn()
      })
    ).toEqual({
      content: draft.destinationContent,
      filename: 'Beta 2.md',
      kind: 'ready',
      path: 'Notes/Beta 2.md',
      suffixIndex: 2
    });
    expect(getNewFileParent.mock.calls).toEqual([
      ['Projects/Alpha.md', 'Beta.md'],
      ['Projects/Alpha.md', 'Beta 1.md'],
      ['Projects/Alpha.md', 'Beta 2.md']
    ]);
    expect(fileExists.mock.calls).toEqual([
      ['Notes/Beta.md'],
      ['Notes/Beta 1.md'],
      ['Notes/Beta 2.md']
    ]);
  });

  it('starts collision selection at an arbitrary suffix index', () => {
    const getNewFileParent = vi.fn(() => ({ path: 'Notes' }));
    const draft = createDraft();

    expect(
      prepareExtractionDestination(draft, 'Alpha.md', {
        fileExists: vi.fn(() => false),
        getNewFileParent,
        resolveLink: vi.fn()
      }, 7)
    ).toMatchObject({
      filename: 'Beta 7.md',
      path: 'Notes/Beta 7.md',
      suffixIndex: 7
    });
    expect(getNewFileParent).toHaveBeenCalledExactlyOnceWith(
      'Alpha.md',
      'Beta 7.md'
    );
  });

  it('normalizes POSIX parent segments before checking and returning the path', () => {
    const fileExists = vi.fn(() => false);

    expect(
      prepareExtractionDestination(createDraft(), 'Alpha.md', {
        fileExists,
        getNewFileParent: vi.fn(() => ({
          path: 'Projects//Current/../Extracted/.'
        })),
        resolveLink: vi.fn()
      })
    ).toMatchObject({ path: 'Projects/Extracted/Beta.md' });
    expect(fileExists).toHaveBeenCalledExactlyOnceWith(
      'Projects/Extracted/Beta.md'
    );
  });

  it('keeps path-like title text inside the returned parent', () => {
    const draft = createDraft('../../Beta');

    expect(
      prepareExtractionDestination(draft, 'Alpha.md', {
        fileExists: vi.fn(() => false),
        getNewFileParent: vi.fn(() => ({ path: 'Notes' })),
        resolveLink: vi.fn()
      })
    ).toMatchObject({
      filename: 'Beta.md',
      path: 'Notes/Beta.md'
    });
  });

  it.each(['../Escape', String.raw`..\Escape`])(
    'rejects a forged filename stem containing path separators: %s',
    (filenameStem) => {
      const fileExists = vi.fn(() => false);
      const getNewFileParent = vi.fn(() => ({ path: 'Notes' }));
      const draft = { ...createDraft(), filenameStem };

      expect(() =>
        prepareExtractionDestination(draft, 'Alpha.md', {
          fileExists,
          getNewFileParent,
          resolveLink: vi.fn()
        })
      ).toThrow(TypeError);
      expect(fileExists).not.toHaveBeenCalled();
      expect(getNewFileParent).not.toHaveBeenCalled();
    }
  );

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects the non-safe starting suffix %s before consulting services',
    (startingSuffixIndex) => {
      const fileExists = vi.fn(() => false);
      const getNewFileParent = vi.fn(() => ({ path: '' }));

      expect(() =>
        prepareExtractionDestination(createDraft(), 'Alpha.md', {
          fileExists,
          getNewFileParent,
          resolveLink: vi.fn()
        }, startingSuffixIndex)
      ).toThrow(RangeError);
      expect(fileExists).not.toHaveBeenCalled();
      expect(getNewFileParent).not.toHaveBeenCalled();
    }
  );
});

describe('createExtractionWikilink', () => {
  it('uses the shortest provided linktext without an alias for the unchanged plain title', () => {
    expect(createExtractionWikilink('Beta', 'Beta', 'Beta')).toBe('[[Beta]]');
  });

  it.each([
    {
      createdBasename: 'Beta 1',
      expected: '[[Beta 1|Beta]]',
      shortestLinktext: 'Beta 1'
    },
    {
      createdBasename: 'Beta',
      expected: '[[Notes/Beta|Beta]]',
      shortestLinktext: 'Notes/Beta'
    },
    {
      createdBasename: 'Filename',
      expected: '[[Beta|Beta]]',
      shortestLinktext: 'Beta'
    }
  ])('aliases the original title when the target differs: $expected', ({
    createdBasename,
    expected,
    shortestLinktext
  }) => {
    expect(
      createExtractionWikilink(shortestLinktext, 'Beta', createdBasename)
    ).toBe(expected);
  });

  it('escapes wikilink delimiters and backslashes in an unaliased target', () => {
    expect(
      createExtractionWikilink(
        String.raw`A|B]\C`,
        String.raw`A|B]\C`,
        String.raw`A|B]\C`
      )
    ).toBe(String.raw`[[A\|B\]\\C]]`);
  });

  it('escapes wikilink delimiters and backslashes in both target and alias', () => {
    expect(
      createExtractionWikilink(
        String.raw`Notes/A|B]\C`,
        String.raw`A|B]\C`,
        String.raw`A|B]\C`
      )
    ).toBe(String.raw`[[Notes/A\|B\]\\C|A\|B\]\\C]]`);
  });

  it.each([
    {
      displayTitle: 'Beta',
      name: 'empty linktext',
      shortestLinktext: ''
    },
    {
      displayTitle: 'Beta',
      name: 'whitespace-only linktext',
      shortestLinktext: ' '.repeat(3)
    },
    {
      displayTitle: '',
      name: 'empty display title',
      shortestLinktext: 'Beta'
    },
    {
      displayTitle: '\t',
      name: 'whitespace-only display title',
      shortestLinktext: 'Beta'
    }
  ])('rejects $name', ({ displayTitle, shortestLinktext }) => {
    expect(() => createExtractionWikilink(shortestLinktext, displayTitle, 'Beta')).toThrow(TypeError);
  });
});

describe('prepareExtractionDestination Markdown targets', () => {
  it.each([
    {
      expectedTarget: 'Target.md',
      name: 'same folder',
      parentPath: 'Extracted',
      resolvedPath: 'Extracted/Target.md',
      sourceTarget: '../Target.md'
    },
    {
      expectedTarget: 'Child/Target',
      name: 'child folder',
      parentPath: 'Extracted',
      resolvedPath: 'Extracted/Child/Target.md',
      sourceTarget: 'Target'
    },
    {
      expectedTarget: '../Target.md',
      name: 'parent folder',
      parentPath: 'Extracted/Child',
      resolvedPath: 'Extracted/Target.md',
      sourceTarget: '../Target.md'
    },
    {
      expectedTarget: '../Two/Target',
      name: 'sibling folder',
      parentPath: 'Extracted/One',
      resolvedPath: 'Extracted/Two/Target.md',
      sourceTarget: 'Target'
    }
  ])('rewrites a note target in the $name', ({
    expectedTarget,
    parentPath,
    resolvedPath,
    sourceTarget
  }) => {
    const source = `# Beta\n[Target](${sourceTarget}#Section)\n`;
    const draft = createDraftFromSource(source);
    const resolveLink = vi.fn(() => ({
      extension: 'md',
      path: resolvedPath
    }));

    expect(
      prepareExtractionDestination(draft, 'Source/Alpha.md', {
        fileExists: vi.fn(() => false),
        getNewFileParent: vi.fn(() => ({ path: parentPath })),
        resolveLink
      })
    ).toMatchObject({
      content: `# Beta\n\n[Target](${expectedTarget}#Section)\n`,
      kind: 'ready'
    });
    expect(resolveLink).toHaveBeenCalledExactlyOnceWith(
      sourceTarget,
      'Source/Alpha.md'
    );
  });

  it('retains attachment extensions when the original target omits a Markdown extension', () => {
    const source = '# Beta\n![Diagram](assets/diagram)\n';
    const draft = createDraftFromSource(source);

    expect(
      prepareExtractionDestination(draft, 'Projects/Alpha.md', {
        fileExists: vi.fn(() => false),
        getNewFileParent: vi.fn(() => ({ path: 'Extracted' })),
        resolveLink: vi.fn(() => ({
          extension: 'png',
          path: 'Extracted/Assets/Diagram.png'
        }))
      })
    ).toMatchObject({
      content: '# Beta\n\n![Diagram](Assets/Diagram.png)\n'
    });
  });

  it('normalizes and URI-encodes Unicode, spaces, and parentheses while preserving subpaths', () => {
    const source = [
      '# Beta',
      '[Plan](<../Plans/Plan#Résumé>)',
      '![Diagram](../Assets/Diagram.png#^block-ref)',
      ''
    ].join('\n');
    const draft = createDraftFromSource(source);
    const resolvedFiles: Readonly<Record<string, DestinationFile>> = {
      '../Assets/Diagram.png': {
        extension: 'png',
        path: 'Notes//Media/../東京 (final)/Diagram (β).png'
      },
      '../Plans/Plan': {
        extension: 'md',
        path: 'Notes//Drafts/../東京 (final)/Plan (β).md'
      }
    };

    expect(
      prepareExtractionDestination(draft, 'Projects/Alpha.md', {
        fileExists: vi.fn(() => false),
        getNewFileParent: vi.fn(() => ({ path: 'Notes/.' })),
        resolveLink: vi.fn((linkpath: string) => resolvedFiles[linkpath] ?? null)
      })
    ).toMatchObject({
      content: [
        '# Beta',
        '',
        '[Plan](<%E6%9D%B1%E4%BA%AC%20%28final%29/Plan%20%28%CE%B2%29#Résumé>)',
        '![Diagram](%E6%9D%B1%E4%BA%AC%20%28final%29/Diagram%20%28%CE%B2%29.png#^block-ref)',
        ''
      ].join('\n')
    });
  });

  it('leaves external and same-note targets unchanged and does not resolve them', () => {
    const source = [
      '# Beta',
      '[External](https://example.com/plan)',
      '[Heading](#Scope)',
      '[Block](#^scope-block)',
      '[Relative](../Plan.md)',
      ''
    ].join('\n');
    const draft = createDraftFromSource(source);
    const resolveLink = vi.fn(() => ({
      extension: 'md',
      path: 'Notes/Plan.md'
    }));

    const preparation = prepareExtractionDestination(
      draft,
      'Projects/Alpha.md',
      {
        fileExists: vi.fn(() => false),
        getNewFileParent: vi.fn(() => ({ path: 'Notes' })),
        resolveLink
      }
    );

    expect(preparation).toMatchObject({
      content: [
        '# Beta',
        '',
        '[External](https://example.com/plan)',
        '[Heading](#Scope)',
        '[Block](#^scope-block)',
        '[Relative](Plan.md)',
        ''
      ].join('\n'),
      kind: 'ready'
    });
    expect(resolveLink).toHaveBeenCalledExactlyOnceWith(
      '../Plan.md',
      'Projects/Alpha.md'
    );
  });

  it('rewrites from the available candidate parent rather than a collided candidate parent', () => {
    const source = '# Beta\n[Target](../Target.md)\n';
    const draft = createDraftFromSource(source);
    const getNewFileParent = vi.fn((_sourcePath: string, filename: string) => ({
      path: filename === 'Beta.md' ? 'First' : 'Second'
    }));

    expect(
      prepareExtractionDestination(draft, 'Source/Alpha.md', {
        fileExists: vi.fn((path) => path === 'First/Beta.md'),
        getNewFileParent,
        resolveLink: vi.fn(() => ({
          extension: 'md',
          path: 'Second/Target.md'
        }))
      })
    ).toMatchObject({
      content: '# Beta\n\n[Target](Target.md)\n',
      path: 'Second/Beta 1.md',
      suffixIndex: 1
    });
  });

  it('returns invalid when any relative target cannot be resolved', () => {
    const draft = createDraftFromSource(
      '# Beta\n[One](one.md) [Two](two.md)\n'
    );

    expect(
      prepareExtractionDestination(draft, 'Source/Alpha.md', {
        fileExists: vi.fn(() => false),
        getNewFileParent: vi.fn(() => ({ path: 'Notes' })),
        resolveLink: vi.fn((linkpath) =>
          linkpath === 'one.md'
            ? { extension: 'md', path: 'Notes/One.md' }
            : null
        )
      })
    ).toEqual({
      kind: 'invalid',
      reason: 'unresolved-relative-link'
    });
  });
});
