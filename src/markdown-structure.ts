import { parser } from '@lezer/markdown';

// eslint-disable-next-line no-magic-numbers -- Markdown defines exactly six numeric heading levels.
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface MarkdownBlock {
  readonly depth: number;
  readonly end: number;
  readonly kind: MarkdownBlockKind;
  readonly start: number;
}

export type MarkdownBlockKind = 'blockquote' | 'callout' | 'fenced-code';

export interface MarkdownContainer {
  readonly depth: number;
  readonly end: number;
  readonly id: string;
  readonly start: number;
}

export interface MarkdownHeading {
  readonly container: MarkdownContainer;
  readonly level: HeadingLevel;
  readonly lineStart: number;
  readonly syntax: MarkdownHeadingSyntax;
  readonly syntaxEnd: number;
  readonly syntaxStart: number;
}

export type MarkdownHeadingSyntax =
  // eslint-disable-next-line no-restricted-syntax -- The approved parser API uses a compact discriminated union.
  | {
    readonly kind: 'atx';
    readonly openingMarkerRange: MarkdownRange;
  }
  // eslint-disable-next-line no-restricted-syntax -- The approved parser API uses a compact discriminated union.
  | {
    readonly kind: 'setext';
    readonly lineEnding: '' | '\n' | '\r\n';
    readonly linePrefix: string;
    readonly titleRanges: readonly MarkdownRange[];
    readonly underlineMarkerRange: MarkdownRange;
  };

export interface MarkdownRange {
  readonly from: number;
  readonly to: number;
}

export interface MarkdownStructure {
  readonly blocks: readonly MarkdownBlock[];
  readonly containers: readonly MarkdownContainer[];
  readonly headings: readonly MarkdownHeading[];
  readonly protectedRanges: readonly MarkdownRange[];
}

interface MarkdownNode {
  readonly from: number;
  readonly name: string;
  readonly to: number;
}

interface MarkdownStructureWorkObserver {
  onBlockRangeVisit?(this: void): void;
  onHeadingRangeVisit?(this: void): void;
}

/* eslint-disable no-magic-numbers -- Markdown heading node names map to specification-defined levels. */
const HEADING_LEVEL_BY_NODE: Readonly<Record<string, HeadingLevel>> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2
};
/* eslint-enable no-magic-numbers -- Re-enable the rule outside the specification-defined mapping. */

const BLOCK_IGNORED_NODE_NAMES = new Set(['Comment', 'CommentBlock']);
const CRLF_LENGTH = 2;
const DELIMITER_IGNORED_NODE_NAMES = new Set([
  'CodeBlock',
  'Comment',
  'CommentBlock',
  'FencedCode',
  'InlineCode'
]);
const MAX_MARKDOWN_INDENTATION_SPACES = 3;
const PERCENT_COMMENT_DELIMITER = '%%';
const SETEXT_HEADING_LEVEL_ONE: HeadingLevel = 1;

export function excludeOffsetsInRanges(
  orderedOffsets: readonly number[],
  ranges: readonly MarkdownRange[],
  onRangeVisit?: () => void
): readonly number[] {
  return excludeOrderedItemsInRanges(
    orderedOffsets,
    ranges,
    (offset) => offset,
    onRangeVisit
  );
}

