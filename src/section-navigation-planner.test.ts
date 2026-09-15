// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import type { MarkdownHeading } from './markdown-structure.ts';
import type { SectionNavigationMode } from './section-navigation-planner.ts';
import type { MarkdownSection } from './section-query.ts';
import type { StructuralPlanningContext } from './structural-planning-context.ts';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import { planSectionNavigation, planSectionNavigationWithContext } from './section-navigation-planner.ts';
import { createStructuralPlanningContext } from './structural-planning-context.ts';

function contextWithHeading(
  context: StructuralPlanningContext,
  index: number,
  heading: MarkdownHeading
): StructuralPlanningContext {
  const sections = context.sections.map((section, sectionIndex): MarkdownSection =>
    sectionIndex === index ? { ...section, heading } : section
  );
  return { ...context, sections };
}

function expectPlan(
  source: string,
  cursorOffset: number,
  mode: SectionNavigationMode,
  expectedOffset: null | number
): void {
  const before = source;
  const context = createStructuralPlanningContext(source);
  const expected = expectedOffset === null
    ? null
    : { cursorOffset: expectedOffset };

  expect(planSectionNavigation(source, cursorOffset, mode)).toEqual(expected);
  expect(
    planSectionNavigationWithContext(context, cursorOffset, mode)
  ).toEqual(expected);
  expect(source).toBe(before);
  expect(context.source).toBe(before);
}

