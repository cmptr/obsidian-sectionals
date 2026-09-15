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

const MAX_HEADING_LEVEL = 6;
const MAX_SETEXT_HEADING_LEVEL = 2;
const MIN_HEADING_LEVEL = 1;

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

function areSetextTitleRangesValid(
  source: string,
  heading: MarkdownHeading,
  titleRanges: readonly MarkdownRange[],
  underlineMarkerRange: MarkdownRange
): boolean {
  let previousRangeEnd = heading.lineStart;
  for (const titleRange of titleRanges) {
    const title = source.slice(titleRange.from, titleRange.to);
    if (
      !isRangeWithinHeading(source, heading, titleRange)
      || titleRange.from < previousRangeEnd
      || titleRange.to >= underlineMarkerRange.from
      || title.includes('\n')
      || title.includes('\r')
    ) {
      return false;
    }
    previousRangeEnd = titleRange.to;
  }
  return true;
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
    !Number.isSafeInteger(heading.level)
    || heading.level < MIN_HEADING_LEVEL
    || heading.level > MAX_HEADING_LEVEL
    || !isRangeWithinHeading(source, heading, marker)
    || marker.from !== heading.syntaxStart
    || source.slice(marker.from, marker.to) !== '#'.repeat(heading.level)
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
  if (
    heading.syntax.kind !== 'setext'
    || !isSetextHeadingValid(source, heading)
  ) {
    return null;
  }

  for (const range of heading.syntax.titleRanges) {
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
  return Number.isSafeInteger(heading.lineStart)
    && Number.isSafeInteger(heading.syntaxStart)
    && Number.isSafeInteger(heading.syntaxEnd)
    && heading.lineStart >= 0
    && heading.lineStart <= heading.syntaxStart
    && heading.syntaxStart <= heading.syntaxEnd
    && heading.syntaxEnd <= source.length
    && (heading.lineStart === 0 || source[heading.lineStart - 1] === '\n')
    && (
      heading.syntaxEnd === source.length
      || source[heading.syntaxEnd] === '\n'
      || source.startsWith('\r\n', heading.syntaxEnd)
    );
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

function isSetextHeadingValid(
  source: string,
  heading: MarkdownHeading
): boolean {
  if (
    heading.syntax.kind !== 'setext'
    || (
      heading.level !== MIN_HEADING_LEVEL
      && heading.level !== MAX_SETEXT_HEADING_LEVEL
    )
    || heading.syntax.titleRanges.length === 0
  ) {
    return false;
  }

  const { titleRanges, underlineMarkerRange } = heading.syntax;
  const firstTitleRange = titleRanges[0];
  if (
    firstTitleRange === undefined
    || (
      heading.syntax.lineEnding === ''
        ? heading.syntaxEnd !== source.length
        : !source.startsWith(heading.syntax.lineEnding, heading.syntaxEnd)
    )
    || firstTitleRange.from !== heading.syntaxStart
    || source.slice(heading.lineStart, firstTitleRange.from)
      !== heading.syntax.linePrefix
    || !isRangeWithinHeading(source, heading, underlineMarkerRange)
    || !areSetextTitleRangesValid(
      source,
      heading,
      titleRanges,
      underlineMarkerRange
    )
  ) {
    return false;
  }

  const markerCharacter = heading.level === MIN_HEADING_LEVEL ? '=' : '-';
  const marker = source.slice(
    underlineMarkerRange.from,
    underlineMarkerRange.to
  );
  const trailingSyntax = source.slice(
    underlineMarkerRange.to,
    heading.syntaxEnd
  );
  return marker !== ''
    && marker === markerCharacter.repeat(marker.length)
    && /^[\t ]*$/u.test(trailingSyntax);
}
