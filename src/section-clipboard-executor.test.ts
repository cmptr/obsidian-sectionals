/* eslint-disable perfectionist/sort-modules -- Keep test harness primitives before the composed factory. */

import { noopAsync } from 'obsidian-dev-utils/function';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

import type {
  ClipboardEditorPosition,
  SectionClipboardEditor,
  SectionClipboardRuntime
} from './section-clipboard-executor.ts';

import { planSectionDeletion } from './deletion-planner.ts';
import { executeSectionClipboard } from './section-clipboard-executor.ts';

interface ClipboardHarness {
  currentSource(): string;
  readonly editor: SectionClipboardEditor;
  readonly events: string[];
  readonly getValue: ReturnType<typeof vi.fn<() => string>>;
  readonly isOriginCurrent: ReturnType<typeof vi.fn<() => boolean>>;
  readonly offsetToPos: ReturnType<typeof vi.fn<(offset: number) => ClipboardEditorPosition>>;
  overwriteSource(source: string): void;
  readonly replaceRange: ReturnType<typeof vi.fn<SectionClipboardEditor['replaceRange']>>;
  readonly runtime: SectionClipboardRuntime;
  readonly setCursor: ReturnType<typeof vi.fn<SectionClipboardEditor['setCursor']>>;
  readonly writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
}

interface DeferredPromise {
  readonly promise: Promise<void>;
  resolve(): void;
}

function createDeferredPromise(): DeferredPromise {
  const deferred = {
    resolve(): void {
      throw new Error('deferred promise was not initialized');
    }
  };
  const promise = new Promise<void>((resolve) => {
    deferred.resolve = resolve;
  });
  return { promise, resolve: deferred.resolve };
}

function offsetFor(
  source: string,
  position: ClipboardEditorPosition
): number {
  const lines = source.split('\n');
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    const text = lines[line];
    if (text === undefined) {
      throw new RangeError('position line is outside the source');
    }
    offset += text.length + 1;
  }
  return offset + position.ch;
}

function positionFor(source: string, offset: number): ClipboardEditorPosition {
  const prefix = source.slice(0, offset);
  const lineStart = prefix.lastIndexOf('\n') + 1;
  return {
    ch: offset - lineStart,
    line: prefix.split('\n').length - 1
  };
}

function createHarness(initialSource: string): ClipboardHarness {
  const events: string[] = [];
  let source = initialSource;
  const getValue = vi.fn(() => {
    events.push('getValue');
    return source;
  });
  const offsetToPos = vi.fn((offset: number) => {
    events.push(`offsetToPos:${String(offset)}`);
    return positionFor(source, offset);
  });
  const replaceRange = vi.fn<SectionClipboardEditor['replaceRange']>((
    replacement,
    from,
    to
  ) => {
    events.push('replaceRange');
    const fromOffset = offsetFor(source, from);
    const toOffset = offsetFor(source, to);
    source = source.slice(0, fromOffset)
      + replacement
      + source.slice(toOffset);
  });
  const setCursor = vi.fn<SectionClipboardEditor['setCursor']>(() => {
    events.push('setCursor');
  });
  const isOriginCurrent = vi.fn(() => {
    events.push('isOriginCurrent');
    return true;
  });
  const writeText = vi.fn((_text: string) => {
    events.push('writeText');
    return noopAsync();
  });
  return {
    currentSource: () => source,
    editor: { getValue, offsetToPos, replaceRange, setCursor },
    events,
    getValue,
    isOriginCurrent,
    offsetToPos,
    overwriteSource: (updatedSource): void => {
      source = updatedSource;
    },
    replaceRange,
    runtime: { isOriginCurrent, writeText },
    setCursor,
    writeText
  };
}

function expectNoClipboardOrMutation(harness: ClipboardHarness): void {
  expect(harness.writeText).not.toHaveBeenCalled();
  expect(harness.offsetToPos).not.toHaveBeenCalled();
  expect(harness.replaceRange).not.toHaveBeenCalled();
  expect(harness.setCursor).not.toHaveBeenCalled();
}

/* eslint-enable perfectionist/sort-modules -- Test harness definitions are complete. */

