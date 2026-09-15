// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible type imports compact.
import type { MarkdownHeading, MarkdownRange } from './markdown-structure.ts';
import type { MarkdownSection } from './section-query.ts';
import type { StructuralPlanningContext } from './structural-planning-context.ts';

import {
  findFirstChildSection,
  findMarkdownSection,
  findNextSiblingSection,
  findParentSection,
  findPreviousSiblingSection
} from './section-query.ts';
import { createStructuralPlanningContext } from './structural-planning-context.ts';

export type SectionNavigationMode =
  | 'first-child'
  | 'next-sibling'
  | 'parent'
  | 'previous-sibling';

export interface SectionNavigationPlan {
  readonly cursorOffset: number;
}

export function planSectionNavigation(
  source: string,
  cursorOffset: number,
  mode: SectionNavigationMode
): null | SectionNavigationPlan {
  return planSectionNavigationWithContext(
    createStructuralPlanningContext(source),
    cursorOffset,
    mode
  );
}

export function planSectionNavigationWithContext(
  context: StructuralPlanningContext,
  cursorOffset: number,
  mode: SectionNavigationMode
): null | SectionNavigationPlan {
  const { sections, source } = context;
  const target = findMarkdownSection(source.length, sections, cursorOffset);
  if (target === null) {
    return null;
  }

  const destination = findNavigationDestination(sections, target, mode);
  if (destination === null) {
    return null;
  }

  const destinationOffset = findHeadingTitleOffset(
    source,
    destination.heading
  );
  return destinationOffset === null ? null : { cursorOffset: destinationOffset };
}

function findAtxTitleOffset(
  source: string,
  heading: MarkdownHeading
): null | number {
  if (heading.syntax.kind !== 'atx') {
    return null;
  }

  const marker = heading.syntax.openingMarkerRange;
  if (
    !isRangeWithinHeading(source, heading, marker)
    || marker.from !== heading.syntaxStart
    || marker.from === marker.to
    || !/^#+$/u.test(source.slice(marker.from, marker.to))
  ) {
    return null;
  }

  let titleOffset = marker.to;
  while (
    titleOffset < heading.syntaxEnd
    && (source[titleOffset] === ' ' || source[titleOffset] === '\t')
  ) {
    titleOffset += 1;
  }
  let contentEnd = heading.syntaxEnd;
  while (
    contentEnd > titleOffset
    && (source[contentEnd - 1] === ' ' || source[contentEnd - 1] === '\t')
  ) {
    contentEnd -= 1;
  }
  if (
    titleOffset === contentEnd
    || /^#+$/u.test(source.slice(titleOffset, contentEnd))
  ) {
    return marker.to;
  }

  return isOffsetWithinHeading(source, heading, titleOffset)
    ? titleOffset
    : null;
}

function findHeadingTitleOffset(
  source: string,
  heading: MarkdownHeading
): null | number {
  if (!isHeadingSyntaxRangeSafe(source, heading)) {
    return null;
  }

  switch (heading.syntax.kind) {
    case 'atx': {
      return findAtxTitleOffset(source, heading);
    }
    case 'setext': {
      return findSetextTitleOffset(source, heading);
    }
    default: {
      heading.syntax satisfies never;
      return null;
    }
  }
}

function findNavigationDestination(
  sections: readonly MarkdownSection[],
  target: MarkdownSection,
  mode: SectionNavigationMode
): MarkdownSection | null {
  switch (mode) {
    case 'first-child': {
      return findFirstChildSection(sections, target);
    }
    case 'next-sibling': {
      return findNextSiblingSection(sections, target);
    }
    case 'parent': {
      return findParentSection(sections, target);
    }
    case 'previous-sibling': {
      return findPreviousSiblingSection(sections, target);
    }
    default: {
      mode satisfies never;
      return null;
    }
  }
}

function findSetextTitleOffset(
  source: string,
  heading: MarkdownHeading
): null | number {
  if (heading.syntax.kind !== 'setext') {
    return null;
  }

  const { titleRanges, underlineMarkerRange } = heading.syntax;
  if (
    titleRanges.length === 0
    || !isRangeWithinHeading(source, heading, underlineMarkerRange)
    || titleRanges.some((range, index) =>
      !isRangeWithinHeading(source, heading, range)
      || source.slice(range.from, range.to).includes('\n')
      || source.slice(range.from, range.to).includes('\r')
      || range.to > underlineMarkerRange.from
      || (index > 0 && range.from < (titleRanges[index - 1]?.to ?? 0))
    )
  ) {
    return null;
  }

  for (const range of titleRanges) {
    for (let offset = range.from; offset < range.to; offset += 1) {
      if (source[offset] !== ' ' && source[offset] !== '\t') {
        return offset;
      }
    }
  }
  return null;
}

function isHeadingSyntaxRangeSafe(
  source: string,
  heading: MarkdownHeading
): boolean {
  return Number.isSafeInteger(heading.syntaxStart)
    && Number.isSafeInteger(heading.syntaxEnd)
    && heading.syntaxStart >= 0
    && heading.syntaxStart <= heading.syntaxEnd
    && heading.syntaxEnd <= source.length;
}

function isOffsetWithinHeading(
  source: string,
  heading: MarkdownHeading,
  offset: number
): boolean {
  return Number.isSafeInteger(offset)
    && heading.syntaxStart <= offset
    && offset <= heading.syntaxEnd
    && offset <= source.length;
}

function isRangeWithinHeading(
  source: string,
  heading: MarkdownHeading,
  range: MarkdownRange
): boolean {
  return Number.isSafeInteger(range.from)
    && Number.isSafeInteger(range.to)
    && range.from <= range.to
    && isOffsetWithinHeading(source, heading, range.from)
    && isOffsetWithinHeading(source, heading, range.to);
}
