// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Obsidian imports compact.
import type { App, Command, Editor, EditorPosition, MarkdownView, PluginManifest } from 'obsidian';
import type { MockInstance } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import type { DeletionRange, DeletionTarget } from './deletion-planner.ts';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible main imports compact.
import DeleteSectionsPlugin, { executeDeleteCommand, executeStructurePickerCommand } from './main.ts';

interface EditorFixture {
  editor: SectionEditor;
  replaceRange: ReturnType<typeof vi.fn>;
  setCursor: ReturnType<typeof vi.fn>;
}

interface PluginCommandsFixture {
  addCommand: MockInstance<(command: Command) => Command>;
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

  const replaceRange = vi.fn();
  const setCursor = vi.fn();
  return {
    editor: {
      getCursor: vi.fn(() => position(cursorOffset)),
      getValue: vi.fn(() => source),
      offsetToPos: vi.fn(position),
      posToOffset: vi.fn(toOffset),
      replaceRange,
      setCursor
    },
    replaceRange,
    setCursor
  };
}

function loadPluginCommands(): PluginCommandsFixture {
  const manifest: PluginManifest = {
    author: 'Aaron Bell',
    description: 'Delete the Markdown section containing the cursor.',
    id: 'sectionals',
    isDesktopOnly: false,
    minAppVersion: '1.8.9',
    name: 'Sectionals',
    version: '0.1.0'
  };
  const plugin = new DeleteSectionsPlugin({} as App, manifest);
  const addCommand = vi.spyOn(plugin, 'addCommand');

  plugin.onload();

  return { addCommand };
}

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

describe('DeleteSectionsPlugin', () => {
  it('registers exact editor-only command metadata without hotkeys', () => {
    const { addCommand } = loadPluginCommands();

    expect(addCommand).toHaveBeenCalledTimes(6);
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
      }
    ]);
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
