/* eslint-disable perfectionist/sort-modules -- Keep tests grouped by production behavior and established command order. */

import type {
  App,
  Command,
  Editor,
  EditorPosition,
  MarkdownFileInfo,
  MarkdownView as PublicMarkdownView,
  // eslint-disable-next-line perfectionist/sort-named-imports -- Dprint sorts imported names before local aliases.
  PluginManifest,
  WorkspaceLeaf as PublicWorkspaceLeaf
} from 'obsidian';
import type { MockInstance } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Obsidian imports compact.
import { TFile as PublicTFile, TFolder as PublicTFolder } from 'obsidian';
// eslint-disable-next-line @stylistic/object-curly-newline, perfectionist/sort-named-imports -- Keep dprint-compatible canonical test imports.
import { App as ObsidianApp, MarkdownView, TFile, TFolder, WorkspaceLeaf } from 'obsidian-test-mocks/obsidian';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import type { DeletionRange, DeletionTarget } from './deletion-planner.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible executor imports compact.
import type { ExtractionExecution, ExtractionNoticeDetails, ExtractionRuntime } from './section-extraction-executor.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible structural action imports compact.
import type { StructuralAction, StructuralEditPlan } from './structural-action.ts';

import SectionalsPlugin, {
  checkAndExecuteStructuralAction,
  executeDeleteCommand,
  executeStructurePickerCommand,
  formatExtractionNotice
} from './main.ts';
import { executeSectionExtraction } from './section-extraction-executor.ts';

interface EditorFixture {
  editor: SectionEditor;
  replaceRange: ReturnType<typeof vi.fn>;
  setCursor: ReturnType<typeof vi.fn>;
}

interface PluginCommandsFixture {
  addCommand: MockInstance<(command: Command) => Command>;
}

interface TestExtractionDependencies {
  execute(
    editor: SectionEditor,
    sourcePath: string,
    execution: ExtractionExecution<PublicTFile>,
    runtime: ExtractionRuntime<PublicTFile>,
    notify: (details: ExtractionNoticeDetails) => void
  ): Promise<boolean>;
  notify(message: string): void;
  observeExecution(execution: Promise<void>): void;
}

type SectionEditor = Pick<
  Editor,
  | 'getCursor'
  | 'getValue'
  | 'offsetToPos'
  | 'posToOffset'
  | 'replaceRange'
  | 'setCursor'
>;

function createEditor(source: string, cursorOffset: number): EditorFixture {
  function position(offset: number): EditorPosition {
    return { ch: offset, line: 0 };
  }

  function toOffset({ ch }: EditorPosition): number {
    return ch;
  }

  let currentSource = source;
  const replaceRange = vi.fn(
    (replacement: string, from: EditorPosition, to?: EditorPosition) => {
      const end = toOffset(to ?? from);
      currentSource = currentSource.slice(0, toOffset(from))
        + replacement
        + currentSource.slice(end);
    }
  );
  const setCursor = vi.fn();
  return {
    editor: {
      getCursor: vi.fn(() => position(cursorOffset)),
      getValue: vi.fn(() => currentSource),
      offsetToPos: vi.fn(position),
      posToOffset: vi.fn(toOffset),
      replaceRange,
      setCursor
    },
    replaceRange,
    setCursor
  };
}

function asApp(value: unknown): App {
  return value as App;
}

function asMarkdownFileInfo(value: unknown): MarkdownFileInfo {
  return value as MarkdownFileInfo;
}

function asMarkdownView(value: unknown): PublicMarkdownView {
  return value as PublicMarkdownView;
}

function createMarkdownView(
  file: PublicTFile,
  editor: SectionEditor
): PublicMarkdownView {
  return asMarkdownView({ editor, file });
}

interface MarkdownOriginFixture {
  readonly leaf: PublicWorkspaceLeaf;
  readonly view: PublicMarkdownView;
}

function createMarkdownOrigin(
  app: ReturnType<typeof ObsidianApp.createConfigured__>,
  file: PublicTFile,
  editor: SectionEditor
): MarkdownOriginFixture {
  const mockLeaf = WorkspaceLeaf.create2__(app);
  const mockView = MarkdownView.create2__(mockLeaf);
  const leaf = mockLeaf.asOriginalType3__();
  const view = mockView.asOriginalType7__();
  view.file = file;
  view.editor = editor as Editor;
  leaf.view = view;
  return { leaf, view };
}

function loadPluginCommands(
  app: App = {} as App,
  extractionDependencies?: TestExtractionDependencies
): PluginCommandsFixture {
  const manifest: PluginManifest = {
    author: 'Aaron Bell',
    description: 'Delete the Markdown section containing the cursor.',
    id: 'sectionals',
    isDesktopOnly: false,
    minAppVersion: '1.8.9',
    name: 'Sectionals',
    version: '0.1.0'
  };
  const plugin = new SectionalsPlugin(
    app,
    manifest,
    extractionDependencies
  );
  const addCommand = vi.spyOn(plugin, 'addCommand');

  plugin.onload();

  return { addCommand };
}

function getRegisteredCommands(
  fixture: PluginCommandsFixture
): ReadonlyMap<string, Command> {
  return new Map(
    fixture.addCommand.mock.calls.map(([command]) => [command.id, command])
  );
}

const IDENTITY_DESTINATION_PATH = 'Folder/Extract me.md';
const IDENTITY_SOURCE = '# Extract me\nbody\n';
const IDENTITY_SOURCE_PATH = 'Folder/source.md';

type MockObsidianApp = ReturnType<typeof ObsidianApp.createConfigured__>;
type SourceIdentityFile = PublicTFile & TFile;

type ExtractionCommandMode = 'linked' | 'open';

interface MutableIdentityView {
  editor: Editor | undefined;
  file: null | PublicTFile;
}

interface IdentityHarness {
  readonly alternateFixture: EditorFixture;
  readonly app: MockObsidianApp;
  readonly commands: ReadonlyMap<string, Command>;
  readonly fixture: EditorFixture;
  getCompletion(): Promise<void> | undefined;
  readonly mode: ExtractionCommandMode;
  readonly notify: ReturnType<typeof vi.fn>;
  readonly openFile: ReturnType<typeof vi.fn>;
  readonly originatingLeaf: null | PublicWorkspaceLeaf;
  readonly otherFile: SourceIdentityFile;
  readonly sourceFile: SourceIdentityFile;
  readonly view: MutableIdentityView;
}

type OriginalVaultCreate = MockObsidianApp['vault']['create'];
type SourceIdentityMutation = (
  harness: IdentityHarness,
  originalCreate: OriginalVaultCreate
) => Promise<void> | void;

function createIdentityHarness(
  contextEditorState: 'present' | 'undefined' = 'present',
  mode: ExtractionCommandMode = 'linked'
): IdentityHarness {
  const app = ObsidianApp.createConfigured__({
    files: {
      'Folder/other.md': IDENTITY_SOURCE,
      [IDENTITY_SOURCE_PATH]: IDENTITY_SOURCE
    }
  });
  const sourceFile = app.vault.getAbstractFileByPath(IDENTITY_SOURCE_PATH);
  const otherFile = app.vault.getAbstractFileByPath('Folder/other.md');
  if (
    !(sourceFile instanceof PublicTFile)
    || !(sourceFile instanceof TFile)
    || !(otherFile instanceof PublicTFile)
    || !(otherFile instanceof TFile)
  ) {
    throw new TypeError('Expected source identity files in the fake vault.');
  }

  const fixture = createEditor(
    IDENTITY_SOURCE,
    IDENTITY_SOURCE.indexOf('body')
  );
  const alternateFixture = createEditor(
    IDENTITY_SOURCE,
    IDENTITY_SOURCE.indexOf('body')
  );
  let originatingLeaf: null | PublicWorkspaceLeaf = null;
  let openFile = vi.fn();
  let view: MutableIdentityView;
  if (mode === 'open') {
    const origin = createMarkdownOrigin(app, sourceFile, fixture.editor);
    originatingLeaf = origin.leaf;
    openFile = vi.spyOn(origin.leaf, 'openFile');
    view = origin.view;
    if (contextEditorState === 'undefined') {
      view.editor = undefined;
    }
  } else {
    view = {
      editor: contextEditorState === 'present'
        ? fixture.editor as Editor
        : undefined,
      file: sourceFile
    };
  }
  const notify = vi.fn();
  let completion: Promise<void> | undefined;
  const commands = getRegisteredCommands(
    loadPluginCommands(asApp(app), {
      execute: executeSectionExtraction,
      notify,
      observeExecution(execution) {
        completion = execution;
      }
    })
  );

  return {
    alternateFixture,
    app,
    commands,
    fixture,
    getCompletion(): Promise<void> | undefined {
      return completion;
    },
    mode,
    notify,
    openFile,
    originatingLeaf,
    otherFile,
    sourceFile,
    view
  };
}

async function invokeIdentityExtraction(
  harness: IdentityHarness
): Promise<void> {
  const commandId = harness.mode === 'open'
    ? 'extract-current-section-to-new-note'
    : 'extract-current-section-to-linked-note';
  const result = harness.commands.get(commandId)?.editorCheckCallback?.(
    false,
    harness.fixture.editor as Editor,
    asMarkdownView(harness.view)
  );
  expect(result).toBe(true);
  const completion = harness.getCompletion();
  if (completion === undefined) {
    throw new TypeError('Expected an observed extraction promise.');
  }
  await completion;
}

