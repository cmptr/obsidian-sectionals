/* eslint-disable @stylistic/lines-between-class-members, @typescript-eslint/explicit-member-accessibility -- Stateful fakes keep each injected service adjacent to its behavior. */
/* eslint-disable @typescript-eslint/require-await -- Async fakes intentionally model Promise services without artificial waits. */
/* eslint-disable perfectionist/sort-classes -- Stateful fake members follow the approved service call order. */

import type { EditorPosition } from 'obsidian';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

import type {
  ExtractionEditor,
  ExtractionFile,
  ExtractionNoticeDetails,
  ExtractionRuntime
} from './section-extraction-executor.ts';
import type { SectionExtractionPlan } from './section-extraction-planner.ts';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible executor imports compact.
import { executeSectionExtraction, ExtractionSourceChangedError } from './section-extraction-executor.ts';
import { planSectionExtraction } from './section-extraction-planner.ts';

interface NotifyFixture {
  readonly notices: ExtractionNoticeDetails[];
  notify(details: ExtractionNoticeDetails): void;
}

interface StoredFakeFile {
  readonly content: string;
  readonly file: FakeFile;
}

class FakeFile implements ExtractionFile {
  constructor(
    readonly id: number,
    public basename: string,
    public path: string
  ) {}
}

class StatefulEditor implements ExtractionEditor {
  beforeGetValue: ((source: string) => void) | undefined;
  readonly events: string[];
  readonly getCursor = vi.fn((_which?: 'anchor' | 'from' | 'head' | 'to') => {
    this.events.push('getCursor');
    return this.position(this.cursorOffset);
  });
  readonly getValue = vi.fn(() => {
    this.events.push('getValue');
    const source = this.source;
    this.beforeGetValue?.(source);
    return source;
  });
  readonly offsetToPos = vi.fn((offset: number) => {
    this.events.push(`offsetToPos:${String(offset)}`);
    return this.position(offset);
  });
  readonly posToOffset = vi.fn((position: EditorPosition) => {
    this.events.push('posToOffset');
    return this.offsetFor(position);
  });
  readonly replaceRange = vi.fn((
    replacement: string,
    from: EditorPosition,
    to?: EditorPosition
  ) => {
    this.events.push('replaceRange');
    const fromOffset = this.offsetFor(from);
    const toOffset = this.offsetFor(to ?? from);
    this.source = this.source.slice(0, fromOffset)
      + replacement
      + this.source.slice(toOffset);
  });
  readonly setCursor = vi.fn((position: EditorPosition) => {
    this.events.push('setCursor');
    this.cursorOffset = this.offsetFor(position);
  });

  constructor(
    private source: string,
    private cursorOffset: number,
    events: string[] = []
  ) {
    this.events = events;
  }

  currentSource(): string {
    return this.source;
  }

  offsetFor(position: EditorPosition): number {
    const lines = this.source.split('\n');
    let offset = 0;
    for (let line = 0; line < position.line; line += 1) {
      const content = lines[line];
      if (content === undefined) {
        throw new RangeError('Editor position line is out of range.');
      }
      offset += content.length + 1;
    }
    return offset + position.ch;
  }

  overwriteSource(source: string): void {
    this.source = source;
  }

  private position(offset: number): EditorPosition {
    const before = this.source.slice(0, offset);
    const finalLineStart = before.lastIndexOf('\n') + 1;
    return {
      ch: offset - finalLineStart,
      line: before.split('\n').length - 1
    };
  }
}