export function parseMarkdownStructure(
  source: string,
  workObserver?: MarkdownStructureWorkObserver
): MarkdownStructure {
  const root: MarkdownContainer = {
    depth: 0,
    end: source.length,
    id: 'root',
    start: 0
  };
  const blocks: MarkdownBlock[] = [];
  const containers: MarkdownContainer[] = [root];
  const headings: MarkdownHeading[] = [];
  const containerStack: MarkdownContainer[] = [root];
  const blockIgnoredRanges: MarkdownRange[] = [];
  const delimiterIgnoredRanges: MarkdownRange[] = [];

  parser.parse(source).iterate({
    enter(node) {
      if (DELIMITER_IGNORED_NODE_NAMES.has(node.name)) {
        const range = { from: node.from, to: node.to };
        delimiterIgnoredRanges.push(range);
        if (BLOCK_IGNORED_NODE_NAMES.has(node.name)) {
          blockIgnoredRanges.push(range);
        }
      }

      if (node.name === 'Blockquote') {
        const container = createContainer(source, node, containerStack.length);
        blocks.push({
          depth: container.depth,
          end: container.end,
          kind: isCallout(source, node) ? 'callout' : 'blockquote',
          start: container.start
        });
        containers.push(container);
        containerStack.push(container);
      } else if (node.name === 'FencedCode') {
        blocks.push({
          depth: containerStack.length - 1,
          end: getLineEndIncludingBreak(source, node.to),
          kind: 'fenced-code',
          start: getLineStart(source, node.from)
        });
      }

      const level = HEADING_LEVEL_BY_NODE[node.name];
      if (level !== undefined) {
        const lineStart = getHeadingLineStart(source, node);
        const syntaxEnd = getHeadingSyntaxEnd(source, node.to);
        headings.push({
          container: containerStack.at(-1) ?? root,
          level,
          lineStart,
          syntax: getHeadingSyntax(source, node, level, lineStart, syntaxEnd),
          syntaxEnd,
          syntaxStart: node.from
        });
      }
    },
    leave(node) {
      if (node.name === 'Blockquote') {
        containerStack.pop();
      }
    }
  });

  const frontmatterRange = findFrontmatterRange(source);
  const blockIgnoredRangesWithFrontmatter = frontmatterRange === null
    ? blockIgnoredRanges
    : [...blockIgnoredRanges, frontmatterRange];
  const delimiterIgnoredRangesWithFrontmatter = frontmatterRange === null
    ? delimiterIgnoredRanges
    : [...delimiterIgnoredRanges, frontmatterRange];
  const percentCommentRanges = findPercentCommentRanges(
    source,
    delimiterIgnoredRangesWithFrontmatter
  );
  const blockProtectedRanges = [
    ...blockIgnoredRangesWithFrontmatter,
    ...percentCommentRanges
  ];
  const protectedRanges = [
    ...delimiterIgnoredRangesWithFrontmatter,
    ...percentCommentRanges
  ];

  return {
    blocks: excludeOrderedItemsInRanges(
      blocks,
      blockProtectedRanges,
      (block) => block.start,
      workObserver?.onBlockRangeVisit
    ),
    containers,
    headings: excludeOrderedItemsInRanges(
      headings,
      protectedRanges,
      (heading) => heading.syntaxStart,
      workObserver?.onHeadingRangeVisit
    ),
    protectedRanges: blockProtectedRanges
  };
}

function containsOffset(range: MarkdownRange, offset: number): boolean {
  return range.from <= offset && offset < range.to;
}

function createContainer(
  source: string,
  node: MarkdownNode,
  depth: number
): MarkdownContainer {
  return {
    depth,
    end: getLineEndIncludingBreak(source, node.to),
    id: `blockquote:${String(node.from)}:${String(node.to)}`,
    start: getLineStart(source, node.from)
  };
}

function excludeOrderedItemsInRanges<T>(
  orderedItems: readonly T[],
  ranges: readonly MarkdownRange[],
  getOffset: (item: T) => number,
  onRangeVisit?: () => void
): readonly T[] {
  const mergedRanges = sortAndMergeRanges(ranges);
  const outsideItems: T[] = [];
  let rangeIndex = 0;
  for (const item of orderedItems) {
    const offset = getOffset(item);
    while (rangeIndex < mergedRanges.length) {
      const currentRange = mergedRanges[rangeIndex];
      if (currentRange === undefined) {
        break;
      }
      onRangeVisit?.();
      if (currentRange.to > offset) {
        break;
      }
      rangeIndex += 1;
    }
    const range = mergedRanges[rangeIndex];
    if (range === undefined || !containsOffset(range, offset)) {
      outsideItems.push(item);
    }
  }
  return outsideItems;
}

function findFrontmatterRange(source: string): MarkdownRange | null {
  const contentStart = source.startsWith('\u{FEFF}') ? 1 : 0;
  const firstLineEnd = source.indexOf('\n', contentStart);
  const firstLine = source
    .slice(contentStart, firstLineEnd === -1 ? source.length : firstLineEnd)
    .replace(/\r$/, '');
  if (firstLine !== '---') {
    return null;
  }

  let lineStart = firstLineEnd === -1 ? source.length : firstLineEnd + 1;
  while (lineStart < source.length) {
    const lineEnd = source.indexOf('\n', lineStart);
    const line = source
      .slice(lineStart, lineEnd === -1 ? source.length : lineEnd)
      .replace(/\r$/, '');
    if (line === '---' || line === '...') {
      return {
        from: 0,
        to: lineEnd === -1 ? source.length : lineEnd + 1
      };
    }
    lineStart = lineEnd === -1 ? source.length : lineEnd + 1;
  }

  return { from: 0, to: source.length };
}

function findPercentCommentRanges(
  source: string,
  delimiterIgnoredRanges: readonly MarkdownRange[]
): MarkdownRange[] {
  const delimiterOffsets: number[] = [];
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const delimiter = source.indexOf(PERCENT_COMMENT_DELIMITER, searchFrom);
    if (delimiter === -1) {
      break;
    }
    delimiterOffsets.push(delimiter);
    searchFrom = delimiter + PERCENT_COMMENT_DELIMITER.length;
  }

  const ranges: MarkdownRange[] = [];
  let open: null | number = null;
  for (
    const delimiter of excludeOffsetsInRanges(
      delimiterOffsets,
      delimiterIgnoredRanges
    )
  ) {
    if (open === null) {
      open = delimiter;
    } else {
      ranges.push({
        from: open,
        to: delimiter + PERCENT_COMMENT_DELIMITER.length
      });
      open = null;
    }
  }

  if (open !== null) {
    ranges.push({ from: open, to: source.length });
  }
  return ranges;
}

