import { parser } from '@lezer/markdown';

import type { MarkdownRange } from './markdown-structure.ts';

import { decodeMarkdownCharacterReference } from './markdown-character-reference.ts';
import { parseMarkdownStructure } from './markdown-structure.ts';

export type DependencyAnalysis =
  // eslint-disable-next-line no-restricted-syntax -- The approved API uses a compact discriminated union.
  | { readonly kind: 'invalid'; readonly reason: 'cross-boundary-reference' }
  // eslint-disable-next-line no-restricted-syntax -- The approved API uses a compact discriminated union.
  | {
    readonly kind: 'ready';
    readonly targets: readonly RelativeMarkdownTarget[];
  };

export type MarkdownTargetKind = 'embed' | 'link' | 'reference-definition';

export interface RelativeMarkdownTarget {
  readonly explicitMarkdownExtension: boolean;
  readonly from: number;
  readonly kind: MarkdownTargetKind;
  readonly linkpath: string;
  readonly subpath: string;
  readonly to: number;
}

interface LabelOccurrences {
  readonly definitions: MarkdownRange[];
  readonly uses: MarkdownRange[];
}

interface MarkdownLine {
  readonly from: number;
  readonly text: string;
  readonly to: number;
}

interface MarkdownNode {
  readonly from: number;
  readonly name: string;
  readonly to: number;
}

interface ParsedMarkdown {
  readonly directUrlParents: ReadonlySet<MarkdownNode>;
  readonly literalRanges: readonly MarkdownRange[];
  readonly nodes: readonly MarkdownNode[];
  readonly parents: ReadonlyMap<MarkdownNode, MarkdownNode | undefined>;
  readonly protectedRanges: readonly MarkdownRange[];
  readonly referenceDefinitions: ReadonlyMap<number, ReferenceDefinition>;
}

interface ReferenceDefinition {
  readonly label: string;
  readonly range: MarkdownRange;
}

interface SplitDestination {
  readonly linkpath: string;
  readonly subpath: string;
}

const BINARY_SEARCH_DIVISOR = 2;
const CHARACTER_REFERENCE_AT_OFFSET = /&(?:#[xX][\dA-Fa-f]+|#\d+|[A-Za-z][A-Za-z\d]+);/uy;
const ESCAPABLE_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/u;
const CODE_NODE_NAMES = new Set(['CodeBlock', 'FencedCode', 'InlineCode']);
const FOOTNOTE_LITERAL_NODE_NAMES = new Set([
  ...CODE_NODE_NAMES,
  'Comment',
  'CommentBlock',
  'HTMLBlock',
  'HTMLTag',
  'LinkTitle',
  'ProcessingInstruction',
  'URL'
]);
const FOOTNOTE_CONTINUATION = /^(?:\t| {2,})/u;
const LABEL_SEPARATOR_LENGTH = 2;
const MATH_BLOCK_DELIMITER = '$$';
const MATH_DELIMITER_WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const URI_SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const REFERENCE_WHITESPACE = /[\t\n\r ]+/gu;

export function analyzeExtractionDependencies(
  source: string,
  extractedRange: MarkdownRange,
  destinationContent: string
): DependencyAnalysis {
  if (hasCrossBoundaryReference(source, extractedRange)) {
    return { kind: 'invalid', reason: 'cross-boundary-reference' };
  }

  return {
    kind: 'ready',
    targets: collectRelativeTargets(destinationContent)
  };
}

export function rewriteMarkdownTargets(
  markdown: string,
  targets: readonly RelativeMarkdownTarget[],
  resolve: (target: RelativeMarkdownTarget) => null | string
): null | string {
  const sortedTargets = [...targets].sort((left, right) => left.from - right.from || left.to - right.to);
  let previousTo = 0;
  for (const target of sortedTargets) {
    if (
      !Number.isSafeInteger(target.from)
      || !Number.isSafeInteger(target.to)
      || target.from < 0
      || target.from >= target.to
      || target.to > markdown.length
      || target.from < previousTo
    ) {
      throw new TypeError('Markdown target ranges must be unique and disjoint.');
    }
    previousTo = target.to;
  }

  const replacements: string[] = [];
  for (const target of sortedTargets) {
    const replacement = resolve(target);
    if (replacement === null) {
      return null;
    }
    replacements.push(replacement + target.subpath);
  }

  let rewritten = markdown;
  for (let index = sortedTargets.length - 1; index >= 0; index -= 1) {
    const target = sortedTargets[index];
    const replacement = replacements[index];
    if (target === undefined || replacement === undefined) {
      continue;
    }
    rewritten = rewritten.slice(0, target.from)
      + replacement
      + rewritten.slice(target.to);
  }
  return rewritten;
}

function collectFootnoteDefinitionEnds(
  lines: readonly MarkdownLine[]
): readonly number[] {
  const definitionEnds = Array.from({ length: lines.length }, () => 0);
  let continuationEnd: number | undefined;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    definitionEnds[index] = continuationEnd ?? line.to;
    if (line.text.trim() === '') {
      continue;
    }
    if (FOOTNOTE_CONTINUATION.test(line.text)) {
      continuationEnd ??= line.to;
    } else {
      continuationEnd = undefined;
    }
  }
  return definitionEnds;
}