class StatefulRuntime implements ExtractionRuntime<FakeFile> {
  afterRead: ((file: FakeFile) => void) | undefined;
  readonly events: string[];
  readonly files = new Map<string, StoredFakeFile>();
  readonly create = vi.fn(async (path: string, content: string) => {
    this.events.push(`create:${path}`);
    return this.storeCreatedFile(path, content);
  });
  readonly delete = vi.fn(async (file: FakeFile) => {
    this.events.push(`delete:${file.path}:${String(file.id)}`);
    const entry = this.files.get(file.path);
    if (entry?.file !== file || entry.file.id !== file.id) {
      throw new Error('file identity changed before delete');
    }
    this.files.delete(file.path);
  });
  readonly fileExists = vi.fn((path: string) => {
    this.events.push(`fileExists:${path}`);
    return this.files.has(path);
  });
  readonly getLinktext = vi.fn((file: FakeFile, sourcePath: string) => {
    this.events.push(`getLinktext:${file.path}:${sourcePath}`);
    return file.basename;
  });
  readonly getNewFileParent = vi.fn((
    _sourcePath: string,
    filename: string
  ) => {
    this.events.push(`getNewFileParent:${filename}`);
    return { path: 'Extracted' };
  });
  readonly read = vi.fn(async (file: FakeFile) => {
    this.events.push(`read:${file.path}:${String(file.id)}`);
    const entry = this.files.get(file.path);
    if (entry?.file !== file || entry.file.id !== file.id) {
      throw new Error('file identity changed before read');
    }
    const { content } = entry;
    this.afterRead?.(file);
    return content;
  });
  readonly resolveLink = vi.fn<ExtractionRuntime<FakeFile>['resolveLink']>(() => null);

  private nextId = 1;

  constructor(events: string[] = []) {
    this.events = events;
  }

  storeCreatedFile(path: string, content: string): FakeFile {
    const basename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/u, '');
    const file = new FakeFile(this.nextId, basename, path);
    this.nextId += 1;
    this.files.set(path, { content, file });
    return file;
  }
}

/* eslint-enable @stylistic/lines-between-class-members, @typescript-eslint/explicit-member-accessibility -- Stateful fake definitions are complete. */
/* eslint-enable perfectionist/sort-classes -- Stateful fake definitions are complete. */

function createNotify(): NotifyFixture {
  const notices: ExtractionNoticeDetails[] = [];
  return {
    notices,
    notify: (details): void => {
      notices.push(details);
    }
  };
}

function staticPlanner(plan: SectionExtractionPlan): typeof planSectionExtraction {
  return () => plan;
}

describe('executeSectionExtraction validation', () => {
  it('returns false without notice or mutation when extraction is unavailable', async () => {
    const editor = new StatefulEditor('plain text\n', 2);
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'linked' },
        runtime,
        notify,
        staticPlanner({ kind: 'unavailable' })
      )
    ).resolves.toBe(false);
    expect(notices).toEqual([]);
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(editor.setCursor).not.toHaveBeenCalled();
  });

  it.each(
    [
      ['unusable-title', 'unusable-title'],
      ['cross-boundary-reference', 'cross-boundary-reference']
    ] as const
  )(
    'handles an invalid %s plan without creating a file',
    async (reason, expectedNotice) => {
      const editor = new StatefulEditor('# Heading\nbody\n', 12);
      const runtime = new StatefulRuntime();
      const { notices, notify } = createNotify();

      await expect(
        executeSectionExtraction(
          editor,
          'Source.md',
          { mode: 'linked' },
          runtime,
          notify,
          staticPlanner({ kind: 'invalid', reason })
        )
      ).resolves.toBe(true);
      expect(notices).toEqual([{ kind: expectedNotice }]);
      expect(runtime.create).not.toHaveBeenCalled();
      expect(runtime.delete).not.toHaveBeenCalled();
      expect(editor.replaceRange).not.toHaveBeenCalled();
      expect(editor.setCursor).not.toHaveBeenCalled();
    }
  );

  it('does not open a file when open extraction is unavailable', async () => {
    const editor = new StatefulEditor('plain text\n', 2);
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn<(file: FakeFile) => Promise<void>>();

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify,
        staticPlanner({ kind: 'unavailable' })
      )
    ).resolves.toBe(false);

    expect(notices).toEqual([]);
    expect(openCreatedFile).not.toHaveBeenCalled();
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('does not open a file when an open extraction plan is invalid', async () => {
    const editor = new StatefulEditor('# Heading\nbody\n', 12);
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn<(file: FakeFile) => Promise<void>>();

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify,
        staticPlanner({ kind: 'invalid', reason: 'unusable-title' })
      )
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'unusable-title' }]);
    expect(openCreatedFile).not.toHaveBeenCalled();
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });
});

