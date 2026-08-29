// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible dependency types compact.
import type { DependencyAnalysis, RelativeMarkdownTarget } from './extraction-dependencies.ts';
import type { MarkdownRange } from './markdown-structure.ts';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible dependency imports compact.
import { analyzeExtractionDependencies, rewriteMarkdownTargets } from './extraction-dependencies.ts';

function analyzeWholeSource(source: string): DependencyAnalysis {
  return analyzeExtractionDependencies(
    source,
    { from: 0, to: source.length },
    source
  );
}

function expectReadyTargets(
  source: string,
  destinationContent = source,
  sectionRange?: MarkdownRange
): readonly RelativeMarkdownTarget[] {
  const effectiveSectionRange = sectionRange ?? { from: 0, to: source.length };
  const analysis = analyzeExtractionDependencies(
    source,
    effectiveSectionRange,
    destinationContent
  );
  expect(analysis.kind).toBe('ready');
  if (analysis.kind !== 'ready') {
    throw new Error(`Expected ready analysis, received ${analysis.kind}.`);
  }
  return analysis.targets;
}

function getSectionRange(source: string, heading: string): MarkdownRange {
  const from = source.indexOf(heading);
  const nextHeading = source.indexOf('\n# ', from + heading.length);
  return {
    from,
    to: nextHeading === -1 ? source.length : nextHeading + 1
  };
}

describe('analyzeExtractionDependencies inline targets', () => {
  it('collects only inline link destination bytes while preserving its label and title', () => {
    const source = '[Project plan](notes/Plan.md#Milestone "Open plan")';
    const [target] = expectReadyTargets(source);

    expect(target).toEqual({
      explicitMarkdownExtension: true,
      from: source.indexOf('notes/Plan.md'),
      kind: 'link',
      linkpath: 'notes/Plan.md',
      subpath: '#Milestone',
      to: source.indexOf(' "Open plan"')
    });
    expect(source.slice(target?.from, target?.to)).toBe(
      'notes/Plan.md#Milestone'
    );
  });

  it('collects only an angle-bracket image destination and retains a block subpath', () => {
    const source = '![Diagram](<assets/my diagram.png#^overview> \'Caption\')';
    const [target] = expectReadyTargets(source);

    expect(target).toEqual({
      explicitMarkdownExtension: false,
      from: source.indexOf('assets/my diagram.png'),
      kind: 'embed',
      linkpath: 'assets/my diagram.png',
      subpath: '#^overview',
      to: source.indexOf('>')
    });
    expect(source.slice(target?.from, target?.to)).toBe(
      'assets/my diagram.png#^overview'
    );
  });

  it.each([
    {
      destination: String.raw`folder/a\(b\).md#Part`,
      explicitMarkdownExtension: true,
      markdown: String.raw`[escaped](folder/a\(b\).md#Part)`,
      path: String.raw`folder/a\(b\).md`,
      subpath: '#Part'
    },
    {
      destination: 'folder/My%20Note.md#A%20B',
      explicitMarkdownExtension: true,
      markdown: '[encoded](folder/My%20Note.md#A%20B)',
      path: 'folder/My%20Note.md',
      subpath: '#A%20B'
    },
    {
      destination: String.raw`folder/name\#part.md`,
      explicitMarkdownExtension: true,
      markdown: String.raw`[escaped hash](folder/name\#part.md)`,
      path: String.raw`folder/name\#part.md`,
      subpath: ''
    }
  ])(
    'retains significant destination syntax in $markdown',
    ({ destination, explicitMarkdownExtension, markdown, path, subpath }) => {
      const [target] = expectReadyTargets(markdown);

      expect(target).toMatchObject({
        explicitMarkdownExtension,
        linkpath: path,
        subpath
      });
      expect(markdown.slice(target?.from, target?.to)).toBe(destination);
    }
  );

  it.each([
    '[[Wiki target]]',
    '![[Embedded target]]',
    '[web](https://example.com/note.md)',
    '[mail](mailto:hello@example.com)',
    '[protocol relative](//example.com/note.md)',
    '![data](data:image/png;base64,abc)',
    '[root](/folder/note.md)',
    '[heading](#Local)',
    '[block](^local-block)'
  ])('does not collect the non-relative target %s', (source) => {
    expect(analyzeWholeSource(source)).toEqual({ kind: 'ready', targets: [] });
  });

  it.each([
    '[missing close](folder/note.md',
    '[missing destination]()',
    String.raw`\[escaped](folder/note.md)`,
    '[not a link] (folder/note.md)'
  ])('does not collect the malformed or escaped construct %s', (source) => {
    expect(analyzeWholeSource(source)).toEqual({ kind: 'ready', targets: [] });
  });

  it('ignores links in code and comments while collecting adjacent live links', () => {
    const source = [
      '`[inline](inline.md)`',
      '```md',
      '[fenced](fenced.md)',
      '```',
      '    [indented](indented.md)',
      '<!-- [html](html.md) -->',
      '%% [obsidian](obsidian.md) %%',
      '[live](live.md)',
      ''
    ].join('\n');
    const targets = expectReadyTargets(source);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      kind: 'link',
      linkpath: 'live.md'
    });
  });
});

