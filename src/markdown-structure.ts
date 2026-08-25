import { parser } from '@lezer/markdown';

// eslint-disable-next-line no-magic-numbers -- Markdown defines exactly six numeric heading levels.
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

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

export interface MarkdownStructure {
  readonly containers: readonly MarkdownContainer[];
  readonly headings: readonly MarkdownHeading[];
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

export function parseMarkdownStructure(source: string): MarkdownStructure {
  const root: MarkdownContainer = {
    depth: 0,
    end: source.length,
    id: 'root',
    start: 0
  };
  const containers: MarkdownContainer[] = [root];
  const headings: MarkdownHeading[] = [];
  const containerStack: MarkdownContainer[] = [root];

  parser.parse(source).iterate({
    enter(node) {
      if (node.name === 'Blockquote') {
        const container = createContainer(source, node, containerStack.length);
        containers.push(container);
        containerStack.push(container);
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

  return { containers, headings };
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

function getHeadingLineStart(source: string, node: MarkdownNode): number {
  if (node.name.startsWith('SetextHeading')) {
    const underlineStart = getLineStart(source, node.to);
    return getLineStart(source, Math.max(0, underlineStart - 1));
  }

  return getLineStart(source, node.from);
}

function getLineEndIncludingBreak(source: string, offset: number): number {
  const newline = source.indexOf('\n', offset);
  return newline === -1 ? source.length : newline + 1;
}

function getLineStart(source: string, offset: number): number {
  return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
}