function collectFootnoteOccurrences(
  source: string,
  protectedRanges: readonly MarkdownRange[],
  labels: Map<string, LabelOccurrences>
): void {
  const definitionStarts = new Set<number>();
  const lines = collectMarkdownLines(source);
  const definitionEnds = collectFootnoteDefinitionEnds(lines);
  for (const [index, line] of lines.entries()) {
    const match = /^[\t ]{0,3}\[\^(?<label>[^\]\r\n]+)\]:/u.exec(line.text);
    const label = match?.groups?.['label'];
    if (
      match !== null
      && label !== undefined
      && !isProtected(line.from, protectedRanges)
    ) {
      const marker = match[0];
      const labelFrom = line.from + marker.indexOf('[^');
      const key = normalizeReferenceLabel(`^${label}`);
      const occurrences = getOrCreateOccurrences(labels, key);
      occurrences.definitions.push({
        from: line.from,
        to: definitionEnds[index] ?? line.to
      });
      definitionStarts.add(labelFrom);
    }
  }

  const usePattern = /\[\^(?<label>[^\]\r\n]+)\]/gu;
  for (const match of source.matchAll(usePattern)) {
    const from = match.index;
    const text = match[0];
    const label = match.groups?.['label'];
    const to = from + text.length;
    if (
      label === undefined
      || isEscaped(source, from)
      || isProtected(from, protectedRanges)
      || definitionStarts.has(from)
    ) {
      continue;
    }
    const occurrences = getOrCreateOccurrences(
      labels,
      normalizeReferenceLabel(`^${label}`)
    );
    occurrences.uses.push({ from, to });
  }
}

function collectInlineMathRanges(
  markdown: string,
  from: number,
  to: number,
  delimiterExcludedRanges: readonly MarkdownRange[],
  mathRanges: MarkdownRange[]
): void {
  let inlineFrom: number | undefined;
  let precedingBackslashes = 0;
  let index = from;
  while (index < to) {
    const character = markdown[index];
    if (character === '\\') {
      precedingBackslashes += 1;
      index += 1;
      continue;
    }
    const isDelimiterEscaped = precedingBackslashes % LABEL_SEPARATOR_LENGTH === 1;
    precedingBackslashes = 0;
    if (character === '\n' || character === '\r') {
      inlineFrom = undefined;
      index += 1;
      continue;
    }
    if (
      character !== '$'
      || isDelimiterEscaped
      || isProtected(index, delimiterExcludedRanges)
    ) {
      index += 1;
      continue;
    }
    if (
      index + MATH_BLOCK_DELIMITER.length <= to
      && markdown.startsWith(MATH_BLOCK_DELIMITER, index)
    ) {
      index += MATH_BLOCK_DELIMITER.length;
      continue;
    }
    if (inlineFrom === undefined) {
      const followingCharacter = markdown[index + 1];
      if (
        index + 1 < to
        && followingCharacter !== '$'
        && !isMathDelimiterWhitespace(followingCharacter)
      ) {
        inlineFrom = index;
      }
    } else if (!isMathDelimiterWhitespace(markdown[index - 1])) {
      mathRanges.push({ from: inlineFrom, to: index + 1 });
      inlineFrom = undefined;
    }
    index += 1;
  }
}

function collectMarkdownLines(source: string): readonly MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let lineStart = 0;
  while (lineStart <= source.length) {
    const newline = source.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? source.length : newline;
    lines.push({
      from: lineStart,
      text: source.slice(lineStart, lineEnd).replace(/\r$/u, ''),
      to: lineEnd
    });
    if (newline === -1) {
      break;
    }
    lineStart = newline + 1;
  }
  return lines;
}

