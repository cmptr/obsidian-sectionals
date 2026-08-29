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

import { executeSectionExtraction } from './section-extraction-executor.ts';
import { planSectionExtraction } from './section-extraction-planner.ts';

interface FakeFile extends ExtractionFile {
  readonly id: number;
}

interface NotifyFixture {
  readonly notices: ExtractionNoticeDetails[];
  notify(details: ExtractionNoticeDetails): void;
}

interface StoredFakeFile {
  readonly content: string;
  readonly file: FakeFile;
}

class StatefulEditor implements ExtractionEditor {
  readonly events: string[];
  readonly getCursor = vi.fn((_which?: 'anchor' | 'from' | 'head' | 'to') => {
    this.events.push('getCursor');
    return this.position(this.cursorOffset);
  });
  readonly getValue = vi.fn(() => {
    this.events.push('getValue');
    return this.source;
  });
  readonly offsetToPos = vi.fn((offset: number) => {
    this.events.push(`offsetToPos:${String(offset)}`);
    return this.position(offset);
  });
  readonly posToOffset = vi.fn((position: EditorPosition) => {
    this.events.push('posToOffset');
    return position.ch;
  });
  readonly replaceRange = vi.fn((
    replacement: string,
    from: EditorPosition,
    to?: EditorPosition
  ) => {
    this.events.push('replaceRange');
    this.source = this.source.slice(0, from.ch)
      + replacement
      + this.source.slice((to ?? from).ch);
  });
  readonly setCursor = vi.fn((position: EditorPosition) => {
    this.events.push('setCursor');
    this.cursorOffset = position.ch;
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

  overwriteSource(source: string): void {
    this.source = source;
  }

  private position(offset: number): EditorPosition {
    return { ch: offset, line: 0 };
  }
}

class StatefulRuntime implements ExtractionRuntime<FakeFile> {
  readonly events: string[];
  readonly files = new Map<string, StoredFakeFile>();
  readonly create = vi.fn(async (path: string, content: string) => {
    this.events.push(`create:${path}`);
    return this.storeCreatedFile(path, content);
  });
  readonly delete = vi.fn(async (file: FakeFile) => {
    this.events.push(`delete:${file.path}`);
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
    this.events.push(`read:${file.path}`);
    const entry = this.files.get(file.path);
    if (entry === undefined) {
      throw new Error('missing file');
    }
    return entry.content;
  });
  readonly resolveLink = vi.fn<ExtractionRuntime<FakeFile>['resolveLink']>(() => null);

  private nextId = 1;

  constructor(events: string[] = []) {
    this.events = events;
  }

  storeCreatedFile(path: string, content: string): FakeFile {
    const basename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/u, '');
    const file = { basename, id: this.nextId, path };
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
});

describe('executeSectionExtraction success', () => {
  it('creates and verifies the destination before replacing the source and mapping the cursor', async () => {
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
      executeSectionExtraction(editor, 'Projects/Source.md', runtime, notify, planner)
    ).resolves.toBe(true);

    expect(notices).toEqual([]);
    expect(runtime.files.get('Extracted/Beta.md')?.content).toBe(
      '# Beta\n\nbody\n'
    );
    expect(editor.currentSource()).toBe('# Beta\n\n[[Beta]]\n');
    expect(editor.replaceRange).toHaveBeenCalledExactlyOnceWith(
      '\n\n[[Beta]]\n',
      { ch: 6, line: 0 },
      { ch: 12, line: 0 }
    );
    expect(editor.setCursor).toHaveBeenCalledExactlyOnceWith({ ch: 8, line: 0 });
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
      'read:Extracted/Beta.md',
      'getValue',
      'offsetToPos:6',
      'offsetToPos:12',
      'replaceRange',
      'getValue',
      'offsetToPos:8',
      'setCursor'
    ]);
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
        file: { basename: 'Beta', id: 999, path }
      });
      throw new Error('already exists');
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Projects/Source.md', runtime, notify)
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
    expect(runtime.getLinktext).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        basename: 'Beta 1',
        path: 'Archive/Nested/Beta 1.md'
      }),
      'Projects/Source.md'
    );
    expect(editor.currentSource()).toBe('# Beta\n\n[[Beta 1|Beta]]\n');
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
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'create-failed' }]);
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
        file: { basename: 'collision', id: 999, path }
      });
      throw new Error('already exists');
    });
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
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
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
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
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'source-changed' }]);
    expect(createdFile).toBeDefined();
    expect(runtime.read).toHaveBeenCalledExactlyOnceWith(createdFile);
    expect(runtime.delete).toHaveBeenCalledExactlyOnceWith(createdFile);
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
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
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
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
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
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
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
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
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
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
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
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
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
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(false);
    expect(runtime.read).toHaveBeenCalledOnce();
    expect(runtime.delete).toHaveBeenCalledOnce();
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
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.read).toHaveBeenCalledTimes(2);
    expect(runtime.delete).toHaveBeenCalledOnce();
    expect(runtime.files.has('Extracted/Beta.md')).toBe(false);
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
      executeSectionExtraction(editor, 'Projects/Source.md', runtime, notify)
    ).resolves.toBe(true);

    expect(notices).toEqual([{ kind: 'unresolved-relative-link' }]);
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.read).not.toHaveBeenCalled();
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });
});

describe('executeSectionExtraction source mutation outcomes', () => {
  it('rolls back when replaceRange throws before mutating the source', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce(() => {
      throw new Error('edit rejected');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
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
        source.slice(0, from.ch) + replacement + source.slice((to ?? from).ch)
      );
      throw new Error('edit reported failure');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('# Beta\n\n[[Beta]]\n');
    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.setCursor).not.toHaveBeenCalled();
  });

  it('retains the destination and reports an indeterminate partial mutation', async () => {
    const editor = new StatefulEditor('# Beta\nbody\n', 9);
    editor.replaceRange.mockImplementationOnce(() => {
      editor.overwriteSource('# Beta\n\n[[Bet');
      throw new Error('partial edit');
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('# Beta\n\n[[Bet');
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
        source.slice(0, from.ch) + replacement + source.slice((to ?? from).ch)
      );
      editor.getValue.mockImplementationOnce(() => {
        throw new Error('inspection failed');
      });
    });
    const runtime = new StatefulRuntime();
    const { notices, notify } = createNotify();

    await expect(
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
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
      executeSectionExtraction(editor, 'Source.md', runtime, notify)
    ).resolves.toBe(true);

    expect(editor.currentSource()).toBe('# Beta\n\n[[Beta]]\n');
    expect(notices).toEqual([{ kind: 'source-edit-failed' }]);
    expect(runtime.files.has('Extracted/Beta.md')).toBe(true);
    expect(runtime.delete).not.toHaveBeenCalled();
    expect(editor.setCursor).toHaveBeenCalledOnce();
  });
});

/* eslint-enable @typescript-eslint/require-await -- Promise-service fake implementations are complete. */
