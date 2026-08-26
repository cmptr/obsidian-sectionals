// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Obsidian imports compact.
import type { App, Editor } from 'obsidian';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Obsidian imports compact.
import { Notice, Plugin } from 'obsidian';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import type { DeletionMode, DeletionRange, DeletionTarget } from './deletion-planner.ts';
import type { MarkdownBlockKind } from './markdown-structure.ts';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import { collectDeletionTargets, planContextualDeletion, planSectionDeletion } from './deletion-planner.ts';
import { openDeletionTargetPicker } from './deletion-target-modal.ts';

export const NO_TARGET_NOTICE = 'No containing heading found.';
export const PARSE_FAILURE_NOTICE = 'Unable to determine the section to delete.';
export const NO_STRUCTURE_TARGET_NOTICE = 'No deletable structure found.';
export const STALE_STRUCTURE_TARGET_NOTICE = 'Note changed; reopen the structure picker.';
export const STRUCTURE_PARSE_FAILURE_NOTICE = 'Unable to determine structures to delete.';

interface ContextualDeleteCommand {
  readonly id: string;
  readonly kind: MarkdownBlockKind;
  readonly name: string;
}

interface DeleteCommand {
  readonly id: string;
  readonly mode: DeletionMode;
  readonly name: string;
}
type Notify = (message: string) => void;
type OpenStructureTargetPicker = (
  app: App,
  targets: readonly DeletionTarget[],
  chooseTarget: (target: DeletionTarget) => void
) => void;
type Planner<Mode extends string> = (
  source: string,
  cursorOffset: number,
  mode: Mode
) => DeletionRange | null;
type SectionEditor = Pick<
  Editor,
  | 'getCursor'
  | 'getValue'
  | 'offsetToPos'
  | 'posToOffset'
  | 'replaceRange'
  | 'setCursor'
>;
type StructureTargetCollector = (
  source: string,
  cursorOffset: number
) => readonly DeletionTarget[];

const COMMANDS: readonly DeleteCommand[] = [
  {
    id: 'delete-current-section',
    mode: 'section',
    name: 'Delete current section'
  },
  {
    id: 'delete-current-heading-block',
    mode: 'heading-block',
    name: 'Delete current heading block'
  }
];

const CONTEXTUAL_COMMANDS: readonly ContextualDeleteCommand[] = [
  {
    id: 'delete-current-fenced-code-block',
    kind: 'fenced-code',
    name: 'Delete current fenced code block'
  },
  {
    id: 'delete-current-callout',
    kind: 'callout',
    name: 'Delete current callout'
  },
  {
    id: 'delete-current-blockquote',
    kind: 'blockquote',
    name: 'Delete current blockquote'
  }
];

export default class DeleteSectionsPlugin extends Plugin {
  public override onload(): void {
    for (const command of COMMANDS) {
      this.addCommand({
        editorCallback: (editor) => {
          executeDeleteCommand(editor, command.mode, (message) => {
            new Notice(message);
          });
        },
        id: command.id,
        name: command.name
      });
    }

    for (const command of CONTEXTUAL_COMMANDS) {
      this.addCommand({
        editorCheckCallback: (isChecking, editor) =>
          checkAndExecuteContextualDeleteCommand(
            isChecking,
            editor,
            command.kind
          ),
        id: command.id,
        name: command.name
      });
    }

    this.addCommand({
      editorCallback: (editor) => {
        executeStructurePickerCommand(
          this.app,
          editor,
          (message) => new Notice(message)
        );
      },
      id: 'delete-current-structure',
      name: 'Delete current structure…'
    });
  }
}

export function executeDeleteCommand(
  editor: SectionEditor,
  mode: DeletionMode,
  notify: Notify,
  planner: Planner<DeletionMode> = planSectionDeletion
): void {
  let range: DeletionRange | null;
  try {
    range = resolveDeletionRange(editor, mode, planner);
  } catch {
    notify(PARSE_FAILURE_NOTICE);
    return;
  }

  if (range === null) {
    notify(NO_TARGET_NOTICE);
    return;
  }

  applyDeletionRange(editor, range);
}

export function executeStructurePickerCommand(
  app: App,
  editor: SectionEditor,
  notify: Notify,
  collector: StructureTargetCollector = collectDeletionTargets,
  openPicker: OpenStructureTargetPicker = openDeletionTargetPicker
): void {
  const source = editor.getValue();
  const cursorOffset = editor.posToOffset(editor.getCursor('head'));

  let targets: readonly DeletionTarget[];
  try {
    targets = collector(source, cursorOffset);
  } catch {
    notify(STRUCTURE_PARSE_FAILURE_NOTICE);
    return;
  }

  if (targets.length === 0) {
    notify(NO_STRUCTURE_TARGET_NOTICE);
    return;
  }

  openPicker(app, targets, (target) => {
    if (editor.getValue() !== source) {
      notify(STALE_STRUCTURE_TARGET_NOTICE);
      return;
    }
    applyDeletionRange(editor, target.range);
  });
}

function applyDeletionRange(editor: SectionEditor, range: DeletionRange): void {
  const from = editor.offsetToPos(range.from);
  const to = editor.offsetToPos(range.to);
  editor.replaceRange('', from, to);
  editor.setCursor(from);
}

function checkAndExecuteContextualDeleteCommand(
  isChecking: boolean,
  editor: SectionEditor,
  kind: MarkdownBlockKind
): boolean {
  let range: DeletionRange | null;
  try {
    range = resolveDeletionRange(editor, kind, planContextualDeletion);
  } catch {
    return false;
  }
  if (range === null) {
    return false;
  }
  if (!isChecking) {
    applyDeletionRange(editor, range);
  }
  return true;
}

function resolveDeletionRange<Mode extends string>(
  editor: SectionEditor,
  mode: Mode,
  planner: Planner<Mode>
): DeletionRange | null {
  const source = editor.getValue();
  const cursorOffset = editor.posToOffset(editor.getCursor('head'));
  return planner(source, cursorOffset, mode);
}
