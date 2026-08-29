// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner types compact.
import type { ExtractionSourceEdit, SectionExtractionDraft } from './section-extraction-planner.ts';

import { createExtractionWikilink } from './section-extraction-destination.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import { createExtractionSourceEdit, planSectionExtraction } from './section-extraction-planner.ts';

function expectReady(source: string, cursorOffset: number): SectionExtractionDraft {
  const plan = planSectionExtraction(source, cursorOffset);
  expect(plan.kind).toBe('ready');
  if (plan.kind !== 'ready') {
    throw new Error(`Expected a ready extraction plan, received ${plan.kind}.`);
  }
  return plan.draft;
}

describe('planSectionExtraction availability', () => {
  it.each([
    ['plain text without a section', 'plain text', 2],
    ['an empty ATX section', '# Empty\n', 3],
    ['a whitespace-only ATX section', '# Empty\n \t \n', 8],
    ['a quoted section', '> ## Quoted\n> body\n', 16],
    ['a callout section', '> [!note]\n> ## Callout\n> body\n', 27]
  ])('is unavailable for %s', (_name, source, cursorOffset) => {
    expect(planSectionExtraction(source, cursorOffset)).toEqual({
      kind: 'unavailable'
    });
  });

  it.each([-1, 9, 0.5, NaN])(
    'is unavailable for the invalid cursor %s',
    (cursorOffset) => {
      expect(planSectionExtraction('# A\nbody', cursorOffset)).toEqual({
        kind: 'unavailable'
      });
    }
  );

  it('does not fall back from an empty deepest child to a parent with content', () => {
    const source = '# Parent\nparent body\n## Empty child\n';

    expect(planSectionExtraction(source, source.indexOf('Empty child'))).toEqual(
      { kind: 'unavailable' }
    );
  });

  it.each([1, 2, 3, 4, 5, 6])(
    'is ready for a non-empty ATX H%s section',
    (level) => {
      const source = `${'#'.repeat(level)} Heading\nbody\n`;
      const draft = expectReady(source, source.indexOf('body'));

      expect(draft.sectionRange).toEqual({ from: 0, to: source.length });
    }
  );

  it.each([
    ['Setext H1', 'Heading\n=======\nbody\n'],
    ['Setext H2', 'Heading\n-------\nbody\n'],
    ['multiline Setext', 'Heading first\nheading second\n=======\nbody\n']
  ])('is ready for a non-empty %s section', (_name, source) => {
    const draft = expectReady(source, source.indexOf('body'));

    expect(draft.sectionRange).toEqual({ from: 0, to: source.length });
  });

  it('is ready when only direct body content is meaningful', () => {
    const source = '# Parent\nbody only\n# Next\nnext body\n';
    const draft = expectReady(source, source.indexOf('body only'));

    expect(draft.sectionRange).toEqual({
      from: 0,
      to: source.indexOf('# Next')
    });
  });

  it('is ready when only descendant headings make up the body', () => {
    const source = '# Parent\n## Child\n';
    const draft = expectReady(source, source.indexOf('Parent'));

    expect(draft.sectionRange).toEqual({ from: 0, to: source.length });
  });

  it('accepts a cursor at true EOF in the final non-empty section', () => {
    const source = '# Final\nbody';
    const draft = expectReady(source, source.length);

    expect(draft.sectionRange).toEqual({ from: 0, to: source.length });
  });
});

