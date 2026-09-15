// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import type { MarkdownSection } from './section-query.ts';

import { parseMarkdownStructure } from './markdown-structure.ts';
import {
  collectMarkdownSections,
  findFirstChildSection,
  findHeadingsInSection,
  findMarkdownSection,
  findNextSiblingSection,
  findParentSection,
  findPreviousSiblingSection,
  findSiblingSections
} from './section-query.ts';

function headingText(source: string, section: MarkdownSection): string {
  return source.slice(section.heading.lineStart, section.heading.syntaxEnd);
}

describe('section queries', () => {
  it.each([
    {
      alphaHeading: '## Alpha',
      betaHeading: '## Beta',
      name: 'the root container',
      source: '# Root\n## Alpha\n##### Deep\n## Beta\nBody\n'
    },
    {
      alphaHeading: '> > ## Alpha',
      betaHeading: '> > ## Beta',
      name: 'the deepest nested quote container',
      source: [
        '> Outer',
        '> > # Root',
        '> > ## Alpha',
        '> > ##### Deep',
        '> > ## Beta',
        '> > Body',
        ''
      ].join('\n')
    },
    {
      alphaHeading: '> ## Alpha',
      betaHeading: '> ## Beta',
      name: 'a callout container',
      source: [
        '> [!note] Sections',
        '> # Root',
        '> ## Alpha',
        '> ##### Deep',
        '> ## Beta',
        '> Body',
        ''
      ].join('\n')
    }
  ])('returns the target subtree and previous exact sibling in $name', ({
    alphaHeading,
    betaHeading,
    source
  }) => {
    const structure = parseMarkdownStructure(source);
    const sections = collectMarkdownSections(structure);
    const alpha = sections.find((section) => section.heading.lineStart === source.indexOf(alphaHeading));
    const beta = sections.find((section) => section.heading.lineStart === source.indexOf(betaHeading));

    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    if (alpha === undefined || beta === undefined) {
      throw new Error('expected hierarchy fixture headings');
    }
    expect(
      findHeadingsInSection(structure, alpha).map((heading) => heading.level)
    ).toEqual([2, 5]);
    expect(findPreviousSiblingSection(sections, beta)).toBe(alpha);
  });

  it('keeps subtree headings in source order and excludes quoted containers', () => {
    const source = [
      '# Root',
      '## Alpha',
      '> ### Nested quote',
      '> > #### Deeper quote',
      '',
      '> ### Different quote',
      '> body',
      '##### Deep',
      '## Beta',
      ''
    ].join('\n');
    const structure = parseMarkdownStructure(source);
    const sections = collectMarkdownSections(structure);
    const alpha = sections.find((section) => section.heading.lineStart === source.indexOf('## Alpha'));

    expect(alpha).toBeDefined();
    if (alpha === undefined) {
      throw new Error('expected Alpha fixture heading');
    }
    expect(
      findHeadingsInSection(structure, alpha).map((heading) => source.slice(heading.lineStart, heading.syntaxEnd))
    ).toEqual(['## Alpha', '##### Deep']);
  });

  it.each([
    {
      name: 'the first sibling',
      source: '# Root\n## Target\n## Later\n',
      targetHeading: '## Target'
    },
    {
      name: 'a preceding heading at a different level',
      source: '# Root\n### Before\n## Target\n',
      targetHeading: '## Target'
    },
    {
      name: 'a preceding heading under a different parent',
      source: [
        '# Root',
        '## First parent',
        '### Before',
        '## Second parent',
        '### Target',
        ''
      ].join('\n'),
      targetHeading: '### Target'
    },
    {
      name: 'a preceding heading in a different quote container',
      source: [
        '> ## Before',
        '> body',
        '',
        'outside',
        '',
        '> ## Target',
        '> body',
        ''
      ].join('\n'),
      targetHeading: '> ## Target'
    }
  ])('returns null for $name', ({ source, targetHeading }) => {
    const sections = collectMarkdownSections(parseMarkdownStructure(source));
    const target = sections.find((section) => section.heading.lineStart === source.indexOf(targetHeading));

    expect(target).toBeDefined();
    if (target === undefined) {
      throw new Error('expected target fixture heading');
    }
    expect(findPreviousSiblingSection(sections, target)).toBeNull();
  });

  it('collects ranges, parents, and same-level siblings', () => {
    const source = [
      '# Root',
      'intro',
      '## Alpha',
      'alpha',
      '### Child',
      'child',
      '## Beta',
      'beta',
      '# Next',
      ''
    ].join('\n');
    const sections = collectMarkdownSections(parseMarkdownStructure(source));
    const alpha = findMarkdownSection(
      source.length,
      sections,
      source.indexOf('alpha')
    );
    const root = findMarkdownSection(
      source.length,
      sections,
      source.indexOf('intro')
    );

    expect(alpha?.range).toEqual({
      from: source.indexOf('## Alpha'),
      to: source.indexOf('## Beta')
    });
    expect(alpha?.parent?.lineStart).toBe(0);
    expect(
      alpha === null
        ? []
        : findSiblingSections(sections, alpha).map((section) => headingText(source, section))
    ).toEqual(['## Alpha', '## Beta']);
    expect(
      root === null
        ? []
        : findSiblingSections(sections, root).map((section) => headingText(source, section))
    ).toEqual(['# Root', '# Next']);
  });

  it.each([
    {
      expectedSiblings: ['### Deep A', '### Deep B'],
      name: 'skipped heading levels',
      source: [
        '# Root',
        '### Deep A',
        'deep-a',
        '### Deep B',
        'deep-b',
        '## Shallower',
        'shallower',
        ''
      ].join('\n'),
      targetBody: 'deep-a'
    },
    {
      expectedSiblings: ['## Root child'],
      name: 'a root heading beside separate quoted containers',
      source: [
        '# Root',
        '> ## Quoted A',
        '> quote-a',
        '',
        '## Root child',
        'root-child',
        '',
        '> ## Quoted B',
        '> quote-b',
        ''
      ].join('\n'),
      targetBody: 'root-child'
    },
    {
      expectedSiblings: ['> ## Quoted A'],
      name: 'the first of separate quoted containers',
      source: [
        '# Root',
        '> ## Quoted A',
        '> quote-a',
        '',
        '## Root child',
        'root-child',
        '',
        '> ## Quoted B',
        '> quote-b',
        ''
      ].join('\n'),
      targetBody: 'quote-a'
    }
  ])('keeps sibling sets independent for $name', ({
    expectedSiblings,
    source,
    targetBody
  }) => {
    const sections = collectMarkdownSections(parseMarkdownStructure(source));
    const target = findMarkdownSection(
      source.length,
      sections,
      source.indexOf(targetBody)
    );

    expect(
      target === null
        ? []
        : findSiblingSections(sections, target).map((section) => headingText(source, section))
    ).toEqual(expectedSiblings);
  });

  it('does not treat different levels under one parent as siblings', () => {
    const source = '# Root\n### Deep\ndeep\n## Shallower\nshallower\n';
    const sections = collectMarkdownSections(parseMarkdownStructure(source));
    const deep = findMarkdownSection(
      source.length,
      sections,
      source.indexOf('deep')
    );
    const shallower = findMarkdownSection(
      source.length,
      sections,
      source.indexOf('shallower')
    );

    expect(deep?.parent?.lineStart).toBe(0);
    expect(shallower?.parent?.lineStart).toBe(0);
    expect(
      deep === null
        ? []
        : findSiblingSections(sections, deep).map((section) => headingText(source, section))
    ).toEqual(['### Deep']);
  });

  it('prefers the deepest container for cursor targeting', () => {
    const source = [
      '# Outer',
      '> ## Quoted',
      '> quote body',
      '> > ### Nested',
      '> > needle',
      '> tail',
      '# Next',
      ''
    ].join('\n');
    const sections = collectMarkdownSections(parseMarkdownStructure(source));
    const target = findMarkdownSection(
      source.length,
      sections,
      source.indexOf('needle')
    );

    expect(target?.heading.container.depth).toBe(2);
    expect(target === null ? null : headingText(source, target)).toBe(
      '> > ### Nested'
    );
  });

  it('accepts true EOF in the final section and rejects unsafe cursors', () => {
    const source = '# Final\nbody';
    const sections = collectMarkdownSections(parseMarkdownStructure(source));

    expect(
      findMarkdownSection(source.length, sections, source.length)?.range
    ).toEqual({ from: 0, to: source.length });
    for (const cursor of [-1, source.length + 1, 0.5, NaN]) {
      expect(findMarkdownSection(source.length, sections, cursor)).toBeNull();
    }
  });

  it('finds canonical root and nested relationships across skipped levels', () => {
    const source = [
      '# Root',
      '### Skipped child',
      '#### First grandchild',
      '#### Second grandchild',
      '### Other child',
      '#### Other grandchild',
      '# Next root',
      ''
    ].join('\n');
    const sections = collectMarkdownSections(parseMarkdownStructure(source));

    function byHeading(heading: string): MarkdownSection | undefined {
      return sections.find((section) => section.heading.lineStart === source.indexOf(heading));
    }

    const root = byHeading('# Root');
    const skippedChild = byHeading('### Skipped child');
    const firstGrandchild = byHeading('#### First grandchild');
    const secondGrandchild = byHeading('#### Second grandchild');
    const otherChild = byHeading('### Other child');
    const otherGrandchild = byHeading('#### Other grandchild');
    const nextRoot = byHeading('# Next root');

    expect(root).toBeDefined();
    expect(skippedChild).toBeDefined();
    expect(firstGrandchild).toBeDefined();
    expect(secondGrandchild).toBeDefined();
    expect(otherChild).toBeDefined();
    expect(otherGrandchild).toBeDefined();
    expect(nextRoot).toBeDefined();
    if (
      root === undefined
      || skippedChild === undefined
      || firstGrandchild === undefined
      || secondGrandchild === undefined
      || otherChild === undefined
      || otherGrandchild === undefined
      || nextRoot === undefined
    ) {
      throw new Error('expected relationship fixture headings');
    }

    expect(findParentSection(sections, root)).toBeNull();
    expect(findParentSection(sections, skippedChild)).toBe(root);
    expect(findParentSection(sections, firstGrandchild)).toBe(skippedChild);
    expect(findNextSiblingSection(sections, root)).toBe(nextRoot);
    expect(findNextSiblingSection(sections, firstGrandchild)).toBe(secondGrandchild);
    expect(findNextSiblingSection(sections, secondGrandchild)).toBeNull();
    expect(findNextSiblingSection(sections, skippedChild)).toBe(otherChild);
    expect(findNextSiblingSection(sections, otherGrandchild)).toBeNull();
    expect(findFirstChildSection(sections, root)).toBe(skippedChild);
    expect(findFirstChildSection(sections, skippedChild)).toBe(firstGrandchild);
    expect(findFirstChildSection(sections, firstGrandchild)).toBeNull();
  });

  it.each([
    {
      childHeading: '> > #### Child',
      firstHeading: '> > ## First',
      name: 'a nested blockquote',
      secondHeading: '> > ## Second',
      source: [
        '> Outer',
        '> > ## First',
        '> > #### Child',
        '> > body',
        '> > ## Second',
        ''
      ].join('\n')
    },
    {
      childHeading: '> #### Child',
      firstHeading: '> ## First',
      name: 'a callout',
      secondHeading: '> ## Second',
      source: [
        '> [!note] Container',
        '> ## First',
        '> #### Child',
        '> body',
        '> ## Second',
        ''
      ].join('\n')
    }
  ])('finds canonical relationships inside $name', ({
    childHeading,
    firstHeading,
    secondHeading,
    source
  }) => {
    const sections = collectMarkdownSections(parseMarkdownStructure(source));
    const first = sections.find((section) => section.heading.lineStart === source.indexOf(firstHeading));
    const child = sections.find((section) => section.heading.lineStart === source.indexOf(childHeading));
    const second = sections.find((section) => section.heading.lineStart === source.indexOf(secondHeading));

    expect(first).toBeDefined();
    expect(child).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || child === undefined || second === undefined) {
      throw new Error('expected container relationship fixture headings');
    }

    expect(findParentSection(sections, child)).toBe(first);
    expect(findFirstChildSection(sections, first)).toBe(child);
    expect(findNextSiblingSection(sections, first)).toBe(second);
  });

  it('does not cross separate blockquote containers', () => {
    const source = [
      '> ## First',
      '> ### Child',
      '> body',
      '',
      'outside',
      '',
      '> ## Second',
      '> ### Other child',
      '> body',
      ''
    ].join('\n');
    const sections = collectMarkdownSections(parseMarkdownStructure(source));
    const first = sections.find((section) => section.heading.lineStart === source.indexOf('> ## First'));
    const child = sections.find((section) => section.heading.lineStart === source.indexOf('> ### Child'));

    expect(first).toBeDefined();
    expect(child).toBeDefined();
    if (first === undefined || child === undefined) {
      throw new Error('expected separate blockquote fixture headings');
    }

    expect(findParentSection(sections, child)).toBe(first);
    expect(findFirstChildSection(sections, first)).toBe(child);
    expect(findNextSiblingSection(sections, first)).toBeNull();
    expect(findNextSiblingSection(sections, child)).toBeNull();
  });

  it('does not cross root containers from separate parses', () => {
    const firstSections = collectMarkdownSections(parseMarkdownStructure('# First\n'));
    const secondSections = collectMarkdownSections(parseMarkdownStructure('# Second\n'));
    const first = firstSections[0];
    const second = secondSections[0];

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) {
      throw new Error('expected separate parse fixture headings');
    }

    expect(first.heading.container.id).toBe(second.heading.container.id);
    expect(first.heading.container).not.toBe(second.heading.container);

    const combinedSections = [...firstSections, ...secondSections];
    expect(findSiblingSections(combinedSections, first)).toEqual([first]);
    expect(findNextSiblingSection(combinedSections, first)).toBeNull();
    expect(findPreviousSiblingSection(combinedSections, second)).toBeNull();
  });

  it('requires canonical section and parent heading identities', () => {
    const source = '# Root\n## Child\n## Next\n';
    const sections = collectMarkdownSections(parseMarkdownStructure(source));
    const root = sections[0];
    const child = sections[1];
    const next = sections[2];

    expect(root).toBeDefined();
    expect(child).toBeDefined();
    expect(next).toBeDefined();
    if (root === undefined || child === undefined || next === undefined) {
      throw new Error('expected identity fixture headings');
    }

    const clonedChild: MarkdownSection = { ...child };
    expect(findParentSection(sections, clonedChild)).toBeNull();
    expect(findNextSiblingSection(sections, clonedChild)).toBeNull();
    expect(findFirstChildSection(sections, { ...root })).toBeNull();

    const clonedParentHeading: MarkdownSection = {
      ...child,
      parent: { ...root.heading }
    };
    const sectionsWithExactTarget = [root, clonedParentHeading, next];
    expect(findParentSection(sectionsWithExactTarget, clonedParentHeading)).toBeNull();
  });
});
