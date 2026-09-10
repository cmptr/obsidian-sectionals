// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible structure type imports compact.
import type { HeadingLevel, MarkdownHeading, MarkdownRange } from './markdown-structure.ts';

export interface HeadingLevelRewrite {
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- Preserve the approved callable-property API.
  readonly mapOffset: (offset: number) => number;
  readonly range: MarkdownRange;
  readonly replacement: string;
}

interface CopiedSpan {
  readonly replacementFrom: number;
  readonly sourceRange: MarkdownRange;
}

interface HeadingPhysicalSyntax {
  readonly finalLineEndingRange: MarkdownRange;
  readonly range: MarkdownRange;
}

const CRLF_LENGTH = 2;
const MAX_HEADING_LEVEL = 6;
const MAX_SETEXT_HEADING_LEVEL = 2;
const MIN_HEADING_LEVEL = 1;

export function planHeadingLevelRewrite(
  source: string,
  heading: MarkdownHeading,
  targetLevel: HeadingLevel
): HeadingLevelRewrite {
  assertTargetLevel(targetLevel);
  const physicalSyntax = validateHeading(source, heading);

  if (heading.syntax.kind === 'atx') {
    return createMarkerRewrite(
      physicalSyntax.range,
      heading.syntax.openingMarkerRange,
      '#'.repeat(targetLevel)
    );
  }

  if (targetLevel <= MAX_SETEXT_HEADING_LEVEL) {
    return createMarkerRewrite(
      physicalSyntax.range,
      heading.syntax.underlineMarkerRange,
      (targetLevel === MIN_HEADING_LEVEL ? '=' : '-').repeat(
        heading.syntax.underlineMarkerRange.to
          - heading.syntax.underlineMarkerRange.from
      )
    );
  }

  return createSetextToAtxRewrite(
    source,
    heading,
    targetLevel,
    physicalSyntax
  );
}

function assertGeneralHeadingRanges(
  source: string,
  heading: MarkdownHeading
): void {
  if (
    !Number.isSafeInteger(heading.lineStart)
    || !Number.isSafeInteger(heading.syntaxStart)
    || !Number.isSafeInteger(heading.syntaxEnd)
    || heading.lineStart < 0
    || heading.lineStart > heading.syntaxStart
    || heading.syntaxStart > heading.syntaxEnd
    || heading.syntaxEnd > source.length
    || (heading.lineStart > 0 && source[heading.lineStart - 1] !== '\n')
  ) {
    throwHeadingSourceTypeError();
  }

  const lineEnding = getLineEndingAt(source, heading.syntaxEnd);
  if (lineEnding === '' && heading.syntaxEnd !== source.length) {
    throwHeadingSourceTypeError();
  }
}

function assertTargetLevel(targetLevel: number): asserts targetLevel is HeadingLevel {
  if (
    !Number.isSafeInteger(targetLevel)
    || targetLevel < MIN_HEADING_LEVEL
    || targetLevel > MAX_HEADING_LEVEL
  ) {
    throw new RangeError('Heading level must be an integer from 1 through 6');
  }
}

function createBoundedOffsetMap(
  range: MarkdownRange,
  mapOffset: (offset: number) => number
): (offset: number) => number {
  return (offset) => {
    if (
      !Number.isSafeInteger(offset)
      || offset < range.from
      || offset > range.to
    ) {
      throw new RangeError('Offset is outside the heading rewrite range');
    }
    return mapOffset(offset);
  };
}

function createMarkerRewrite(
  physicalRange: MarkdownRange,
  markerRange: MarkdownRange,
  replacement: string
): HeadingLevelRewrite {
  const delta = replacement.length - (markerRange.to - markerRange.from);
  return {
    mapOffset: createBoundedOffsetMap(physicalRange, (offset) => {
      if (offset < markerRange.from) {
        return offset;
      }
      if (offset < markerRange.to) {
        return markerRange.from + Math.min(
          offset - markerRange.from,
          replacement.length
        );
      }
      if (offset === markerRange.to) {
        return markerRange.from + replacement.length;
      }
      return offset + delta;
    }),
    range: markerRange,
    replacement
  };
}