function collectMathBlockRanges(
  markdown: string,
  from: number,
  to: number,
  delimiterExcludedRanges: readonly MarkdownRange[]
): readonly MarkdownRange[] {
  const blockRanges: MarkdownRange[] = [];
  let blockFrom: number | undefined;
  let precedingBackslashes = 0;
  let index = from;
  while (index < to) {
    const character = markdown[index];
    if (character === '\\') {
      precedingBackslashes += 1;
      index += 1;
      continue;
    }
    const isDelimiterEscaped = precedingBackslashes % LABEL_SEPARATOR_LENGTH === 1;
    precedingBackslashes = 0;
    if (
      character === '$'
      && !isDelimiterEscaped
      && !isProtected(index, delimiterExcludedRanges)
      && index + MATH_BLOCK_DELIMITER.length <= to
      && markdown.startsWith(MATH_BLOCK_DELIMITER, index)
    ) {
      if (blockFrom === undefined) {
        blockFrom = index;
      } else {
        blockRanges.push({
          from: blockFrom,
          to: index + MATH_BLOCK_DELIMITER.length
        });
        blockFrom = undefined;
      }
      index += MATH_BLOCK_DELIMITER.length;
      continue;
    }
    index += 1;
  }
  return blockRanges;
}

function collectMathRangesInSegment(
  markdown: string,
  from: number,
  to: number,
  delimiterExcludedRanges: readonly MarkdownRange[],
  mathRanges: MarkdownRange[]
): void {
  const blockRanges = collectMathBlockRanges(
    markdown,
    from,
    to,
    delimiterExcludedRanges
  );
  let inlineSegmentFrom = from;
  for (const blockRange of blockRanges) {
    collectInlineMathRanges(
      markdown,
      inlineSegmentFrom,
      blockRange.from,
      delimiterExcludedRanges,
      mathRanges
    );
    mathRanges.push(blockRange);
    inlineSegmentFrom = blockRange.to;
  }
  collectInlineMathRanges(
    markdown,
    inlineSegmentFrom,
    to,
    delimiterExcludedRanges,
    mathRanges
  );
}

function collectReferenceOccurrences(
  source: string,
  parsed: ParsedMarkdown
): Map<string, LabelOccurrences> {
  const labels = new Map<string, LabelOccurrences>();
  for (const definition of parsed.referenceDefinitions.values()) {
    if (isProtected(definition.range.from, parsed.protectedRanges)) {
      continue;
    }
    const key = normalizeReferenceLabel(definition.label);
    if (key === '') {
      continue;
    }
    const occurrences = getOrCreateOccurrences(labels, key);
    occurrences.definitions.push(definition.range);
  }

  for (const node of parsed.nodes) {
    if (
      (node.name !== 'Image' && node.name !== 'Link')
      || isProtected(node.from, parsed.protectedRanges)
      || parsed.directUrlParents.has(node)
      || isWikilinkLike(source, node)
    ) {
      continue;
    }
    const label = extractReferenceUseLabel(source.slice(node.from, node.to));
    if (label === null || label.startsWith('^')) {
      continue;
    }
    const key = normalizeReferenceLabel(label);
    labels.get(key)?.uses.push({ from: node.from, to: node.to });
  }

  return labels;
}

function collectRelativeTargets(markdown: string): RelativeMarkdownTarget[] {
  const parsed = parseMarkdown(markdown);
  const targets: RelativeMarkdownTarget[] = [];

  for (const node of parsed.nodes) {
    if (node.name !== 'URL' || isProtected(node.from, parsed.protectedRanges)) {
      continue;
    }

    const parentName = parsed.parents.get(node)?.name;
    const kind = getTargetKind(parentName);
    const parentNode = findParentNode(node, parsed);
    if (
      kind === null
      || (kind === 'reference-definition'
        && parentNode !== undefined
        && markdown.startsWith('[^', parentNode.from))
    ) {
      continue;
    }

    const isAngleDestination = markdown[node.from] === '<'
      && markdown[node.to - 1] === '>';
    const from = node.from + (isAngleDestination ? 1 : 0);
    const to = node.to - (isAngleDestination ? 1 : 0);
    const destination = markdown.slice(from, to);
    const split = splitDestination(destination);
    const logicalLinkpath = decodeLogicalLinkpath(split.linkpath);
    if (!isRelativeDestination(logicalLinkpath)) {
      continue;
    }

    targets.push({
      explicitMarkdownExtension: /\.md$/iu.test(logicalLinkpath),
      from,
      kind,
      linkpath: logicalLinkpath,
      subpath: split.subpath,
      to
    });
  }

  return targets;
}

function decodeLogicalLinkpath(rawLinkpath: string): string {
  const markdownDecodedLinkpath = decodeMarkdownSyntax(rawLinkpath);
  try {
    return decodeURIComponent(markdownDecodedLinkpath);
  } catch {
    return markdownDecodedLinkpath;
  }
}