describe('executeSectionExtraction success', () => {
  it('executes linked mode without an opener and maps the cursor to the committed link', async () => {
    const events: string[] = [];
    const editor = new StatefulEditor('# Beta\nbody\n', 9, events);
    const runtime = new StatefulRuntime(events);
    const { notices, notify } = createNotify();
    function planner(
      source: string,
      cursorOffset: number
    ): SectionExtractionPlan {
      events.push(`plan:${String(cursorOffset)}`);
      return planSectionExtraction(source, cursorOffset);
    }

    await expect(
      executeSectionExtraction(editor, 'Projects/Source.md', { mode: 'linked' }, runtime, notify, planner)
    ).resolves.toBe(true);

    expect(notices).toEqual([]);
    expect(runtime.files.get('Extracted/Beta.md')?.content).toBe(
      '# Beta\n\nbody\n'
    );
    expect(editor.currentSource()).toBe('[[Beta]]\n');
    expect(editor.replaceRange).toHaveBeenCalledExactlyOnceWith(
      '[[Beta]]\n',
      { ch: 0, line: 0 },
      { ch: 0, line: 2 }
    );
    expect(editor.setCursor).toHaveBeenCalledExactlyOnceWith({ ch: 0, line: 0 });
    expect(events).toEqual([
      'getValue',
      'getCursor',
      'posToOffset',
      'plan:9',
      'getNewFileParent:Beta.md',
      'fileExists:Extracted/Beta.md',
      'create:Extracted/Beta.md',
      'getLinktext:Extracted/Beta.md:Projects/Source.md',
      'getValue',
      'read:Extracted/Beta.md:1',
      'getValue',
      'getLinktext:Extracted/Beta.md:Projects/Source.md',
      'offsetToPos:0',
      'offsetToPos:12',
      'getValue',
      'replaceRange',
      'getValue',
      'offsetToPos:0',
      'setCursor'
    ]);
    expect(runtime.delete).not.toHaveBeenCalled();
  });

  it('executes open mode only after inspecting the exact source commit', async () => {
    const events: string[] = [];
    const editor = new StatefulEditor('# Beta\nbody\n', 9, events);
    const runtime = new StatefulRuntime(events);
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn(async (file: FakeFile) => {
      events.push(`open:${file.path}`);
    });

    await expect(
      executeSectionExtraction(
        editor,
        'Projects/Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(notices).toEqual([]);
    expect(runtime.files.get('Extracted/Beta.md')?.content).toBe(
      '# Beta\n\nbody\n'
    );
    expect(openCreatedFile).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: 'Extracted/Beta.md' })
    );
    expect(runtime.getLinktext).not.toHaveBeenCalled();
    expect(editor.currentSource()).toBe('');
    expect(editor.replaceRange).toHaveBeenCalledExactlyOnceWith(
      '',
      { ch: 0, line: 0 },
      { ch: 0, line: 2 }
    );
    expect(editor.setCursor).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
    const replacementIndex = events.indexOf('replaceRange');
    const commitInspectionIndex = events.indexOf('getValue', replacementIndex + 1);
    const openingIndex = events.indexOf('open:Extracted/Beta.md');
    expect(replacementIndex).toBeGreaterThanOrEqual(0);
    expect(commitInspectionIndex).toBeGreaterThan(replacementIndex);
    expect(openingIndex).toBeGreaterThan(commitInspectionIndex);
  });
});

describe('executeSectionExtraction open-mode postcommit', () => {
  it('retains the committed destination and reports its path when opening fails', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn(async () => {
      throw new Error('open failed');
    });

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('');
    expect(runtime.files.get('Extracted/Beta.md')?.content).toBe(
      '# Beta\n\nbody\n'
    );
    expect(openCreatedFile).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: 'Extracted/Beta.md' })
    );
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(notices).toEqual([{
      kind: 'open-failed',
      path: 'Extracted/Beta.md'
    }]);
  });

  it('opens and retains an exact commit when replaceRange applies it before throwing', async () => {
    const events: string[] = [];
    const editor = new StatefulEditor('# Beta\nbody\n', 9, events);
    editor.replaceRange.mockImplementationOnce((replacement, from, to) => {
      events.push('replaceRange:exact-then-throw');
      const source = editor.currentSource();
      editor.overwriteSource(
        source.slice(0, editor.offsetFor(from))
          + replacement
          + source.slice(editor.offsetFor(to ?? from))
      );
      throw new Error('edit reported failure');
    });
    const runtime = new StatefulRuntime(events);
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn(async (file: FakeFile) => {
      events.push(`open:${file.path}`);
    });

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('');
    expect(openCreatedFile).toHaveBeenCalledOnce();
    const replacementIndex = events.indexOf('replaceRange:exact-then-throw');
    const commitInspectionIndex = events.indexOf('getValue', replacementIndex + 1);
    const openingIndex = events.indexOf('open:Extracted/Beta.md');
    expect(replacementIndex).toBeGreaterThanOrEqual(0);
    expect(commitInspectionIndex).toBeGreaterThan(replacementIndex);
    expect(openingIndex).toBeGreaterThan(commitInspectionIndex);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
  });

  it('reports only the retained path when opening an exact throwing commit also fails', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce((replacement, from, to) => {
      const source = editor.currentSource();
      editor.overwriteSource(
        source.slice(0, editor.offsetFor(from))
          + replacement
          + source.slice(editor.offsetFor(to ?? from))
      );
      throw new Error('edit reported failure');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn(async () => {
      throw new Error('open failed');
    });

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('');
    expect(openCreatedFile).toHaveBeenCalledOnce();
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(notices).toEqual([{
      kind: 'open-failed',
      path: 'Extracted/Beta.md'
    }]);
  });
});