function createSetextToAtxRewrite(
  source: string,
  heading: MarkdownHeading,
  targetLevel: HeadingLevel,
  physicalSyntax: HeadingPhysicalSyntax
): HeadingLevelRewrite {
  if (heading.syntax.kind !== 'setext') {
    throwHeadingSourceTypeError();
  }

  const copiedSpans: CopiedSpan[] = [];
  let replacement = '';
  function appendCopiedSpan(sourceRange: MarkdownRange): void {
    if (sourceRange.from === sourceRange.to) {
      return;
    }
    copiedSpans.push({
      replacementFrom: replacement.length,
      sourceRange
    });
    replacement += source.slice(sourceRange.from, sourceRange.to);
  }

  const firstTitleRange = heading.syntax.titleRanges[0];
  if (firstTitleRange === undefined) {
    throwHeadingSourceTypeError();
  }
  appendCopiedSpan({
    from: heading.lineStart,
    to: firstTitleRange.from
  });
  replacement += `${'#'.repeat(targetLevel)} `;

  let hasTitleSegment = false;
  for (const titleRange of heading.syntax.titleRanges) {
    const retainedRange = getTrimmedRange(source, titleRange);
    if (retainedRange === null) {
      continue;
    }
    if (hasTitleSegment) {
      replacement += ' ';
    }
    appendCopiedSpan(retainedRange);
    hasTitleSegment = true;
  }
  appendCopiedSpan(physicalSyntax.finalLineEndingRange);

  return {
    mapOffset: createBoundedOffsetMap(
      physicalSyntax.range,
      (offset) =>
        mapSetextToAtxOffset(
          offset,
          physicalSyntax.range,
          replacement.length,
          copiedSpans
        )
    ),
    range: physicalSyntax.range,
    replacement
  };
}

function getLineEndingAt(
  source: string,
  lineEnd: number
): '' | '\n' | '\r\n' {
  if (source.slice(lineEnd, lineEnd + CRLF_LENGTH) === '\r\n') {
    return '\r\n';
  }
  return source[lineEnd] === '\n' ? '\n' : '';
}

function getTrimmedRange(
  source: string,
  range: MarkdownRange
): MarkdownRange | null {
  let from = range.from;
  while (from < range.to && isAsciiMarkdownPadding(source[from])) {
    from += 1;
  }

  let to = range.to;
  while (to > from && isAsciiMarkdownPadding(source[to - 1])) {
    to -= 1;
  }

  return from === to ? null : { from, to };
}

function isAsciiMarkdownPadding(character: string | undefined): boolean {
  return character === ' ' || character === '\t';
}

function isRangeWithinSource(range: MarkdownRange, sourceLength: number): boolean {
  return Number.isSafeInteger(range.from)
    && Number.isSafeInteger(range.to)
    && range.from >= 0
    && range.from <= range.to
    && range.to <= sourceLength;
}

function mapRemovedOffsetToNearestBoundary(
  offset: number,
  previousSourceBoundary: number,
  previousReplacementBoundary: number,
  nextSourceBoundary: number,
  nextReplacementBoundary: number
): number {
  return offset - previousSourceBoundary <= nextSourceBoundary - offset
    ? previousReplacementBoundary
    : nextReplacementBoundary;
}

function mapSetextToAtxOffset(
  offset: number,
  physicalRange: MarkdownRange,
  replacementLength: number,
  copiedSpans: readonly CopiedSpan[]
): number {
  let previousSourceBoundary = physicalRange.from;
  let previousReplacementBoundary = physicalRange.from;

  for (const copiedSpan of copiedSpans) {
    const replacementFrom = physicalRange.from + copiedSpan.replacementFrom;
    if (offset < copiedSpan.sourceRange.from) {
      return mapRemovedOffsetToNearestBoundary(
        offset,
        previousSourceBoundary,
        previousReplacementBoundary,
        copiedSpan.sourceRange.from,
        replacementFrom
      );
    }
    if (offset < copiedSpan.sourceRange.to) {
      return replacementFrom + offset - copiedSpan.sourceRange.from;
    }
    previousSourceBoundary = copiedSpan.sourceRange.to;
    previousReplacementBoundary = replacementFrom
      + copiedSpan.sourceRange.to
      - copiedSpan.sourceRange.from;
  }

  return mapRemovedOffsetToNearestBoundary(
    offset,
    previousSourceBoundary,
    previousReplacementBoundary,
    physicalRange.to,
    physicalRange.from + replacementLength
  );
}

