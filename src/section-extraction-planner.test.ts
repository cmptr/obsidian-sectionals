// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import type { SectionExtractionDraft } from './section-extraction-planner.ts';

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
      expect(draft.sourceBodyRange).toEqual({
        from: source.indexOf('\n'),
        to: source.length
      });
    }
  );

  it.each([
    ['Setext H1', 'Heading\n=======\nbody\n'],
    ['Setext H2', 'Heading\n-------\nbody\n'],
    ['multiline Setext', 'Heading first\nheading second\n=======\nbody\n']
  ])('is ready for a non-empty %s section', (_name, source) => {
    const draft = expectReady(source, source.indexOf('body'));

    expect(draft.sectionRange).toEqual({ from: 0, to: source.length });
    expect(draft.sourceBodyRange).toEqual({
      from: source.lastIndexOf('\n', source.indexOf('body') - 1),
      to: source.length
    });
  });

  it('is ready when only direct body content is meaningful', () => {
    const source = '# Parent\nbody only\n# Next\nnext body\n';
    const draft = expectReady(source, source.indexOf('body only'));

    expect(draft.sectionRange).toEqual({
      from: 0,
      to: source.indexOf('# Next')
    });
    expect(draft.sourceBodyRange).toEqual({
      from: source.indexOf('\n'),
      to: source.indexOf('# Next')
    });
  });

  it('is ready when only descendant headings make up the body', () => {
    const source = '# Parent\n## Child\n';
    const draft = expectReady(source, source.indexOf('Parent'));

    expect(draft.sectionRange).toEqual({ from: 0, to: source.length });
    expect(draft.sourceBodyRange).toEqual({
      from: source.indexOf('\n'),
      to: source.length
    });
  });

  it('accepts a cursor at true EOF in the final non-empty section', () => {
    const source = '# Final\nbody';
    const draft = expectReady(source, source.length);

    expect(draft.sectionRange).toEqual({ from: 0, to: source.length });
    expect(draft.sourceBodyRange).toEqual({
      from: source.indexOf('\n'),
      to: source.length
    });
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

describe('createExtractionSourceEdit', () => {
  it('replaces an EOF body with one canonical wikilink paragraph', () => {
    const source = '# Beta\nbody\n';
    const draft = expectReady(source, source.indexOf('body'));

    expect(createExtractionSourceEdit(source.length, draft, '[[Beta]]')).toEqual(
      {
        cursorOffset: draft.sourceBodyRange.from + 2,
        range: draft.sourceBodyRange,
        replacement: '\n\n[[Beta]]\n'
      }
    );
  });

  it('leaves one blank line after the wikilink before a following section', () => {
    const source = '# Beta\nbody\n# Next\nnext body\n';
    const draft = expectReady(source, source.indexOf('body'));

    expect(createExtractionSourceEdit(source.length, draft, '[[Beta]]')).toEqual(
      {
        cursorOffset: draft.sourceBodyRange.from + 2,
        range: draft.sourceBodyRange,
        replacement: '\n\n[[Beta]]\n\n'
      }
    );
  });

  it('uses the draft CRLF and points the cursor at the first opening bracket', () => {
    const source = '## Beta\r\nbody\r\n';
    const draft = expectReady(source, source.indexOf('body'));
    const edit = createExtractionSourceEdit(
      source.length,
      draft,
      '[[Folder/Beta|Beta]]'
    );

    expect(edit).toEqual({
      cursorOffset: draft.sourceBodyRange.from + 4,
      range: draft.sourceBodyRange,
      replacement: '\r\n\r\n[[Folder/Beta|Beta]]\r\n'
    });
    expect(edit.replacement[edit.cursorOffset - edit.range.from]).toBe('[');
  });

  it('splices an EOF CRLF source without duplicating the retained heading carriage return', () => {
    const source = '## Beta\r\nbody\r\n';
    const draft = expectReady(source, source.indexOf('body'));
    const edit = createExtractionSourceEdit(source.length, draft, '[[Beta]]');
    const editedSource = source.slice(0, edit.range.from)
      + edit.replacement
      + source.slice(edit.range.to);

    expect(draft.sourceBodyRange.from).toBe(source.indexOf('\r\n'));
    expect(editedSource).toBe('## Beta\r\n\r\n[[Beta]]\r\n');
    expect(editedSource).not.toContain('\r\r\n');
  });

  it('splices CRLF before following content without corrupting either boundary', () => {
    const source = '## Beta\r\nbody\r\n# Next\r\nnext body\r\n';
    const draft = expectReady(source, source.indexOf('body'));
    const edit = createExtractionSourceEdit(source.length, draft, '[[Beta]]');
    const editedSource = source.slice(0, edit.range.from)
      + edit.replacement
      + source.slice(edit.range.to);

    expect(draft.sourceBodyRange.from).toBe(source.indexOf('\r\n'));
    expect(editedSource).toBe(
      '## Beta\r\n\r\n[[Beta]]\r\n\r\n# Next\r\nnext body\r\n'
    );
    expect(editedSource).not.toContain('\r\r\n');
  });

  it.each([
    '',
    'Beta',
    '[[]]',
    '[[   ]]',
    '[[Beta]',
    '[[Beta]] trailing',
    '[[Beta\nTitle]]',
    '[[Beta|]]'
  ])('throws TypeError for the malformed wikilink %j', (wikilink) => {
    const source = '# Beta\nbody\n';
    const draft = expectReady(source, source.indexOf('body'));

    expect(() => createExtractionSourceEdit(source.length, draft, wikilink))
      .toThrow(TypeError);
  });
});
