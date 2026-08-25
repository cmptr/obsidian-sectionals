import type { MarkdownHeading } from './markdown-structure.ts';

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
  const candidates = headings.filter((heading) =>
    containsCursor(
      sourceLength,
      heading.lineStart,
      getLogicalEnd(headings, heading),
      cursor
    )
  );

  candidates.sort(
    (left, right) =>
      right.container.depth - left.container.depth
      || right.lineStart - left.lineStart
  );
  return candidates[0] ?? null;
}

function getLogicalEnd(
  headings: readonly MarkdownHeading[],
  heading: MarkdownHeading
): number {
  return (
    findBoundary(headings, heading, 'section')?.lineStart
      ?? heading.container.end
  );
}