describe('executeSectionClipboard copy', () => {
  it.each([
    {
      cursorOffset: 15,
      expectedText: '# Target\nbody\n',
      name: 'an ATX section',
      source: 'intro\n# Target\nbody\n# Keep\nkeep\n'
    },
    {
      cursorOffset: 21,
      expectedText: 'First title\nsecond title\n===\nbody\n',
      name: 'a multiline Setext section',
      source: '# Before\nold\n\nFirst title\nsecond title\n===\nbody\n# Keep\n'
    },
    {
      cursorOffset: 12,
      expectedText: '# Target\r\nbody\r\n',
      name: 'a CRLF section',
      source: '# Target\r\nbody\r\n# Keep\r\nkeep\r\n'
    },
    {
      cursorOffset: 24,
      expectedText: '## Target\nbody\n### Child\nchild body\n',
      name: 'a section with nested descendants',
      source: '# Root\nintro\n## Target\nbody\n### Child\nchild body\n## Keep\nkeep\n'
    },
    {
      cursorOffset: 15,
      expectedText: '> ## Target\n> body\n',
      name: 'a quoted section',
      source: '> ## Target\n> body\n> ## Keep\n> keep\n'
    },
    {
      cursorOffset: 27,
      expectedText: '> ## Target\n> body\n> ### Child\n> child\n',
      name: 'a callout section',
      source: '> [!note]\n> ## Target\n> body\n> ### Child\n> child\n> ## Keep\n> keep\n'
    },
    {
      cursorOffset: 11,
      expectedText: '# Target\nbody\n\n\n',
      name: 'owned blank lines',
      source: '# Target\nbody\n\n\n# Keep\nkeep\n'
    },
    {
      cursorOffset: 25,
      expectedText: '# Final\nbody',
      name: 'a cursor at true EOF',
      source: '# Before\nold\n# Final\nbody'
    },
    {
      cursorOffset: 16,
      expectedText: '# Target\nunterminated body',
      name: 'an unterminated final line',
      source: '# Target\nunterminated body'
    }
  ])('copies $name byte-for-byte', async ({
    cursorOffset,
    expectedText,
    source
  }) => {
    const harness = createHarness(source);
    const planner = vi.fn<typeof planSectionDeletion>(planSectionDeletion);

    await expect(
      executeSectionClipboard(
        harness.editor,
        cursorOffset,
        'copy',
        harness.runtime,
        planner
      )
    ).resolves.toEqual({ status: 'copied' });

    expect(planner).toHaveBeenCalledExactlyOnceWith(
      source,
      cursorOffset,
      'section'
    );
    expect(harness.writeText).toHaveBeenCalledExactlyOnceWith(expectedText);
    expect(harness.offsetToPos).not.toHaveBeenCalled();
    expect(harness.replaceRange).not.toHaveBeenCalled();
    expect(harness.setCursor).not.toHaveBeenCalled();
  });

  it.each([
    {
      cursorOffset: 2,
      name: 'there is no section at the cursor',
      source: 'intro\n# Heading\nbody\n'
    },
    {
      cursorOffset: 5,
      name: 'the cursor is outside the source',
      source: '# H'
    }
  ])('returns unavailable when $name', async ({ cursorOffset, source }) => {
    const harness = createHarness(source);

    await expect(
      executeSectionClipboard(
        harness.editor,
        cursorOffset,
        'copy',
        harness.runtime
      )
    ).resolves.toEqual({ status: 'unavailable' });

    expectNoClipboardOrMutation(harness);
  });

  it.each([
    {
      arrange: (harness: ClipboardHarness): void => {
        harness.getValue.mockImplementation(() => {
          throw new Error('read failed');
        });
      },
      name: 'the editor read throws',
      planner: planSectionDeletion
    },
    {
      arrange: (_harness: ClipboardHarness): void => undefined,
      name: 'the planner throws',
      planner: (): never => {
        throw new Error('planning failed');
      }
    }
  ])('returns operation-failed when $name', async ({ arrange, planner }) => {
    const harness = createHarness('# Target\nbody\n');
    arrange(harness);

    await expect(
      executeSectionClipboard(
        harness.editor,
        11,
        'copy',
        harness.runtime,
        planner
      )
    ).resolves.toEqual({ status: 'operation-failed' });

    expectNoClipboardOrMutation(harness);
  });

  it('returns clipboard-failed without mutating when clipboard writing rejects', async () => {
    const harness = createHarness('# Target\nbody\n');
    harness.writeText.mockRejectedValueOnce(new Error('clipboard denied'));

    await expect(
      executeSectionClipboard(
        harness.editor,
        11,
        'copy',
        harness.runtime
      )
    ).resolves.toEqual({ status: 'clipboard-failed' });

    expect(harness.writeText).toHaveBeenCalledExactlyOnceWith(
      '# Target\nbody\n'
    );
    expect(harness.replaceRange).not.toHaveBeenCalled();
    expect(harness.setCursor).not.toHaveBeenCalled();
  });
});

