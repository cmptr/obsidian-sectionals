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
  readonly syntaxEnd: number;
  readonly syntaxStart: number;
}

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
const DELIMITER_IGNORED_NODE_NAMES = new Set([
  'CodeBlock',
  'Comment',
  'CommentBlock',
  'FencedCode',
  'InlineCode'
]);
const PERCENT_COMMENT_DELIMITER = '%%';

export function parseMarkdownStructure(source: string): MarkdownStructure {
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
        headings.push({
          container: containerStack.at(-1) ?? root,
          level,
          lineStart: getHeadingLineStart(source, node),
          syntaxEnd: node.to,
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
    blocks: blocks.filter((block) =>
      blockProtectedRanges.every(
        (range) => !containsOffset(range, block.start)
      )
    ),
    containers,
    headings: headings.filter((heading) =>
      protectedRanges.every(
        (range) => !containsOffset(range, heading.syntaxStart)
      )
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
  const ranges: MarkdownRange[] = [];
  let open: null | number = null;
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const delimiter = source.indexOf(PERCENT_COMMENT_DELIMITER, searchFrom);
    if (delimiter === -1) {
      break;
    }
    searchFrom = delimiter + PERCENT_COMMENT_DELIMITER.length;
    if (
      delimiterIgnoredRanges.some((range) => containsOffset(range, delimiter))
    ) {
      continue;
    }

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

function getHeadingLineStart(source: string, node: MarkdownNode): number {
  return getLineStart(source, node.from);
}

function getLineEndIncludingBreak(source: string, offset: number): number {
  const newline = source.indexOf('\n', offset);
  return newline === -1 ? source.length : newline + 1;
}

function getLineStart(source: string, offset: number): number {
  return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
}

function isCallout(source: string, node: MarkdownNode): boolean {
  const lineEnd = source.indexOf('\n', node.from);
  const openingLine = source
    .slice(node.from, lineEnd === -1 ? source.length : lineEnd)
    .replace(/\r$/u, '')
    .replace(/^[\t ]*>[\t ]?/u, '');
  return /^\[![a-z\d-]+\][+-]?(?:[\t ]|$)/iu.test(openingLine);
}
