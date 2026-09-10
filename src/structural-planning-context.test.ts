import type { Mock } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible context imports compact.
import type { StructuralPlanningContext, StructuralPlanningContextProvider } from './structural-planning-context.ts';

import { parseMarkdownStructure } from './markdown-structure.ts';
import { collectMarkdownSections } from './section-query.ts';
import {
  createEphemeralStructuralPlanningContextProvider,
  createStructuralPlanningContext
} from './structural-planning-context.ts';

interface ProviderHarness {
  readonly deferred: (() => void)[];
  readonly factory: Mock<(source: string) => StructuralPlanningContext>;
  readonly provider: StructuralPlanningContextProvider;
}

describe('ephemeral structural planning context provider', () => {
  function createHarness(): ProviderHarness {
    const deferred: (() => void)[] = [];
    const factory = vi.fn((source: string) => createStructuralPlanningContext(source));
    const provider = createEphemeralStructuralPlanningContextProvider(
      factory,
      (expire) => {
        deferred.push(expire);
      }
    );
    return { deferred, factory, provider };
  }

  it('returns one context for repeated exact editor and source calls', () => {
    const { deferred, factory, provider } = createHarness();
    const editor = {};

    const first = provider(editor, '# One\n');
    const second = provider(editor, '# One\n');

    expect(second).toBe(first);
    expect(factory).toHaveBeenCalledExactlyOnceWith('# One\n');
    expect(deferred).toHaveLength(1);
  });

  it('immediately replaces the entry when the source changes', () => {
    const { deferred, factory, provider } = createHarness();
    const editor = {};

    const first = provider(editor, '# One\n');
    const second = provider(editor, '# Two\n');

    expect(second).not.toBe(first);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenNthCalledWith(2, '# Two\n');
    expect(deferred).toHaveLength(2);
  });

  it('immediately replaces the entry for another editor with identical source', () => {
    const { deferred, factory, provider } = createHarness();

    const first = provider({}, '# One\n');
    const second = provider({}, '# One\n');

    expect(second).not.toBe(first);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(deferred).toHaveLength(2);
  });

  it('builds a fresh context after expiry', () => {
    const { deferred, factory, provider } = createHarness();
    const editor = {};

    const first = provider(editor, '# One\n');
    deferred[0]?.();
    const second = provider(editor, '# One\n');

    expect(second).not.toBe(first);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('does not let an older generation expiry clear a newer entry', () => {
    const { deferred, factory, provider } = createHarness();
    const editor = {};

    provider(editor, '# One\n');
    const current = provider(editor, '# Two\n');
    deferred[0]?.();

    expect(provider(editor, '# Two\n')).toBe(current);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('does not cache factory exceptions', () => {
    const failure = new Error('parse failed');
    const deferred: (() => void)[] = [];
    const factory = vi.fn((source: string) => createStructuralPlanningContext(source));
    factory.mockImplementationOnce(() => {
      throw failure;
    });
    const provider = createEphemeralStructuralPlanningContextProvider(
      factory,
      (expire) => {
        deferred.push(expire);
      }
    );
    const editor = {};

    expect(() => provider(editor, '# One\n')).toThrow(failure);
    expect(provider(editor, '# One\n').source).toBe('# One\n');
    expect(factory).toHaveBeenCalledTimes(2);
    expect(deferred).toHaveLength(1);
  });

  it('retains only the latest entry', () => {
    const { factory, provider } = createHarness();
    const firstEditor = {};
    const secondEditor = {};

    const first = provider(firstEditor, '# One\n');
    provider(secondEditor, '# Two\n');
    const rebuilt = provider(firstEditor, '# One\n');

    expect(rebuilt).not.toBe(first);
    expect(factory).toHaveBeenCalledTimes(3);
  });
});

describe('structural planning context', () => {
  it('parses exactly once and derives sections from that structure', () => {
    const source = '# Root\n\n## Child\nBody\n';
    const structure = parseMarkdownStructure(source);
    const parse = vi.fn(() => structure);

    const context = createStructuralPlanningContext(source, parse);

    expect(parse).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledWith(source);
    expect(context).toEqual({
      sections: collectMarkdownSections(structure),
      source,
      structure
    });

    if (context.source !== source) {
      // @ts-expect-error -- Structural planning source is immutable.
      context.source = '';
      // @ts-expect-error -- Structural planning structure is immutable.
      context.structure = parseMarkdownStructure('');
      // @ts-expect-error -- Structural planning sections are immutable.
      context.sections = [];
      const [section] = context.sections;
      if (section !== undefined) {
        // @ts-expect-error -- Structural planning section collections are immutable.
        context.sections[0] = section;
      }
    }
  });

  it.each([
    {
      name: 'root source',
      source: '# Root\n\n## Child\nBody\n'
    },
    {
      name: 'quoted source',
      source: '> # Root\n>\n> ## Child\n> Body\n'
    },
    {
      name: 'protected source',
      source: '# Root\n\n```md\n## Protected\n```\n\n## Visible\n'
    },
    {
      name: 'CRLF source',
      source: '# Root\r\n\r\n## Child\r\nBody\r\n'
    },
    {
      name: 'empty source',
      source: ''
    }
  ])('matches direct parsing and section collection for $name', ({ source }) => {
    const structure = parseMarkdownStructure(source);

    expect(createStructuralPlanningContext(source)).toEqual({
      sections: collectMarkdownSections(structure),
      source,
      structure
    });
  });
});