describe('executeSectionExtraction created-file identity', () => {
  it('retains an unknown file returned at the wrong path without linking or deleting it', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.create.mockImplementationOnce(async (_path, content) => {
      const file = new FakeFile(99, 'Beta', 'Elsewhere/Beta.md');
      runtime.files.set(file.path, { content, file });
      return file;
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'destination-changed',
      path: 'Extracted/Beta.md'
    }]);
    expect(editor.currentSource()).toBe('# Beta\nbody\n');
    expect(runtime.getLinktext).not.toHaveBeenCalled();
    expect(runtime.read).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
  });

  it('retains an unknown file whose returned path cannot be inspected', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.create.mockImplementationOnce(async () => {
      const file = new FakeFile(99, 'Beta', 'Extracted/Beta.md');
      Object.defineProperty(file, 'path', {
        get() {
          throw new Error('path unavailable');
        }
      });
      return file;
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'destination-changed',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.getLinktext).not.toHaveBeenCalled();
    expect(runtime.read).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
  });

  it('retains an unknown file returned with the wrong basename', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.create.mockImplementationOnce(async (path, content) => {
      const file = runtime.storeCreatedFile(path, content);
      file.basename = 'Other';
      return file;
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'destination-changed',
      path: 'Extracted/Beta.md'
    }]);
    expect(editor.currentSource()).toBe('# Beta\nbody\n');
    expect(runtime.getLinktext).not.toHaveBeenCalled();
    expect(runtime.read).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
  });

  it('retains the destination when its path changes during destination readback', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.afterRead = (file): void => {
      file.path = 'Moved/Beta.md';
    };
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'destination-changed',
      path: 'Extracted/Beta.md'
    }]);
    expect(editor.currentSource()).toBe('# Beta\nbody\n');
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('does not open a destination whose identity changes during readback', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.afterRead = (file): void => {
      file.path = 'Moved/Beta.md';
    };
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn<(file: FakeFile) => Promise<void>>();

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'destination-changed',
      path: 'Extracted/Beta.md'
    }]);
    expect(editor.currentSource()).toBe('# Beta\nbody\n');
    expect(openCreatedFile).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('retains a same-path object that the adapter cannot read by exact identity', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    let returnedFile: FakeFile | undefined;
    runtime.create.mockImplementationOnce(async (path, content) => {
      runtime.storeCreatedFile(path, content);
      returnedFile = new FakeFile(99, 'Beta', path);
      return returnedFile;
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'rollback-failed',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.read).toHaveBeenCalledExactlyOnceWith(returnedFile);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });
});

