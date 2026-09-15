// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import { planContextualDeletionWithContext, planSectionDeletionWithContext } from '../src/deletion-planner.ts';
import { parseMarkdownStructure } from '../src/markdown-structure.ts';
import { isSectionExtractionAvailableWithContext } from '../src/section-extraction-availability.ts';
import { planSectionExtraction } from '../src/section-extraction-planner.ts';
import { planSectionHierarchyChangeWithContext } from '../src/section-hierarchy-planner.ts';
import { planSectionMovementWithContext } from '../src/section-movement-planner.ts';
import { planSectionNavigationWithContext } from '../src/section-navigation-planner.ts';
import {
  createEphemeralStructuralPlanningContextProvider,
  createStructuralPlanningContext
} from '../src/structural-planning-context.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible fixture imports compact.
import { createPercentCommentFixture, createPlanningFixture } from './structural-planning-performance-fixtures.ts';

interface FixtureOffsets {
  readonly blockquote: number;
  readonly callout: number;
  readonly fencedCode: number;
  readonly target: number;
}

const ASCII_MAX_CODE_POINT = 0x7F;
const CONTEXT_GENERATION_COUNT = 2;
const KIBIBYTE = 1024;
const LARGE_PLANNING_BYTES = KIBIBYTE * KIBIBYTE;
const PERCENT_BLOCK_COUNT = 64;
const PERCENT_DELIMITERS_PER_BLOCK = 2;
const SMALL_PLANNING_KIBIBYTES = 250;
const SMALL_PLANNING_BYTES = SMALL_PLANNING_KIBIBYTES * KIBIBYTE;
const PLANNING_SIZES = [SMALL_PLANNING_BYTES, LARGE_PLANNING_BYTES] as const;

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

function expectSharedWorkloadResults(
  getContext: () => ReturnType<typeof createStructuralPlanningContext>
): void {
  const source = getContext().source;
  const offsets = getFixtureOffsets(source);

  expect(
    planSectionNavigationWithContext(getContext(), offsets.target, 'parent')
  ).toEqual({ cursorOffset: source.indexOf('Planning fixture') });
  expect(
    planSectionNavigationWithContext(
      getContext(),
      offsets.target,
      'previous-sibling'
    )
  ).toEqual({ cursorOffset: source.indexOf('Flat alpha') });
  expect(
    planSectionNavigationWithContext(
      getContext(),
      offsets.target,
      'next-sibling'
    )
  ).toEqual({ cursorOffset: source.indexOf('Flat omega') });
  expect(
    planSectionNavigationWithContext(
      getContext(),
      offsets.target,
      'first-child'
    )
  ).toEqual({ cursorOffset: source.indexOf('Nested target child') });

  for (const mode of ['up', 'down', 'start', 'end'] as const) {
    expect(
      planSectionMovementWithContext(getContext(), offsets.target, {
        kind: 'move-section',
        mode
      })
    ).not.toBeNull();
  }
  for (const mode of ['promote', 'demote'] as const) {
    expect(
      planSectionHierarchyChangeWithContext(getContext(), offsets.target, {
        kind: 'change-section-hierarchy',
        mode
      })
    ).not.toBeNull();
  }
  expect(
    planContextualDeletionWithContext(
      getContext(),
      offsets.fencedCode,
      'fenced-code'
    )
  ).not.toBeNull();
  expect(
    planContextualDeletionWithContext(
      getContext(),
      offsets.callout,
      'callout'
    )
  ).not.toBeNull();
  expect(
    planContextualDeletionWithContext(
      getContext(),
      offsets.blockquote,
      'blockquote'
    )
  ).not.toBeNull();
  expect(
    planSectionDeletionWithContext(
      getContext(),
      offsets.target,
      'section'
    )
  ).not.toBeNull();
  expect(
    planSectionDeletionWithContext(
      getContext(),
      offsets.target,
      'section'
    )
  ).not.toBeNull();
  expect(
    isSectionExtractionAvailableWithContext(getContext(), offsets.target)
  ).toBe(true);
  expect(
    isSectionExtractionAvailableWithContext(getContext(), offsets.target)
  ).toBe(true);
}

function getFixtureOffsets(source: string): FixtureOffsets {
  return {
    blockquote: source.indexOf('blockquote cursor'),
    callout: source.indexOf('callout cursor'),
    fencedCode: source.indexOf('fenced cursor'),
    target: source.indexOf('planning target body')
  };
}

function isAscii(source: string): boolean {
  for (const character of source) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint > ASCII_MAX_CODE_POINT) {
      return false;
    }
  }
  return true;
}

