import type { App } from 'obsidian';

import { FuzzySuggestModal } from 'obsidian';

import type { DeletionTarget } from './deletion-planner.ts';

import { formatDeletionTarget } from './deletion-planner.ts';

export type ChooseDeletionTarget = (target: DeletionTarget) => void;

export class DeletionTargetModal extends FuzzySuggestModal<DeletionTarget> {
  private readonly chooseTarget: ChooseDeletionTarget;
  private readonly targets: readonly DeletionTarget[];

  public constructor(
    app: App,
    targets: readonly DeletionTarget[],
    chooseTarget: ChooseDeletionTarget
  ) {
    super(app);
    this.targets = targets;
    this.chooseTarget = chooseTarget;
    this.setPlaceholder('Choose a structure to delete…');
  }

  public getItems(): DeletionTarget[] {
    return [...this.targets];
  }

  public getItemText(target: DeletionTarget): string {
    return formatDeletionTarget(target);
  }

  public onChooseItem(
    target: DeletionTarget,
    _event: KeyboardEvent | MouseEvent
  ): void {
    this.chooseTarget(target);
  }
}

export function openDeletionTargetPicker(
  app: App,
  targets: readonly DeletionTarget[],
  chooseTarget: ChooseDeletionTarget
): void {
  new DeletionTargetModal(app, targets, chooseTarget).open();
}