describe('planSectionExtraction destination content', () => {
  it('creates one ATX H1 with inline Markdown and without the target block ID', () => {
    const source = '### **Beta** [plan](plan.md) `x` ^beta ###\nbody\n';
    const draft = expectReady(source, source.indexOf('body'));

    expect(draft).toMatchObject({
      destinationContent: '# **Beta** [plan](plan.md) `x`\n\nbody\n',
      displayTitle: 'Beta plan x',
      filenameStem: 'Beta plan x',
      lineEnding: '\n'
    });
  });

  it('collapses multiline Setext title whitespace into one ATX H1', () => {
    const source = 'Alpha  *Beta*\n  continuation\n=======\nbody\n';
    const draft = expectReady(source, source.indexOf('body'));

    expect(draft).toMatchObject({
      destinationContent: '# Alpha *Beta* continuation\n\nbody\n',
      displayTitle: 'Alpha Beta continuation',
      filenameStem: 'Alpha Beta continuation'
    });
  });

  it.each([
    {
      destinationContent: '# Title `Alpha Beta`\n\nbody\n',
      displayTitle: 'Title Alpha Beta',
      filenameStem: 'Title Alpha Beta',
      name: 'code span',
      source: 'Title `Alpha\nBeta`\n=======\nbody\n'
    },
    {
      destinationContent: '# <span data-label="one two">Alpha</span>\n\nbody\n',
      displayTitle: 'Alpha',
      filenameStem: 'Alpha',
      name: 'HTML attribute',
      source: '<span data-label="one\ntwo">Alpha</span>\n=======\nbody\n'
    }
  ])(
    'collapses a multiline Setext $name into one physical ATX H1',
    ({ destinationContent, displayTitle, filenameStem, source }) => {
      const draft = expectReady(source, source.indexOf('body'));

      expect(draft).toMatchObject({
        destinationContent,
        displayTitle,
        filenameStem
      });
    }
  );

  it('rebases descendant headings by one constant offset and preserves skipped levels and block IDs', () => {
    const source = [
      '## Parent',
      'parent body',
      '#### Deep ^deep',
      'deep body',
      '### Mid',
      'mid body',
      '# Next',
      'next body',
      ''
    ].join('\n');
    const draft = expectReady(source, source.indexOf('parent body'));

    expect(draft.destinationContent).toBe([
      '# Parent',
      '',
      'parent body',
      '### Deep ^deep',
      'deep body',
      '## Mid',
      'mid body',
      ''
    ].join('\n'));
  });

  it('converts a parsed Setext descendant to ATX while retaining its block ID', () => {
    const source = '# Parent\nparent body\n\nChild title ^child\n------------------\nchild body\n';
    const draft = expectReady(source, source.indexOf('parent body'));

    expect(draft.destinationContent).toBe(
      '# Parent\n\nparent body\n\n## Child title ^child\nchild body\n'
    );
  });

  it('leaves fenced, commented, inline-code, and quoted headings as body text', () => {
    const source = [
      '# Parent',
      'parent body',
      '```md',
      '## Fenced',
      '```',
      '<!--',
      '## Commented',
      '-->',
      '`## Inline code`',
      '> ## Quoted',
      '> quoted body',
      '## Real child',
      'real body',
      ''
    ].join('\n');
    const draft = expectReady(source, source.indexOf('parent body'));

    expect(draft.destinationContent).toBe([
      '# Parent',
      '',
      'parent body',
      '```md',
      '## Fenced',
      '```',
      '<!--',
      '## Commented',
      '-->',
      '`## Inline code`',
      '> ## Quoted',
      '> quoted body',
      '## Real child',
      'real body',
      ''
    ].join('\n'));
  });

  it('normalizes only outer body blanks while preserving internal whitespace and trailing spaces', () => {
    const source = '# Beta\n\n  \nfirst  \n\n \tmiddle\t \nlast  \n\n \t\n';
    const draft = expectReady(source, source.indexOf('first'));

    expect(draft.destinationContent).toBe(
      '# Beta\n\nfirst  \n\n \tmiddle\t \nlast  \n'
    );
  });

  it('keeps YAML-like body content beneath the generated H1', () => {
    const source = '# Beta\n---\nstatus: draft\nbody\n';
    const draft = expectReady(source, source.indexOf('Beta'));

    expect(draft.destinationContent).toBe(
      '# Beta\n\n---\nstatus: draft\nbody\n'
    );
  });

  it('uses the target heading CRLF for every generated line boundary', () => {
    const source = '## Beta\r\nbody\r\n### Child\r\nchild body\r\n';
    const draft = expectReady(source, source.indexOf('body'));

    expect(draft.lineEnding).toBe('\r\n');
    expect(draft.destinationContent).toBe(
      '# Beta\r\n\r\nbody\r\n## Child\r\nchild body\r\n'
    );
  });

  it('recognizes closing ATX syntax and a target block ID before CRLF', () => {
    const source = '### **Beta** ^beta ###\r\nbody\r\n';
    const draft = expectReady(source, source.indexOf('body'));

    expect(draft).toMatchObject({
      destinationContent: '# **Beta**\r\n\r\nbody\r\n',
      displayTitle: 'Beta',
      filenameStem: 'Beta'
    });
  });

  it('returns invalid when the visible title cannot form a filename', () => {
    expect(planSectionExtraction('# /:*?\nbody\n', 9)).toEqual({
      kind: 'invalid',
      reason: 'unusable-title'
    });
  });
});

