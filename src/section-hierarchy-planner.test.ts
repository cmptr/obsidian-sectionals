// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible type imports compact.
import type { ChangeSectionHierarchyAction, SectionHierarchyMode, StructuralEditPlan } from './structural-action.ts';

import { parseMarkdownStructure } from './markdown-structure.ts';
import { planSectionHierarchyChange } from './section-hierarchy-planner.ts';

function applyPlan(source: string, plan: StructuralEditPlan): string {
  return source.slice(0, plan.range.from)
    + plan.replacement
    + source.slice(plan.range.to);
}

function expectEveryHeadingToShift(
  source: string,
  plan: StructuralEditPlan,
  delta: -1 | 1
): void {
  const originalLevels = parseMarkdownStructure(
    source.slice(plan.range.from, plan.range.to)
  ).headings.map((heading) => heading.level);
  const replacementLevels = parseMarkdownStructure(plan.replacement).headings
    .map((heading) => heading.level);

  expect(replacementLevels).toEqual(
    originalLevels.map((level) => level + delta)
  );
}

function requiredPlan(
  source: string,
  cursorOffset: number,
  mode: SectionHierarchyMode
): StructuralEditPlan {
  const plan = planSectionHierarchyChange(source, cursorOffset, {
    kind: 'change-section-hierarchy',
    mode
  });
  if (plan === null) {
    throw new Error(`Expected a ${mode} hierarchy plan`);
  }
  return plan;
}

const DEMOTE: ChangeSectionHierarchyAction = {
  kind: 'change-section-hierarchy',
  mode: 'demote'
};
const PROMOTE: ChangeSectionHierarchyAction = {
  kind: 'change-section-hierarchy',
  mode: 'promote'
};

