/* eslint-disable perfectionist/sort-switch-case, perfectionist/sort-union-types, unicorn/switch-case-braces -- Match the specified exhaustive dispatcher shape. */

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible type imports compact.
import type { StructuralAction, StructuralEditPlan } from './structural-action.ts';

import { planSectionHierarchyChange } from './section-hierarchy-planner.ts';
import { planSectionMovement } from './section-movement-planner.ts';

export function planStructuralAction(
  source: string,
  cursorOffset: number,
  action: StructuralAction
): StructuralEditPlan | null {
  switch (action.kind) {
    case 'move-section':
      return planSectionMovement(source, cursorOffset, action);
    case 'change-section-hierarchy':
      return planSectionHierarchyChange(source, cursorOffset, action);
    default:
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unknown structural action: ${String(value)}`);
}

/* eslint-enable perfectionist/sort-switch-case, perfectionist/sort-union-types, unicorn/switch-case-braces -- Dispatcher definition is complete. */