async function runPostCreateIdentityMutation(
  mutate: SourceIdentityMutation,
  beforeExtraction?: (harness: IdentityHarness) => void,
  contextEditorState: 'present' | 'undefined' = 'present',
  mode: ExtractionCommandMode = 'linked'
): Promise<IdentityHarness> {
  const harness = createIdentityHarness(contextEditorState, mode);
  const originalCreate = harness.app.vault.create.bind(harness.app.vault);
  let didMutate = false;
  vi.spyOn(harness.app.vault, 'create').mockImplementation(
    async (path, content, options) => {
      const created = await originalCreate(path, content, options);
      if (path === IDENTITY_DESTINATION_PATH && !didMutate) {
        didMutate = true;
        await mutate(harness, originalCreate);
      }
      return created;
    }
  );
  const trashFile = vi.spyOn(harness.app.fileManager, 'trashFile');
  beforeExtraction?.(harness);

  await invokeIdentityExtraction(harness);

  const destination = trashFile.mock.calls.find(
    ([file]) => file.path === IDENTITY_DESTINATION_PATH
  )?.[0];
  expect(destination).toBeInstanceOf(PublicTFile);
  expect(
    trashFile.mock.calls.filter(([file]) => file === destination)
  ).toHaveLength(1);
  expect(
    harness.app.vault.getAbstractFileByPath(IDENTITY_DESTINATION_PATH)
  ).toBeNull();
  expect(harness.fixture.replaceRange).not.toHaveBeenCalled();
  expect(harness.fixture.editor.getValue()).toBe(IDENTITY_SOURCE);
  expect(harness.openFile).not.toHaveBeenCalled();
  expect(harness.notify).toHaveBeenCalledOnce();
  expect(harness.notify).toHaveBeenCalledWith(
    'The source note changed; extraction was cancelled.'
  );
  return harness;
}

async function runFinalGuardIdentityMutation(
  configureMutation: (harness: IdentityHarness) => void,
  mode: ExtractionCommandMode = 'linked'
): Promise<void> {
  const harness = createIdentityHarness('present', mode);
  configureMutation(harness);
  const trashFile = vi.spyOn(harness.app.fileManager, 'trashFile');

  await invokeIdentityExtraction(harness);

  const destination = trashFile.mock.calls.find(
    ([file]) => file.path === IDENTITY_DESTINATION_PATH
  )?.[0];
  expect(destination).toBeInstanceOf(PublicTFile);
  expect(
    trashFile.mock.calls.filter(([file]) => file === destination)
  ).toHaveLength(1);
  expect(
    harness.app.vault.getAbstractFileByPath(IDENTITY_DESTINATION_PATH)
  ).toBeNull();
  expect(harness.fixture.replaceRange).not.toHaveBeenCalled();
  expect(harness.fixture.editor.getValue()).toBe(IDENTITY_SOURCE);
  expect(harness.openFile).not.toHaveBeenCalled();
  expect(harness.notify).toHaveBeenCalledOnce();
  expect(harness.notify).toHaveBeenCalledWith(
    'The source note changed; extraction was cancelled.'
  );
}