describe('structural planning performance fixtures', () => {
  it.each(PLANNING_SIZES)(
    'creates a deterministic, exact %i-byte ASCII planning document',
    (byteLength) => {
      const first = createPlanningFixture(byteLength);
      const second = createPlanningFixture(byteLength);

      expect(first).toBe(second);
      expect(Buffer.byteLength(first, 'utf-8')).toBe(byteLength);
      expect(first).toHaveLength(byteLength);
      expect(isAscii(first)).toBe(true);
      expect(Buffer.from(first, 'utf-8').toString('utf-8')).toBe(first);
    }
  );

  it('creates flat, nested, protected, and actionable structures', () => {
    const source = createPlanningFixture(SMALL_PLANNING_BYTES);
    const structure = parseMarkdownStructure(source);
    const visibleHeadingLines = structure.headings.map((heading) => source.slice(heading.lineStart, heading.syntaxEnd));

    expect(visibleHeadingLines).toEqual(
      expect.arrayContaining([
        '# Planning fixture',
        '## Flat alpha',
        '## Planning target',
        '### Nested target child',
        '## Flat omega'
      ])
    );
    expect(visibleHeadingLines).not.toContain('# protected fenced heading');
    expect(visibleHeadingLines).not.toContain('# protected percent heading');
    expect(
      structure.blocks.some((block) => block.kind === 'fenced-code')
    ).toBe(true);
    expect(
      structure.blocks.some((block) => block.kind === 'callout')
    ).toBe(true);
    expect(
      structure.blocks.some((block) => block.kind === 'blockquote')
    ).toBe(true);
    expect(structure.protectedRanges.length).toBeGreaterThan(1);
    const context = createStructuralPlanningContext(source);
    expectSharedWorkloadResults(() => context);
    expect(
      planSectionExtraction(source, getFixtureOffsets(source).target).kind
    ).toBe('ready');
  });

  it('rejects a byte length that cannot hold the fixed planning scaffold', () => {
    expect(() => createPlanningFixture(1)).toThrow(RangeError);
  });

  it.each([
    PERCENT_BLOCK_COUNT,
    PERCENT_BLOCK_COUNT * PERCENT_DELIMITERS_PER_BLOCK
  ])(
    'creates exactly %i adversarial blocks and twice as many delimiters',
    (blockCount) => {
      const first = createPercentCommentFixture(blockCount);
      const second = createPercentCommentFixture(blockCount);
      const structure = parseMarkdownStructure(first);

      expect(first).toBe(second);
      expect(isAscii(first)).toBe(true);
      expect(countMatches(first, /^```text$/gmu)).toBe(blockCount);
      expect(countMatches(first, /^%%$/gmu)).toBe(
        blockCount * PERCENT_DELIMITERS_PER_BLOCK
      );
      expect(
        structure.blocks.filter((block) => block.kind === 'fenced-code')
      ).toHaveLength(blockCount);
      expect(structure.protectedRanges).toHaveLength(blockCount);
    }
  );
});

describe('structural planning parser calls', () => {
  it('parses once for every fresh context', () => {
    const source = createPlanningFixture(SMALL_PLANNING_BYTES);
    const parse = vi.fn(parseMarkdownStructure);

    createStructuralPlanningContext(source, parse);
    expect(parse).toHaveBeenCalledOnce();

    createStructuralPlanningContext(source, parse);
    expect(parse).toHaveBeenCalledTimes(CONTEXT_GENERATION_COUNT);
    expect(parse).toHaveBeenNthCalledWith(1, source);
    expect(parse).toHaveBeenNthCalledWith(CONTEXT_GENERATION_COUNT, source);
  });

  it('parses once across synchronous checks and once after expiry', () => {
    const source = createPlanningFixture(SMALL_PLANNING_BYTES);
    const deferred: (() => void)[] = [];
    const parse = vi.fn(parseMarkdownStructure);
    const provider = createEphemeralStructuralPlanningContextProvider(
      (currentSource) => createStructuralPlanningContext(currentSource, parse),
      (expire) => {
        deferred.push(expire);
      }
    );
    const editor = {};

    function getContext(): ReturnType<typeof createStructuralPlanningContext> {
      return provider(editor, source);
    }
    const context = getContext();
    expectSharedWorkloadResults(getContext);
    expect(getContext()).toBe(context);
    expect(parse).toHaveBeenCalledOnce();

    deferred[0]?.();
    expect(provider(editor, source)).not.toBe(context);
    expect(parse).toHaveBeenCalledTimes(CONTEXT_GENERATION_COUNT);
  });
});
