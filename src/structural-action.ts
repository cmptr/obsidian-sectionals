import type { MarkdownRange } from './markdown-structure.ts';

export interface ChangeSectionHierarchyAction {
  readonly kind: 'change-section-hierarchy';
  readonly mode: SectionHierarchyMode;
}

export interface MoveSectionAction {
  readonly kind: 'move-section';
  readonly mode: SectionMovementMode;
}

export type SectionHierarchyMode = 'demote' | 'promote';

export type SectionMovementMode = 'down' | 'end' | 'start' | 'up';

export type StructuralAction = ChangeSectionHierarchyAction | MoveSectionAction;

export interface StructuralEditPlan {
  readonly action: StructuralAction;
  readonly cursorOffset: number;
  readonly range: MarkdownRange;
  readonly replacement: string;
}
