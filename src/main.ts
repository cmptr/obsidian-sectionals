/* eslint-disable perfectionist/sort-modules -- Keep public command contracts and helpers near their existing consumers. */

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Obsidian imports compact.
import type { App, Editor, MarkdownFileInfo, MarkdownView, PluginManifest } from 'obsidian';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Obsidian imports compact.
import { normalizePath, Notice, Plugin, TFile, TFolder } from 'obsidian';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import type { DeletionMode, DeletionRange, DeletionTarget } from './deletion-planner.ts';
import type { MarkdownBlockKind } from './markdown-structure.ts';
import type {
  ExtractionEditor,
  ExtractionExecution,
  ExtractionNoticeDetails,
  ExtractionRuntime
} from './section-extraction-executor.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible structural action imports compact.
import type { StructuralAction, StructuralEditPlan } from './structural-action.ts';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import { collectDeletionTargets, planContextualDeletion, planSectionDeletion } from './deletion-planner.ts';
import { openDeletionTargetPicker } from './deletion-target-modal.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible executor imports compact.
import { executeSectionExtraction, ExtractionSourceChangedError } from './section-extraction-executor.ts';
import { planSectionExtraction } from './section-extraction-planner.ts';
import { planSectionMovement } from './section-movement-planner.ts';

export const NO_TARGET_NOTICE = 'No containing heading found.';
export const PARSE_FAILURE_NOTICE = 'Unable to determine the section to delete.';
export const NO_STRUCTURE_TARGET_NOTICE = 'No deletable structure found.';
export const STALE_STRUCTURE_TARGET_NOTICE = 'Note changed; reopen the structure picker.';
export const STRUCTURE_PARSE_FAILURE_NOTICE = 'Unable to determine structures to delete.';
export const EXTRACTION_NOTICES = {
  'create-failed': 'Unable to create the extracted note.',
  'cross-boundary-reference': 'The section has a reference or footnote outside its boundaries.',
  'destination-changed': 'Extraction stopped because the new note changed: {path}',
  'indeterminate-source-mutation': 'The source changed unexpectedly; the extracted note was kept: {path}',
  'open-failed': 'The section was extracted, but the new note could not be opened: {path}',
  'rollback-failed': 'Extraction stopped, but the new note could not be removed: {path}',
  'source-changed': 'The source note changed; extraction was cancelled.',
  'source-edit-failed': 'Unable to replace the source section.',
  'unresolved-relative-link': 'The section contains a relative link or embed that could not be resolved.',
  'unusable-title': 'Rename the heading before extracting it.'
} as const;

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
type StructuralActionPlanner = (
  source: string,
  cursorOffset: number,
  action: StructuralAction
) => null | StructuralEditPlan;
type StructureTargetCollector = (
  source: string,
  cursorOffset: number
) => readonly DeletionTarget[];
export interface ExtractionCommandDependencies {
  execute(
    editor: ExtractionEditor,
    sourcePath: string,
    execution: ExtractionExecution<TFile>,
    runtime: ExtractionRuntime<TFile>,
    notify: (details: ExtractionNoticeDetails) => void
  ): Promise<boolean>;
  notify(message: string): void;
  observeExecution(execution: Promise<void>): void;
}

const DEFAULT_EXTRACTION_COMMAND_DEPENDENCIES: ExtractionCommandDependencies = {
  execute: executeSectionExtraction,
  notify(message) {
    new Notice(message);
  },
  observeExecution(execution) {
    execution.catch(() => undefined);
  }
};