describe('executeSectionExtraction final commit gate', () => {
  it('does not yield after the matching final source snapshot', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    let sourceReadCount = 0;
    let didMutationMicrotaskRun = false;
    let didMutationRunBeforeReplacement: boolean | undefined;
    editor.beforeGetValue = (): void => {
      sourceReadCount += 1;
      if (sourceReadCount === 3) {
        queueMicrotask(() => {
          didMutationMicrotaskRun = true;
          editor.overwriteSource('# Zeta\nbody\n');
        });
      }
    };
    editor.replaceRange.mockImplementationOnce((replacement, from, to) => {
      didMutationRunBeforeReplacement = didMutationMicrotaskRun;
      const source = editor.currentSource();
      editor.overwriteSource(
        source.slice(0, editor.offsetFor(from))
          + replacement
          + source.slice(editor.offsetFor(to ?? from))
      );
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(didMutationMicrotaskRun).toBe(true);
    expect(didMutationRunBeforeReplacement).toBe(false);
    expect(editor.replaceRange).toHaveBeenCalledOnce();
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it('rebuilds the source edit from the final shortest linktext', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.getLinktext
      .mockReturnValueOnce('Beta')
      .mockReturnValueOnce('Extracted/Beta');
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(runtime.getLinktext).toHaveBeenCalledTimes(2);
    expect(editor.currentSource()).toBe('[[Extracted/Beta|Beta]]\n');
    expect(notices).toEqual([]);
  });

  it('retains the destination when final linktext generation changes its path', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.getLinktext
      .mockReturnValueOnce('Beta')
      .mockImplementationOnce((file) => {
        file.path = 'Moved/Beta.md';
        return 'Moved/Beta';
      });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'destination-changed',
      path: 'Extracted/Beta.md'
    }]);
    expect(editor.currentSource()).toBe('# Beta\nbody\n');
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
  });
});

describe('executeSectionExtraction collision races', () => {
  it('re-prepares content and source linking at the next suffix after a create race', async () => {
    const editor = new StatefulEditor(
      '# Beta\n[Asset](../Assets/Photo.png)\n',
      10
    );
    const runtime = new StatefulRuntime();
    runtime.getNewFileParent.mockImplementation((_sourcePath, filename) => {
      runtime.events.push(`getNewFileParent:${filename}`);
      return { path: filename === 'Beta.md' ? 'Extracted' : 'Archive/Nested' };
    });
    runtime.resolveLink.mockReturnValue({
      extension: 'png',
      path: 'Assets/Photo.png'
    });
    runtime.create.mockImplementationOnce(async (path) => {
      runtime.events.push(`create:${path}`);
      runtime.files.set(path, {
        content: 'won by another writer',
        file: new FakeFile(999, 'Beta', path)
      });
      throw new Error('already exists');
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Projects/Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([]);
    expect(runtime.create).toHaveBeenCalledTimes(2);
    expect(runtime.create.mock.calls[0]?.[0]).toBe('Extracted/Beta.md');
    expect(runtime.create.mock.calls[1]).toEqual([
      'Archive/Nested/Beta 1.md',
      '# Beta\n\n[Asset](../../Assets/Photo.png)\n'
    ]);
    expect(runtime.getNewFileParent.mock.calls).toEqual([
      ['Projects/Source.md', 'Beta.md'],
      ['Projects/Source.md', 'Beta 1.md']
    ]);
    expect(runtime.getLinktext).toHaveBeenCalledTimes(2);
    expect(runtime.getLinktext).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        basename: 'Beta 1',
        path: 'Archive/Nested/Beta 1.md'
      }),
      'Projects/Source.md'
    );
    expect(runtime.getLinktext).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        basename: 'Beta 1',
        path: 'Archive/Nested/Beta 1.md'
      }),
      'Projects/Source.md'
    );
    expect(editor.currentSource()).toBe('[[Beta 1|Beta]]\n');
    expect(runtime.files.get('Extracted/Beta.md')?.content).toBe(
      'won by another writer'
    );
    expect(runtime.delete).not.toHaveBeenCalled();
  });

  it('does not retry a create rejection when the candidate still does not exist', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.create.mockImplementationOnce(async (path) => {
      runtime.events.push(`create:${path}`);
      throw new Error('permission denied');
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'create-failed' }]);
    expect(runtime.create).toHaveBeenCalledOnce();
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('does not open a file when open-mode destination creation fails', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.create.mockImplementationOnce(async (path) => {
      runtime.events.push(`create:${path}`);
      throw new Error('permission denied');
    });
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn<(file: FakeFile) => Promise<void>>();

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'create-failed' }]);
    expect(openCreatedFile).not.toHaveBeenCalled();
    expect(runtime.create).toHaveBeenCalledOnce();
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('stops after 10,000 create collisions', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.create.mockImplementation(async (path) => {
      runtime.files.set(path, {
        content: 'won by another writer',
        file: new FakeFile(999, 'collision', path)
      });
      throw new Error('already exists');
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'create-failed' }]);
    expect(runtime.create).toHaveBeenCalledTimes(10_000);
    expect(runtime.create.mock.calls.at(-1)?.[0]).toBe(
      'Extracted/Beta 9999.md'
    );
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('does not create after 10,000 pre-existing destination candidates', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.fileExists.mockImplementation(() => true);
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'create-failed' }]);
    expect(runtime.fileExists).toHaveBeenCalledTimes(10_000);
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });
});

