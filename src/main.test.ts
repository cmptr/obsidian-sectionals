/* eslint-disable perfectionist/sort-modules -- Keep tests grouped by production behavior and established command order. */

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Obsidian imports compact.
import type { App, Command, Editor, EditorPosition, MarkdownView, PluginManifest } from 'obsidian';
import type { MockInstance } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Obsidian imports compact.
import { TFile as PublicTFile, TFolder as PublicTFolder } from 'obsidian';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Obsidian test imports compact.
import { App as ObsidianApp, TFile, TFolder } from 'obsidian-test-mocks/obsidian';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import type { DeletionRange, DeletionTarget } from './deletion-planner.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible executor imports compact.
import type { ExtractionNoticeDetails, ExtractionRuntime } from './section-extraction-executor.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible structural action imports compact.
import type { StructuralAction, StructuralEditPlan } from './structural-action.ts';

import SectionalsPlugin, {
  checkAndExecuteStructuralAction,
  executeDeleteCommand,
  executeStructurePickerCommand,
  formatExtractionNotice
} from './main.ts';

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

function createMarkdownView(file: PublicTFile): MarkdownView {
  return { file } as MarkdownView;
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

    expect(addCommand).toHaveBeenCalledTimes(12);
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
      }
    ]);
  });

  it('checks extraction availability from the current editor and source file without side effects', () => {
    const getNewFileParent = vi.fn();
    const getFirstLinkpathDestination = vi.fn();
    const fileToLinktext = vi.fn();
    const create = vi.fn();
    const read = vi.fn();
    const deleteFile = vi.fn();
    const getAbstractFileByPath = vi.fn();
    const app = asApp({
      fileManager: { getNewFileParent },
      metadataCache: {
        fileToLinktext,
        // eslint-disable-next-line unicorn/name-replacements -- Obsidian public API name.
        getFirstLinkpathDest: getFirstLinkpathDestination
      },
      vault: {
        create,
        delete: deleteFile,
        getAbstractFileByPath,
        read
      }
    });
    const execute = vi.fn(() => Promise.resolve(true));
    const notify = vi.fn();
    const observeExecution = vi.fn();
    const commands = getRegisteredCommands(
      loadPluginCommands(app, { execute, notify, observeExecution })
    );
    const extraction = commands.get(
      'extract-current-section-to-linked-note'
    );
    const unavailable = createEditor('plain text\n', 2);
    const readySource = '# Extract me\nbody\n';
    const ready = createEditor(readySource, readySource.indexOf('body'));
    const invalidSource = '# Extract me\nbody[^outside]\n# Keep\n[^outside]: note\n';
    const invalid = createEditor(
      invalidSource,
      invalidSource.indexOf('body')
    );

    expect(
      extraction?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        { file: null } as MarkdownView
      )
    ).toBe(false);
    expect(
      extraction?.editorCheckCallback?.(
        true,
        unavailable.editor as Editor,
        { file: { path: 'Notes/source.md' } } as MarkdownView
      )
    ).toBe(false);
    expect(
      extraction?.editorCheckCallback?.(
        true,
        ready.editor as Editor,
        { file: { path: 'Notes/source.md' } } as MarkdownView
      )
    ).toBe(true);
    expect(
      extraction?.editorCheckCallback?.(
        true,
        invalid.editor as Editor,
        { file: { path: 'Notes/source.md' } } as MarkdownView
      )
    ).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(observeExecution).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(getNewFileParent).not.toHaveBeenCalled();
    expect(getFirstLinkpathDestination).not.toHaveBeenCalled();
    expect(fileToLinktext).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(getAbstractFileByPath).not.toHaveBeenCalled();
  });

  it('starts one extraction asynchronously and returns before it settles', async () => {
    let finishExecution: ((isSuccessful: boolean) => void) | undefined;
    const execute = vi.fn(
      (
        _editor: SectionEditor,
        _sourcePath: string,
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
          { file: { path: 'Notes/source.md' } } as MarkdownView
        )
    ).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toBe(fixture.editor);
    expect(execute.mock.calls[0]?.[1]).toBe('Notes/source.md');
    expect(observeExecution).toHaveBeenCalledOnce();
    expect(completion).toBeInstanceOf(Promise);
    expect(notify).not.toHaveBeenCalled();

    finishExecution?.(true);
    await completion;
    expect(notify).not.toHaveBeenCalled();
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
    const deleteFile = vi.spyOn(app.vault, 'delete');
    const execute = vi.fn(
      async (
        _editor: SectionEditor,
        _sourcePath: string,
        runtime: ExtractionRuntime<PublicTFile>
      ) => {
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
          createMarkdownView(sourceFile)
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
    expect(deleteFile).toHaveBeenCalledWith(expect.any(PublicTFile));
    expect(app.vault.getAbstractFileByPath('Extracted/created.md')).toBeNull();
  });

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
            { file: { path: 'Notes/source.md' } } as MarkdownView
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
          { file: { path: 'Notes/source.md' } } as MarkdownView
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
          { file: { path: 'Notes/source.md' } } as MarkdownView
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
          { file: { path: 'Notes/source.md' } } as MarkdownView
        )
    ).toBe(true);
    await completion;

    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps the previous movement as the repeat action after extraction', async () => {
    let completion: Promise<void> | undefined;
    const execute = vi.fn(() => Promise.resolve(true));
    const commands = getRegisteredCommands(
      loadPluginCommands({} as App, {
        execute,
        notify: vi.fn(),
        observeExecution(execution) {
          completion = execution;
        }
      })
    );
    const view = {} as MarkdownView;
    const rememberedSource = '## Alpha\na\n## Beta\nb\n';
    const remembered = createEditor(
      rememberedSource,
      rememberedSource.indexOf('\na\n') + 1
    );
    const extractionSource = '# Extract me\nbody\n';
    const extraction = createEditor(
      extractionSource,
      extractionSource.indexOf('body')
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
          false,
          extraction.editor as Editor,
          { file: { path: 'Notes/source.md' } } as MarkdownView
        )
    ).toBe(true);
    await completion;
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
    const view = {} as MarkdownView;
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
        {} as MarkdownView
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
    const view = {} as MarkdownView;

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
    const view = {} as MarkdownView;
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
    const view = {} as MarkdownView;
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
    const view = {} as MarkdownView;
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
    const view = {} as MarkdownView;
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
    const view = {} as MarkdownView;

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
