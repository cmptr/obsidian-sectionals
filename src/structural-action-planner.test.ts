// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import type { StructuralAction } from './structural-action.ts';

import { planSectionHierarchyChange } from './section-hierarchy-planner.ts';
import { planSectionMovement } from './section-movement-planner.ts';
import { planStructuralAction } from './structural-action-planner.ts';

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