function decodeMarkdownSyntax(markdown: string): string {
  let decoded = '';
  for (let index = 0; index < markdown.length; index += 1) {
    const character = markdown[index];
    const nextCharacter = markdown[index + 1];
    if (character === undefined) {
      break;
    }
    if (
      character === '\\'
      && nextCharacter !== undefined
      && ESCAPABLE_PUNCTUATION.test(nextCharacter)
    ) {
      decoded += nextCharacter;
      index += 1;
      continue;
    }
    const reference = character === '&'
      ? getCharacterReferenceAt(markdown, index)
      : null;
    if (reference !== null) {
      decoded += decodeMarkdownCharacterReference(reference);
      index += reference.length - 1;
      continue;
    }
    decoded += character;
  }
  return decoded;
}

function extractReferenceUseLabel(markdown: string): null | string {
  const reference = markdown.startsWith('![') ? markdown.slice(1) : markdown;
  if (!reference.startsWith('[') || !reference.endsWith(']')) {
    return null;
  }
  const secondLabelStart = reference.lastIndexOf('][');
  if (secondLabelStart !== -1) {
    const secondLabel = reference.slice(
      secondLabelStart + LABEL_SEPARATOR_LENGTH,
      -1
    );
    return secondLabel === ''
      ? reference.slice(1, secondLabelStart)
      : secondLabel;
  }
  return reference.slice(1, -1);
}

function findObsidianMathRanges(
  markdown: string,
  excludedRanges: readonly MarkdownRange[],
  delimiterExcludedRanges: readonly MarkdownRange[]
): readonly MarkdownRange[] {
  const mathRanges: MarkdownRange[] = [];
  let segmentFrom = 0;
  for (const excludedRange of excludedRanges) {
    if (segmentFrom < excludedRange.from) {
      collectMathRangesInSegment(
        markdown,
        segmentFrom,
        excludedRange.from,
        delimiterExcludedRanges,
        mathRanges
      );
    }
    segmentFrom = Math.max(segmentFrom, excludedRange.to);
  }
  if (segmentFrom < markdown.length) {
    collectMathRangesInSegment(
      markdown,
      segmentFrom,
      markdown.length,
      delimiterExcludedRanges,
      mathRanges
    );
  }
  return mathRanges;
}

function findParentNode(
  node: MarkdownNode,
  parsed: ParsedMarkdown
): MarkdownNode | undefined {
  return parsed.parents.get(node);
}

function getBoundarySide(
  occurrence: MarkdownRange,
  sectionRange: MarkdownRange
): 'crossing' | 'inside' | 'outside' {
  if (
    occurrence.from >= sectionRange.from
    && occurrence.to <= sectionRange.to
  ) {
    return 'inside';
  }
  if (occurrence.to <= sectionRange.from || occurrence.from >= sectionRange.to) {
    return 'outside';
  }
  return 'crossing';
}

function getCharacterReferenceAt(markdown: string, offset: number): null | string {
  CHARACTER_REFERENCE_AT_OFFSET.lastIndex = offset;
  return CHARACTER_REFERENCE_AT_OFFSET.exec(markdown)?.[0] ?? null;
}

function getOrCreateOccurrences(
  labels: Map<string, LabelOccurrences>,
  key: string
): LabelOccurrences {
  const existing = labels.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = { definitions: [], uses: [] };
  labels.set(key, created);
  return created;
}

function getTargetKind(parentName: string | undefined): MarkdownTargetKind | null {
  if (parentName === 'Image') {
    return 'embed';
  }
  if (parentName === 'Link') {
    return 'link';
  }
  if (parentName === 'LinkReference') {
    return 'reference-definition';
  }
  return null;
}

function hasCrossBoundaryReference(
  source: string,
  extractedRange: MarkdownRange
): boolean {
  const parsed = parseMarkdown(source);
  const labels = collectReferenceOccurrences(source, parsed);
  collectFootnoteOccurrences(source, parsed.literalRanges, labels);

  for (const occurrences of labels.values()) {
    if (occurrences.definitions.length === 0) {
      continue;
    }
    const sides = [...occurrences.definitions, ...occurrences.uses].map(
      (range) => getBoundarySide(range, extractedRange)
    );
    if (sides.includes('crossing') || new Set(sides).size > 1) {
      return true;
    }
  }
  return false;
}

function isEscaped(source: string, offset: number): boolean {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && source[index] === '\\'; index -= 1) {
    backslashes += 1;
  }
  return backslashes % LABEL_SEPARATOR_LENGTH === 1;
}

function isMathDelimiterWhitespace(
  character: string | undefined
): boolean {
  return character !== undefined
    && MATH_DELIMITER_WHITESPACE.has(character);
}