describe('planSectionHierarchyChange', () => {
  describe('validity', () => {
    it('rejects invalid cursor offsets before planning', () => {
      const source = '# Root\n## Target\nbody\n';

      for (const cursorOffset of [-1, source.length + 1, 0.5, NaN, Infinity]) {
        expect(
          planSectionHierarchyChange(source, cursorOffset, PROMOTE)
        ).toBeNull();
      }
    });

    it('rejects a cursor with no current section', () => {
      const plainSource = 'plain text only\n';
      const protectedSource = '```md\n# Not a section\n```\n';

      expect(
        planSectionHierarchyChange(plainSource, 4, PROMOTE)
      ).toBeNull();
      expect(
        planSectionHierarchyChange(
          protectedSource,
          protectedSource.indexOf('Not'),
          PROMOTE
        )
      ).toBeNull();
    });

    it('rejects H1 promotion', () => {
      const source = '# Target\nbody\n';

      expect(
        planSectionHierarchyChange(source, source.indexOf('body'), PROMOTE)
      ).toBeNull();
    });

    it('does not promote an enclosing ancestor when the deepest section is H1', () => {
      const source = [
        '## Enclosing',
        'outer body',
        '> # Deepest',
        '> inner body',
        '## Keep',
        ''
      ].join('\n');

      expect(
        planSectionHierarchyChange(
          source,
          source.indexOf('inner body'),
          PROMOTE
        )
      ).toBeNull();
    });

    it.each([
      {
        name: 'the first sibling',
        source: '# Root\n## Target\nbody\n## Later\n',
        target: 'body'
      },
      {
        name: 'a preceding heading at a different level',
        source: '# Root\n### Before\nbefore\n## Target\nbody\n',
        target: 'body'
      },
      {
        name: 'a preceding heading under a different parent',
        source: [
          '# Root',
          '## First parent',
          '### Before',
          'before',
          '## Second parent',
          '### Target',
          'body',
          ''
        ].join('\n'),
        target: 'body'
      },
      {
        name: 'a preceding heading in a different container',
        source: [
          '> ## Before',
          '> before',
          '',
          'outside',
          '',
          '> ## Target',
          '> body',
          ''
        ].join('\n'),
        target: '> body'
      }
    ])('rejects demotion for $name', ({ source, target }) => {
      expect(
        planSectionHierarchyChange(source, source.indexOf(target), DEMOTE)
      ).toBeNull();
    });

    it('rejects demotion when any heading in the target subtree is H6', () => {
      const source = [
        '# Root',
        '## Previous',
        'previous',
        '## Target',
        'target body',
        '###### Too deep',
        'deep body',
        '# Keep',
        ''
      ].join('\n');

      expect(
        planSectionHierarchyChange(
          source,
          source.indexOf('target body'),
          DEMOTE
        )
      ).toBeNull();
    });

    it('does not demote an enclosing ancestor when the deepest section has no previous exact sibling', () => {
      const source = [
        '# Root',
        '## Previous',
        'previous',
        '## Enclosing',
        'outer body',
        '> ### Deepest',
        '> inner body',
        '## Keep',
        ''
      ].join('\n');

      expect(
        planSectionHierarchyChange(
          source,
          source.indexOf('inner body'),
          DEMOTE
        )
      ).toBeNull();
    });
  });

  describe('exact subtree rewrites', () => {
    it('promotes every ATX heading by one while preserving skipped gaps and surrounding bytes', () => {
      const source = [
        'preamble',
        '',
        '# Parent',
        'parent body',
        '## Target ##  ',
        'target body',
        '### Child ###',
        'child body',
        '##### Deep  ',
        'deep body',
        '## Keep',
        'keep body',
        ''
      ].join('\n');
      const action: ChangeSectionHierarchyAction = {
        kind: 'change-section-hierarchy',
        mode: 'promote'
      };
      const plan = planSectionHierarchyChange(
        source,
        source.indexOf('target body'),
        action
      );

      expect(plan).not.toBeNull();
      if (plan === null) {
        throw new Error('Expected an ATX promotion plan');
      }
      expect(plan.action).toBe(action);
      expect(plan.range).toEqual({
        from: source.indexOf('## Target'),
        to: source.indexOf('## Keep')
      });
      expect(plan.replacement).toBe([
        '# Target ##  ',
        'target body',
        '## Child ###',
        'child body',
        '#### Deep  ',
        'deep body',
        ''
      ].join('\n'));
      expect(applyPlan(source, plan)).toBe([
        'preamble',
        '',
        '# Parent',
        'parent body',
        '# Target ##  ',
        'target body',
        '## Child ###',
        'child body',
        '#### Deep  ',
        'deep body',
        '## Keep',
        'keep body',
        ''
      ].join('\n'));
      expectEveryHeadingToShift(source, plan, -1);
    });

    it('demotes an H2/H5 subtree beneath its preceding H2 sibling', () => {
      const source = [
        '# Root',
        '## Previous',
        'previous body',
        '',
        '## Target',
        'target body',
        '##### Deep',
        'deep body',
        '',
        '# Suffix',
        ''
      ].join('\n');
      const plan = requiredPlan(
        source,
        source.indexOf('target body'),
        'demote'
      );

      expect(plan.range).toEqual({
        from: source.indexOf('## Target'),
        to: source.indexOf('# Suffix')
      });
      expect(applyPlan(source, plan)).toBe([
        '# Root',
        '## Previous',
        'previous body',
        '',
        '### Target',
        'target body',
        '###### Deep',
        'deep body',
        '',
        '# Suffix',
        ''
      ].join('\n'));
      expectEveryHeadingToShift(source, plan, 1);
    });

    it('promotes a mixed Setext and ATX subtree without changing non-heading text', () => {
      const source = [
        'Prefix',
        '',
        'Parent',
        '======',
        'parent body',
        '',
        'Target',
        '------  ',
        'body  ',
        '#### Child ##  ',
        'child body',
        '',
        'Keep',
        '------',
        'suffix',
        ''
      ].join('\n');
      const plan = requiredPlan(source, source.indexOf('body  '), 'promote');

      expect(plan.range).toEqual({
        from: source.indexOf('Target'),
        to: source.indexOf('Keep')
      });
      expect(applyPlan(source, plan)).toBe([
        'Prefix',
        '',
        'Parent',
        '======',
        'parent body',
        '',
        'Target',
        '======  ',
        'body  ',
        '### Child ##  ',
        'child body',
        '',
        'Keep',
        '------',
        'suffix',
        ''
      ].join('\n'));
      expectEveryHeadingToShift(source, plan, -1);
    });

    it('demotes a mixed Setext and ATX subtree with CRLF at true EOF', () => {
      const source = [
        'Previous',
        '--------',
        'previous body',
        '',
        'Target  ',
        '--------  ',
        'target body',
        '#### Child ##  ',
        'child body'
      ].join('\r\n');
      const plan = requiredPlan(
        source,
        source.indexOf('target body'),
        'demote'
      );
      const updated = applyPlan(source, plan);

      expect(plan.range).toEqual({
        from: source.indexOf('Target'),
        to: source.length
      });
      expect(updated).toBe([
        'Previous',
        '--------',
        'previous body',
        '',
        '### Target',
        'target body',
        '##### Child ##  ',
        'child body'
      ].join('\r\n'));
      expectEveryHeadingToShift(source, plan, 1);
    });

    it('promotes a complete blockquote subtree and preserves its exact suffix', () => {
      const source = [
        'before',
        '',
        '> ## Target  ',
        '> body',
        '> #### Child',
        '> child',
        '',
        'after',
        ''
      ].join('\n');
      const plan = requiredPlan(source, source.indexOf('> body'), 'promote');

      expect(applyPlan(source, plan)).toBe([
        'before',
        '',
        '> # Target  ',
        '> body',
        '> ### Child',
        '> child',
        '',
        'after',
        ''
      ].join('\n'));
      expectEveryHeadingToShift(source, plan, -1);
    });

    it('demotes a complete callout subtree inside its container', () => {
      const source = [
        'before',
        '',
        '> [!note] Sections',
        '> ## Previous',
        '> previous',
        '> ## Target',
        '> target',
        '> ##### Deep',
        '> deep',
        '',
        'after',
        ''
      ].join('\n');
      const plan = requiredPlan(
        source,
        source.indexOf('> target'),
        'demote'
      );

      expect(plan.range).toEqual({
        from: source.indexOf('> ## Target'),
        to: source.indexOf('\nafter')
      });
      expect(applyPlan(source, plan)).toBe([
        'before',
        '',
        '> [!note] Sections',
        '> ## Previous',
        '> previous',
        '> ### Target',
        '> target',
        '> ###### Deep',
        '> deep',
        '',
        'after',
        ''
      ].join('\n'));
      expectEveryHeadingToShift(source, plan, 1);
    });
  });

  describe('cursor mapping', () => {
    const atxSource = [
      '# Root',
      '## Parent',
      '### Target',
      'Target body',
      '##### Child',
      'Child body',
      '### Keep',
      ''
    ].join('\n');
    const atxOutput = [
      '# Root',
      '## Parent',
      '## Target',
      'Target body',
      '#### Child',
      'Child body',
      '### Keep',
      ''
    ].join('\n');
    const deepestAtxOutput = [
      '# Root',
      '## Parent',
      '### Target',
      'Target body',
      '#### Child',
      'Child body',
      '### Keep',
      ''
    ].join('\n');

    it.each([
      {
        expectedOffset: atxOutput.indexOf('## Target'),
        expectedOutput: atxOutput,
        name: 'the retained target marker',
        sourceOffset: atxSource.indexOf('### Target'),
        trackedText: '#'
      },
      {
        expectedOffset: atxOutput.indexOf('## Target') + 2,
        expectedOutput: atxOutput,
        name: 'removed target marker syntax',
        sourceOffset: atxSource.indexOf('### Target') + 2,
        trackedText: ''
      },
      {
        expectedOffset: atxOutput.indexOf('Target') + 2,
        expectedOutput: atxOutput,
        name: 'the target title',
        sourceOffset: atxSource.indexOf('Target') + 2,
        trackedText: 'rget'
      },
      {
        expectedOffset: atxOutput.indexOf('Target body') + 7,
        expectedOutput: atxOutput,
        name: 'target body text',
        sourceOffset: atxSource.indexOf('Target body') + 7,
        trackedText: 'body'
      },
      {
        expectedOffset: deepestAtxOutput.indexOf('#### Child') + 4,
        expectedOutput: deepestAtxOutput,
        name: 'removed descendant marker syntax at the deepest target',
        sourceOffset: atxSource.indexOf('##### Child') + 4,
        trackedText: ''
      },
      {
        expectedOffset: deepestAtxOutput.indexOf('Child') + 2,
        expectedOutput: deepestAtxOutput,
        name: 'the descendant title at the deepest target',
        sourceOffset: atxSource.indexOf('Child') + 2,
        trackedText: 'ild'
      },
      {
        expectedOffset: deepestAtxOutput.indexOf('Child body') + 6,
        expectedOutput: deepestAtxOutput,
        name: 'descendant body text at the deepest target',
        sourceOffset: atxSource.indexOf('Child body') + 6,
        trackedText: 'body'
      }
    ])('maps $name deterministically', ({
      expectedOffset,
      expectedOutput,
      sourceOffset,
      trackedText
    }) => {
      const plan = requiredPlan(atxSource, sourceOffset, 'promote');
      const updated = applyPlan(atxSource, plan);

      expect(updated).toBe(expectedOutput);
      expect(plan.cursorOffset).toBe(expectedOffset);
      expect(
        updated.slice(plan.cursorOffset, plan.cursorOffset + trackedText.length)
      ).toBe(trackedText);
      expect(plan.cursorOffset).toBeGreaterThanOrEqual(plan.range.from);
      expect(plan.cursorOffset).toBeLessThanOrEqual(
        plan.range.from + plan.replacement.length
      );
    });

    it('maps a retained Setext title to the same characters after conversion', () => {
      const source = 'Before\n------\nbefore\n\nTarget\n------\nbody';
      const sourceOffset = source.indexOf('Target') + 2;
      const plan = requiredPlan(source, sourceOffset, 'demote');
      const updated = applyPlan(source, plan);

      expect(updated).toBe('Before\n------\nbefore\n\n### Target\nbody');
      expect(plan.cursorOffset).toBe(updated.indexOf('Target') + 2);
      expect(updated.slice(plan.cursorOffset, plan.cursorOffset + 4)).toBe(
        source.slice(sourceOffset, sourceOffset + 4)
      );
    });

    it('maps removed Setext underline syntax to its nearest stable boundary', () => {
      const source = 'Before\n------\nbefore\n\nTarget\n------\nbody';
      const sourceOffset = source.lastIndexOf('------') + 2;
      const plan = requiredPlan(source, sourceOffset, 'demote');
      const updated = applyPlan(source, plan);
      const expectedBoundary = updated.indexOf('### Target')
        + '### Target'.length;

      expect(plan.cursorOffset).toBe(expectedBoundary);
      expect(plan.cursorOffset).not.toBe(
        plan.range.from + plan.replacement.length
      );
      expect(updated[plan.cursorOffset]).toBe('\n');
      expect(plan.cursorOffset).toBeGreaterThanOrEqual(plan.range.from);
      expect(plan.cursorOffset).toBeLessThanOrEqual(
        plan.range.from + plan.replacement.length
      );
    });

    it('maps true EOF to true EOF after the target rewrite', () => {
      const source = [
        '# Root',
        '## Previous',
        'previous',
        '## Target',
        'body'
      ].join('\n');
      const plan = requiredPlan(source, source.length, 'demote');
      const updated = applyPlan(source, plan);

      expect(plan.cursorOffset).toBe(updated.length);
      expect(updated).toBe([
        '# Root',
        '## Previous',
        'previous',
        '### Target',
        'body'
      ].join('\n'));
    });
  });
});
