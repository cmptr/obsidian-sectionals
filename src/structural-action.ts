import type { MarkdownRange } from './markdown-structure.ts';

export interface MoveSectionAction {
  readonly kind: 'move-section';
  readonly mode: SectionMovementMode;
}

export type SectionMovementMode = 'down' | 'end' | 'start' | 'up';

export type StructuralAction = MoveSectionAction;

export interface StructuralEditPlan {
  readonly action: StructuralAction;
  readonly cursorOffset: number;
  readonly range: MarkdownRange;
  readonly replacement: string;
}