function isProtected(
  offset: number,
  protectedRanges: readonly MarkdownRange[]
): boolean {
  let lowerIndex = 0;
  let upperIndex = protectedRanges.length - 1;
  while (lowerIndex <= upperIndex) {
    const middleIndex = Math.floor(
      (lowerIndex + upperIndex) / BINARY_SEARCH_DIVISOR
    );
    const range = protectedRanges[middleIndex];
    if (range === undefined) {
      return false;
    }
    if (offset < range.from) {
      upperIndex = middleIndex - 1;
    } else if (offset >= range.to) {
      lowerIndex = middleIndex + 1;
    } else {
      return true;
    }
  }
  return false;
}

function isRelativeDestination(logicalLinkpath: string): boolean {
  return logicalLinkpath !== ''
    && !logicalLinkpath.startsWith('/')
    && !logicalLinkpath.startsWith('#')
    && !logicalLinkpath.startsWith('^')
    && !URI_SCHEME.test(logicalLinkpath);
}

function isWikilinkLike(source: string, node: MarkdownNode): boolean {
  return source[node.from - 1] === '[' || source[node.to] === ']';
}

function normalizeReferenceLabel(label: string): string {
  const normalizedWhitespace = decodeMarkdownSyntax(label)
    .replaceAll(REFERENCE_WHITESPACE, ' ')
    .trim();
  let normalizedCase = '';
  for (const character of normalizedWhitespace) {
    normalizedCase += character === 'ı'
      ? character
      : character.toLowerCase().toUpperCase();
  }
  return normalizedCase;
}

function parseMarkdown(markdown: string): ParsedMarkdown {
  const nodes: MarkdownNode[] = [];
  const parents = new Map<MarkdownNode, MarkdownNode | undefined>();
  const nodeStack: MarkdownNode[] = [];
  const codeRanges: MarkdownRange[] = [];
  const literalRanges: MarkdownRange[] = [];
  const directUrlParents = new Set<MarkdownNode>();
  const referenceDefinitions = new Map<number, ReferenceDefinition>();

  parser.parse(markdown).iterate({
    enter(node) {
      const parsedNode = { from: node.from, name: node.name, to: node.to };
      const parent = nodeStack.at(-1);
      nodes.push(parsedNode);
      parents.set(parsedNode, parent);
      nodeStack.push(parsedNode);
      if (node.name === 'URL' && parent !== undefined) {
        directUrlParents.add(parent);
      }
      if (node.name === 'LinkLabel' && parent?.name === 'LinkReference') {
        referenceDefinitions.set(parent.from, {
          label: markdown.slice(node.from + 1, node.to - 1),
          range: { from: parent.from, to: parent.to }
        });
      }
      if (CODE_NODE_NAMES.has(node.name)) {
        codeRanges.push({ from: node.from, to: node.to });
      }
      if (FOOTNOTE_LITERAL_NODE_NAMES.has(node.name)) {
        literalRanges.push({ from: node.from, to: node.to });
      }
    },
    leave() {
      nodeStack.pop();
    }
  });

  const protectedRangesWithoutMath = sortAndMergeRanges([
    ...parseMarkdownStructure(markdown).protectedRanges,
    ...codeRanges
  ]);
  const mathRanges = findObsidianMathRanges(
    markdown,
    protectedRangesWithoutMath,
    sortAndMergeRanges(literalRanges)
  );
  const protectedRanges = sortAndMergeRanges([
    ...protectedRangesWithoutMath,
    ...mathRanges
  ]);
  return {
    directUrlParents,
    literalRanges: sortAndMergeRanges([
      ...protectedRanges,
      ...literalRanges
    ]),
    nodes,
    parents,
    protectedRanges,
    referenceDefinitions
  };
}

function sortAndMergeRanges(
  ranges: readonly MarkdownRange[]
): readonly MarkdownRange[] {
  const sortedRanges = [...ranges].sort((left, right) => left.from - right.from || left.to - right.to);
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

function splitDestination(destination: string): SplitDestination {
  let backslashes = 0;
  for (let index = 0; index < destination.length; index += 1) {
    const character = destination[index];
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    const characterReference = character === '&'
      ? getCharacterReferenceAt(destination, index)
      : null;
    if (characterReference !== null) {
      index += characterReference.length - 1;
      backslashes = 0;
      continue;
    }
    if (character === '#' && backslashes % LABEL_SEPARATOR_LENGTH === 0) {
      return {
        linkpath: destination.slice(0, index),
        subpath: destination.slice(index)
      };
    }
    backslashes = 0;
  }
  return { linkpath: destination, subpath: '' };
}