function findSetextUnderlineMarkerRange(
  source: string,
  lineStart: number,
  lineEnd: number,
  markerCharacter: '-' | '='
): MarkdownRange {
  let from = lineStart;
  while (from < lineEnd && source[from] !== markerCharacter) {
    from += 1;
  }
  let to = from;
  while (to < lineEnd && source[to] === markerCharacter) {
    to += 1;
  }
  return { from, to };
}

function getHeadingLineStart(source: string, node: MarkdownNode): number {
  return getLineStart(source, node.from);
}

function getHeadingSyntax(
  source: string,
  node: MarkdownNode,
  level: HeadingLevel,
  lineStart: number,
  syntaxEnd: number
): MarkdownHeadingSyntax {
  if (node.name.startsWith('ATXHeading')) {
    return {
      kind: 'atx',
      openingMarkerRange: { from: node.from, to: node.from + level }
    };
  }

  const underlineLineStart = getLineStart(source, syntaxEnd);
  const markerCharacter = level === SETEXT_HEADING_LEVEL_ONE ? '=' : '-';
  const underlineMarkerRange = findSetextUnderlineMarkerRange(
    source,
    underlineLineStart,
    syntaxEnd,
    markerCharacter
  );
  return {
    kind: 'setext',
    lineEnding: getLineEndingAt(source, syntaxEnd),
    linePrefix: source.slice(lineStart, node.from),
    titleRanges: getSetextTitleRanges(
      source,
      lineStart,
      node.from,
      underlineLineStart
    ),
    underlineMarkerRange
  };
}

function getHeadingSyntaxEnd(source: string, nodeEnd: number): number {
  return source.slice(nodeEnd - 1, nodeEnd + 1) === '\r\n'
    ? nodeEnd - 1
    : nodeEnd;
}

function getLineContentEnd(source: string, lineStart: number): number {
  const newline = source.indexOf('\n', lineStart);
  const lineEnd = newline === -1 ? source.length : newline;
  return source[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
}

function getLineEndIncludingBreak(source: string, offset: number): number {
  const newline = source.indexOf('\n', offset);
  return newline === -1 ? source.length : newline + 1;
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

function getLineStart(source: string, offset: number): number {
  return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
}

function getSetextTitleRanges(
  source: string,
  firstLineStart: number,
  firstTitleStart: number,
  underlineLineStart: number
): MarkdownRange[] {
  const ranges: MarkdownRange[] = [];
  let lineStart = firstLineStart;
  while (lineStart < underlineLineStart) {
    const lineEnd = getLineContentEnd(source, lineStart);
    ranges.push({
      from: lineStart === firstLineStart
        ? firstTitleStart
        : getSetextTitleStart(source, lineStart, lineEnd),
      to: lineEnd
    });
    const newline = source.indexOf('\n', lineStart);
    if (newline === -1) {
      break;
    }
    lineStart = newline + 1;
  }
  return ranges;
}

function getSetextTitleStart(
  source: string,
  lineStart: number,
  lineEnd: number
): number {
  let offset = lineStart;
  while (offset < lineEnd) {
    let indentation = 0;
    while (
      indentation < MAX_MARKDOWN_INDENTATION_SPACES
      && offset < lineEnd
      && source[offset] === ' '
    ) {
      indentation += 1;
      offset += 1;
    }
    if (source[offset] !== '>') {
      return offset;
    }
    offset += 1;
    if (source[offset] === ' ' || source[offset] === '\t') {
      offset += 1;
    }
  }
  return offset;
}

function isCallout(source: string, node: MarkdownNode): boolean {
  const lineEnd = source.indexOf('\n', node.from);
  const openingLine = source
    .slice(node.from, lineEnd === -1 ? source.length : lineEnd)
    .replace(/\r$/u, '')
    .replace(/^[\t ]*>[\t ]?/u, '');
  return /^\[![a-z\d-]+\][+-]?(?:[\t ]|$)/iu.test(openingLine);
}

function sortAndMergeRanges(
  ranges: readonly MarkdownRange[]
): readonly MarkdownRange[] {
  const sortedRanges = ranges
    .map((range) => ({ from: range.from, to: range.to }))
    .sort(
      (left, right) => left.from - right.from || left.to - right.to
    );
  const mergedRanges: MarkdownRange[] = [];
  for (const range of sortedRanges) {
    const previous = mergedRanges.at(-1);
    if (previous === undefined || range.from > previous.to) {
      mergedRanges.push(range);
    } else if (range.to > previous.to) {
      mergedRanges[mergedRanges.length - 1] = {
        from: previous.from,
        to: range.to
      };
    }
  }
  return mergedRanges;
}
