// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import type { MarkdownSection } from './section-query.ts';

import { parseMarkdownStructure } from './markdown-structure.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible query imports compact.
import { collectMarkdownSections, findMarkdownSection, findSiblingSections } from './section-query.ts';

function headingText(source: string, section: MarkdownSection): string {
  return source.slice(section.heading.lineStart, section.heading.syntaxEnd);
}

describe('section queries', () => {
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
});