describe('checkAndExecuteStructuralAction', () => {
  const action: StructuralAction = { kind: 'move-section', mode: 'up' };
  const plan: StructuralEditPlan = {
    action,
    cursorOffset: 4,
    range: { from: 0, to: 20 },
    replacement: '## Beta\nb\n## Alpha\na\n'
  };

  it('reports a valid plan while checking without editing or remembering', () => {
    const { editor, replaceRange, setCursor } = createEditor(
      '## Alpha\na\n## Beta\nb\n',
      4
    );
    const remember = vi.fn();
    const planner = vi.fn(() => plan);

    expect(
      checkAndExecuteStructuralAction(
        true,
        editor,
        action,
        remember,
        planner
      )
    ).toBe(true);
    expect(editor.getCursor).toHaveBeenCalledWith('head');
    expect(planner).toHaveBeenCalledWith(
      '## Alpha\na\n## Beta\nb\n',
      4,
      action
    );
    expect(replaceRange).not.toHaveBeenCalled();
    expect(setCursor).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });

  it('reports an unavailable action while checking a null plan', () => {
    const { editor, replaceRange } = createEditor('## Alpha\na\n', 4);
    const remember = vi.fn();

    expect(
      checkAndExecuteStructuralAction(true, editor, action, remember, () => null)
    ).toBe(false);
    expect(replaceRange).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });

  it('fails closed when movement planning throws', () => {
    const { editor, replaceRange, setCursor } = createEditor(
      '## Alpha\na\n',
      4
    );
    const remember = vi.fn();

    expect(
      checkAndExecuteStructuralAction(false, editor, action, remember, () => {
        throw new Error('parse failed');
      })
    ).toBe(false);
    expect(replaceRange).not.toHaveBeenCalled();
    expect(setCursor).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });

  it('applies one planned replacement before mapping the cursor and remembering', () => {
    const { editor, replaceRange, setCursor } = createEditor(
      '## Alpha\na\n## Beta\nb\n',
      4
    );
    const remember = vi.fn();

    expect(
      checkAndExecuteStructuralAction(false, editor, action, remember, () => plan)
    ).toBe(true);
    expect(replaceRange).toHaveBeenCalledOnce();
    expect(replaceRange).toHaveBeenCalledWith(
      plan.replacement,
      { ch: 0, line: 0 },
      { ch: 20, line: 0 }
    );
    expect(editor.offsetToPos).toHaveBeenNthCalledWith(3, plan.cursorOffset);
    expect(setCursor).toHaveBeenCalledWith({ ch: 4, line: 0 });
    expect(remember).toHaveBeenCalledOnce();
    expect(remember).toHaveBeenCalledWith(plan.action);
    expect(replaceRange.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(editor.offsetToPos).mock.invocationCallOrder[2] ?? 0
    );
    expect(vi.mocked(editor.offsetToPos).mock.invocationCallOrder[2]).toBeLessThan(
      setCursor.mock.invocationCallOrder[0] ?? 0
    );
    expect(setCursor.mock.invocationCallOrder[0]).toBeLessThan(
      remember.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('propagates editor mutation errors without remembering the action', () => {
    const { editor, replaceRange, setCursor } = createEditor(
      '## Alpha\na\n## Beta\nb\n',
      4
    );
    const remember = vi.fn();
    const mutationFailure = new Error('mutation failed');
    replaceRange.mockImplementation(() => {
      throw mutationFailure;
    });

    expect(() => {
      checkAndExecuteStructuralAction(false, editor, action, remember, () => plan);
    }).toThrow(mutationFailure);
    expect(setCursor).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });
});

describe('executeDeleteCommand', () => {
  it('applies exactly one replacement and places the cursor at its start', () => {
    const { editor, replaceRange, setCursor } = createEditor(
      '# Delete\nbody\n# Keep\n',
      10
    );
    const notify = vi.fn();
    const planner = vi.fn((): DeletionRange => ({ from: 0, to: 14 }));

    executeDeleteCommand(editor, 'section', notify, planner);

    expect(replaceRange).toHaveBeenCalledOnce();
    expect(replaceRange).toHaveBeenCalledWith(
      '',
      { ch: 0, line: 0 },
      { ch: 14, line: 0 }
    );
    expect(setCursor).toHaveBeenCalledWith({ ch: 0, line: 0 });
    expect(notify).not.toHaveBeenCalled();
  });

  it('uses the active selection head', () => {
    const { editor } = createEditor('# Heading\nbody\n', 12);
    const planner = vi.fn(() => null);

    executeDeleteCommand(editor, 'heading-block', vi.fn(), planner);

    expect(editor.getCursor).toHaveBeenCalledWith('head');
    expect(planner).toHaveBeenCalledWith(
      '# Heading\nbody\n',
      12,
      'heading-block'
    );
  });

  it('shows the no-target notice without editing', () => {
    const { editor, replaceRange, setCursor } = createEditor(
      'introduction\n',
      3
    );
    const notify = vi.fn();

    executeDeleteCommand(editor, 'section', notify, () => null);

    expect(notify).toHaveBeenCalledWith('No containing heading found.');
    expect(replaceRange).not.toHaveBeenCalled();
    expect(setCursor).not.toHaveBeenCalled();
  });

  it('fails closed when planning throws', () => {
    const { editor, replaceRange } = createEditor('# Heading\n', 2);
    const notify = vi.fn();

    executeDeleteCommand(editor, 'section', notify, () => {
      throw new Error('parse failed');
    });

    expect(notify).toHaveBeenCalledWith(
      'Unable to determine the section to delete.'
    );
    expect(replaceRange).not.toHaveBeenCalled();
  });

  it('does not swallow editor mutation failures', () => {
    const { editor, replaceRange, setCursor } = createEditor('# Heading\n', 2);
    const mutationFailure = new Error('mutation failed');
    replaceRange.mockImplementation(() => {
      throw mutationFailure;
    });

    expect(() => {
      executeDeleteCommand(editor, 'section', vi.fn(), () => ({
        from: 0,
        to: 10
      }));
    }).toThrow(mutationFailure);
    expect(setCursor).not.toHaveBeenCalled();
  });
});

describe('executeStructurePickerCommand', () => {
  it('opens the picker with targets from the active selection head', () => {
    const source = '# Setup\nbody\n';
    const { editor, replaceRange } = createEditor(
      source,
      source.indexOf('body')
    );
    const targets: readonly DeletionTarget[] = [
      {
        detail: 'Setup',
        kinds: ['section', 'heading-block'],
        lineCount: 2,
        range: { from: 0, to: source.length }
      }
    ];
    const collector = vi.fn(() => targets);
    const openPicker = vi.fn();

    executeStructurePickerCommand(
      {} as App,
      editor,
      vi.fn(),
      collector,
      openPicker
    );

    expect(collector).toHaveBeenCalledWith(source, source.indexOf('body'));
    expect(openPicker).toHaveBeenCalledOnce();
    expect(openPicker.mock.calls[0]?.[1]).toBe(targets);
    expect(replaceRange).not.toHaveBeenCalled();
  });

  it('notifies without opening when no structure is available', () => {
    const { editor, replaceRange } = createEditor('plain text\n', 2);
    const notify = vi.fn();
    const openPicker = vi.fn();

    executeStructurePickerCommand(
      {} as App,
      editor,
      notify,
      () => [],
      openPicker
    );

    expect(notify).toHaveBeenCalledWith('No deletable structure found.');
    expect(openPicker).not.toHaveBeenCalled();
    expect(replaceRange).not.toHaveBeenCalled();
  });

  it('fails closed when structure collection throws', () => {
    const { editor, replaceRange } = createEditor('# Setup\n', 2);
    const notify = vi.fn();

    executeStructurePickerCommand(
      {} as App,
      editor,
      notify,
      () => {
        throw new Error('parse failed');
      },
      vi.fn()
    );

    expect(notify).toHaveBeenCalledWith(
      'Unable to determine structures to delete.'
    );
    expect(replaceRange).not.toHaveBeenCalled();
  });

  it('applies the chosen target in one editor transaction', () => {
    const source = '# Setup\nbody\n# Keep\n';
    const { editor, replaceRange, setCursor } = createEditor(source, 10);
    const target: DeletionTarget = {
      detail: 'Setup',
      kinds: ['section'],
      lineCount: 2,
      range: { from: 0, to: source.indexOf('# Keep') }
    };
    let chooseTarget: ((target: DeletionTarget) => void) | undefined;

    executeStructurePickerCommand(
      {} as App,
      editor,
      vi.fn(),
      () => [target],
      (_app, _targets, choose) => {
        chooseTarget = choose;
      }
    );

    expect(replaceRange).not.toHaveBeenCalled();
    chooseTarget?.(target);
    expect(replaceRange).toHaveBeenCalledOnce();
    expect(replaceRange).toHaveBeenCalledWith(
      '',
      { ch: 0, line: 0 },
      { ch: source.indexOf('# Keep'), line: 0 }
    );
    expect(setCursor).toHaveBeenCalledWith({ ch: 0, line: 0 });
  });

  it('rejects a target when the editor changed while the picker was open', () => {
    const source = '# Setup\nbody\n';
    const { editor, replaceRange } = createEditor(source, 2);
    const notify = vi.fn();
    const target: DeletionTarget = {
      detail: 'Setup',
      kinds: ['section'],
      lineCount: 2,
      range: { from: 0, to: source.length }
    };
    let chooseTarget: ((target: DeletionTarget) => void) | undefined;

    executeStructurePickerCommand(
      {} as App,
      editor,
      notify,
      () => [target],
      (_app, _targets, choose) => {
        chooseTarget = choose;
      }
    );
    vi.mocked(editor.getValue).mockReturnValue(`${source}changed\n`);

    chooseTarget?.(target);

    expect(notify).toHaveBeenCalledWith(
      'Note changed; reopen the structure picker.'
    );
    expect(replaceRange).not.toHaveBeenCalled();
  });
});

describe('SectionalsPlugin', () => {
  it('registers exact editor-only command metadata without hotkeys', () => {
    const { addCommand } = loadPluginCommands();

    expect(addCommand).toHaveBeenCalledTimes(13);
    expect(
      addCommand.mock.calls.map(([command]) => ({
        callback: command.callback,
        editorCallback: typeof command.editorCallback,
        editorCheckCallback: typeof command.editorCheckCallback,
        hotkeys: command.hotkeys,
        id: command.id,
        name: command.name
      }))
    ).toEqual([
      {
        callback: undefined,
        editorCallback: 'function',
        editorCheckCallback: 'undefined',
        hotkeys: undefined,
        id: 'delete-current-section',
        name: 'Delete current section'
      },
      {
        callback: undefined,
        editorCallback: 'function',
        editorCheckCallback: 'undefined',
        hotkeys: undefined,
        id: 'delete-current-heading-block',
        name: 'Delete current heading block'
      },
      {
        callback: undefined,
        editorCallback: 'undefined',
        editorCheckCallback: 'function',
        hotkeys: undefined,
        id: 'delete-current-fenced-code-block',
        name: 'Delete current fenced code block'
      },
      {
        callback: undefined,
        editorCallback: 'undefined',
        editorCheckCallback: 'function',
        hotkeys: undefined,
        id: 'delete-current-callout',
        name: 'Delete current callout'
      },
      {
        callback: undefined,
        editorCallback: 'undefined',
        editorCheckCallback: 'function',
        hotkeys: undefined,
        id: 'delete-current-blockquote',
        name: 'Delete current blockquote'
      },
      {
        callback: undefined,
        editorCallback: 'function',
        editorCheckCallback: 'undefined',
        hotkeys: undefined,
        id: 'delete-current-structure',
        name: 'Delete current structure…'
      },
      {
        callback: undefined,
        editorCallback: 'undefined',
        editorCheckCallback: 'function',
        hotkeys: undefined,
        id: 'move-current-section-up',
        name: 'Move current section up'
      },
      {
        callback: undefined,
        editorCallback: 'undefined',
        editorCheckCallback: 'function',
        hotkeys: undefined,
        id: 'move-current-section-down',
        name: 'Move current section down'
      },
      {
        callback: undefined,
        editorCallback: 'undefined',
        editorCheckCallback: 'function',
        hotkeys: undefined,
        id: 'move-current-section-to-start',
        name: 'Move current section to start'
      },
      {
        callback: undefined,
        editorCallback: 'undefined',
        editorCheckCallback: 'function',
        hotkeys: undefined,
        id: 'move-current-section-to-end',
        name: 'Move current section to end'
      },
      {
        callback: undefined,
        editorCallback: 'undefined',
        editorCheckCallback: 'function',
        hotkeys: undefined,
        id: 'repeat-last-structural-action',
        name: 'Repeat last structural action'
      },
      {
        callback: undefined,
        editorCallback: 'undefined',
        editorCheckCallback: 'function',
        hotkeys: undefined,
        id: 'extract-current-section-to-linked-note',
        name: 'Extract current section to linked note'
      },
      {
        callback: undefined,
        editorCallback: 'undefined',
        editorCheckCallback: 'function',
        hotkeys: undefined,
        id: 'extract-current-section-to-new-note',
        name: 'Extract current section to new note'
      }
    ]);
  });

  // eslint-disable-next-line complexity -- Keep the complete side-effect-free availability matrix in one stateful test.
  it('checks linked and open extraction availability without side effects or repeat mutation', () => {
    const readySource = '# Extract me\nbody\n';
    const app = ObsidianApp.createConfigured__({
      files: { 'Notes/source.md': readySource }
    });
    const sourceFile = app.vault.getAbstractFileByPath('Notes/source.md');
    if (!(sourceFile instanceof PublicTFile) || !(sourceFile instanceof TFile)) {
      throw new TypeError('Expected the availability source file.');
    }
    const ready = createEditor(readySource, readySource.indexOf('body'));
    const alternate = createEditor(readySource, readySource.indexOf('body'));
    const unavailable = createEditor('plain text\n', 2);
    const origin = createMarkdownOrigin(app, sourceFile, ready.editor);
    const openFile = vi.spyOn(origin.leaf, 'openFile');
    const getNewFileParent = vi.spyOn(app.fileManager, 'getNewFileParent');
    const getFirstLinkpathDestination = vi.spyOn(
      app.metadataCache,
      'getFirstLinkpathDest'
    );
    const fileToLinktext = vi.spyOn(app.metadataCache, 'fileToLinktext');
    const create = vi.spyOn(app.vault, 'create');
    const read = vi.spyOn(app.vault, 'read');
    const trashFile = vi.spyOn(app.fileManager, 'trashFile');
    const getAbstractFileByPath = vi.spyOn(
      app.vault,
      'getAbstractFileByPath'
    );
    const execute = vi.fn(() => Promise.resolve(true));
    const notify = vi.fn();
    const observeExecution = vi.fn();
    const commands = getRegisteredCommands(
      loadPluginCommands(asApp(app), { execute, notify, observeExecution })
    );
    const linkedExtraction = commands.get(
      'extract-current-section-to-linked-note'
    );
    const openExtraction = commands.get(
      'extract-current-section-to-new-note'
    );
    const linkedContext = asMarkdownFileInfo({ file: sourceFile });

    expect(
      linkedExtraction?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        { file: null } as PublicMarkdownView
      )
    ).toBe(false);
    expect(
      linkedExtraction?.editorCheckCallback?.(
        true,
        unavailable.editor as Editor,
        linkedContext
      )
    ).toBe(false);
    expect(
      linkedExtraction?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        linkedContext
      )
    ).toBe(true);

    expect(
      openExtraction?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        { file: null } as PublicMarkdownView
      )
    ).toBe(false);
    expect(
      openExtraction?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        asMarkdownView({ editor: ready.editor, file: sourceFile })
      )
    ).toBe(false);
    expect(
      openExtraction?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        asMarkdownView({
          editor: ready.editor,
          file: sourceFile,
          leaf: origin.leaf
        })
      )
    ).toBe(false);
    expect(
      openExtraction?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        origin.view
      )
    ).toBe(true);

    origin.view.editor = alternate.editor as Editor;
    expect(
      openExtraction?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        origin.view
      )
    ).toBe(false);
    origin.view.editor = ready.editor as Editor;
    vi.mocked(ready.editor.getValue).mockImplementationOnce(() => {
      throw new Error('editor unavailable');
    });
    expect(
      openExtraction?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        origin.view
      )
    ).toBe(false);
    const unrelatedOrigin = createMarkdownOrigin(
      app,
      sourceFile,
      alternate.editor
    );
    origin.leaf.view = unrelatedOrigin.view;
    expect(
      openExtraction?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        origin.view
      )
    ).toBe(false);
    origin.leaf.view = origin.view;
    Object.defineProperty(origin.leaf, 'view', {
      configurable: true,
      get() {
        throw new Error('leaf unavailable');
      }
    });
    expect(
      openExtraction?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        origin.view
      )
    ).toBe(false);

    expect(
      commands.get('repeat-last-structural-action')?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        origin.view
      )
    ).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(observeExecution).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
    expect(getNewFileParent).not.toHaveBeenCalled();
    expect(getFirstLinkpathDestination).not.toHaveBeenCalled();
    expect(fileToLinktext).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(trashFile).not.toHaveBeenCalled();
    expect(getAbstractFileByPath).not.toHaveBeenCalled();
  });

  it('starts one extraction asynchronously and returns before it settles', async () => {
    let finishExecution: ((isSuccessful: boolean) => void) | undefined;
    const execute = vi.fn(
      (
        _editor: SectionEditor,
        _sourcePath: string,
        _execution: ExtractionExecution<PublicTFile>,
        _runtime: ExtractionRuntime<PublicTFile>,
        _notify: (details: ExtractionNoticeDetails) => void
      ) =>
        new Promise<boolean>((resolve) => {
          finishExecution = resolve;
        })
    );
    const notify = vi.fn();
    let completion: Promise<void> | undefined;
    const observeExecution = vi.fn((execution: Promise<void>) => {
      completion = execution;
    });
    const commands = getRegisteredCommands(
      loadPluginCommands({} as App, { execute, notify, observeExecution })
    );
    const source = '# Extract me\nbody\n';
    const fixture = createEditor(source, source.indexOf('body'));

    expect(
      commands.get('extract-current-section-to-linked-note')
        ?.editorCheckCallback?.(
          false,
          fixture.editor as Editor,
          asMarkdownView({
            editor: fixture.editor,
            file: { path: 'Notes/source.md' }
          })
        )
    ).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).not.toBe(fixture.editor);
    expect(execute.mock.calls[0]?.[1]).toBe('Notes/source.md');
    expect(execute.mock.calls[0]?.[2]).toEqual({ mode: 'linked' });
    expect(observeExecution).toHaveBeenCalledOnce();
    expect(completion).toBeInstanceOf(Promise);
    expect(notify).not.toHaveBeenCalled();

    finishExecution?.(true);
    await completion;
    expect(notify).not.toHaveBeenCalled();
  });

  it('captures the originating leaf without consulting later workspace selection', async () => {
    const source = '# Extract me\nbody\n';
    const app = ObsidianApp.createConfigured__({
      files: {
        'Folder/created.md': '# Extract me\n\nbody\n',
        'Folder/source.md': source
      }
    });
    const sourceFile = app.vault.getAbstractFileByPath('Folder/source.md');
    const createdFile = app.vault.getAbstractFileByPath('Folder/created.md');
    if (
      !(sourceFile instanceof PublicTFile)
      || !(sourceFile instanceof TFile)
      || !(createdFile instanceof PublicTFile)
      || !(createdFile instanceof TFile)
    ) {
      throw new TypeError('Expected open-command files.');
    }
    const fixture = createEditor(source, source.indexOf('body'));
    const origin = createMarkdownOrigin(app, sourceFile, fixture.editor);
    const unrelatedMockLeaf = WorkspaceLeaf.create2__(app);
    const unrelatedLeaf = unrelatedMockLeaf.asOriginalType3__();
    const originatingOpen = vi.spyOn(origin.leaf, 'openFile');
    const unrelatedOpen = vi.spyOn(unrelatedLeaf, 'openFile');
    const getActiveViewOfType = vi.spyOn(app.workspace, 'getActiveViewOfType');
    const getLeaf = vi.spyOn(app.workspace, 'getLeaf');
    const getMostRecentLeaf = vi.spyOn(app.workspace, 'getMostRecentLeaf');
    const revealLeaf = vi.spyOn(app.workspace, 'revealLeaf');
    const setActiveLeaf = vi.spyOn(app.workspace, 'setActiveLeaf');
    let capturedExecution: ExtractionExecution<PublicTFile> | undefined;
    let completion: Promise<void> | undefined;
    const commands = getRegisteredCommands(
      loadPluginCommands(asApp(app), {
        execute: vi.fn(
          (
            _editor: SectionEditor,
            _sourcePath: string,
            execution: ExtractionExecution<PublicTFile>,
            _runtime: ExtractionRuntime<PublicTFile>,
            _notify: (details: ExtractionNoticeDetails) => void
          ) => {
            capturedExecution = execution;
            return Promise.resolve(true);
          }
        ),
        notify: vi.fn(),
        observeExecution(execution) {
          completion = execution;
        }
      })
    );

    expect(
      commands.get('extract-current-section-to-new-note')
        ?.editorCheckCallback?.(
          false,
          fixture.editor as Editor,
          origin.view
        )
    ).toBe(true);
    await completion;
    expect(capturedExecution?.mode).toBe('open');
    if (capturedExecution?.mode !== 'open') {
      throw new TypeError('Expected a captured open execution.');
    }

    app.workspace.activeLeaf = unrelatedMockLeaf;
    await capturedExecution.openCreatedFile(createdFile);

    expect(originatingOpen).toHaveBeenCalledExactlyOnceWith(createdFile);
    expect(unrelatedOpen).not.toHaveBeenCalled();
    expect(getActiveViewOfType).not.toHaveBeenCalled();
    expect(getLeaf).not.toHaveBeenCalled();
    expect(getMostRecentLeaf).not.toHaveBeenCalled();
    expect(revealLeaf).not.toHaveBeenCalled();
    expect(setActiveLeaf).not.toHaveBeenCalled();
  });

  it('commits open extraction before opening and retains both files when opening fails', async () => {
    const source = '# Extract me\nbody\n';
    const app = ObsidianApp.createConfigured__({
      files: { 'Folder/source.md': source }
    });
    const sourceFile = app.vault.getAbstractFileByPath('Folder/source.md');
    if (!(sourceFile instanceof PublicTFile) || !(sourceFile instanceof TFile)) {
      throw new TypeError('Expected the open integration source file.');
    }
    const fixture = createEditor(source, source.indexOf('body'));
    const origin = createMarkdownOrigin(app, sourceFile, fixture.editor);
    const openFile = vi.spyOn(origin.leaf, 'openFile').mockImplementation(
      async (createdFile) => {
        expect(fixture.editor.getValue()).toBe('');
        if (!(createdFile instanceof TFile)) {
          throw new TypeError('Expected the concrete created file.');
        }
        expect(await app.vault.read(createdFile)).toBe(
          '# Extract me\n\nbody\n'
        );
        throw new Error('open failed');
      }
    );
    const notify = vi.fn();
    let completion: Promise<void> | undefined;
    const commands = getRegisteredCommands(
      loadPluginCommands(asApp(app), {
        execute: executeSectionExtraction,
        notify,
        observeExecution(execution) {
          completion = execution;
        }
      })
    );

    expect(
      commands.get('extract-current-section-to-new-note')
        ?.editorCheckCallback?.(
          false,
          fixture.editor as Editor,
          origin.view
        )
    ).toBe(true);
    await completion;

    expect(openFile).toHaveBeenCalledOnce();
    expect(fixture.editor.getValue()).toBe('');
    const destination = app.vault.getAbstractFileByPath(
      'Folder/Extract me.md'
    );
    expect(destination).toBeInstanceOf(PublicTFile);
    if (!(destination instanceof TFile)) {
      throw new TypeError('Expected the retained open destination.');
    }
    expect(await app.vault.read(destination)).toBe('# Extract me\n\nbody\n');
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      'The section was extracted, but the new note could not be opened: Folder/Extract me.md'
    );
  });

  it('keeps linked extraction in place without opening a leaf', async () => {
    const source = '# Extract me\nbody\n';
    const app = ObsidianApp.createConfigured__({
      files: { 'Folder/source.md': source }
    });
    const sourceFile = app.vault.getAbstractFileByPath('Folder/source.md');
    if (!(sourceFile instanceof PublicTFile) || !(sourceFile instanceof TFile)) {
      throw new TypeError('Expected the linked integration source file.');
    }
    const fixture = createEditor(source, source.indexOf('body'));
    const origin = createMarkdownOrigin(app, sourceFile, fixture.editor);
    const openFile = vi.spyOn(origin.leaf, 'openFile');
    let completion: Promise<void> | undefined;
    const commands = getRegisteredCommands(
      loadPluginCommands(asApp(app), {
        execute: executeSectionExtraction,
        notify: vi.fn(),
        observeExecution(execution) {
          completion = execution;
        }
      })
    );

    expect(
      commands.get('extract-current-section-to-linked-note')
        ?.editorCheckCallback?.(
          false,
          fixture.editor as Editor,
          asMarkdownFileInfo({ file: sourceFile })
        )
    ).toBe(true);
    await completion;

    expect(fixture.editor.getValue()).toBe('[[Extract me]]\n');
    expect(fixture.setCursor).toHaveBeenCalledOnce();
    expect(openFile).not.toHaveBeenCalled();
    const destination = app.vault.getAbstractFileByPath(
      'Folder/Extract me.md'
    );
    expect(destination).toBeInstanceOf(PublicTFile);
    if (!(destination instanceof TFile)) {
      throw new TypeError('Expected the retained linked destination.');
    }
    expect(await app.vault.read(destination)).toBe('# Extract me\n\nbody\n');
  });

  it('adapts extraction to normalized public Obsidian file APIs and concrete file types', async () => {
    const app = ObsidianApp.createConfigured__({
      files: {
        'Extracted/': '',
        'Extracted/existing.md': 'existing',
        'Folder/source.md': '# Extract me\nbody\n',
        'Links/target.md': 'target'
      }
    });
    const sourceFile = app.vault.getAbstractFileByPath('Folder/source.md');
    const targetFile = app.vault.getAbstractFileByPath('Links/target.md');
    const destinationFolder = app.vault.getAbstractFileByPath('Extracted');
    if (
      !(sourceFile instanceof PublicTFile)
      || !(sourceFile instanceof TFile)
      || !(targetFile instanceof PublicTFile)
      || !(targetFile instanceof TFile)
    ) {
      throw new TypeError('Expected source and target files in the fake vault.');
    }
    if (
      !(destinationFolder instanceof PublicTFolder)
      || !(destinationFolder instanceof TFolder)
    ) {
      throw new TypeError('Expected the destination folder in the fake vault.');
    }
    const getNewFileParent = vi.spyOn(app.fileManager, 'getNewFileParent')
      .mockReturnValue(destinationFolder);
    const getFirstLinkpathDestination = vi.spyOn(
      app.metadataCache,
      'getFirstLinkpathDest'
    ).mockReturnValue(targetFile);
    const fileToLinktext = vi.spyOn(app.metadataCache, 'fileToLinktext')
      .mockReturnValue('target');
    const getAbstractFileByPath = vi.spyOn(
      app.vault,
      'getAbstractFileByPath'
    );
    const create = vi.spyOn(app.vault, 'create');
    const read = vi.spyOn(app.vault, 'read');
    const trashFile = vi.spyOn(app.fileManager, 'trashFile');
    const execute = vi.fn(
      async (
        _editor: SectionEditor,
        _sourcePath: string,
        execution: ExtractionExecution<PublicTFile>,
        runtime: ExtractionRuntime<PublicTFile>
      ) => {
        expect(execution).toEqual({ mode: 'linked' });
        expect(
          runtime.getNewFileParent('Folder//source.md', 'Extract me.md')
        ).toBe(destinationFolder);
        expect(runtime.fileExists('Extracted//existing.md')).toBe(true);
        expect(runtime.fileExists('Extracted')).toBe(true);
        expect(runtime.fileExists('Extracted//missing.md')).toBe(false);
        expect(
          runtime.resolveLink('../Links/target', 'Folder//source.md')
        ).toBe(targetFile);
        expect(
          runtime.getLinktext(targetFile, 'Folder//source.md')
        ).toBe('target');
        const created = await runtime.create(
          'Extracted//created.md',
          'created'
        );
        expect(created).toBeInstanceOf(TFile);
        expect(await runtime.read(created)).toBe('created');
        await runtime.delete(created);
        return true;
      }
    );
    let completion: Promise<void> | undefined;
    const commands = getRegisteredCommands(
      loadPluginCommands(asApp(app), {
        execute,
        notify: vi.fn(),
        observeExecution(execution) {
          completion = execution;
        }
      })
    );
    const source = '# Extract me\nbody\n';
    const fixture = createEditor(source, source.indexOf('body'));

    expect(
      commands.get('extract-current-section-to-linked-note')
        ?.editorCheckCallback?.(
          false,
          fixture.editor as Editor,
          createMarkdownView(sourceFile, fixture.editor)
        )
    ).toBe(true);
    await completion;

    expect(getNewFileParent).toHaveBeenCalledWith(
      'Folder/source.md',
      'Extract me.md'
    );
    expect(getAbstractFileByPath).toHaveBeenCalledWith(
      'Extracted/existing.md'
    );
    expect(getAbstractFileByPath).toHaveBeenCalledWith('Extracted');
    expect(getAbstractFileByPath).toHaveBeenCalledWith(
      'Extracted/missing.md'
    );
    expect(getFirstLinkpathDestination).toHaveBeenCalledWith(
      '../Links/target',
      'Folder/source.md'
    );
    expect(fileToLinktext).toHaveBeenCalledWith(
      targetFile,
      'Folder/source.md',
      true
    );
    expect(create).toHaveBeenCalledWith(
      'Extracted/created.md',
      'created'
    );
    expect(read).toHaveBeenCalledWith(expect.any(PublicTFile));
    expect(trashFile).toHaveBeenCalledWith(expect.any(PublicTFile));
    expect(app.vault.getAbstractFileByPath('Extracted/created.md')).toBeNull();
  });

  it('passes a decoded logical Markdown linkpath through the real destination adapter', async () => {
    const source = String.raw`# Extract me
[Target](../Links/A\(B\)%20&amp;%E6%9D%B1%E4%BA%AC%2FNote.md#Part)
`;
    const app = ObsidianApp.createConfigured__({
      files: {
        'Folder/source.md': source,
        'Links/target.md': 'target'
      }
    });
    const sourceFile = app.vault.getAbstractFileByPath('Folder/source.md');
    const targetFile = app.vault.getAbstractFileByPath('Links/target.md');
    if (
      !(sourceFile instanceof PublicTFile)
      || !(sourceFile instanceof TFile)
      || !(targetFile instanceof PublicTFile)
      || !(targetFile instanceof TFile)
    ) {
      throw new TypeError('Expected logical-link files in the fake vault.');
    }
    const getFirstLinkpathDestination = vi.spyOn(
      app.metadataCache,
      'getFirstLinkpathDest'
    ).mockReturnValue(targetFile);
    vi.spyOn(app.metadataCache, 'fileToLinktext').mockReturnValue('Extract me');
    const fixture = createEditor(source, source.indexOf('[Target]'));
    let completion: Promise<void> | undefined;
    const commands = getRegisteredCommands(
      loadPluginCommands(asApp(app), {
        execute: executeSectionExtraction,
        notify: vi.fn(),
        observeExecution(execution) {
          completion = execution;
        }
      })
    );

    expect(
      commands.get('extract-current-section-to-linked-note')
        ?.editorCheckCallback?.(
          false,
          fixture.editor as Editor,
          createMarkdownView(sourceFile, fixture.editor)
        )
    ).toBe(true);
    await completion;

    expect(getFirstLinkpathDestination).toHaveBeenNthCalledWith(
      1,
      '../Links/A(B) &東京/Note.md',
      'Folder/source.md'
    );
  });

  it.each(['linked', 'open'] as const)(
    'retains a same-path replacement inserted while the first %s destination read settles',
    async (mode) => {
      const harness = createIdentityHarness('present', mode);
      const originalCreate = harness.app.vault.create.bind(harness.app.vault);
      const originalDelete = harness.app.vault.delete.bind(harness.app.vault);
      const originalRead = harness.app.vault.read.bind(harness.app.vault);
      const productionTrash = vi.spyOn(harness.app.fileManager, 'trashFile');
      const readEvents: string[] = [];
      let destinationReadCount = 0;
      let originalDestination: TFile | undefined;
      let replacement: SourceIdentityFile | undefined;
      vi.spyOn(harness.app.vault, 'read').mockImplementation((file) => {
        const originalReadPromise = originalRead(file);
        if (
          file.path !== IDENTITY_DESTINATION_PATH
          || destinationReadCount !== 0
        ) {
          return originalReadPromise;
        }
        destinationReadCount += 1;
        originalDestination = file;
        readEvents.push('underlying-read-invoked');
        const replacementPromise = originalReadPromise.then(
          async (originalContent) => {
            readEvents.push('original-bytes-captured');
            await originalDelete(file);
            const recreated = await originalCreate(
              IDENTITY_DESTINATION_PATH,
              'replacement bytes\n'
            );
            if (
              !(recreated instanceof PublicTFile)
              || !(recreated instanceof TFile)
            ) {
              throw new TypeError('Expected a replacement destination file.');
            }
            replacement = recreated;
            readEvents.push('replacement-inserted');
            return originalContent;
          }
        );
        return replacementPromise.then((originalContent) => {
          readEvents.push('read-settled');
          return originalContent;
        });
      });

      await invokeIdentityExtraction(harness);

      expect(readEvents).toEqual([
        'underlying-read-invoked',
        'original-bytes-captured',
        'replacement-inserted',
        'read-settled'
      ]);
      expect(replacement).toBeInstanceOf(PublicTFile);
      expect(originalDestination).toBeInstanceOf(PublicTFile);
      expect(replacement).not.toBe(originalDestination);
      expect(
        harness.app.vault.getAbstractFileByPath(IDENTITY_DESTINATION_PATH)
      ).toBe(replacement);
      if (replacement === undefined) {
        throw new TypeError('Expected the retained replacement destination.');
      }
      expect(await originalRead(replacement)).toBe('replacement bytes\n');
      expect(await originalRead(harness.sourceFile)).toBe(IDENTITY_SOURCE);
      expect(harness.fixture.editor.getValue()).toBe(IDENTITY_SOURCE);
      expect(harness.fixture.replaceRange).not.toHaveBeenCalled();
      expect(harness.fixture.setCursor).not.toHaveBeenCalled();
      expect(harness.openFile).not.toHaveBeenCalled();
      expect(productionTrash).not.toHaveBeenCalled();
      expect(harness.notify).toHaveBeenCalledExactlyOnceWith(
        `Extraction stopped, but the new note could not be removed: ${IDENTITY_DESTINATION_PATH}`
      );
    }
  );

  it('retains a different same-path destination inserted before rollback read', async () => {
    const harness = createIdentityHarness();
    const originalCreate = harness.app.vault.create.bind(harness.app.vault);
    const originalDelete = harness.app.vault.delete.bind(harness.app.vault);
    let replacement: SourceIdentityFile | undefined;
    let didReplaceDestination = false;
    vi.spyOn(harness.app.vault, 'create').mockImplementation(
      async (path, content, options) => {
        const created = await originalCreate(path, content, options);
        if (path === IDENTITY_DESTINATION_PATH && !didReplaceDestination) {
          didReplaceDestination = true;
          await originalDelete(created);
          const recreated = await originalCreate(path, content, options);
          if (
            !(recreated instanceof PublicTFile)
            || !(recreated instanceof TFile)
          ) {
            throw new TypeError('Expected a replacement destination file.');
          }
          replacement = recreated;
        }
        return created;
      }
    );

    await invokeIdentityExtraction(harness);

    expect(
      harness.app.vault.getAbstractFileByPath(IDENTITY_DESTINATION_PATH)
    ).toBe(replacement);
    expect(harness.fixture.replaceRange).not.toHaveBeenCalled();
    expect(harness.fixture.editor.getValue()).toBe(IDENTITY_SOURCE);
    expect(harness.notify).toHaveBeenCalledExactlyOnceWith(
      `Extraction stopped, but the new note could not be removed: ${IDENTITY_DESTINATION_PATH}`
    );
  });

  it('retains a different same-path destination inserted before rollback delete', async () => {
    const harness = createIdentityHarness();
    const originalCreate = harness.app.vault.create.bind(harness.app.vault);
    const originalDelete = harness.app.vault.delete.bind(harness.app.vault);
    const originalRead = harness.app.vault.read.bind(harness.app.vault);
    let destinationReadCount = 0;
    let replacement: SourceIdentityFile | undefined;
    vi.spyOn(harness.app.vault, 'read').mockImplementation(async (file) => {
      const content = await originalRead(file);
      if (file.path === IDENTITY_DESTINATION_PATH) {
        destinationReadCount += 1;
        if (destinationReadCount === 1) {
          harness.view.file = harness.otherFile;
        } else if (destinationReadCount === 2) {
          await originalDelete(file);
          const recreated = await originalCreate(file.path, content);
          if (
            !(recreated instanceof PublicTFile)
            || !(recreated instanceof TFile)
          ) {
            throw new TypeError('Expected a replacement destination file.');
          }
          replacement = recreated;
        }
      }
      return content;
    });

    await invokeIdentityExtraction(harness);

    expect(
      harness.app.vault.getAbstractFileByPath(IDENTITY_DESTINATION_PATH)
    ).toBe(replacement);
    expect(harness.fixture.replaceRange).not.toHaveBeenCalled();
    expect(harness.fixture.editor.getValue()).toBe(IDENTITY_SOURCE);
    expect(harness.notify).toHaveBeenCalledExactlyOnceWith(
      `Extraction stopped, but the new note could not be removed: ${IDENTITY_DESTINATION_PATH}`
    );
  });

  it.each(['linked', 'open'] as const)(
    'cancels and rolls back when the source file is renamed during %s extraction',
    async (mode) => {
      await runPostCreateIdentityMutation(
        async (harness) => {
          await harness.app.vault.rename(
            harness.sourceFile,
            'Folder/renamed.md'
          );
        },
        undefined,
        'present',
        mode
      );
    }
  );

  it.each(['linked', 'open'] as const)(
    'cancels and rolls back when the source file is deleted during %s extraction',
    async (mode) => {
      await runPostCreateIdentityMutation(
        async (harness) => {
          await harness.app.fileManager.trashFile(harness.sourceFile);
        },
        undefined,
        'present',
        mode
      );
    }
  );

  it.each(['linked', 'open'] as const)(
    'cancels and rolls back when another file replaces the source path during %s extraction',
    async (mode) => {
      await runPostCreateIdentityMutation(
        async (harness, originalCreate) => {
          await harness.app.fileManager.trashFile(harness.sourceFile);
          const replacement = await originalCreate(
            IDENTITY_SOURCE_PATH,
            IDENTITY_SOURCE
          );
          expect(replacement).not.toBe(harness.sourceFile);
        },
        undefined,
        'present',
        mode
      );
    }
  );

  it.each(['linked', 'open'] as const)(
    'cancels and rolls back when the command context rebinds to another same-content file during %s extraction',
    async (mode) => {
      await runPostCreateIdentityMutation(
        (harness) => {
          harness.view.file = harness.otherFile;
        },
        undefined,
        'present',
        mode
      );
    }
  );

  it.each(['linked', 'open'] as const)(
    'cancels and rolls back when the command context rebinds to another same-content editor during %s extraction',
    async (mode) => {
      await runPostCreateIdentityMutation(
        (harness) => {
          harness.view.editor = harness.alternateFixture.editor as Editor;
        },
        undefined,
        'present',
        mode
      );
    }
  );

  it('cancels and rolls back when an absent context editor becomes present', async () => {
    await runPostCreateIdentityMutation(
      (harness) => {
        harness.view.editor = harness.alternateFixture.editor as Editor;
      },
      undefined,
      'undefined'
    );
  });

  it.each(['linked', 'open'] as const)(
    'cancels and rolls back when a present context editor becomes absent during %s extraction',
    async (mode) => {
      await runPostCreateIdentityMutation(
        (harness) => {
          harness.view.editor = undefined;
        },
        undefined,
        'present',
        mode
      );
    }
  );

  it('guards source identity after final linktext resolution', async () => {
    await runFinalGuardIdentityMutation((harness) => {
      const originalFileToLinktext = harness.app.metadataCache.fileToLinktext
        .bind(harness.app.metadataCache);
      let callCount = 0;
      vi.spyOn(harness.app.metadataCache, 'fileToLinktext')
        .mockImplementation((file, sourcePath, omitMdExtension) => {
          const linktext = originalFileToLinktext(
            file,
            sourcePath,
            omitMdExtension
          );
          callCount += 1;
          if (callCount === 2) {
            harness.view.file = harness.otherFile;
          }
          return linktext;
        });
    });
  });

  it.each(['linked', 'open'] as const)(
    'guards %s source identity between final position mappings',
    async (mode) => {
      await runFinalGuardIdentityMutation((harness) => {
        const offsetToPosition = vi.mocked(harness.fixture.editor.offsetToPos);
        const originalOffsetToPosition = offsetToPosition.getMockImplementation();
        if (originalOffsetToPosition === undefined) {
          throw new TypeError('Expected the editor position fake.');
        }
        let callCount = 0;
        offsetToPosition.mockImplementation((offset) => {
          const position = originalOffsetToPosition(offset);
          callCount += 1;
          if (callCount === 1) {
            harness.view.editor = harness.alternateFixture.editor as Editor;
          }
          return position;
        });
      }, mode);
    }
  );

  it.each(['linked', 'open'] as const)(
    'guards %s source identity after final position mapping',
    async (mode) => {
      await runFinalGuardIdentityMutation((harness) => {
        const offsetToPosition = vi.mocked(harness.fixture.editor.offsetToPos);
        const originalOffsetToPosition = offsetToPosition.getMockImplementation();
        if (originalOffsetToPosition === undefined) {
          throw new TypeError('Expected the editor position fake.');
        }
        let callCount = 0;
        offsetToPosition.mockImplementation((offset) => {
          const position = originalOffsetToPosition(offset);
          callCount += 1;
          if (callCount === 2) {
            harness.view.file = harness.otherFile;
          }
          return position;
        });
      }, mode);
    }
  );

  it.each(['linked', 'open'] as const)(
    'rolls back %s extraction without delegating when the pre-replacement identity guard fails',
    async (mode) => {
      await runFinalGuardIdentityMutation((harness) => {
        const getValue = vi.mocked(harness.fixture.editor.getValue);
        const originalGetValue = getValue.getMockImplementation();
        if (originalGetValue === undefined) {
          throw new TypeError('Expected the editor source fake.');
        }
        let callCount = 0;
        getValue.mockImplementation(() => {
          const source = originalGetValue();
          callCount += 1;
          if (callCount === 5) {
            harness.view.file = harness.otherFile;
          }
          return source;
        });
      }, mode);
    }
  );

  it('rolls back open extraction when the originating leaf stops owning its view before replacement', async () => {
    await runFinalGuardIdentityMutation((harness) => {
      const originatingLeaf = harness.originatingLeaf;
      if (originatingLeaf === null) {
        throw new TypeError('Expected the originating leaf.');
      }
      const unrelated = createMarkdownOrigin(
        harness.app,
        harness.otherFile,
        harness.alternateFixture.editor
      );
      const offsetToPosition = vi.mocked(harness.fixture.editor.offsetToPos);
      const originalOffsetToPosition = offsetToPosition.getMockImplementation();
      if (originalOffsetToPosition === undefined) {
        throw new TypeError('Expected the editor position fake.');
      }
      let callCount = 0;
      offsetToPosition.mockImplementation((offset) => {
        const position = originalOffsetToPosition(offset);
        callCount += 1;
        if (callCount === 2) {
          originatingLeaf.view = unrelated.view;
        }
        return position;
      });
    }, 'open');
  });

  it('rolls back open extraction when its view moves to another leaf before replacement', async () => {
    await runFinalGuardIdentityMutation((harness) => {
      const unrelated = createMarkdownOrigin(
        harness.app,
        harness.otherFile,
        harness.alternateFixture.editor
      );
      const offsetToPosition = vi.mocked(harness.fixture.editor.offsetToPos);
      const originalOffsetToPosition = offsetToPosition.getMockImplementation();
      if (originalOffsetToPosition === undefined) {
        throw new TypeError('Expected the editor position fake.');
      }
      let callCount = 0;
      offsetToPosition.mockImplementation((offset) => {
        const position = originalOffsetToPosition(offset);
        callCount += 1;
        if (callCount === 2) {
          Object.defineProperty(harness.view, 'leaf', {
            configurable: true,
            value: unrelated.leaf
          });
        }
        return position;
      });
    }, 'open');
  });

  it.each(['linked', 'open'] as const)(
    'preserves repeat movement state when %s source identity changes',
    async (mode) => {
      const movementSource = '## Alpha\na\n## Beta\nb\n';
      const movement = createEditor(
        movementSource,
        movementSource.indexOf('\na\n') + 1
      );
      const harness = await runPostCreateIdentityMutation(
        (identityHarness) => {
          identityHarness.view.editor = identityHarness.alternateFixture.editor as Editor;
        },
        (identityHarness) => {
          expect(
            identityHarness.commands.get('move-current-section-down')
              ?.editorCheckCallback?.(
                false,
                movement.editor as Editor,
                {} as PublicMarkdownView
              )
          ).toBe(true);
        },
        mode === 'linked' ? 'undefined' : 'present',
        mode
      );
      const repeatedSource = '## One\none\n## Two\ntwo\n';
      const repeated = createEditor(
        repeatedSource,
        repeatedSource.indexOf('one')
      );

      expect(
        harness.commands.get('repeat-last-structural-action')
          ?.editorCheckCallback?.(
            false,
            repeated.editor as Editor,
            {} as PublicMarkdownView
          )
      ).toBe(true);
      expect(repeated.editor.getValue()).toBe(
        '## Two\ntwo\n## One\none\n'
      );
    }
  );

  it('extracts successfully while an absent context editor remains absent', async () => {
    const harness = createIdentityHarness('undefined');
    const extraction = harness.commands.get(
      'extract-current-section-to-linked-note'
    );

    expect(
      extraction?.editorCheckCallback?.(
        true,
        harness.fixture.editor as Editor,
        asMarkdownView(harness.view)
      )
    ).toBe(true);
    expect(harness.getCompletion()).toBeUndefined();

    await invokeIdentityExtraction(harness);

    expect(harness.fixture.replaceRange).toHaveBeenCalledOnce();
    expect(harness.fixture.editor.getValue()).toBe(
      '[[Extract me]]\n'
    );
    expect(harness.fixture.setCursor).toHaveBeenCalledOnce();
    expect(harness.notify).not.toHaveBeenCalled();
    expect(
      harness.app.vault.getAbstractFileByPath(IDENTITY_DESTINATION_PATH)
    ).toBeInstanceOf(PublicTFile);
  });

  it.each(['linked', 'open'] as const)(
    'extracts successfully in %s mode while all captured source identities remain stable',
    async (mode) => {
      const harness = createIdentityHarness('present', mode);

      await invokeIdentityExtraction(harness);

      expect(harness.fixture.replaceRange).toHaveBeenCalledOnce();
      expect(harness.fixture.editor.getValue()).toBe(
        mode === 'linked' ? '[[Extract me]]\n' : ''
      );
      if (mode === 'linked') {
        expect(harness.fixture.setCursor).toHaveBeenCalledOnce();
        expect(harness.openFile).not.toHaveBeenCalled();
      } else {
        expect(harness.fixture.setCursor).not.toHaveBeenCalled();
        expect(harness.openFile).toHaveBeenCalledOnce();
      }
      expect(harness.notify).not.toHaveBeenCalled();
      const destination = harness.app.vault.getAbstractFileByPath(
        IDENTITY_DESTINATION_PATH
      );
      expect(destination).toBeInstanceOf(PublicTFile);
      if (!(destination instanceof TFile)) {
        throw new TypeError('Expected the stable extraction destination.');
      }
      expect(await harness.app.vault.read(destination)).toBe(
        '# Extract me\n\nbody\n'
      );
    }
  );

  it.each(
    [
      [
        { kind: 'create-failed' },
        'Unable to create the extracted note.'
      ],
      [
        { kind: 'cross-boundary-reference' },
        'The section has a reference or footnote outside its boundaries.'
      ],
      [
        { kind: 'destination-changed', path: 'Extracted/Topic.md' },
        'Extraction stopped because the new note changed: Extracted/Topic.md'
      ],
      [
        {
          kind: 'indeterminate-source-mutation',
          path: 'Extracted/Topic.md'
        },
        'The source changed unexpectedly; the extracted note was kept: Extracted/Topic.md'
      ],
      [
        { kind: 'open-failed', path: 'Extracted/Topic.md' },
        'The section was extracted, but the new note could not be opened: Extracted/Topic.md'
      ],
      [
        { kind: 'rollback-failed', path: 'Extracted/Topic.md' },
        'Extraction stopped, but the new note could not be removed: Extracted/Topic.md'
      ],
      [
        { kind: 'source-changed' },
        'The source note changed; extraction was cancelled.'
      ],
      [
        { kind: 'source-edit-failed' },
        'Unable to replace the source section.'
      ],
      [
        { kind: 'unresolved-relative-link' },
        'The section contains a relative link or embed that could not be resolved.'
      ],
      [
        { kind: 'unusable-title' },
        'Rename the heading before extracting it.'
      ]
    ] as const
  )(
    'shows the practical extraction notice for %s',
    async (details, expectedNotice) => {
      const notify = vi.fn();
      let completion: Promise<void> | undefined;
      const execute = vi.fn(
        (
          _editor: SectionEditor,
          _sourcePath: string,
          _execution: ExtractionExecution<PublicTFile>,
          _runtime: ExtractionRuntime<PublicTFile>,
          report: (notice: ExtractionNoticeDetails) => void
        ) => {
          report(details);
          return Promise.resolve(true);
        }
      );
      const commands = getRegisteredCommands(
        loadPluginCommands({} as App, {
          execute,
          notify,
          observeExecution(execution) {
            completion = execution;
          }
        })
      );
      const source = '# Extract me\nbody\n';
      const fixture = createEditor(source, source.indexOf('body'));

      expect(
        commands.get('extract-current-section-to-linked-note')
          ?.editorCheckCallback?.(
            false,
            fixture.editor as Editor,
            asMarkdownView({
              editor: fixture.editor,
              file: { path: 'Notes/source.md' }
            })
          )
      ).toBe(true);
      await completion;

      expect(notify).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledWith(expectedNotice);
    }
  );

  it('requires a retained path when formatting path-bearing notices', () => {
    expect(() => {
      formatExtractionNotice({ kind: 'destination-changed' });
    }).toThrow(TypeError);
    expect(() => {
      formatExtractionNotice({ kind: 'indeterminate-source-mutation' });
    }).toThrow(TypeError);
    expect(() => {
      formatExtractionNotice({ kind: 'open-failed' });
    }).toThrow(TypeError);
    expect(() => {
      formatExtractionNotice({ kind: 'rollback-failed' });
    }).toThrow(TypeError);
  });

  it('maps an unexpected async extraction failure once at the command boundary', async () => {
    const notify = vi.fn();
    let completion: Promise<void> | undefined;
    const commands = getRegisteredCommands(
      loadPluginCommands({} as App, {
        execute: vi.fn(() => Promise.reject(new Error('unexpected failure'))),
        notify,
        observeExecution(execution) {
          completion = execution;
        }
      })
    );
    const source = '# Extract me\nbody\n';
    const fixture = createEditor(source, source.indexOf('body'));

    expect(
      commands.get('extract-current-section-to-linked-note')
        ?.editorCheckCallback?.(
          false,
          fixture.editor as Editor,
          asMarkdownView({
            editor: fixture.editor,
            file: { path: 'Notes/source.md' }
          })
        )
    ).toBe(true);
    await completion;

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      'Unable to create the extracted note.'
    );
  });

  it('does not duplicate a notice when the executor later fails', async () => {
    const notify = vi.fn();
    let completion: Promise<void> | undefined;
    const commands = getRegisteredCommands(
      loadPluginCommands({} as App, {
        execute: vi.fn(
          (
            _editor: SectionEditor,
            _sourcePath: string,
            _execution: ExtractionExecution<PublicTFile>,
            _runtime: ExtractionRuntime<PublicTFile>,
            report: (notice: ExtractionNoticeDetails) => void
          ) => {
            report({ kind: 'source-changed' });
            return Promise.reject(new Error('failure after notice'));
          }
        ),
        notify,
        observeExecution(execution) {
          completion = execution;
        }
      })
    );
    const source = '# Extract me\nbody\n';
    const fixture = createEditor(source, source.indexOf('body'));

    expect(
      commands.get('extract-current-section-to-linked-note')
        ?.editorCheckCallback?.(
          false,
          fixture.editor as Editor,
          asMarkdownView({
            editor: fixture.editor,
            file: { path: 'Notes/source.md' }
          })
        )
    ).toBe(true);
    await completion;

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      'The source note changed; extraction was cancelled.'
    );
  });

  it('keeps successful extraction quiet', async () => {
    const notify = vi.fn();
    let completion: Promise<void> | undefined;
    const commands = getRegisteredCommands(
      loadPluginCommands({} as App, {
        execute: vi.fn(() => Promise.resolve(true)),
        notify,
        observeExecution(execution) {
          completion = execution;
        }
      })
    );
    const source = '# Extract me\nbody\n';
    const fixture = createEditor(source, source.indexOf('body'));

    expect(
      commands.get('extract-current-section-to-linked-note')
        ?.editorCheckCallback?.(
          false,
          fixture.editor as Editor,
          asMarkdownView({
            editor: fixture.editor,
            file: { path: 'Notes/source.md' }
          })
        )
    ).toBe(true);
    await completion;

    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps the previous movement as the repeat action after linked and open extraction', async () => {
    const extractionSource = '# Extract me\nbody\n';
    const app = ObsidianApp.createConfigured__({
      files: {
        'Notes/linked-source.md': extractionSource,
        'Notes/open-source.md': extractionSource
      }
    });
    const linkedSourceFile = app.vault.getAbstractFileByPath(
      'Notes/linked-source.md'
    );
    const openSourceFile = app.vault.getAbstractFileByPath(
      'Notes/open-source.md'
    );
    if (
      !(linkedSourceFile instanceof PublicTFile)
      || !(linkedSourceFile instanceof TFile)
      || !(openSourceFile instanceof PublicTFile)
      || !(openSourceFile instanceof TFile)
    ) {
      throw new TypeError('Expected repeat-isolation source files.');
    }
    const completions: Promise<void>[] = [];
    const execute = vi.fn(
      (
        _editor: SectionEditor,
        _sourcePath: string,
        _execution: ExtractionExecution<PublicTFile>,
        _runtime: ExtractionRuntime<PublicTFile>,
        _notify: (details: ExtractionNoticeDetails) => void
      ) => Promise.resolve(true)
    );
    const commands = getRegisteredCommands(
      loadPluginCommands(asApp(app), {
        execute,
        notify: vi.fn(),
        observeExecution(execution) {
          completions.push(execution);
        }
      })
    );
    const view = {} as PublicMarkdownView;
    const rememberedSource = '## Alpha\na\n## Beta\nb\n';
    const remembered = createEditor(
      rememberedSource,
      rememberedSource.indexOf('\na\n') + 1
    );
    const linkedExtraction = createEditor(
      extractionSource,
      extractionSource.indexOf('body')
    );
    const openExtraction = createEditor(
      extractionSource,
      extractionSource.indexOf('body')
    );
    const openOrigin = createMarkdownOrigin(
      app,
      openSourceFile,
      openExtraction.editor
    );
    const repeatedSource = '## One\none\n## Two\ntwo\n';
    const repeated = createEditor(
      repeatedSource,
      repeatedSource.indexOf('one')
    );

    expect(
      commands.get('move-current-section-down')?.editorCheckCallback?.(
        false,
        remembered.editor as Editor,
        view
      )
    ).toBe(true);
    expect(
      commands.get('extract-current-section-to-linked-note')
        ?.editorCheckCallback?.(
          true,
          linkedExtraction.editor as Editor,
          asMarkdownFileInfo({ file: linkedSourceFile })
        )
    ).toBe(true);
    expect(
      commands.get('extract-current-section-to-new-note')
        ?.editorCheckCallback?.(
          true,
          openExtraction.editor as Editor,
          openOrigin.view
        )
    ).toBe(true);
    expect(
      commands.get('extract-current-section-to-linked-note')
        ?.editorCheckCallback?.(
          false,
          linkedExtraction.editor as Editor,
          asMarkdownFileInfo({ file: linkedSourceFile })
        )
    ).toBe(true);
    expect(
      commands.get('extract-current-section-to-new-note')
        ?.editorCheckCallback?.(
          false,
          openExtraction.editor as Editor,
          openOrigin.view
        )
    ).toBe(true);
    await Promise.all(completions);
    expect(execute.mock.calls.map((call) => call[2].mode)).toEqual([
      'linked',
      'open'
    ]);

    expect(
      commands.get('repeat-last-structural-action')?.editorCheckCallback?.(
        false,
        repeated.editor as Editor,
        view
      )
    ).toBe(true);
    expect(repeated.editor.getValue()).toBe(
      '## Two\ntwo\n## One\none\n'
    );
  });

  it('repeats a successful movement mode against another editor source', () => {
    const { addCommand } = loadPluginCommands();
    const commands = new Map(
      addCommand.mock.calls.map(([command]) => [command.id, command])
    );
    const view = {} as PublicMarkdownView;
    const firstSource = '## Alpha\na\n## Beta\nb\n';
    const first = createEditor(firstSource, firstSource.indexOf('\na\n') + 1);
    const secondSource = '## One\none\n## Two\ntwo\n';
    const second = createEditor(secondSource, secondSource.indexOf('one'));

    expect(
      commands.get('move-current-section-down')?.editorCheckCallback?.(
        false,
        first.editor as Editor,
        view
      )
    ).toBe(true);
    expect(first.editor.getValue()).toBe('## Beta\nb\n## Alpha\na\n');

    expect(
      commands.get('repeat-last-structural-action')?.editorCheckCallback?.(
        false,
        second.editor as Editor,
        view
      )
    ).toBe(true);
    expect(second.replaceRange).toHaveBeenCalledOnce();
    expect(second.replaceRange).toHaveBeenCalledWith(
      '## Two\ntwo\n## One\none\n',
      { ch: 0, line: 0 },
      { ch: secondSource.length, line: 0 }
    );
    expect(second.editor.getValue()).toBe('## Two\ntwo\n## One\none\n');
  });

  it('does not offer repeat before a movement succeeds', () => {
    const { addCommand } = loadPluginCommands();
    const commands = new Map(
      addCommand.mock.calls.map(([command]) => [command.id, command])
    );
    const source = '## Alpha\na\n## Beta\nb\n';
    const fixture = createEditor(source, source.indexOf('\na\n') + 1);

    expect(
      commands.get('repeat-last-structural-action')?.editorCheckCallback?.(
        true,
        fixture.editor as Editor,
        {} as PublicMarkdownView
      )
    ).toBe(false);
    expect(fixture.replaceRange).not.toHaveBeenCalled();
  });

  it('does not remember a movement availability check', () => {
    const { addCommand } = loadPluginCommands();
    const commands = new Map(
      addCommand.mock.calls.map(([command]) => [command.id, command])
    );
    const source = '## Alpha\na\n## Beta\nb\n';
    const fixture = createEditor(source, source.indexOf('\na\n') + 1);
    const view = {} as PublicMarkdownView;

    expect(
      commands.get('move-current-section-down')?.editorCheckCallback?.(
        true,
        fixture.editor as Editor,
        view
      )
    ).toBe(true);
    expect(
      commands.get('repeat-last-structural-action')?.editorCheckCallback?.(
        true,
        fixture.editor as Editor,
        view
      )
    ).toBe(false);
    expect(fixture.replaceRange).not.toHaveBeenCalled();
  });

  it('keeps the remembered movement when another execution is unavailable', () => {
    const { addCommand } = loadPluginCommands();
    const commands = new Map(
      addCommand.mock.calls.map(([command]) => [command.id, command])
    );
    const view = {} as PublicMarkdownView;
    const rememberedSource = '## Alpha\na\n## Beta\nb\n';
    const remembered = createEditor(
      rememberedSource,
      rememberedSource.indexOf('\na\n') + 1
    );
    const unavailableSource = '## First\none\n## Second\ntwo\n';
    const unavailable = createEditor(
      unavailableSource,
      unavailableSource.indexOf('one')
    );
    const repeatedSource = '## Left\nleft\n## Right\nright\n';
    const repeated = createEditor(
      repeatedSource,
      repeatedSource.indexOf('left')
    );

    expect(
      commands.get('move-current-section-down')?.editorCheckCallback?.(
        false,
        remembered.editor as Editor,
        view
      )
    ).toBe(true);
    expect(
      commands.get('move-current-section-up')?.editorCheckCallback?.(
        false,
        unavailable.editor as Editor,
        view
      )
    ).toBe(false);
    expect(unavailable.replaceRange).not.toHaveBeenCalled();

    expect(
      commands.get('repeat-last-structural-action')?.editorCheckCallback?.(
        false,
        repeated.editor as Editor,
        view
      )
    ).toBe(true);
    expect(repeated.editor.getValue()).toBe(
      '## Right\nright\n## Left\nleft\n'
    );
  });

  it('keeps a successful repeated action available for another editor', () => {
    const { addCommand } = loadPluginCommands();
    const commands = new Map(
      addCommand.mock.calls.map(([command]) => [command.id, command])
    );
    const view = {} as PublicMarkdownView;
    const sources = [
      '## Alpha\na\n## Beta\nb\n',
      '## One\none\n## Two\ntwo\n',
      '## Left\nleft\n## Right\nright\n'
    ] as const;
    const editors = sources.map((source) => createEditor(source, source.indexOf('\n') + 1));

    expect(
      commands.get('move-current-section-down')?.editorCheckCallback?.(
        false,
        editors[0]?.editor as Editor,
        view
      )
    ).toBe(true);
    expect(
      commands.get('repeat-last-structural-action')?.editorCheckCallback?.(
        false,
        editors[1]?.editor as Editor,
        view
      )
    ).toBe(true);
    expect(
      commands.get('repeat-last-structural-action')?.editorCheckCallback?.(
        false,
        editors[2]?.editor as Editor,
        view
      )
    ).toBe(true);
    expect(editors[1]?.replaceRange).toHaveBeenCalledOnce();
    expect(editors[2]?.replaceRange).toHaveBeenCalledOnce();
  });

  it('does not offer repeat when the remembered movement has no destination', () => {
    const { addCommand } = loadPluginCommands();
    const commands = new Map(
      addCommand.mock.calls.map(([command]) => [command.id, command])
    );
    const view = {} as PublicMarkdownView;
    const rememberedSource = '## Alpha\na\n## Beta\nb\n';
    const remembered = createEditor(
      rememberedSource,
      rememberedSource.indexOf('\na\n') + 1
    );
    const unavailableSource = '## One\none\n## Two\ntwo\n';
    const unavailable = createEditor(
      unavailableSource,
      unavailableSource.indexOf('two')
    );

    expect(
      commands.get('move-current-section-down')?.editorCheckCallback?.(
        false,
        remembered.editor as Editor,
        view
      )
    ).toBe(true);
    expect(
      commands.get('repeat-last-structural-action')?.editorCheckCallback?.(
        true,
        unavailable.editor as Editor,
        view
      )
    ).toBe(false);
    expect(unavailable.replaceRange).not.toHaveBeenCalled();
  });

  it('presents contextual commands only for matching cursor targets', () => {
    const { addCommand } = loadPluginCommands();
    const commands = new Map(
      addCommand.mock.calls.map(([command]) => [command.id, command])
    );
    const view = {} as PublicMarkdownView;
    const fencedSource = '# Heading\nbefore\n```ts\ncode\n```\nafter\n';
    const fenced = createEditor(fencedSource, fencedSource.indexOf('code'));
    const calloutSource = '> [!note]\n> body\n';
    const callout = createEditor(calloutSource, calloutSource.indexOf('body'));
    const blockquoteSource = '> quote\n> body\n';
    const blockquote = createEditor(
      blockquoteSource,
      blockquoteSource.indexOf('body')
    );
    const protectedSource = '> quote\n> %%\n> hidden\n> %%\n> tail\n';
    const protectedBlockquote = createEditor(
      protectedSource,
      protectedSource.indexOf('hidden')
    );

    const fencedCommand = commands.get('delete-current-fenced-code-block');
    const calloutCommand = commands.get('delete-current-callout');
    const blockquoteCommand = commands.get('delete-current-blockquote');

    expect(
      fencedCommand?.editorCheckCallback?.(true, fenced.editor as Editor, view)
    ).toBe(true);
    expect(
      calloutCommand?.editorCheckCallback?.(
        true,
        fenced.editor as Editor,
        view
      )
    ).toBe(false);
    expect(
      calloutCommand?.editorCheckCallback?.(
        true,
        callout.editor as Editor,
        view
      )
    ).toBe(true);
    expect(
      blockquoteCommand?.editorCheckCallback?.(
        true,
        callout.editor as Editor,
        view
      )
    ).toBe(false);
    expect(
      blockquoteCommand?.editorCheckCallback?.(
        true,
        blockquote.editor as Editor,
        view
      )
    ).toBe(true);
    expect(
      blockquoteCommand?.editorCheckCallback?.(
        true,
        protectedBlockquote.editor as Editor,
        view
      )
    ).toBe(false);
    expect(fenced.replaceRange).not.toHaveBeenCalled();

    fencedCommand?.editorCheckCallback?.(false, fenced.editor as Editor, view);

    expect(fenced.replaceRange).toHaveBeenCalledWith(
      '',
      { ch: fencedSource.indexOf('```ts'), line: 0 },
      { ch: fencedSource.indexOf('after'), line: 0 }
    );
  });

  it('routes each registered heading callback to its matching deletion mode', () => {
    const { addCommand } = loadPluginCommands();
    const commands = addCommand.mock.calls.map(([command]) => command);
    const source = '# A\nintro\n## B\nchild\n# C\nkeep\n';
    const section = createEditor(source, 2);
    const headingBlock = createEditor(source, 2);
    const view = {} as PublicMarkdownView;

    commands[0]?.editorCallback?.(section.editor as Editor, view);
    commands[1]?.editorCallback?.(headingBlock.editor as Editor, view);

    expect(section.replaceRange).toHaveBeenCalledOnce();
    expect(section.replaceRange).toHaveBeenCalledWith(
      '',
      { ch: 0, line: 0 },
      { ch: 21, line: 0 }
    );
    expect(headingBlock.replaceRange).toHaveBeenCalledOnce();
    expect(headingBlock.replaceRange).toHaveBeenCalledWith(
      '',
      { ch: 0, line: 0 },
      { ch: 10, line: 0 }
    );
  });
});

/* eslint-enable perfectionist/sort-modules -- Test module definitions are complete. */
