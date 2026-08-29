// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible type imports compact.
import type { MoveSectionAction, SectionMovementMode, StructuralEditPlan } from './structural-action.ts';

import { planSectionMovement } from './section-movement-planner.ts';

function applyPlan(source: string, plan: StructuralEditPlan): string {
  return source.slice(0, plan.range.from)
    + plan.replacement
    + source.slice(plan.range.to);
}

function requiredPlan(
  source: string,
  cursorOffset: number,
  mode: SectionMovementMode
): StructuralEditPlan {
  const plan = planSectionMovement(source, cursorOffset, {
    kind: 'move-section',
    mode
  });
  if (plan === null) {
    throw new Error(`Expected a ${mode} movement plan`);
  }
  return plan;
}

describe('planSectionMovement', () => {
  it('plans adjacent and non-adjacent movement among same-level siblings', () => {
    const source = [
      '# Root',
      '## Alpha',
      'a',
      '## Beta',
      'b',
      '## Gamma',
      'g',
      '## Delta',
      'd',
      '## Epsilon',
      'e',
      '# Keep',
      ''
    ].join('\n');
    const gammaCursor = source.indexOf('\ng\n') + 1;
    const upPlan = requiredPlan(source, gammaCursor, 'up');
    const downPlan = requiredPlan(source, gammaCursor, 'down');
    const startPlan = requiredPlan(source, gammaCursor, 'start');
    const endPlan = requiredPlan(source, gammaCursor, 'end');

    expect(applyPlan(source, upPlan)).toBe(
      '# Root\n## Alpha\na\n## Gamma\ng\n## Beta\nb\n## Delta\nd\n## Epsilon\ne\n# Keep\n'
    );
    expect(applyPlan(source, downPlan)).toBe(
      '# Root\n## Alpha\na\n## Beta\nb\n## Delta\nd\n## Gamma\ng\n## Epsilon\ne\n# Keep\n'
    );
    expect(startPlan.range).toEqual({
      from: source.indexOf('## Alpha'),
      to: source.indexOf('## Delta')
    });
    expect(startPlan.replacement).toBe(
      '## Gamma\ng\n## Alpha\na\n## Beta\nb\n'
    );
    expect(applyPlan(source, startPlan)).toBe(
      '# Root\n## Gamma\ng\n## Alpha\na\n## Beta\nb\n## Delta\nd\n## Epsilon\ne\n# Keep\n'
    );
    expect(endPlan.range).toEqual({
      from: source.indexOf('## Gamma'),
      to: source.indexOf('# Keep')
    });
    expect(endPlan.replacement).toBe(
      '## Delta\nd\n## Epsilon\ne\n## Gamma\ng\n'
    );
    expect(applyPlan(source, endPlan)).toBe(
      '# Root\n## Alpha\na\n## Beta\nb\n## Delta\nd\n## Epsilon\ne\n## Gamma\ng\n# Keep\n'
    );
  });

  it('returns null at sibling edges and for an only child', () => {
    const source = '# Root\n## Alpha\na\n## Beta\nb\n';
    const alphaCursor = source.indexOf('\na\n') + 1;
    const betaCursor = source.indexOf('\nb\n') + 1;
    const onlyChild = '# Root\n## Only\nbody\n';

    expect(
      planSectionMovement(source, alphaCursor, {
        kind: 'move-section',
        mode: 'up'
      })
    ).toBeNull();
    expect(
      planSectionMovement(source, alphaCursor, {
        kind: 'move-section',
        mode: 'start'
      })
    ).toBeNull();
    expect(
      planSectionMovement(source, betaCursor, {
        kind: 'move-section',
        mode: 'down'
      })
    ).toBeNull();
    expect(
      planSectionMovement(source, betaCursor, {
        kind: 'move-section',
        mode: 'end'
      })
    ).toBeNull();
    expect(
      planSectionMovement(onlyChild, onlyChild.indexOf('body'), {
        kind: 'move-section',
        mode: 'up'
      })
    ).toBeNull();
    expect(
      planSectionMovement(onlyChild, onlyChild.indexOf('body'), {
        kind: 'move-section',
        mode: 'end'
      })
    ).toBeNull();
  });

  it('moves the complete descendant subtree with its target', () => {
    const source = [
      '# Root',
      '## Alpha',
      'alpha',
      '## Beta',
      'Beta body',
      '### Child',
      'child body',
      '#### Grandchild',
      'grandchild body',
      '## Gamma',
      'gamma',
      ''
    ].join('\n');

    expect(
      applyPlan(
        source,
        requiredPlan(source, source.indexOf('Beta body'), 'up')
      )
    ).toBe([
      '# Root',
      '## Beta',
      'Beta body',
      '### Child',
      'child body',
      '#### Grandchild',
      'grandchild body',
      '## Alpha',
      'alpha',
      '## Gamma',
      'gamma',
      ''
    ].join('\n'));
  });

  it('never crosses the current heading parent', () => {
    const source = [
      '# Root',
      '## Parent A',
      '### Alpha',
      'alpha',
      '### Beta',
      'beta',
      '## Parent B',
      '### Gamma',
      'gamma',
      '### Delta',
      'delta',
      ''
    ].join('\n');
    const betaCursor = source.indexOf('\nbeta\n') + 1;

    expect(applyPlan(source, requiredPlan(source, betaCursor, 'up'))).toBe([
      '# Root',
      '## Parent A',
      '### Beta',
      'beta',
      '### Alpha',
      'alpha',
      '## Parent B',
      '### Gamma',
      'gamma',
      '### Delta',
      'delta',
      ''
    ].join('\n'));
    expect(
      planSectionMovement(source, betaCursor, {
        kind: 'move-section',
        mode: 'down'
      })
    ).toBeNull();
    expect(
      planSectionMovement(source, betaCursor, {
        kind: 'move-section',
        mode: 'end'
      })
    ).toBeNull();
  });

  it('keeps root and quoted sibling sets separate', () => {
    const source = [
      '## Root A',
      'root-a',
      '> ## Quote A',
      '> quote-a',
      '> ## Quote B',
      '> quote-b',
      '## Root B',
      'root-b',
      ''
    ].join('\n');
    const quoteACursor = source.indexOf('quote-a');
    const quoteBCursor = source.indexOf('quote-b');

    expect(
      applyPlan(source, requiredPlan(source, quoteACursor, 'down'))
    ).toBe([
      '## Root A',
      'root-a',
      '> ## Quote B',
      '> quote-b',
      '> ## Quote A',
      '> quote-a',
      '## Root B',
      'root-b',
      ''
    ].join('\n'));
    expect(
      planSectionMovement(source, quoteBCursor, {
        kind: 'move-section',
        mode: 'down'
      })
    ).toBeNull();
  });

  it.each([
    {
      expected: '# Root\n## Beta\nb\n## Alpha\na\n',
      name: 'LF',
      source: '# Root\n## Alpha\na\n## Beta\nb\n'
    },
    {
      expected: '# Root\r\n## Beta\r\nb\r\n## Alpha\r\na\r\n',
      name: 'CRLF',
      source: '# Root\r\n## Alpha\r\na\r\n## Beta\r\nb\r\n'
    }
  ])('preserves exact $name line endings', ({ expected, source }) => {
    expect(
      applyPlan(source, requiredPlan(source, source.indexOf('b'), 'up'))
    ).toBe(expected);
  });

  it('preserves exact blank lines and an EOF without a trailing line break', () => {
    const source = '# Root\n## Alpha\na\n\n## Beta\nb\n\n\n## Gamma\ng';

    expect(
      applyPlan(source, requiredPlan(source, source.indexOf('\nb\n') + 1, 'up'))
    ).toBe('# Root\n## Beta\nb\n\n\n## Alpha\na\n\n## Gamma\ng');
  });

  it.each([
    {
      expected: [
        'Beta title',
        'continued',
        '---',
        'Alpha title',
        'continued',
        '---',
        '',
        ''
      ].join('\n'),
      name: 'multiline Setext',
      source: [
        'Alpha title',
        'continued',
        '---',
        '',
        'Beta title',
        'continued',
        '---',
        ''
      ].join('\n'),
      target: 'Beta title'
    },
    {
      expected: [
        '> ## Beta',
        '> beta',
        '> ## Alpha',
        '> alpha',
        ''
      ].join('\n'),
      name: 'quoted ATX',
      source: [
        '> ## Alpha',
        '> alpha',
        '> ## Beta',
        '> beta',
        ''
      ].join('\n'),
      target: 'beta'
    },
    {
      expected: [
        '> [!note] Sections',
        '> ## Beta',
        '> beta',
        '> ## Alpha',
        '> alpha',
        ''
      ].join('\n'),
      name: 'callout-contained ATX',
      source: [
        '> [!note] Sections',
        '> ## Alpha',
        '> alpha',
        '> ## Beta',
        '> beta',
        ''
      ].join('\n'),
      target: 'beta'
    }
  ])('moves a $name target as exact text', ({ expected, source, target }) => {
    expect(
      applyPlan(source, requiredPlan(source, source.lastIndexOf(target), 'up'))
    ).toBe(expected);
  });

  it.each([
    {
      name: 'fenced code',
      source: '```md\n# Hidden\n```\n# Alpha\na\n# Beta\nb\n'
    },
    {
      name: 'frontmatter',
      source: '---\n# Hidden\n---\n# Alpha\na\n# Beta\nb\n'
    },
    {
      name: 'HTML comment',
      source: '<!--\n# Hidden\n-->\n# Alpha\na\n# Beta\nb\n'
    },
    {
      name: 'Obsidian comment',
      source: '%%\n# Hidden\n%%\n# Alpha\na\n# Beta\nb\n'
    }
  ])('does not target a heading inside $name', ({ source }) => {
    expect(
      planSectionMovement(source, source.indexOf('Hidden'), {
        kind: 'move-section',
        mode: 'down'
      })
    ).toBeNull();
  });

  const cursorSource = [
    '# Root',
    '## Alpha',
    'Alpha body',
    '## Beta',
    'Beta body',
    '## Gamma',
    'Gamma body',
    '## Delta',
    'Delta body',
    '## Epsilon',
    'Epsilon body',
    ''
  ].join('\n');
  const nestedCursorSource = [
    '# Root',
    '## Parent',
    '### One',
    'One body',
    '### Two',
    'Two body',
    '### Three',
    'Three body',
    '### Four',
    'Four body',
    ''
  ].join('\n');
  const eofCursorSource = [
    '# Root',
    '## Alpha',
    'Alpha body',
    '## Beta',
    'Beta body',
    '## Gamma',
    'Gamma body',
    '## Delta',
    'Delta body',
    ''
  ].join('\n');

  it.each(
    [
      {
        cursorOffset: cursorSource.indexOf('Gamma') + 2,
        mode: 'up',
        name: 'an upward move from inside a heading',
        source: cursorSource,
        trackedText: 'mma'
      },
      {
        cursorOffset: cursorSource.indexOf('Beta body') + 'Beta '.length,
        mode: 'down',
        name: 'a downward move from inside body text',
        source: cursorSource,
        trackedText: 'body'
      },
      {
        cursorOffset: cursorSource.indexOf('Gamma body') + 'Gamma '.length,
        mode: 'start',
        name: 'a non-adjacent move to start',
        source: cursorSource,
        trackedText: 'body'
      },
      {
        cursorOffset: nestedCursorSource.indexOf('Two body') + 'Two '.length,
        mode: 'end',
        name: 'a nested descendant section moving non-adjacently to end',
        source: nestedCursorSource,
        trackedText: 'body'
      },
      {
        cursorOffset: eofCursorSource.length,
        mode: 'start',
        name: 'a true EOF boundary moving non-adjacently to start',
        source: eofCursorSource,
        trackedText: ''
      }
    ] as const
  )(
    'maps the cursor-relative offset for $name',
    ({ cursorOffset, mode, source, trackedText }) => {
      const plan = requiredPlan(source, cursorOffset, mode);
      const updated = applyPlan(source, plan);

      if (cursorOffset === source.length) {
        expect(updated.slice(0, plan.cursorOffset)).toBe(
          '# Root\n## Delta\nDelta body\n'
        );
        expect(updated.slice(plan.cursorOffset)).toBe([
          '## Alpha',
          'Alpha body',
          '## Beta',
          'Beta body',
          '## Gamma',
          'Gamma body',
          ''
        ].join('\n'));
        return;
      }

      expect(updated[plan.cursorOffset]).toBe(source[cursorOffset]);
      expect(
        updated.slice(plan.cursorOffset, plan.cursorOffset + trackedText.length)
      ).toBe(trackedText);
    }
  );

  it('returns the original action and rejects invalid cursor offsets', () => {
    const source = '# Alpha\na\n# Beta\nb\n';
    const action: MoveSectionAction = {
      kind: 'move-section',
      mode: 'up'
    };
    const plan = planSectionMovement(source, source.indexOf('\nb\n') + 1, action);

    expect(plan?.action).toBe(action);
    for (const cursorOffset of [-1, source.length + 1, 0.5, NaN]) {
      expect(planSectionMovement(source, cursorOffset, action)).toBeNull();
    }
  });
});