describe('executeSectionClipboard cut', () => {
  const source = '# Target\nbody\n# Keep\nkeep\n';

  it('waits for clipboard success before deleting and places the cursor afterward', async () => {
    const harness = createHarness(source);
    const clipboard = createDeferredPromise();
    harness.writeText.mockImplementationOnce((_text) => {
      harness.events.push('writeText');
      return clipboard.promise;
    });
    const planner = vi.fn<typeof planSectionDeletion>(planSectionDeletion);

    const execution = executeSectionClipboard(
      harness.editor,
      11,
      'cut',
      harness.runtime,
      planner
    );

    expect(harness.writeText).toHaveBeenCalledExactlyOnceWith(
      '# Target\nbody\n'
    );
    expect(harness.currentSource()).toBe(source);
    expect(harness.replaceRange).not.toHaveBeenCalled();
    expect(harness.setCursor).not.toHaveBeenCalled();

    clipboard.resolve();
    await expect(execution).resolves.toEqual({ status: 'cut' });

    expect(planner).toHaveBeenCalledExactlyOnceWith(source, 11, 'section');
    expect(harness.replaceRange).toHaveBeenCalledExactlyOnceWith(
      '',
      { ch: 0, line: 0 },
      { ch: 0, line: 2 }
    );
    expect(harness.setCursor).toHaveBeenCalledExactlyOnceWith({
      ch: 0,
      line: 0
    });
    expect(harness.currentSource()).toBe('# Keep\nkeep\n');
    expect(harness.events).toEqual([
      'getValue',
      'offsetToPos:0',
      'offsetToPos:14',
      'writeText',
      'isOriginCurrent',
      'getValue',
      'replaceRange',
      'getValue',
      'setCursor'
    ]);
  });

  it('leaves the source unchanged when clipboard writing rejects', async () => {
    const harness = createHarness(source);
    harness.writeText.mockRejectedValueOnce(new Error('clipboard denied'));

    await expect(
      executeSectionClipboard(harness.editor, 11, 'cut', harness.runtime)
    ).resolves.toEqual({ status: 'clipboard-failed' });

    expect(harness.currentSource()).toBe(source);
    expect(harness.isOriginCurrent).not.toHaveBeenCalled();
    expect(harness.replaceRange).not.toHaveBeenCalled();
    expect(harness.setCursor).not.toHaveBeenCalled();
  });

  it.each([
    {
      arrange: (harness: ClipboardHarness): void => {
        harness.isOriginCurrent.mockReturnValueOnce(false);
      },
      name: 'returns false'
    },
    {
      arrange: (harness: ClipboardHarness): void => {
        harness.isOriginCurrent.mockImplementationOnce(() => {
          throw new Error('origin check failed');
        });
      },
      name: 'throws'
    }
  ])('reports source-changed when the origin guard $name', async ({ arrange }) => {
    const harness = createHarness(source);
    arrange(harness);

    await expect(
      executeSectionClipboard(harness.editor, 11, 'cut', harness.runtime)
    ).resolves.toEqual({ status: 'source-changed' });

    expect(harness.writeText).toHaveBeenCalledExactlyOnceWith(
      '# Target\nbody\n'
    );
    expect(harness.replaceRange).not.toHaveBeenCalled();
    expect(harness.setCursor).not.toHaveBeenCalled();
  });

  it('reports source-changed without re-planning when the editor changes during clipboard writing', async () => {
    const harness = createHarness(source);
    const clipboard = createDeferredPromise();
    harness.writeText.mockImplementationOnce(() => clipboard.promise);
    const planner = vi.fn<typeof planSectionDeletion>(planSectionDeletion);
    const execution = executeSectionClipboard(
      harness.editor,
      11,
      'cut',
      harness.runtime,
      planner
    );

    harness.overwriteSource(`${source}changed\n`);
    clipboard.resolve();

    await expect(execution).resolves.toEqual({ status: 'source-changed' });
    expect(planner).toHaveBeenCalledExactlyOnceWith(source, 11, 'section');
    expect(harness.replaceRange).not.toHaveBeenCalled();
    expect(harness.setCursor).not.toHaveBeenCalled();
  });

  it.each([0, 14])(
    'returns operation-failed when converting offset %i throws',
    async (failingOffset) => {
      const harness = createHarness(source);
      harness.offsetToPos.mockImplementation((offset) => {
        if (offset === failingOffset) {
          throw new Error('position conversion failed');
        }
        return positionFor(source, offset);
      });

      await expect(
        executeSectionClipboard(harness.editor, 11, 'cut', harness.runtime)
      ).resolves.toEqual({ status: 'operation-failed' });

      expect(harness.writeText).not.toHaveBeenCalled();
      expect(harness.replaceRange).not.toHaveBeenCalled();
      expect(harness.setCursor).not.toHaveBeenCalled();
    }
  );

  it('returns source-changed when the post-clipboard source read throws', async () => {
    const harness = createHarness(source);
    harness.getValue
      .mockImplementationOnce(() => source)
      .mockImplementationOnce(() => {
        throw new Error('source unavailable');
      });

    await expect(
      executeSectionClipboard(harness.editor, 11, 'cut', harness.runtime)
    ).resolves.toEqual({ status: 'source-changed' });

    expect(harness.replaceRange).not.toHaveBeenCalled();
    expect(harness.setCursor).not.toHaveBeenCalled();
  });

  it('returns cut-failed when replacement throws before mutation', async () => {
    const harness = createHarness(source);
    harness.replaceRange.mockImplementationOnce(() => {
      throw new Error('replacement failed');
    });

    await expect(
      executeSectionClipboard(harness.editor, 11, 'cut', harness.runtime)
    ).resolves.toEqual({ status: 'cut-failed' });

    expect(harness.currentSource()).toBe(source);
    expect(harness.replaceRange).toHaveBeenCalledTimes(1);
    expect(harness.setCursor).not.toHaveBeenCalled();
  });

  it('finishes a cut when replacement applies the exact deletion and throws', async () => {
    const harness = createHarness(source);
    harness.replaceRange.mockImplementationOnce(() => {
      harness.overwriteSource('# Keep\nkeep\n');
      throw new Error('replacement reported failure');
    });

    await expect(
      executeSectionClipboard(harness.editor, 11, 'cut', harness.runtime)
    ).resolves.toEqual({ status: 'cut' });

    expect(harness.currentSource()).toBe('# Keep\nkeep\n');
    expect(harness.replaceRange).toHaveBeenCalledTimes(1);
    expect(harness.setCursor).toHaveBeenCalledExactlyOnceWith({
      ch: 0,
      line: 0
    });
  });

  it('returns cut-unverified when replacement partially mutates and throws', async () => {
    const harness = createHarness(source);
    harness.replaceRange.mockImplementationOnce(() => {
      harness.overwriteSource('# Targ\nbody\n# Keep\nkeep\n');
      throw new Error('replacement reported failure');
    });

    await expect(
      executeSectionClipboard(harness.editor, 11, 'cut', harness.runtime)
    ).resolves.toEqual({ status: 'cut-unverified' });

    expect(harness.currentSource()).toBe(
      '# Targ\nbody\n# Keep\nkeep\n'
    );
    expect(harness.replaceRange).toHaveBeenCalledTimes(1);
    expect(harness.setCursor).not.toHaveBeenCalled();
  });

  it('returns cut-failed when replacement returns without mutation', async () => {
    const harness = createHarness(source);
    harness.replaceRange.mockImplementationOnce(() => undefined);

    await expect(
      executeSectionClipboard(harness.editor, 11, 'cut', harness.runtime)
    ).resolves.toEqual({ status: 'cut-failed' });

    expect(harness.currentSource()).toBe(source);
    expect(harness.replaceRange).toHaveBeenCalledTimes(1);
    expect(harness.setCursor).not.toHaveBeenCalled();
  });

  it('returns cut-unverified when the source is unreadable after replacement', async () => {
    const harness = createHarness(source);
    harness.getValue
      .mockImplementationOnce(() => source)
      .mockImplementationOnce(() => source)
      .mockImplementationOnce(() => {
        throw new Error('source unavailable');
      });

    await expect(
      executeSectionClipboard(harness.editor, 11, 'cut', harness.runtime)
    ).resolves.toEqual({ status: 'cut-unverified' });

    expect(harness.currentSource()).toBe('# Keep\nkeep\n');
    expect(harness.replaceRange).toHaveBeenCalledTimes(1);
    expect(harness.setCursor).not.toHaveBeenCalled();
  });

  it('returns cut-cursor-failed when exact deletion succeeds but cursor placement throws', async () => {
    const harness = createHarness(source);
    harness.setCursor.mockImplementationOnce(() => {
      throw new Error('cursor placement failed');
    });

    await expect(
      executeSectionClipboard(harness.editor, 11, 'cut', harness.runtime)
    ).resolves.toEqual({ status: 'cut-cursor-failed' });

    expect(harness.currentSource()).toBe('# Keep\nkeep\n');
    expect(harness.replaceRange).toHaveBeenCalledTimes(1);
    expect(harness.setCursor).toHaveBeenCalledTimes(1);
  });
});
