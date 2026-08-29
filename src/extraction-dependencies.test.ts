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
      destination: 'folder/a((b)c).md#Part',
      explicitMarkdownExtension: true,
      markdown: '[nested](folder/a((b)c).md#Part)',
      path: 'folder/a((b)c).md',
      subpath: '#Part'
    },
    {
      destination: 'folder/note.md',
      explicitMarkdownExtension: true,
      markdown: '[multiline](\n  folder/note.md\n  "Title"\n)',
      path: 'folder/note.md',
      subpath: ''
    },
    {
      destination: 'folder/parenthesized.md',
      explicitMarkdownExtension: true,
      markdown: '[parenthesized title](folder/parenthesized.md\n  (Title))',
      path: 'folder/parenthesized.md',
      subpath: ''
    },
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
    '[block](^local-block)',
    String.raw`[escaped scheme](https\://example.com/note.md)`,
    String.raw`[escaped root](\/folder/note.md)`,
    '[named protocol relative](&sol;&sol;example.com/note.md)',
    String.raw`[escaped same heading](\#Local)`,
    '[decimal root](&#47;folder/note.md)',
    '[hex same block](&#x5e;local-block)',
    '[entity scheme](https&#58;//example.com/note.md)'
  ])('does not collect the non-relative target %s', (source) => {
    expect(analyzeWholeSource(source)).toEqual({ kind: 'ready', targets: [] });
  });

  it.each([
    {
      linkpath: String.raw`folder/https\://plan.md`,
      source: String.raw`[relative escaped punctuation](folder/https\://plan.md)`
    },
    {
      linkpath: 'folder/&sol;plan.md',
      source: '[relative entity punctuation](folder/&sol;plan.md)'
    },
    {
      linkpath: 'folder/&#35;plan.md',
      source: '[relative numeric entity](folder/&#35;plan.md)'
    }
  ])('retains the ordinary relative control $source', ({ linkpath, source }) => {
    expect(expectReadyTargets(source)[0]).toMatchObject({ linkpath });
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

  it.each([
    {
      definition: '[ref]: note.md',
      name: 'full reference',
      use: '[inside][ref]'
    },
    {
      definition: '[ref]: note.md',
      name: 'collapsed reference',
      use: '[ref][]'
    },
    {
      definition: '[ref]: note.md',
      name: 'shortcut reference',
      use: '[ref]'
    },
    {
      definition: '[ref]: image.png',
      name: 'reference image',
      use: '![inside][ref]'
    },
    {
      definition: '[ref]: note.md',
      name: 'ASCII normalized case',
      use: '[inside][REF]'
    },
    {
      definition: '[Σ]: note.md',
      name: 'sigma and final sigma case folding',
      use: '[inside][ς]'
    },
    {
      definition: '[straße]: note.md',
      name: 'sharp s full case folding',
      use: '[inside][STRASSE]'
    },
    {
      definition: '[a b]: note.md',
      name: 'collapsed label whitespace',
      use: '[inside][A  B]'
    },
    {
      definition: '[a&b]: note.md',
      name: 'escaped label punctuation',
      use: String.raw`[inside][A\&B]`
    },
    {
      definition: '[a&b]: note.md',
      name: 'entity label punctuation',
      use: '[inside][A&amp;B]'
    },
    {
      definition: '[ref]:\n  note.md\n  (Multiline title)',
      name: 'multiline reference definition',
      use: '[inside][ref]'
    }
  ])(
    'rejects definition-outside/use-inside for $name',
    ({ definition, use }) => {
      const source = `# Extract\n${use}\n# Keep\n${definition}\n`;

      expect(
        analyzeExtractionDependencies(
          source,
          getSectionRange(source, '# Extract'),
          '# Extract\n\nbody\n'
        )
      ).toEqual({ kind: 'invalid', reason: 'cross-boundary-reference' });
    }
  );

  it('does not rescan the syntax-node array for each parsed link', () => {
    const linkCount = 250;
    const source = Array.from(
      { length: linkCount },
      (_value, index) => `[link ${String(index)}](notes/note-${String(index)}.md)`
    ).join(' ');
    const originalSome = Array.prototype.some;
    let syntaxNodeVisits = 0;
    const someSpy = vi.spyOn(Array.prototype, 'some').mockImplementation(
      function doesSomeMatch(
        this: unknown[],
        predicate: (value: unknown, index: number, array: unknown[]) => unknown,
        thisArgument?: unknown
      ): boolean {
        const first = this[0];
        const isSyntaxNodeArray = typeof first === 'object'
          && first !== null
          && 'name' in first
          && first.name === 'Document';
        return Reflect.apply(originalSome, this, [
          (value: unknown, index: number, array: unknown[]): unknown => {
            if (isSyntaxNodeArray) {
              syntaxNodeVisits += 1;
            }
            return predicate.call(thisArgument, value, index, array);
          }
        ]);
      }
    );

    try {
      expect(analyzeWholeSource(source).kind).toBe('ready');
    } finally {
      someSpy.mockRestore();
    }
    expect(syntaxNodeVisits).toBe(0);
  });

  it.each([
    {
      name: 'frontmatter',
      source: '---\n[ref]: fake.md\n---\n# Extract\n[inside][ref]\n'
    },
    {
      name: 'Obsidian comment',
      source: '%%\n\n[ref]: fake.md\n\n%%\n# Extract\n[inside][ref]\n'
    }
  ])('ignores a fake reference definition in $name', ({ source }) => {
    expect(
      analyzeExtractionDependencies(
        source,
        getSectionRange(source, '# Extract'),
        '# Extract\n\n[inside][ref]\n'
      )
    ).toEqual({ kind: 'ready', targets: [] });
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

  it.each([
    ['link destination', '[link](note[^id].md)'],
    ['link title', '[link](note.md "title [^id]")'],
    ['inline raw HTML attribute', '<span data-note="[^id]">text</span>'],
    ['raw HTML block attribute', '<div data-note="[^id]">\ntext\n</div>'],
    ['inline code', '`[^id]`'],
    ['fenced code', '```md\n[^id]\n```'],
    ['HTML comment', '<!-- [^id] -->'],
    ['Obsidian comment', '%% [^id] %%']
  ])('ignores footnote-like text in a %s', (_name, literal) => {
    const source = `# Extract\n${literal}\n# Keep\n[^id]: detail\n`;

    expect(
      analyzeExtractionDependencies(
        source,
        getSectionRange(source, '# Extract'),
        '# Extract\n\nbody\n'
      )
    ).toEqual({ kind: 'ready', targets: [] });
  });

  it('still detects a live footnote beside literal false positives', () => {
    const source = [
      '# Extract',
      '[link](note[^id].md "title [^id]")',
      '<span data-note="[^id]">text</span>',
      'Live[^id].',
      '# Keep',
      '[^id]: detail',
      ''
    ].join('\n');

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
      from: -1,
      name: 'negative',
      to: 4
    },
    {
      from: 8,
      name: 'reversed',
      to: 4
    },
    {
      from: 5,
      name: 'zero-length',
      to: 5
    },
    {
      from: 2.5,
      name: 'fractional',
      to: 5
    },
    {
      from: Number.MAX_SAFE_INTEGER + 1,
      name: 'unsafe integer',
      to: Number.MAX_SAFE_INTEGER + 2
    },
    {
      from: 12,
      name: 'out of bounds',
      to: 20
    }
  ])('throws before resolving a $name range', ({ from, to }) => {
    const resolve = vi.fn(() => 'replacement');
    const target = {
      explicitMarkdownExtension: false,
      from,
      kind: 'link' as const,
      linkpath: 'target',
      subpath: '',
      to
    };

    expect(() => rewriteMarkdownTargets('0123456789abcdef', [target], resolve))
      .toThrow(TypeError);
    expect(resolve).not.toHaveBeenCalled();
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
