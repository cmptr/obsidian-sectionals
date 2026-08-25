// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Obsidian imports compact.
import type { App, Command, Editor, EditorPosition, MarkdownView, PluginManifest } from 'obsidian';
import type { MockInstance } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

import type { DeletionRange } from './deletion-planner.ts';

import DeleteSectionsPlugin, { executeDeleteCommand } from './main.ts';

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

describe('DeleteSectionsPlugin', () => {
  it('registers exact editor-only command metadata without hotkeys', () => {
    const { addCommand } = loadPluginCommands();

    expect(addCommand).toHaveBeenCalledTimes(2);
    expect(
      addCommand.mock.calls.map(([command]) => ({
        callback: command.callback,
        editorCallback: typeof command.editorCallback,
        hotkeys: command.hotkeys,
        id: command.id,
        name: command.name
      }))
    ).toEqual([
      {
        callback: undefined,
        editorCallback: 'function',
        hotkeys: undefined,
        id: 'delete-current-section',
        name: 'Delete current section'
      },
      {
        callback: undefined,
        editorCallback: 'function',
        hotkeys: undefined,
        id: 'delete-current-heading-block',
        name: 'Delete current heading block'
      }
    ]);
  });

  it('routes each registered callback to its matching deletion mode', () => {
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