describe('analyzeExtractionDependencies reference boundaries', () => {
  it('is ready when a reference definition and every use are inside', () => {
    const source = [
      '# Extract',
      '[first][Shared] and [Shared][] and [Shared].',
      '',
      '[shared]: folder/note.md#Part "Title"',
      '# Keep',
      'outside text',
      ''
    ].join('\n');
    const sectionRange = getSectionRange(source, '# Extract');
    const destinationContent = [
      '# Extract',
      '',
      '[first][Shared] and [Shared][] and [Shared].',
      '',
      '[shared]: folder/note.md#Part "Title"',
      ''
    ].join('\n');
    const targets = expectReadyTargets(
      source,
      destinationContent,
      sectionRange
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      explicitMarkdownExtension: true,
      kind: 'reference-definition',
      linkpath: 'folder/note.md',
      subpath: '#Part'
    });
    expect(destinationContent.slice(targets[0]?.from, targets[0]?.to)).toBe(
      'folder/note.md#Part'
    );
  });

  it('is ready when a reference definition and every use are outside', () => {
    const source = [
      '# Extract',
      'body',
      '# Keep',
      '[outside][shared]',
      '',
      '[shared]: folder/note.md',
      ''
    ].join('\n');

    expect(
      analyzeExtractionDependencies(
        source,
        getSectionRange(source, '# Extract'),
        '# Extract\n\nbody\n'
      )
    ).toEqual({ kind: 'ready', targets: [] });
  });

  it.each([
    {
      name: 'use inside and definition outside',
      source: '# Extract\n[inside][ref]\n# Keep\n[ref]: note.md\n'
    },
    {
      name: 'definition inside and use outside',
      source: '# Extract\n[ref]: note.md\n# Keep\n[outside][ref]\n'
    },
    {
      name: 'uses on both sides',
      source: '# Extract\n[inside][ref]\n\n[ref]: note.md\n# Keep\n[outside][ref]\n'
    },
    {
      name: 'image use inside and definition outside',
      source: '# Extract\n![inside][ref]\n# Keep\n[ref]: image.png\n'
    }
  ])('rejects a reference with $name', ({ source }) => {
    expect(
      analyzeExtractionDependencies(
        source,
        getSectionRange(source, '# Extract'),
        '# Extract\n\nbody\n'
      )
    ).toEqual({ kind: 'invalid', reason: 'cross-boundary-reference' });
  });

  it('ignores escaped and code-contained reference-like text', () => {
    const source = [
      '# Extract',
      String.raw`\[ref]`,
      '`[inline][ref]`',
      '```md',
      '[fenced][ref]',
      '```',
      '# Keep',
      '[ref]: note.md',
      ''
    ].join('\n');

    expect(
      analyzeExtractionDependencies(
        source,
        getSectionRange(source, '# Extract'),
        '# Extract\n\nbody\n'
      )
    ).toEqual({ kind: 'ready', targets: [] });
  });
});