describe('executeSectionExtraction pre-commit rollback', () => {
  it('deletes only its unchanged created file when the source becomes stale', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    let createdFile: FakeFile | undefined;
    runtime.create.mockImplementationOnce(async (path, content) => {
      runtime.events.push(`create:${path}`);
      createdFile = runtime.storeCreatedFile(path, content);
      editor.overwriteSource('# Beta\nchanged\n');
      return createdFile;
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'source-changed' }]);
    expect(createdFile).toBeDefined();
    expect(runtime.read).toHaveBeenCalledExactlyOnceWith(createdFile);
    expect(runtime.delete).toHaveBeenCalledExactlyOnceWith(createdFile);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(false);
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('rolls back a stale open extraction without opening the created file', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.create.mockImplementationOnce(async (path, content) => {
      runtime.events.push(`create:${path}`);
      const file = runtime.storeCreatedFile(path, content);
      editor.overwriteSource('# Beta\nchanged\n');
      return file;
    });
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn<(file: FakeFile) => Promise<void>>();

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'source-changed' }]);
    expect(openCreatedFile).not.toHaveBeenCalled();
    expect(runtime.delete).toHaveBeenCalledOnce();
    expect(runtime.files.has('Extracted/Beta.md')).toBe(false);
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('rolls back when the source changes during destination readback', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.read.mockImplementationOnce(async (file) => {
      const entry = runtime.files.get(file.path);
      if (entry === undefined) {
        throw new Error('missing file');
      }
      editor.overwriteSource('# Zeta\nbody\n');
      return entry.content;
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'source-changed' }]);
    expect(runtime.read).toHaveBeenCalledTimes(2);
    expect(runtime.delete).toHaveBeenCalledOnce();
    expect(runtime.files.has('Extracted/Beta.md')).toBe(false);
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('rolls back when the live source cannot be read before replacement', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.create.mockImplementationOnce(async (path, content) => {
      runtime.events.push(`create:${path}`);
      const file = runtime.storeCreatedFile(path, content);
      editor.getValue.mockImplementationOnce(() => {
        throw new Error('editor read failed');
      });
      return file;
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.read).toHaveBeenCalledOnce();
    expect(runtime.delete).toHaveBeenCalledOnce();
    expect(runtime.files.has('Extracted/Beta.md')).toBe(false);
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('retains changed destination content and reports its path', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.getLinktext.mockImplementation((file, sourcePath) => {
      runtime.events.push(`getLinktext:${file.path}:${sourcePath}`);
      const entry = runtime.files.get(file.path);
      if (entry !== undefined) {
        runtime.files.set(file.path, { ...entry, content: 'changed externally' });
      }
      return file.basename;
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'destination-changed',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.files.get('Extracted/Beta.md')?.content).toBe(
      'changed externally'
    );
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('retains the created file when destination verification cannot read it', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.read.mockRejectedValueOnce(new Error('read failed'));
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'rollback-failed',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('retains the created file and reports rollback failure when rollback readback fails', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.create.mockImplementationOnce(async (path, content) => {
      runtime.events.push(`create:${path}`);
      const file = runtime.storeCreatedFile(path, content);
      editor.overwriteSource('# Zeta\nbody\n');
      return file;
    });
    runtime.read.mockRejectedValueOnce(new Error('read failed'));
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'rollback-failed',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('retains the created file and reports rollback failure when deletion fails', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.create.mockImplementationOnce(async (path, content) => {
      runtime.events.push(`create:${path}`);
      const file = runtime.storeCreatedFile(path, content);
      editor.overwriteSource('# Beta\nchanged\n');
      return file;
    });
    runtime.delete.mockImplementationOnce(async (file) => {
      runtime.events.push(`delete:${file.path}`);
      throw new Error('delete failed');
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'rollback-failed',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.read).toHaveBeenCalledOnce();
    expect(runtime.delete).toHaveBeenCalledOnce();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('rolls back an unchanged file when shortest-link generation fails', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.getLinktext.mockImplementationOnce(() => {
      throw new Error('link generation failed');
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(false);
    expect(runtime.read).toHaveBeenCalledOnce();
    expect(runtime.delete).toHaveBeenCalledOnce();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('retains a rollback target whose path changes during readback', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    runtime.getLinktext.mockImplementationOnce(() => {
      throw new Error('link generation failed');
    });
    runtime.afterRead = (file): void => {
      file.path = 'Moved/Beta.md';
    };
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'destination-changed',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('retains an identity replacement installed between rollback read and delete', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    const runtime = new StatefulRuntime();
    let createdFile: FakeFile | undefined;
    runtime.create.mockImplementationOnce(async (path, content) => {
      createdFile = runtime.storeCreatedFile(path, content);
      return createdFile;
    });
    runtime.getLinktext.mockImplementationOnce(() => {
      throw new Error('link generation failed');
    });
    runtime.afterRead = (file): void => {
      const entry = runtime.files.get(file.path);
      if (entry !== undefined) {
        runtime.files.set(file.path, {
          content: entry.content,
          file: new FakeFile(999, file.basename, file.path)
        });
      }
    };
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'rollback-failed',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.delete).toHaveBeenCalledExactlyOnceWith(createdFile);
    expect(runtime.files.get('Extracted/Beta.md')?.file).not.toBe(createdFile);
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('rolls back when source range mapping fails before replacement', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.offsetToPos.mockImplementationOnce(() => {
      throw new Error('mapping failed');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.read).toHaveBeenCalledTimes(2);
    expect(runtime.delete).toHaveBeenCalledOnce();
    expect(runtime.files.has('Extracted/Beta.md')).toBe(false);
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('does not create or open a file when open-mode destination preparation cannot resolve a relative link', async () => {
    const editor = new StatefulEditor(
      '# Beta\n[Asset](../Assets/Missing.png)\n',
      10
    );
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn<(file: FakeFile) => Promise<void>>();

    await expect(
      executeSectionExtraction(
        editor,
        'Projects/Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'unresolved-relative-link' }]);
    expect(openCreatedFile).not.toHaveBeenCalled();
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.read).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('does not create a file when destination preparation cannot resolve a relative link', async () => {
    const editor = new StatefulEditor(
      '# Beta\n[Asset](../Assets/Missing.png)\n',
      10
    );
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Projects/Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'unresolved-relative-link' }]);
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.read).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });
});

describe('executeSectionExtraction source mutation outcomes', () => {
  it('rolls back when replaceRange returns without mutating the source', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce(() => {
      editor.events.push('replaceRange:no-op');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('# Beta\nbody\n');
    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.delete).toHaveBeenCalledOnce();
    expect(runtime.files.has('Extracted/Beta.md')).toBe(false);
    expect(editor.setCursor).not.toHaveBeenCalled();
  });

  it('rolls back and does not open when open-mode replaceRange returns without mutation', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce(() => {
      editor.events.push('replaceRange:no-op');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn<(file: FakeFile) => Promise<void>>();

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('# Beta\nbody\n');
    expect(openCreatedFile).not.toHaveBeenCalled();
    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.delete).toHaveBeenCalledOnce();
    expect(runtime.files.has('Extracted/Beta.md')).toBe(false);
    expect(editor.setCursor).not.toHaveBeenCalled();
  });

  it('retains an indeterminate open-mode partial mutation without opening or deleting', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce(() => {
      editor.overwriteSource('# Bet');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn<(file: FakeFile) => Promise<void>>();

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('# Bet');
    expect(openCreatedFile).not.toHaveBeenCalled();
    expect(notices).toEqual([{
      kind: 'indeterminate-source-mutation',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.setCursor).not.toHaveBeenCalled();
  });

  it('retains the destination when replaceRange returns after a partial mutation', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce(() => {
      editor.overwriteSource('[[Bet');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'indeterminate-source-mutation',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.setCursor).not.toHaveBeenCalled();
  });

  it('rolls back when replaceRange throws before mutating the source', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce(() => {
      throw new Error('edit rejected');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('# Beta\nbody\n');
    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.read).toHaveBeenCalledTimes(2);
    expect(runtime.delete).toHaveBeenCalledOnce();
    expect(runtime.files.has('Extracted/Beta.md')).toBe(false);
    expect(editor.setCursor).not.toHaveBeenCalled();
  });

  it('retains the destination when replaceRange throws after the exact mutation', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce((replacement, from, to) => {
      const source = editor.currentSource();
      editor.overwriteSource(
        source.slice(0, editor.offsetFor(from))
          + replacement
          + source.slice(editor.offsetFor(to ?? from))
      );
      throw new Error('edit reported failure');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('[[Beta]]\n');
    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.setCursor).toHaveBeenCalledOnce();
  });

  it('classifies an exact linked mutation before trusting a thrown source-changed error', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce((replacement, from, to) => {
      const source = editor.currentSource();
      editor.overwriteSource(
        source.slice(0, editor.offsetFor(from))
          + replacement
          + source.slice(editor.offsetFor(to ?? from))
      );
      throw new ExtractionSourceChangedError();
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('[[Beta]]\n');
    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.setCursor).toHaveBeenCalledOnce();
  });

  it('classifies an exact open mutation before trusting a thrown source-changed error', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce((replacement, from, to) => {
      const source = editor.currentSource();
      editor.overwriteSource(
        source.slice(0, editor.offsetFor(from))
          + replacement
          + source.slice(editor.offsetFor(to ?? from))
      );
      throw new ExtractionSourceChangedError();
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn<(file: FakeFile) => Promise<void>>();

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('');
    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(openCreatedFile).toHaveBeenCalledOnce();
    expect(editor.setCursor).not.toHaveBeenCalled();
  });

  it('gives opener failure precedence after an exact mutation throws a source-changed error', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce((replacement, from, to) => {
      const source = editor.currentSource();
      editor.overwriteSource(
        source.slice(0, editor.offsetFor(from))
          + replacement
          + source.slice(editor.offsetFor(to ?? from))
      );
      throw new ExtractionSourceChangedError();
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn(async () => {
      throw new Error('open failed');
    });

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('');
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(openCreatedFile).toHaveBeenCalledOnce();
    expect(notices).toEqual([{
      kind: 'open-failed',
      path: 'Extracted/Beta.md'
    }]);
  });

  it('retains a linked partial mutation when replacement throws a source-changed error', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce(() => {
      editor.overwriteSource('[[Bet');
      throw new ExtractionSourceChangedError();
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('[[Bet');
    expect(notices).toEqual([{
      kind: 'indeterminate-source-mutation',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.setCursor).not.toHaveBeenCalled();
  });

  it('retains an open partial mutation when replacement throws a source-changed error', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce(() => {
      editor.overwriteSource('# Bet');
      throw new ExtractionSourceChangedError();
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();
    const openCreatedFile = vi.fn<(file: FakeFile) => Promise<void>>();

    await expect(
      executeSectionExtraction(
        editor,
        'Source.md',
        { mode: 'open', openCreatedFile },
        runtime,
        notify
      )
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('# Bet');
    expect(notices).toEqual([{
      kind: 'indeterminate-source-mutation',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(openCreatedFile).not.toHaveBeenCalled();
    expect(editor.setCursor).not.toHaveBeenCalled();
  });

  it('retains the destination and reports an indeterminate partial mutation', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce(() => {
      editor.overwriteSource('[[Bet');
      throw new Error('partial edit');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('[[Bet');
    expect(notices).toEqual([{
      kind: 'indeterminate-source-mutation',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.setCursor).not.toHaveBeenCalled();
  });

  it('retains the destination when post-replacement source inspection fails', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce((replacement, from, to) => {
      const source = editor.currentSource();
      editor.overwriteSource(
        source.slice(0, editor.offsetFor(from))
          + replacement
          + source.slice(editor.offsetFor(to ?? from))
      );
      editor.getValue.mockImplementationOnce(() => {
        throw new Error('inspection failed');
      });
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{
      kind: 'indeterminate-source-mutation',
      path: 'Extracted/Beta.md'
    }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.setCursor).not.toHaveBeenCalled();
  });

  it('retains the destination when cursor placement throws after an exact mutation', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.setCursor.mockImplementationOnce(() => {
      throw new Error('cursor failed');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', { mode: 'linked' }, runtime, notify)
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('[[Beta]]\n');
    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.setCursor).toHaveBeenCalledOnce();
  });
});

/* eslint-enable @typescript-eslint/require-await -- Promise-service fake implementations are complete. */
