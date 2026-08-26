import type { App } from 'obsidian';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

import type { DeletionTarget } from './deletion-planner.ts';

import { DeletionTargetModal } from './deletion-target-modal.ts';

const FENCED_TARGET: DeletionTarget = {
  detail: 'ts',
  kinds: ['fenced-code'],
  lineCount: 3,
  range: { from: 10, to: 30 }
};
const SECTION_TARGET: DeletionTarget = {
  detail: 'Setup',
  kinds: ['section'],
  lineCount: 9,
  range: { from: 0, to: 60 }
};
const TARGETS: readonly DeletionTarget[] = [
  FENCED_TARGET,
  SECTION_TARGET
];

describe('DeletionTargetModal', () => {
  it('preserves collector order and sets native picker copy', () => {
    const modal = new DeletionTargetModal({} as App, TARGETS, vi.fn());

    expect(modal.getItems()).toEqual(TARGETS);
    expect(modal.inputEl.placeholder).toBe('Choose a structure to delete…');
    expect(modal.getItemText(FENCED_TARGET)).toBe(
      'Fenced code · ts · 3 lines'
    );
  });

  it('supports a one-item collection', () => {
    const modal = new DeletionTargetModal(
      {} as App,
      [FENCED_TARGET],
      vi.fn()
    );

    expect(modal.getItems()).toEqual([FENCED_TARGET]);
  });

  it('forwards the chosen target exactly once', () => {
    const chooseTarget = vi.fn();
    const modal = new DeletionTargetModal({} as App, TARGETS, chooseTarget);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    modal.onChooseItem(SECTION_TARGET, event);

    expect(chooseTarget).toHaveBeenCalledOnce();
    expect(chooseTarget).toHaveBeenCalledWith(SECTION_TARGET);
  });
});
