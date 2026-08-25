// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible type imports compact.
import type { HeadingLevel, MarkdownHeading } from './markdown-structure.ts';

import { parseMarkdownStructure } from './markdown-structure.ts';

export type DeletionMode = 'heading-block' | 'section';

export interface DeletionRange {
  readonly from: number;
  readonly to: number;
}

export function planSectionDeletion(
  source: string,
  cursorOffset: number,
  mode: DeletionMode
): DeletionRange | null {
  if (
    !Number.isSafeInteger(cursorOffset)
    || cursorOffset < 0
    || cursorOffset > source.length
  ) {
    return null;
  }

  const { headings } = parseMarkdownStructure(source);
  const target = findTarget(source.length, headings, cursorOffset);
  if (target === null) {
    return null;
  }

  const boundary = findBoundary(headings, target, mode);
  const range = {
    from: target.lineStart,
    to: boundary?.lineStart ?? target.container.end
  };

  if (
    range.from < 0
    || range.from >= range.to
    || range.to > source.length
    || range.to > target.container.end
  ) {
    return null;
  }
  return range;
}

function computeLogicalEnds(
  headings: readonly MarkdownHeading[]
): ReadonlyMap<MarkdownHeading, number> {
  const logicalEnds = new Map<MarkdownHeading, number>();
  const nextStartsByContainer = new Map<string, Map<HeadingLevel, number>>();

  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const heading = headings[index];
    if (heading === undefined) {
      continue;
    }

    let nextStartsByLevel = nextStartsByContainer.get(heading.container.id);
    if (nextStartsByLevel === undefined) {
      nextStartsByLevel = new Map<HeadingLevel, number>();
      nextStartsByContainer.set(heading.container.id, nextStartsByLevel);
    }

    let logicalEnd = heading.container.end;
    for (const [level, nextLineStart] of nextStartsByLevel) {
      if (level <= heading.level && nextLineStart < logicalEnd) {
        logicalEnd = nextLineStart;
      }
    }

    logicalEnds.set(heading, logicalEnd);
    nextStartsByLevel.set(heading.level, heading.lineStart);
  }

  return logicalEnds;
}

function containsCursor(
  sourceLength: number,
  start: number,
  end: number,
  cursor: number
): boolean {
  return (
    start <= cursor
    && (cursor < end || (cursor === sourceLength && end === sourceLength))
  );
}

function findBoundary(
  headings: readonly MarkdownHeading[],
  target: MarkdownHeading,
  mode: DeletionMode
): MarkdownHeading | null {
  return (
    headings.find(
      (heading) =>
        heading.lineStart > target.lineStart
        && heading.container.id === target.container.id
        && (mode === 'heading-block' || heading.level <= target.level)
    ) ?? null
  );
}

function findTarget(
  sourceLength: number,
  headings: readonly MarkdownHeading[],
  cursor: number
): MarkdownHeading | null {
  const logicalEnds = computeLogicalEnds(headings);
  let target: MarkdownHeading | null = null;

  for (const heading of headings) {
    const logicalEnd = logicalEnds.get(heading) ?? heading.container.end;
    if (!containsCursor(sourceLength, heading.lineStart, logicalEnd, cursor)) {
      continue;
    }

    if (
      target === null
      || heading.container.depth > target.container.depth
      || (heading.container.depth === target.container.depth
        && heading.lineStart > target.lineStart)
    ) {
      target = heading;
    }
  }

  return target;
}