describe('planSectionExtraction dependencies', () => {
  it('returns destination-relative link and embed target ranges', () => {
    const source = [
      '# Project',
      'See [plan](../Plans/Plan.md#Scope "Open") and ![map](assets/map.png).',
      ''
    ].join('\n');
    const draft = expectReady(source, source.indexOf('See'));
    const linkDestination = '../Plans/Plan.md#Scope';
    const embedDestination = 'assets/map.png';

    expect(draft.relativeTargets).toEqual([
      {
        explicitMarkdownExtension: true,
        from: draft.destinationContent.indexOf(linkDestination),
        kind: 'link',
        linkpath: '../Plans/Plan.md',
        subpath: '#Scope',
        to: draft.destinationContent.indexOf(linkDestination)
          + linkDestination.length
      },
      {
        explicitMarkdownExtension: false,
        from: draft.destinationContent.indexOf(embedDestination),
        kind: 'embed',
        linkpath: embedDestination,
        subpath: '',
        to: draft.destinationContent.indexOf(embedDestination)
          + embedDestination.length
      }
    ]);
  });

  it('returns a destination-relative target for a self-contained reference definition', () => {
    const source = [
      '# Project',
      '[plan][shared]',
      '',
      '[shared]: ../Plans/Plan.md#Scope "Open"',
      ''
    ].join('\n');
    const draft = expectReady(source, source.indexOf('[plan]'));
    const destination = '../Plans/Plan.md#Scope';

    expect(draft.relativeTargets).toEqual([
      {
        explicitMarkdownExtension: true,
        from: draft.destinationContent.indexOf(destination),
        kind: 'reference-definition',
        linkpath: '../Plans/Plan.md',
        subpath: '#Scope',
        to: draft.destinationContent.indexOf(destination) + destination.length
      }
    ]);
  });

  it.each([
    {
      name: 'reference link',
      source: '# Extract\n[inside][shared]\n# Keep\n[shared]: note.md\n'
    },
    {
      name: 'footnote',
      source: '# Extract\nText[^shared].\n# Keep\n[^shared]: detail\n'
    }
  ])('rejects a cross-boundary $name', ({ source }) => {
    expect(planSectionExtraction(source, source.indexOf('Extract'))).toEqual({
      kind: 'invalid',
      reason: 'cross-boundary-reference'
    });
  });

  it('allows a heading reference whose definition moves with the section', () => {
    const referenceInside = [
      '# [Project][shared]',
      'body',
      '',
      '[shared]: ../Plans/Plan.md#Scope',
      '# Keep',
      'kept',
      ''
    ].join('\n');
    const referenceDraft = expectReady(
      referenceInside,
      referenceInside.indexOf('body')
    );

    expect(referenceDraft.destinationContent).toContain('# [Project][shared]');
    expect(referenceDraft.relativeTargets).toEqual([
      expect.objectContaining({
        kind: 'reference-definition',
        linkpath: '../Plans/Plan.md',
        subpath: '#Scope'
      })
    ]);
  });

  it('allows a heading footnote whose definition moves with the section', () => {
    const footnoteInside = [
      '# Project[^note]',
      'body',
      '',
      '[^note]: detail',
      '# Keep',
      'kept',
      ''
    ].join('\n');

    expect(
      planSectionExtraction(
        footnoteInside,
        footnoteInside.indexOf('body')
      ).kind
    ).toBe('ready');
  });

  it('allows a heading reference image whose definition moves with the section', () => {
    const referenceImageInside = [
      '# ![Project map][shared]',
      'body',
      '',
      '[shared]: image.png',
      '# Keep',
      'kept',
      ''
    ].join('\n');

    expect(
      planSectionExtraction(
        referenceImageInside,
        referenceImageInside.indexOf('body')
      ).kind
    ).toBe('ready');
  });

  it.each([
    {
      definition: '[shared]: note.md',
      heading: '[Project][shared]',
      name: 'reference link'
    },
    {
      definition: '[^shared]: detail',
      heading: 'Project[^shared]',
      name: 'footnote'
    },
    {
      definition: '[shared]: image.png',
      heading: '![Project map][shared]',
      name: 'reference image'
    }
  ])('rejects a heading $name whose definition stays under Keep', ({
    definition,
    heading
  }) => {
    const source = `# ${heading}\nbody\n# Keep\n${definition}\n`;

    expect(planSectionExtraction(source, source.indexOf('body'))).toEqual({
      kind: 'invalid',
      reason: 'cross-boundary-reference'
    });
  });

  it('rejects an inside definition used again under Keep', () => {
    const source = [
      '# [Project][shared]',
      'body',
      '',
      '[shared]: note.md',
      '# Keep',
      '[again][shared]',
      ''
    ].join('\n');

    expect(planSectionExtraction(source, source.indexOf('body'))).toEqual({
      kind: 'invalid',
      reason: 'cross-boundary-reference'
    });
  });

  it('allows an inline Markdown link in the target heading and collects its logical target', () => {
    const source = '# [Project](../Plans/Plan.md#Scope)\nbody\n';
    const draft = expectReady(source, source.indexOf('body'));
    const destination = '../Plans/Plan.md#Scope';

    expect(draft.relativeTargets).toEqual([
      {
        explicitMarkdownExtension: true,
        from: draft.destinationContent.indexOf(destination),
        kind: 'link',
        linkpath: '../Plans/Plan.md',
        subpath: '#Scope',
        to: draft.destinationContent.indexOf(destination) + destination.length
      }
    ]);
  });
});

