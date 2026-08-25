import type { Editor } from 'obsidian';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Obsidian imports compact.
import { Notice, Plugin } from 'obsidian';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import type { DeletionMode, DeletionRange } from './deletion-planner.ts';

import { planSectionDeletion } from './deletion-planner.ts';

export const NO_TARGET_NOTICE = 'No containing heading found.';
export const PARSE_FAILURE_NOTICE = 'Unable to determine the section to delete.';

interface DeleteCommand {
  readonly id: string;
  readonly mode: DeletionMode;
  readonly name: string;
}
type Notify = (message: string) => void;
type Planner = (
  source: string,
  cursorOffset: number,
  mode: DeletionMode
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
  }
}

export function executeDeleteCommand(
  editor: SectionEditor,
  mode: DeletionMode,
  notify: Notify,
  planner: Planner = planSectionDeletion
): void {
  const source = editor.getValue();
  const cursorOffset = editor.posToOffset(editor.getCursor('head'));
  let range: DeletionRange | null;
  try {
    range = planner(source, cursorOffset, mode);
  } catch {
    notify(PARSE_FAILURE_NOTICE);
    return;
  }

  if (range === null) {
    notify(NO_TARGET_NOTICE);
    return;
  }

  const from = editor.offsetToPos(range.from);
  const to = editor.offsetToPos(range.to);
  editor.replaceRange('', from, to);
  editor.setCursor(from);
}
