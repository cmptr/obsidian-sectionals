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
      path: 'folder/a(b).md',
      subpath: '#Part'
    },
    {
      destination: 'folder/My%20Note.md#A%20B',
      explicitMarkdownExtension: true,
      markdown: '[encoded](folder/My%20Note.md#A%20B)',
      path: 'folder/My Note.md',
      subpath: '#A%20B'
    },
    {
      destination: String.raw`folder/name\#part.md`,
      explicitMarkdownExtension: true,
      markdown: String.raw`[escaped hash](folder/name\#part.md)`,
      path: 'folder/name#part.md',
      subpath: ''
    },
    {
      destination: 'folder/A&amp;B.md',
      explicitMarkdownExtension: true,
      markdown: '[entity](folder/A&amp;B.md)',
      path: 'folder/A&B.md',
      subpath: ''
    },
    {
      destination: 'folder/%E6%9D%B1%E4%BA%AC.md',
      explicitMarkdownExtension: true,
      markdown: '[UTF-8](folder/%E6%9D%B1%E4%BA%AC.md)',
      path: 'folder/東京.md',
      subpath: ''
    },
    {
      destination: 'folder%2Fnested%2Fnote.md',
      explicitMarkdownExtension: true,
      markdown: '[encoded separators](folder%2Fnested%2Fnote.md)',
      path: 'folder/nested/note.md',
      subpath: ''
    },
    {
      destination: String.raw`A\#B&amp;C%20D.md#Part&amp;More`,
      explicitMarkdownExtension: true,
      markdown: String.raw`[interactions](A\#B&amp;C%20D.md#Part&amp;More)`,
      path: 'A#B&C D.md',
      subpath: '#Part&amp;More'
    },
    {
      destination: 'folder/%2520.md',
      explicitMarkdownExtension: true,
      markdown: '[single decode](folder/%2520.md)',
      path: 'folder/%20.md',
      subpath: ''
    },
    {
      destination: 'folder/A%26amp%3BB.md',
      explicitMarkdownExtension: true,
      markdown: '[no entity double decode](folder/A%26amp%3BB.md)',
      path: 'folder/A&amp;B.md',
      subpath: ''
    }
  ])(
    'retains raw destination bytes while exposing a logical linkpath in $markdown',
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
      linkpath: 'folder/https://plan.md',
      source: String.raw`[relative escaped punctuation](folder/https\://plan.md)`
    },
    {
      linkpath: 'folder//plan.md',
      source: '[relative entity punctuation](folder/&sol;plan.md)'
    },
    {
      linkpath: 'folder/#plan.md',
      source: '[relative numeric entity](folder/&#35;plan.md)'
    }
  ])('retains the ordinary relative control $source', ({ linkpath, source }) => {
    expect(expectReadyTargets(source)[0]).toMatchObject({ linkpath });
  });

  it.each([
    'https%3A%2F%2Fexample.com/note.md',
    '%2Ffolder/note.md',
    '%23Local',
    '%5Elocal-block'
  ])('does not collect a percent-encoded non-relative target %s', (destination) => {
    expect(analyzeWholeSource(`[target](${destination})`)).toEqual({
      kind: 'ready',
      targets: []
    });
  });

  it.each([
    'folder/bad%.md',
    'folder/bad%2.md',
    'folder/bad%GG.md',
    'folder/bad%C3%28.md'
  ])('retains the complete logical linkpath for invalid percent bytes in %s', (linkpath) => {
    const source = `[invalid](${linkpath}#Part)`;
    const [target] = expectReadyTargets(source);

    expect(target).toMatchObject({
      from: source.indexOf(linkpath),
      linkpath,
      subpath: '#Part',
      to: source.indexOf('#Part') + '#Part'.length
    });
    expect(source.slice(target?.from, target?.to)).toBe(`${linkpath}#Part`);
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
      definition: '[ss]: note.md',
      name: 'capital sharp S to SS folding',
      use: '[inside][ẞ]'
    },
    {
      definition: '[k]: note.md',
      name: 'Kelvin sign case folding',
      use: '[inside][K]'
    },
    {
      definition: '[ffi]: note.md',
      name: 'ligature multi-code-point folding',
      use: '[inside][ﬃ]'
    },
    {
      definition: '[i̇]: note.md',
      name: 'capital dotted I combining folding',
      use: '[inside][İ]'
    },
    {
      definition: '[ΐ]: note.md',
      name: 'Greek combining-sequence folding',
      use: '[inside][ΐ]'
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

  it('keeps Unicode dotless I distinct from ASCII i', () => {
    const source = '# Extract\n[inside][ı]\n# Keep\n[i]: note.md\n';

    expect(
      analyzeExtractionDependencies(
        source,
        getSectionRange(source, '# Extract'),
        '# Extract\n\nbody\n'
      )
    ).toEqual({ kind: 'ready', targets: [] });
  });

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

  it('collects hundreds of complete footnote extents with bounded line visits', () => {
    const definitionCount = 300;
    const source = `${
      Array.from(
        { length: definitionCount },
        (_value, index) => {
          const indentation = index === 0 ? '' : '  ';
          return `${indentation}[^note-${String(index)}]: detail`;
        }
      ).join('\n')
    }\n`;
    const boundary = source.indexOf('[^note-150]') + '[^note-150]'.length;
    const originalIndexOf = String.prototype.indexOf;
    let lineVisits = 0;
    const indexOfSpy = vi.spyOn(String.prototype, 'indexOf').mockImplementation(
      function countLineVisits(
        this: string,
        searchString: string,
        position?: number
      ): number {
        if (this === source && searchString === '\n') {
          lineVisits += 1;
        }
        return Reflect.apply(originalIndexOf, this, [searchString, position]);
      }
    );

    try {
      expect(
        analyzeExtractionDependencies(
          source,
          { from: 0, to: boundary },
          'destination\n'
        )
      ).toEqual({ kind: 'invalid', reason: 'cross-boundary-reference' });
    } finally {
      indexOfSpy.mockRestore();
    }
    expect(lineVisits).toBe(definitionCount + 4);
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

describe('analyzeExtractionDependencies Obsidian math protection', () => {
  it('leaves inline-math Markdown bytes untouched without hiding adjacent live syntax or creating crossings', () => {
    const math = String.raw`$[math](math.md) ![image](math.png) [fake][REF] [^NOTE] \$ value$`;
    const source = [
      '# Extract',
      math,
      '[live](live.md)',
      '# Keep',
      '[ref]: reference.md',
      '[^note]: detail',
      ''
    ].join('\n');
    const destinationContent = `${math}\n[live](live.md)\n`;
    const targets = expectReadyTargets(
      source,
      destinationContent,
      getSectionRange(source, '# Extract')
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ linkpath: 'live.md' });
    expect(
      rewriteMarkdownTargets(
        destinationContent,
        targets,
        () => 'rewritten.md'
      )
    ).toBe(`${math}\n[live](rewritten.md)\n`);
  });

  it.each([
    {
      lineEnding: '\n',
      math: '$$![same line](same.md) [fake][ref] [^note]$$',
      name: 'same-line block math'
    },
    {
      lineEnding: '\n',
      math: '$$\n![multiline](multi.md)\n[ref]: fake.md\n[^note]: fake\n$$',
      name: 'multiline block math'
    },
    {
      lineEnding: '\r\n',
      math: '$$\r\n![CRLF](crlf.md)\r\n[ref]: fake.md\r\n[^note]: fake\r\n$$',
      name: 'CRLF block math'
    }
  ])('protects links, images, references, and footnotes in $name', ({
    lineEnding,
    math
  }) => {
    const source =
      `# Extract${lineEnding}${math}${lineEnding}[live](live.md)${lineEnding}# Keep${lineEnding}[ref]: reference.md${lineEnding}[^note]: detail${lineEnding}`;
    const destinationContent = `${math}${lineEnding}[live](live.md)${lineEnding}`;
    const targets = expectReadyTargets(
      source,
      destinationContent,
      getSectionRange(source, '# Extract')
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ linkpath: 'live.md' });
    expect(
      rewriteMarkdownTargets(destinationContent, targets, () => 'moved.md')
    ).toBe(`${math}${lineEnding}[live](moved.md)${lineEnding}`);
  });

  it.each([
    {
      name: 'escaped inline opener',
      source: String.raw`\$[live](escaped.md)$`
    },
    {
      name: 'space after inline opener',
      source: '$ [live](space.md) $'
    },
    {
      name: 'unmatched inline delimiter',
      source: '$[live](inline.md)'
    },
    {
      name: 'unmatched block delimiter',
      source: '$$\n![live](block.png)\n'
    }
  ])('does not protect Markdown after an $name', ({ source }) => {
    const targets = expectReadyTargets(source);

    expect(targets).toHaveLength(1);
  });

  it('does not let math delimiters in code, comments, or frontmatter capture live Markdown', () => {
    const source = [
      '---',
      '$$',
      '---',
      '[frontmatter adjacent](front.md)',
      '$$',
      '```md',
      '$$',
      '```',
      '[code adjacent](code.md)',
      '$$',
      '<!-- $$ -->',
      '[comment adjacent](comment.md)',
      '$$',
      '%% $$ %%',
      '[Obsidian comment adjacent](obsidian.md)',
      ''
    ].join('\n');

    expect(expectReadyTargets(source).map((target) => target.linkpath)).toEqual([
      'front.md',
      'code.md',
      'comment.md',
      'obsidian.md'
    ]);
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
