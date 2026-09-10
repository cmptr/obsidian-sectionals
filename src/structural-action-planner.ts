/* eslint-disable perfectionist/sort-switch-case, perfectionist/sort-union-types, unicorn/switch-case-braces -- Match the specified exhaustive dispatcher shape. */

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible type imports compact.
import type { StructuralAction, StructuralEditPlan } from './structural-action.ts';
import type { StructuralPlanningContext } from './structural-planning-context.ts';

import { planSectionHierarchyChangeWithContext } from './section-hierarchy-planner.ts';
import { planSectionMovementWithContext } from './section-movement-planner.ts';
import { createStructuralPlanningContext } from './structural-planning-context.ts';

export function planStructuralAction(
  source: string,
  cursorOffset: number,
  action: StructuralAction
): StructuralEditPlan | null {
  return planStructuralActionWithContext(
    createStructuralPlanningContext(source),
    cursorOffset,
    action
  );
}

export function planStructuralActionWithContext(
  context: StructuralPlanningContext,
  cursorOffset: number,
  action: StructuralAction
): StructuralEditPlan | null {
  switch (action.kind) {
    case 'move-section':
      return planSectionMovementWithContext(context, cursorOffset, action);
    case 'change-section-hierarchy':
      return planSectionHierarchyChangeWithContext(
        context,
        cursorOffset,
        action
      );
    default:
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unknown structural action: ${String(value)}`);
}

/* eslint-enable perfectionist/sort-switch-case, perfectionist/sort-union-types, unicorn/switch-case-braces -- Dispatcher definition is complete. */