describe('createExtractionSourceEdit', () => {
  it('replaces complete LF sections in linked and open modes', () => {
    const beforeFollowing = '## Beta\nbody\n### Child\nchild\n## Gamma\ngamma\n';
    const beforeFollowingDraft = expectReady(
      beforeFollowing,
      beforeFollowing.indexOf('body')
    );
    const linkedBeforeFollowing = createExtractionSourceEdit(
      beforeFollowing,
      beforeFollowingDraft,
      { mode: 'linked', wikilink: '[[Beta]]' }
    );
    expect(linkedBeforeFollowing).toEqual({
      cursorOffset: 0,
      mode: 'linked',
      range: {
        from: 0,
        to: beforeFollowing.indexOf('## Gamma')
      },
      replacement: '[[Beta]]\n\n'
    });
    expect(applySourceEdit(beforeFollowing, linkedBeforeFollowing)).toBe(
      '[[Beta]]\n\n## Gamma\ngamma\n'
    );

    const nestedAtEof = '# Parent\nintro\n## Beta\nbody\n';
    const nestedDraft = expectReady(nestedAtEof, nestedAtEof.indexOf('body'));
    const linkedAtEof = createExtractionSourceEdit(
      nestedAtEof,
      nestedDraft,
      { mode: 'linked', wikilink: '[[Beta]]' }
    );
    expect(linkedAtEof.replacement).toBe('\n[[Beta]]\n');
    expect(linkedAtEof.mode).toBe('linked');
    if (linkedAtEof.mode !== 'linked') {
      throw new Error('Expected a linked source edit.');
    }
    expect(linkedAtEof.cursorOffset).toBe(nestedDraft.sectionRange.from + 1);
    expect(applySourceEdit(nestedAtEof, linkedAtEof)).toBe(
      '# Parent\nintro\n\n[[Beta]]\n'
    );

    const nestedBeforeFollowing = '# Parent\nintro\n## Beta\nbody\n## Gamma\ngamma\n';
    const nestedBeforeFollowingDraft = expectReady(
      nestedBeforeFollowing,
      nestedBeforeFollowing.indexOf('body')
    );
    const nestedLinkedEdit = createExtractionSourceEdit(
      nestedBeforeFollowing,
      nestedBeforeFollowingDraft,
      { mode: 'linked', wikilink: '[[Beta]]' }
    );
    expect(nestedLinkedEdit.replacement).toBe('\n[[Beta]]\n\n');
    expect(applySourceEdit(nestedBeforeFollowing, nestedLinkedEdit)).toBe(
      '# Parent\nintro\n\n[[Beta]]\n\n## Gamma\ngamma\n'
    );
    const nestedOpenEdit = createExtractionSourceEdit(
      nestedBeforeFollowing,
      nestedBeforeFollowingDraft,
      { mode: 'open' }
    );
    expect(applySourceEdit(nestedBeforeFollowing, nestedOpenEdit)).toBe(
      '# Parent\nintro\n## Gamma\ngamma\n'
    );

    const openEdit = createExtractionSourceEdit(
      beforeFollowing,
      beforeFollowingDraft,
      { mode: 'open' }
    );
    expect(openEdit).toEqual({
      mode: 'open',
      range: beforeFollowingDraft.sectionRange,
      replacement: ''
    });
    expect(applySourceEdit(beforeFollowing, openEdit)).toBe(
      '## Gamma\ngamma\n'
    );
  });

  it.each(['\n\n', '\n \t\n'])(
    'does not generate a leading separator after the existing blank %j',
    (blank) => {
      const source = `# Parent\nintro${blank}## Beta\nbody\n`;
      const draft = expectReady(source, source.indexOf('body'));
      const edit = createExtractionSourceEdit(source, draft, {
        mode: 'linked',
        wikilink: '[[Beta]]'
      });

      expect(edit.replacement).toBe('[[Beta]]\n');
      expect(edit.mode).toBe('linked');
      if (edit.mode !== 'linked') {
        throw new Error('Expected a linked source edit.');
      }
      expect(edit.cursorOffset).toBe(draft.sectionRange.from);
      expect(applySourceEdit(source, edit)).toBe(
        `# Parent\nintro${blank}[[Beta]]\n`
      );
    }
  );

  it('uses CRLF paragraph ownership at EOF and before following content', () => {
    const nestedAtEof = '# Parent\r\nintro\r\n## Beta\r\nbody\r\n';
    const nestedDraft = expectReady(nestedAtEof, nestedAtEof.indexOf('body'));
    const linkedAtEof = createExtractionSourceEdit(
      nestedAtEof,
      nestedDraft,
      { mode: 'linked', wikilink: '[[Beta]]' }
    );
    expect(linkedAtEof.replacement).toBe('\r\n[[Beta]]\r\n');
    expect(linkedAtEof.mode).toBe('linked');
    if (linkedAtEof.mode !== 'linked') {
      throw new Error('Expected a linked source edit.');
    }
    expect(linkedAtEof.cursorOffset).toBe(nestedDraft.sectionRange.from + 2);
    expect(applySourceEdit(nestedAtEof, linkedAtEof)).toBe(
      '# Parent\r\nintro\r\n\r\n[[Beta]]\r\n'
    );

    const beforeFollowing = '## Beta\r\nbody\r\n## Gamma\r\ngamma\r\n';
    const beforeFollowingDraft = expectReady(
      beforeFollowing,
      beforeFollowing.indexOf('body')
    );
    const linkedBeforeFollowing = createExtractionSourceEdit(
      beforeFollowing,
      beforeFollowingDraft,
      { mode: 'linked', wikilink: '[[Beta]]' }
    );
    expect(linkedBeforeFollowing.replacement).toBe('[[Beta]]\r\n\r\n');
    expect(linkedBeforeFollowing.mode).toBe('linked');
    if (linkedBeforeFollowing.mode !== 'linked') {
      throw new Error('Expected a linked source edit.');
    }
    expect(linkedBeforeFollowing.cursorOffset).toBe(0);
    expect(applySourceEdit(beforeFollowing, linkedBeforeFollowing)).toBe(
      '[[Beta]]\r\n\r\n## Gamma\r\ngamma\r\n'
    );
  });

  it('removes the complete note in open mode without exposing a cursor offset', () => {
    const source = '# Beta\nbody\n';
    const draft = expectReady(source, source.indexOf('body'));
    const edit = createExtractionSourceEdit(source, draft, { mode: 'open' });

    expect(applySourceEdit(source, edit)).toBe('');
    expect(edit).not.toHaveProperty('cursorOffset');
  });

  it.each([
    {
      createdBasename: String.raw`A\B`,
      displayTitle: String.raw`A\B`,
      expectedWikilink: String.raw`[[A\\B]]`,
      name: 'backslash',
      shortestLinktext: String.raw`A\B`
    },
    {
      createdBasename: 'A|B',
      displayTitle: 'A|B',
      expectedWikilink: String.raw`[[A\|B]]`,
      name: 'pipe',
      shortestLinktext: 'A|B'
    },
    {
      createdBasename: 'A]B',
      displayTitle: 'A]B',
      expectedWikilink: String.raw`[[A\]B]]`,
      name: 'closing bracket',
      shortestLinktext: 'A]B'
    },
    {
      createdBasename: 'A#B',
      displayTitle: 'A#B',
      expectedWikilink: String.raw`[[A\#B]]`,
      name: 'hash',
      shortestLinktext: 'A#B'
    },
    {
      createdBasename: '^Block',
      displayTitle: '^Block',
      expectedWikilink: String.raw`[[\^Block]]`,
      name: 'caret',
      shortestLinktext: '^Block'
    },
    {
      createdBasename: 'Beta',
      displayTitle: String.raw`Title\|] # ^`,
      expectedWikilink: String.raw`[[Notes/Beta|Title\\\|\] # ^]]`,
      name: 'alias',
      shortestLinktext: 'Notes/Beta'
    },
    {
      createdBasename: 'A[B',
      displayTitle: 'A[B',
      expectedWikilink: '[[A[B]]',
      name: 'single opening bracket target',
      shortestLinktext: 'A[B'
    },
    {
      createdBasename: '[[A',
      displayTitle: '[[A',
      expectedWikilink: '[[[[A]]',
      name: 'repeated opening brackets beside the outer opening delimiter',
      shortestLinktext: '[[A'
    },
    {
      createdBasename: String.raw`A[\]B`,
      displayTitle: String.raw`A[\]B`,
      expectedWikilink: String.raw`[[A[\\\]B]]`,
      name: 'opening bracket target beside escaped bracket and backslash',
      shortestLinktext: String.raw`A[\]B`
    },
    {
      createdBasename: 'Beta',
      displayTitle: 'A[B',
      expectedWikilink: '[[Notes/Beta|A[B]]',
      name: 'single opening bracket alias',
      shortestLinktext: 'Notes/Beta'
    },
    {
      createdBasename: 'Beta',
      displayTitle: 'A[[',
      expectedWikilink: '[[Notes/Beta|A[[]]',
      name: 'repeated opening brackets beside the outer closing delimiter',
      shortestLinktext: 'Notes/Beta'
    },
    {
      createdBasename: 'Beta',
      displayTitle: String.raw`A[[\]B`,
      expectedWikilink: String.raw`[[Notes/Beta|A[[\\\]B]]`,
      name: 'opening bracket alias beside escaped bracket and backslash',
      shortestLinktext: 'Notes/Beta'
    }
  ])('applies a generated wikilink containing $name bytes', ({
    createdBasename,
    displayTitle,
    expectedWikilink,
    shortestLinktext
  }) => {
    const source = '# Beta\nbody\n';
    const draft = expectReady(source, source.indexOf('body'));
    const wikilink = createExtractionWikilink(
      shortestLinktext,
      displayTitle,
      createdBasename
    );

    expect(wikilink).toBe(expectedWikilink);
    const edit = createExtractionSourceEdit(source, draft, {
      mode: 'linked',
      wikilink
    });
    expect(applySourceEdit(source, edit)).toBe(`${expectedWikilink}\n`);
  });

  it.each([
    '',
    'Beta',
    '[[]]',
    '[[   ]]',
    '[[Beta]',
    '[[Beta]] trailing',
    '[[Beta\nTitle]]',
    '[[Beta|]]',
    '[[Beta#Heading]]',
    '[[^Block]]',
    '[[Beta^Block]]',
    String.raw`[[Beta\q]]`,
    String.raw`[[Beta\[]]`,
    String.raw`[[Beta|Alias\#Heading]]`,
    String.raw`[[Beta|Alias\^Block]]`,
    String.raw`[[Beta|Alias\q]]`,
    '[[Beta|Alias|More]]',
    '[[Beta]Tail]]',
    '[[[Beta]]]',
    '[[Beta]]]',
    String.raw`[[Beta\]]`
  ])('throws TypeError for the malformed wikilink %j', (wikilink) => {
    const source = '# Beta\nbody\n';
    const draft = expectReady(source, source.indexOf('body'));

    expect(() => createExtractionSourceEdit(source, draft, { mode: 'linked', wikilink })).toThrow(TypeError);
  });

  it('does not validate a wikilink in open mode', () => {
    const source = '# Beta\nbody\n';
    const draft = expectReady(source, source.indexOf('body'));

    expect(createExtractionSourceEdit(source, draft, { mode: 'open' })).toEqual({
      mode: 'open',
      range: draft.sectionRange,
      replacement: ''
    });
  });
});

function applySourceEdit(
  source: string,
  edit: ExtractionSourceEdit
): string {
  return source.slice(0, edit.range.from)
    + edit.replacement
    + source.slice(edit.range.to);
}