describe('analyzeExtractionDependencies footnote boundaries', () => {
  it('is ready when a footnote definition and every use are inside', () => {
    const source = '# Extract\nText[^note].\n\n[^note]: detail\n# Keep\nbody\n';

    expect(
      analyzeExtractionDependencies(
        source,
        getSectionRange(source, '# Extract'),
        '# Extract\n\nText[^note].\n\n[^note]: detail\n'
      )
    ).toEqual({ kind: 'ready', targets: [] });
  });

  it('is ready when a footnote definition and every use are outside', () => {
    const source = '# Extract\nbody\n# Keep\nText[^note].\n\n[^note]: detail\n';

    expect(
      analyzeExtractionDependencies(
        source,
        getSectionRange(source, '# Extract'),
        '# Extract\n\nbody\n'
      )
    ).toEqual({ kind: 'ready', targets: [] });
  });

  it.each([
    {
      name: 'use inside and definition outside',
      source: '# Extract\nText[^note].\n# Keep\n[^note]: detail\n'
    },
    {
      name: 'definition inside and use outside',
      source: '# Extract\n[^note]: detail\n# Keep\nText[^note].\n'
    },
    {
      name: 'uses on both sides',
      source: '# Extract\nText[^note].\n\n[^note]: detail\n# Keep\nAgain[^note].\n'
    }
  ])('rejects a footnote with $name', ({ source }) => {
    expect(
      analyzeExtractionDependencies(
        source,
        getSectionRange(source, '# Extract'),
        '# Extract\n\nbody\n'
      )
    ).toEqual({ kind: 'invalid', reason: 'cross-boundary-reference' });
  });

  it('rejects a multiline footnote definition that itself crosses the boundary', () => {
    const source = '[^note]: first line\n    continuation line\n';
    const sectionRange = {
      from: 0,
      to: source.indexOf('continuation') + 'continuation'.length
    };

    expect(
      analyzeExtractionDependencies(source, sectionRange, 'destination\n')
    ).toEqual({ kind: 'invalid', reason: 'cross-boundary-reference' });
  });

  it('ignores escaped and code-contained footnote-like text', () => {
    const source = [
      '# Extract',
      String.raw`\[^note]`,
      '`[^note]`',
      '```md',
      '[^note]',
      '```',
      '# Keep',
      '[^note]: detail',
      ''
    ].join('\n');

    expect(
      analyzeExtractionDependencies(
        source,
        getSectionRange(source, '# Extract'),
        '# Extract\n\nbody\n'
      )
    ).toEqual({ kind: 'ready', targets: [] });
  });
});

describe('rewriteMarkdownTargets', () => {
  it('rewrites destinations end-to-start and preserves labels, titles, embeds, and subpaths', () => {
    const markdown = [
      '[Plan](notes/Plan.md#Milestone "Open")',
      '![Diagram](assets/diagram.png#^overview)',
      '',
      '[shared]: references/Shared.md#Details "Shared title"',
      ''
    ].join('\n');
    const targets = expectReadyTargets(markdown);

    expect(
      rewriteMarkdownTargets(markdown, targets, (target) => {
        const replacements: Readonly<Record<string, string>> = {
          'assets/diagram.png': '../assets/diagram.png',
          'notes/Plan.md': 'Plan',
          'references/Shared.md': '../Shared Note.md'
        };
        return replacements[target.linkpath] ?? null;
      })
    ).toBe([
      '[Plan](Plan#Milestone "Open")',
      '![Diagram](../assets/diagram.png#^overview)',
      '',
      '[shared]: ../Shared Note.md#Details "Shared title"',
      ''
    ].join('\n'));
  });

  it('returns null when any target cannot be resolved', () => {
    const markdown = '[one](one.md) [two](two.md)';
    const targets = expectReadyTargets(markdown);

    expect(
      rewriteMarkdownTargets(
        markdown,
        targets,
        (target) => target.linkpath === 'one.md' ? 'One' : null
      )
    ).toBeNull();
  });

  it.each([
    {
      name: 'duplicate',
      targets: [
        {
          explicitMarkdownExtension: true,
          from: 5,
          kind: 'link' as const,
          linkpath: 'a.md',
          subpath: '',
          to: 9
        },
        {
          explicitMarkdownExtension: true,
          from: 5,
          kind: 'link' as const,
          linkpath: 'a.md',
          subpath: '',
          to: 9
        }
      ]
    },
    {
      name: 'overlapping',
      targets: [
        {
          explicitMarkdownExtension: false,
          from: 2,
          kind: 'link' as const,
          linkpath: 'first',
          subpath: '',
          to: 8
        },
        {
          explicitMarkdownExtension: false,
          from: 7,
          kind: 'embed' as const,
          linkpath: 'second',
          subpath: '',
          to: 12
        }
      ]
    }
  ])('throws before resolving $name target ranges', ({ targets }) => {
    const resolve = vi.fn(() => 'replacement');

    expect(() => rewriteMarkdownTargets('0123456789abcdef', targets, resolve))
      .toThrow(TypeError);
    expect(resolve).not.toHaveBeenCalled();
  });
});