describe('section navigation planning', () => {
  it.each([
    { expectedOffset: 2, mode: 'parent' as const },
    { expectedOffset: null, mode: 'previous-sibling' as const },
    { expectedOffset: 89, mode: 'next-sibling' as const },
    { expectedOffset: 44, mode: 'first-child' as const }
  ])('plans $mode with literal offsets across skipped levels', ({
    expectedOffset,
    mode
  }) => {
    const source = [
      '# Root',
      'root body',
      '### Skipped',
      'skip body',
      '#### First',
      'first body',
      '#### Second',
      'second body',
      '### Other',
      'other body',
      '# Next',
      ''
    ].join('\n');

    expectPlan(source, 29, mode, expectedOffset);
  });

  it.each([
    {
      cursorOffset: 17,
      expectedOffset: 89,
      mode: 'next-sibling' as const,
      name: 'heading'
    },
    {
      cursorOffset: 29,
      expectedOffset: 89,
      mode: 'next-sibling' as const,
      name: 'body'
    },
    {
      cursorOffset: 50,
      expectedOffset: 21,
      mode: 'parent' as const,
      name: 'descendant body'
    },
    {
      cursorOffset: 113,
      expectedOffset: 2,
      mode: 'previous-sibling' as const,
      name: 'true EOF'
    }
  ])('targets the deepest section from its $name', ({
    cursorOffset,
    expectedOffset,
    mode
  }) => {
    const source = [
      '# Root',
      'root body',
      '### Skipped',
      'skip body',
      '#### First',
      'first body',
      '#### Second',
      'second body',
      '### Other',
      'other body',
      '# Next',
      ''
    ].join('\n');
    expectPlan(source, cursorOffset, mode, expectedOffset);
  });

  it('finds the previous exact sibling', () => {
    const source = '# Root\n### First\nbody\n### Second\nbody\n';

    expectPlan(source, 35, 'previous-sibling', 11);
  });

  it.each(
    [
      'parent',
      'previous-sibling',
      'next-sibling',
      'first-child'
    ] as const
  )('returns null for unavailable %s boundaries', (mode) => {
    expectPlan('# Only\nbody\n', 8, mode, null);
  });

  it.each([-1, 8, 0.5, NaN, Infinity])(
    'rejects invalid cursor offset %s',
    (cursorOffset) => {
      expectPlan('# A\n', cursorOffset, 'next-sibling', null);
    }
  );

  it('does not fall back to an ancestor relationship', () => {
    const source = [
      '# Outer',
      '> ## Inner',
      '> inner body',
      '# Next',
      ''
    ].join('\n');

    expectPlan(source, 22, 'next-sibling', null);
    expectPlan(source, 22, 'parent', null);
  });

  it('keeps root and separate blockquote containers independent', () => {
    const source = [
      '# Root',
      '> ## Quote one',
      '> body one',
      '',
      '## Root child',
      'root body',
      '',
      '> ## Quote two',
      '> body two',
      ''
    ].join('\n');

    expectPlan(source, 25, 'next-sibling', null);
    expectPlan(source, 53, 'previous-sibling', null);
    expectPlan(source, 53, 'parent', 2);
  });

  it('respects nested blockquote boundaries and quote prefixes', () => {
    const source = [
      '> Outer',
      '> > ## First',
      '> > body',
      '> > ### Child',
      '> > child',
      '> > ## Second',
      ''
    ].join('\n');

    expectPlan(source, 29, 'first-child', 38);
    expectPlan(source, 45, 'parent', 15);
    expectPlan(source, 25, 'next-sibling', 61);
  });

  it('navigates only within a callout container', () => {
    const source = [
      '> [!note] Box',
      '> ## First',
      '> body',
      '> #### Child',
      '> child',
      '> ## Second',
      ''
    ].join('\n');

    expectPlan(source, 31, 'first-child', 39);
    expectPlan(source, 47, 'parent', 19);
    expectPlan(source, 27, 'next-sibling', 58);
  });

  it.each([
    '```md\n# Fake\n```\n',
    '---\n# Fake\n---\n',
    '<!--\n# Fake\n-->\n',
    '%%\n# Fake\n%%\n'
  ])('returns null when protected syntax contains the only heading', (source) => {
    expectPlan(source, source.indexOf('Fake'), 'parent', null);
  });

  it.each([
    {
      expectedOffset: 11,
      name: 'one marker',
      source: '# A\nbody\n# B\n'
    },
    {
      expectedOffset: 15,
      name: 'spaces, tabs, and inline markup',
      source: '# Parent\n##   \t**Bold**\n'
    },
    {
      expectedOffset: 16,
      name: 'six opening markers',
      source: '# Parent\n###### Deep\n'
    }
  ])('places an ATX cursor before title syntax for $name', ({
    expectedOffset,
    source
  }) => {
    const mode = source.startsWith('# A') ? 'next-sibling' : 'first-child';
    expectPlan(source, 2, mode, expectedOffset);
  });

  it.each([
    { source: '# Parent\n##\n' },
    { source: '# Parent\n## \t\n' },
    { source: '# Parent\n##   ###\n' },
    { source: '# Parent\n## \t###  \t\n' }
  ])('lands immediately after an opening marker for an empty ATX title', ({
    source
  }) => {
    expectPlan(source, 2, 'first-child', 11);
  });

  it('places a quoted ATX cursor after its marker and whitespace', () => {
    const source = '> # Parent\n> ## \t*Child*\n';

    expectPlan(source, 4, 'first-child', 17);
  });

  it('places a Setext cursor at the first title character', () => {
    const source = 'Parent\n======\nChild\n-----\n';

    expectPlan(source, 0, 'first-child', 14);
    expectPlan(source, 20, 'parent', 0);
  });

  it('uses the first title line of a multiline Setext heading', () => {
    const source = '# Parent\n  First line\nsecond line\n-----------\n';

    expectPlan(source, 2, 'first-child', 11);
  });

  it('handles Setext quote prefixes', () => {
    const source = '> Parent\n> ======\n> Child\n> -----\n';

    expectPlan(source, 2, 'first-child', 20);
    expectPlan(source, 28, 'parent', 2);
  });

  it('handles CRLF ATX syntax without counting carriage returns as title text', () => {
    const source = '# Parent\r\n## \tChild\r\n## Next\r\n';

    expectPlan(source, 2, 'first-child', 14);
    expectPlan(source, 17, 'next-sibling', 24);
  });

  it('handles CRLF Setext syntax', () => {
    const source = 'Parent\r\n======\r\nChild\r\n-----\r\n';

    expectPlan(source, 0, 'first-child', 16);
    expectPlan(source, 23, 'parent', 0);
  });

  it('rejects malformed ATX syntax ranges from a supplied context', () => {
    const source = '# Parent\n## Child\n';
    const context = createStructuralPlanningContext(source);
    const child = context.sections[1];
    expect(child).toBeDefined();
    if (child?.heading.syntax.kind !== 'atx') {
      throw new Error('expected ATX child fixture');
    }
    const malformed = contextWithHeading(context, 1, {
      ...child.heading,
      syntax: {
        kind: 'atx',
        openingMarkerRange: { from: source.length + 1, to: source.length + 3 }
      }
    });

    expect(
      planSectionNavigationWithContext(malformed, 2, 'first-child')
    ).toBeNull();

    const unsafeSyntaxEnd = contextWithHeading(context, 1, {
      ...child.heading,
      syntaxEnd: source.length + 1
    });
    expect(
      planSectionNavigationWithContext(unsafeSyntaxEnd, 2, 'first-child')
    ).toBeNull();
  });

  it('rejects malformed or whitespace-only Setext title ranges', () => {
    const source = '# Parent\nChild\n-----\n';
    const context = createStructuralPlanningContext(source);
    const child = context.sections[1];
    expect(child).toBeDefined();
    if (child?.heading.syntax.kind !== 'setext') {
      throw new Error('expected Setext child fixture');
    }
    const malformed = contextWithHeading(context, 1, {
      ...child.heading,
      syntax: {
        ...child.heading.syntax,
        titleRanges: [{ from: 10, to: 10 }, { from: -1, to: 4 }]
      }
    });

    expect(
      planSectionNavigationWithContext(malformed, 2, 'first-child')
    ).toBeNull();

    const noSafeRange = contextWithHeading(context, 1, {
      ...child.heading,
      syntax: {
        ...child.heading.syntax,
        titleRanges: [{ from: 9, to: 9 }]
      }
    });
    expect(
      planSectionNavigationWithContext(noSafeRange, 2, 'first-child')
    ).toBeNull();

    const lineBreakRange = contextWithHeading(context, 1, {
      ...child.heading,
      syntax: {
        ...child.heading.syntax,
        titleRanges: [{ from: 14, to: 15 }]
      }
    });
    expect(
      planSectionNavigationWithContext(lineBreakRange, 2, 'first-child')
    ).toBeNull();
  });
});