const DELETION_COMMANDS: readonly DeleteCommand[] = [
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

const MOVEMENT_COMMANDS = [
  {
    id: 'move-current-section-up',
    mode: 'up',
    name: 'Move current section up'
  },
  {
    id: 'move-current-section-down',
    mode: 'down',
    name: 'Move current section down'
  },
  {
    id: 'move-current-section-to-start',
    mode: 'start',
    name: 'Move current section to start'
  },
  {
    id: 'move-current-section-to-end',
    mode: 'end',
    name: 'Move current section to end'
  }
] as const;

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

export default class SectionalsPlugin extends Plugin {
  private readonly extractionDependencies: ExtractionCommandDependencies;
  private lastStructuralAction: null | StructuralAction = null;

  public constructor(
    app: App,
    manifest: PluginManifest,
    extractionDependencies: ExtractionCommandDependencies = DEFAULT_EXTRACTION_COMMAND_DEPENDENCIES
  ) {
    super(app, manifest);
    this.extractionDependencies = extractionDependencies;
  }

  public override onload(): void {
    for (const command of DELETION_COMMANDS) {
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

    for (const command of MOVEMENT_COMMANDS) {
      this.addCommand({
        editorCheckCallback: (isChecking, editor) => {
          const action: StructuralAction = {
            kind: 'move-section',
            mode: command.mode
          };
          return checkAndExecuteStructuralAction(
            isChecking,
            editor,
            action,
            (successfulAction) => {
              this.lastStructuralAction = successfulAction;
            }
          );
        },
        id: command.id,
        name: command.name
      });
    }

    this.addCommand({
      editorCheckCallback: (isChecking, editor) => {
        const action = this.lastStructuralAction;
        if (action === null) {
          return false;
        }
        return checkAndExecuteStructuralAction(
          isChecking,
          editor,
          action,
          (successfulAction) => {
            this.lastStructuralAction = successfulAction;
          }
        );
      },
      id: 'repeat-last-structural-action',
      name: 'Repeat last structural action'
    });

    this.addCommand({
      editorCheckCallback: (isChecking, editor, context) => {
        const sourceFile = context.file;
        if (sourceFile === null) {
          return false;
        }
        const source = editor.getValue();
        const cursorOffset = editor.posToOffset(editor.getCursor('head'));
        try {
          if (planSectionExtraction(source, cursorOffset).kind === 'unavailable') {
            return false;
          }
        } catch {
          return false;
        }
        if (!isChecking) {
          const expectedContextEditor = context.editor;
          const expectedSourcePath = normalizePath(sourceFile.path);
          const execution = runExtractionCommand(
            createGuardedExtractionEditor(
              this.app,
              sourceFile,
              expectedSourcePath,
              context,
              expectedContextEditor,
              editor
            ),
            expectedSourcePath,
            { mode: 'linked' },
            createExtractionRuntime(this.app),
            this.extractionDependencies
          );
          this.extractionDependencies.observeExecution(execution);
        }
        return true;
      },
      id: 'extract-current-section-to-linked-note',
      name: 'Extract current section to linked note'
    });
  }
}

export function formatExtractionNotice(
  details: ExtractionNoticeDetails
): string {
  const template = EXTRACTION_NOTICES[details.kind];
  if (!template.includes('{path}')) {
    return template;
  }
  if (details.path === undefined) {
    throw new TypeError('A retained extraction path is required.');
  }
  const retainedPath = details.path;
  return template.replace('{path}', () => retainedPath);
}

function createGuardedExtractionEditor(
  app: App,
  sourceFile: TFile,
  expectedSourcePath: string,
  context: MarkdownFileInfo | MarkdownView,
  expectedContextEditor: Editor | undefined,
  editor: Editor
): ExtractionEditor {
  function assertSourceIdentity(): void {
    try {
      if (
        sourceFile.path !== expectedSourcePath
        || app.vault.getAbstractFileByPath(expectedSourcePath) !== sourceFile
        || context.file !== sourceFile
        || context.editor !== expectedContextEditor
      ) {
        throw new ExtractionSourceChangedError();
      }
    } catch (error) {
      if (error instanceof ExtractionSourceChangedError) {
        throw error;
      }
      throw new ExtractionSourceChangedError();
    }
  }

  return {
    getCursor(side): ReturnType<ExtractionEditor['getCursor']> {
      assertSourceIdentity();
      return editor.getCursor(side);
    },
    getValue(): string {
      assertSourceIdentity();
      return editor.getValue();
    },
    offsetToPos(offset): ReturnType<ExtractionEditor['offsetToPos']> {
      assertSourceIdentity();
      return editor.offsetToPos(offset);
    },
    posToOffset(position): number {
      assertSourceIdentity();
      return editor.posToOffset(position);
    },
    replaceRange(replacement, from, to, origin): void {
      assertSourceIdentity();
      editor.replaceRange(replacement, from, to, origin);
    },
    setCursor(position, character): void {
      assertSourceIdentity();
      editor.setCursor(position, character);
    }
  };
}

function assertCurrentExtractionFile(app: App, file: TFile): void {
  const normalizedFilePath = normalizePath(file.path);
  const currentFile = app.vault.getAbstractFileByPath(normalizedFilePath);
  if (file.path !== normalizedFilePath || currentFile !== file) {
    throw new TypeError('Expected the created extraction file to remain current.');
  }
}

function createExtractionRuntime(app: App): ExtractionRuntime<TFile> {
  return {
    async create(path, content): Promise<TFile> {
      const file = await app.vault.create(normalizePath(path), content);
      if (!(file instanceof TFile)) {
        throw new TypeError('Expected Vault.create() to return a file.');
      }
      return file;
    },
    delete(file): Promise<void> {
      assertCurrentExtractionFile(app, file);
      return app.vault.delete(file);
    },
    fileExists(path): boolean {
      const abstractFile = app.vault.getAbstractFileByPath(normalizePath(path));
      if (abstractFile === null) {
        return false;
      }
      if (abstractFile instanceof TFile || abstractFile instanceof TFolder) {
        return true;
      }
      throw new TypeError('Expected a vault file or folder.');
    },
    getLinktext(file, sourcePath): string {
      return app.metadataCache.fileToLinktext(
        file,
        normalizePath(sourcePath),
        true
      );
    },
    getNewFileParent(sourcePath, candidateFilename): TFolder {
      const parent = app.fileManager.getNewFileParent(
        normalizePath(sourcePath),
        normalizePath(candidateFilename)
      );
      if (!(parent instanceof TFolder)) {
        throw new TypeError('Expected the new-file parent to be a folder.');
      }
      return parent;
    },
    read(file): Promise<string> {
      assertCurrentExtractionFile(app, file);
      return app.vault.read(file);
    },
    resolveLink(linkpath, sourcePath): null | TFile {
      const file = app.metadataCache.getFirstLinkpathDest(
        linkpath,
        normalizePath(sourcePath)
      );
      return file instanceof TFile ? file : null;
    }
  };
}

async function runExtractionCommand(
  editor: ExtractionEditor,
  sourcePath: string,
  execution: ExtractionExecution<TFile>,
  runtime: ExtractionRuntime<TFile>,
  dependencies: ExtractionCommandDependencies
): Promise<void> {
  const notificationState = { didNotify: false };
  try {
    await dependencies.execute(
      editor,
      sourcePath,
      execution,
      runtime,
      (details) => {
        const message = formatExtractionNotice(details);
        notificationState.didNotify = true;
        dependencies.notify(message);
      }
    );
  } catch (error) {
    if (!notificationState.didNotify) {
      try {
        dependencies.notify(
          error instanceof ExtractionSourceChangedError
            ? EXTRACTION_NOTICES['source-changed']
            : EXTRACTION_NOTICES['create-failed']
        );
      } catch {
        // Notice failures must not become unhandled command rejections.
      }
    }
  }
}

export function checkAndExecuteStructuralAction(
  isChecking: boolean,
  editor: SectionEditor,
  action: StructuralAction,
  remember: (action: StructuralAction) => void,
  planner: StructuralActionPlanner = planSectionMovement
): boolean {
  const source = editor.getValue();
  const cursorOffset = editor.posToOffset(editor.getCursor('head'));
  let plan: null | StructuralEditPlan;
  try {
    plan = planner(source, cursorOffset, action);
  } catch {
    return false;
  }
  if (plan === null) {
    return false;
  }
  if (!isChecking) {
    applyStructuralEditPlan(editor, plan);
    remember(plan.action);
  }
  return true;
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

function applyStructuralEditPlan(
  editor: SectionEditor,
  plan: StructuralEditPlan
): void {
  const from = editor.offsetToPos(plan.range.from);
  const to = editor.offsetToPos(plan.range.to);
  editor.replaceRange(plan.replacement, from, to);
  editor.setCursor(editor.offsetToPos(plan.cursorOffset));
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

/* eslint-enable perfectionist/sort-modules -- Main module definitions are complete. */
