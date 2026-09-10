// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

import type { StructuralAction } from './structural-action.ts';

import {
  collectDeletionTargetsWithContext,
  planContextualDeletionWithContext,
  planSectionDeletionWithContext
} from './deletion-planner.ts';
import { parseMarkdownStructure } from './markdown-structure.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import { planSectionHierarchyChange, planSectionHierarchyChangeWithContext } from './section-hierarchy-planner.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import { planSectionMovement, planSectionMovementWithContext } from './section-movement-planner.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import { planStructuralAction, planStructuralActionWithContext } from './structural-action-planner.ts';
import { createStructuralPlanningContext } from './structural-planning-context.ts';

function asStructuralAction(value: unknown): StructuralAction {
  return value as StructuralAction;
}

const SOURCE = [
  '# Root',
  '## Alpha',
  'alpha',
  '## Beta',
  'beta',
  '### Beta child',
  'child',
  '## Gamma',
  'gamma',
  '## Delta',
  'delta',
  ''
].join('\n');
const CURSOR_OFFSET = SOURCE.indexOf('\nbeta\n') + 1;

describe('context-aware structural action planner', () => {
  const actions = [
    { kind: 'move-section', mode: 'up' },
    { kind: 'move-section', mode: 'down' },
    { kind: 'move-section', mode: 'start' },
    { kind: 'move-section', mode: 'end' },
    { kind: 'change-section-hierarchy', mode: 'promote' },
    { kind: 'change-section-hierarchy', mode: 'demote' }
  ] as const satisfies readonly StructuralAction[];

  it.each([
    {
      cursorOffset: (source: string): number => source.indexOf('beta'),
      name: 'ATX headings with LF endings',
      source: SOURCE
    },
    {
      cursorOffset: (source: string): number => source.indexOf('Beta'),
      name: 'multiline Setext headings',
      source: 'Alpha\n-----\na\n\nBeta\n-----\nb\n'
    },
    {
      cursorOffset: (source: string): number => source.lastIndexOf('beta'),
      name: 'callout-contained quoted headings',
      source: '> [!note]\n> ## Alpha\n> alpha\n> ## Beta\n> beta\n'
    },
    {
      cursorOffset: (source: string): number => source.indexOf('Hidden'),
      name: 'a protected heading',
      source: '```md\n# Hidden\n```\n# Alpha\na\n# Beta\nb\n'
    },
    {
      cursorOffset: (): number => -1,
      name: 'an invalid cursor offset',
      source: '# Alpha\na\n# Beta\nb\n'
    },
    {
      cursorOffset: (source: string): number => source.indexOf('beta'),
      name: 'ATX headings with CRLF endings',
      source: '# Root\r\n## Alpha\r\nalpha\r\n## Beta\r\nbeta\r\n'
    },
    {
      cursorOffset: (source: string): number => source.indexOf('beta'),
      name: 'exact blank lines without a trailing line break',
      source: '# Root\n## Alpha\nalpha\n\n## Beta\nbeta\n\n## Gamma\ngamma'
    },
    {
      cursorOffset: (source: string): number => source.length,
      name: 'a true EOF cursor',
      source: '# Root\n## Alpha\nalpha\n## Beta\nbeta'
    }
  ])('matches the source wrapper for every action with $name', ({
    cursorOffset: selectCursorOffset,
    source
  }) => {
    const context = createStructuralPlanningContext(source);
    const cursorOffset = selectCursorOffset(source);

    for (const action of actions) {
      expect(
        planStructuralActionWithContext(context, cursorOffset, action)
      ).toEqual(planStructuralAction(source, cursorOffset, action));
    }
  });

  it.each(actions)(
    'keeps the context dispatcher aligned for $kind $mode',
    (action) => {
      const context = createStructuralPlanningContext(SOURCE);
      const expected = action.kind === 'move-section'
        ? planSectionMovementWithContext(context, CURSOR_OFFSET, action)
        : planSectionHierarchyChangeWithContext(
          context,
          CURSOR_OFFSET,
          action
        );

      expect(
        planStructuralActionWithContext(context, CURSOR_OFFSET, action)
      ).toEqual(expected);
    }
  );

  it('serves every planner from one context without parsing again', () => {
    const structuralLines = [
      '# Root',
      '## Alpha',
      'alpha',
      '## Beta',
      '> [!note]',
      '> body',
      '## Gamma',
      'gamma'
    ];
    const source = ['---', ...structuralLines, '---', ''].join('\n');
    const padding = ' '.repeat(3);
    const structuralSource = [
      padding,
      ...structuralLines,
      padding,
      ''
    ].join('\n');
    const cursorOffset = source.indexOf('body');
    const parse = vi.fn((_source: string) => parseMarkdownStructure(structuralSource));
    const context = createStructuralPlanningContext(source, parse);
    const movementAction = { kind: 'move-section', mode: 'up' } as const;
    const hierarchyAction = {
      kind: 'change-section-hierarchy',
      mode: 'demote'
    } as const;

    expect(collectDeletionTargetsWithContext(context, cursorOffset)).not
      .toHaveLength(0);
    expect(
      planContextualDeletionWithContext(context, cursorOffset, 'callout')
    ).not.toBeNull();
    expect(
      planSectionDeletionWithContext(context, cursorOffset, 'section')
    ).not.toBeNull();
    expect(
      planSectionMovementWithContext(context, cursorOffset, movementAction)
    ).not.toBeNull();
    expect(
      planSectionHierarchyChangeWithContext(
        context,
        cursorOffset,
        hierarchyAction
      )
    ).not.toBeNull();
    expect(
      planStructuralActionWithContext(context, cursorOffset, movementAction)
    ).not.toBeNull();
    expect(parse).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledWith(source);
  });

  it('rejects an unknown action through the context dispatcher', () => {
    const context = createStructuralPlanningContext(SOURCE);
    const unknownAction = asStructuralAction({
      kind: 'future-structural-action'
    });

    expect(() => {
      planStructuralActionWithContext(
        context,
        CURSOR_OFFSET,
        unknownAction
      );
    }).toThrow(TypeError);
  });
});

describe('planStructuralAction', () => {
  it.each(['up', 'down', 'start', 'end'] as const)(
    'dispatches move-section %s to the movement planner',
    (mode) => {
      const action = { kind: 'move-section', mode } as const;

      expect(planStructuralAction(SOURCE, CURSOR_OFFSET, action)).toEqual(
        planSectionMovement(SOURCE, CURSOR_OFFSET, action)
      );
    }
  );

  it.each(['promote', 'demote'] as const)(
    'dispatches change-section-hierarchy %s to the hierarchy planner',
    (mode) => {
      const action = { kind: 'change-section-hierarchy', mode } as const;

      expect(planStructuralAction(SOURCE, CURSOR_OFFSET, action)).toEqual(
        planSectionHierarchyChange(SOURCE, CURSOR_OFFSET, action)
      );
    }
  );

  it('rejects an unknown structural action instead of silently falling back', () => {
    const unknownAction = asStructuralAction({
      kind: 'future-structural-action'
    });

    expect(() => {
      planStructuralAction(SOURCE, CURSOR_OFFSET, unknownAction);
    }).toThrow(TypeError);
  });
});