function throwHeadingSourceTypeError(): never {
  throw new TypeError('Heading ranges do not belong to source');
}

function validateAtxHeading(source: string, heading: MarkdownHeading): void {
  if (heading.syntax.kind !== 'atx') {
    throwHeadingSourceTypeError();
  }
  const markerRange = heading.syntax.openingMarkerRange;
  if (
    !isRangeWithinSource(markerRange, source.length)
    || markerRange.from !== heading.syntaxStart
    || markerRange.to > heading.syntaxEnd
    || source.slice(markerRange.from, markerRange.to) !== '#'.repeat(heading.level)
  ) {
    throwHeadingSourceTypeError();
  }
}

function validateHeading(
  source: string,
  heading: MarkdownHeading
): HeadingPhysicalSyntax {
  assertGeneralHeadingRanges(source, heading);
  const lineEnding = getLineEndingAt(source, heading.syntaxEnd);
  const finalLineEndingRange = {
    from: heading.syntaxEnd,
    to: heading.syntaxEnd + lineEnding.length
  };
  const physicalSyntax = {
    finalLineEndingRange,
    range: { from: heading.lineStart, to: finalLineEndingRange.to }
  };

  if (heading.syntax.kind === 'atx') {
    validateAtxHeading(source, heading);
  } else {
    validateSetextHeading(source, heading, lineEnding);
  }
  return physicalSyntax;
}

function validateSetextHeading(
  source: string,
  heading: MarkdownHeading,
  lineEnding: '' | '\n' | '\r\n'
): void {
  if (
    heading.syntax.kind !== 'setext'
    || (heading.level !== MIN_HEADING_LEVEL
      && heading.level !== MAX_SETEXT_HEADING_LEVEL)
    || heading.syntax.lineEnding !== lineEnding
    || heading.syntax.titleRanges.length === 0
  ) {
    throwHeadingSourceTypeError();
  }

  const { titleRanges, underlineMarkerRange } = heading.syntax;
  const firstTitleRange = titleRanges[0];
  if (firstTitleRange === undefined) {
    throwHeadingSourceTypeError();
  }
  if (
    firstTitleRange.from !== heading.syntaxStart
    || source.slice(heading.lineStart, firstTitleRange.from)
      !== heading.syntax.linePrefix
    || !isRangeWithinSource(underlineMarkerRange, source.length)
    || underlineMarkerRange.to > heading.syntaxEnd
  ) {
    throwHeadingSourceTypeError();
  }

  validateSetextTitleRanges(
    source,
    heading.lineStart,
    titleRanges,
    underlineMarkerRange
  );

  const markerCharacter = heading.level === MIN_HEADING_LEVEL ? '=' : '-';
  const marker = source.slice(
    underlineMarkerRange.from,
    underlineMarkerRange.to
  );
  const trailingSyntax = source.slice(
    underlineMarkerRange.to,
    heading.syntaxEnd
  );
  if (
    marker === ''
    || marker !== markerCharacter.repeat(marker.length)
    || !/^[\t ]*$/u.test(trailingSyntax)
  ) {
    throwHeadingSourceTypeError();
  }
}

function validateSetextTitleRanges(
  source: string,
  lineStart: number,
  titleRanges: readonly MarkdownRange[],
  underlineMarkerRange: MarkdownRange
): void {
  let previousRangeEnd = lineStart;
  for (const titleRange of titleRanges) {
    const title = source.slice(titleRange.from, titleRange.to);
    if (
      !isRangeWithinSource(titleRange, source.length)
      || titleRange.from < previousRangeEnd
      || titleRange.to >= underlineMarkerRange.from
      || title.includes('\n')
      || title.includes('\r')
    ) {
      throwHeadingSourceTypeError();
    }
    previousRangeEnd = titleRange.to;
  }
}
