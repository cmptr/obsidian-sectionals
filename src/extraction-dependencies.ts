import { parser } from '@lezer/markdown';

import type { MarkdownRange } from './markdown-structure.ts';

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

interface MarkdownNode {
  readonly from: number;
  readonly name: string;
  readonly to: number;
}

interface ParsedMarkdown {
  readonly nodes: readonly MarkdownNode[];
  readonly parents: ReadonlyMap<MarkdownNode, MarkdownNode | undefined>;
  readonly protectedRanges: readonly MarkdownRange[];
}

interface SplitDestination {
  readonly linkpath: string;
  readonly subpath: string;
}

const CODE_NODE_NAMES = new Set(['CodeBlock', 'FencedCode', 'InlineCode']);
const FOOTNOTE_CONTINUATION = /^(?:\t| {2,})/u;
const FOOTNOTE_MARKER_OVERHEAD = 3;
const LABEL_SEPARATOR_LENGTH = 2;
const URI_SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const REFERENCE_WHITESPACE = /[\t\n\r ]+/gu;

export function analyzeExtractionDependencies(
  source: string,
  sectionRange: MarkdownRange,
  destinationContent: string
): DependencyAnalysis {
  if (hasCrossBoundaryReference(source, sectionRange)) {
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

function collectFootnoteOccurrences(
  source: string,
  protectedRanges: readonly MarkdownRange[],
  labels: Map<string, LabelOccurrences>
): void {
  const definitionLabelRanges: MarkdownRange[] = [];
  let lineStart = 0;
  while (lineStart <= source.length) {
    const newline = source.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd).replace(/\r$/u, '');
    const match = /^[\t ]{0,3}\[\^(?<label>[^\]\r\n]+)\]:/u.exec(line);
    const label = match?.groups?.['label'];
    if (
      match !== null
      && label !== undefined
      && !isProtected(lineStart, protectedRanges)
    ) {
      const marker = match[0];
      const labelFrom = lineStart + marker.indexOf('[^');
      const labelTo = labelFrom + label.length + FOOTNOTE_MARKER_OVERHEAD;
      const key = normalizeReferenceLabel(`^${label}`);
      const occurrences = getOrCreateOccurrences(labels, key);
      occurrences.definitions.push({
        from: lineStart,
        to: getFootnoteDefinitionEnd(source, lineEnd)
      });
      definitionLabelRanges.push({ from: labelFrom, to: labelTo });
    }
    if (newline === -1) {
      break;
    }
    lineStart = newline + 1;
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
      || definitionLabelRanges.some((range) => range.from === from)
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

function collectReferenceOccurrences(
  source: string,
  parsed: ParsedMarkdown
): Map<string, LabelOccurrences> {
  const labels = new Map<string, LabelOccurrences>();
  const referenceDefinitionLabels = new Map<string, MarkdownRange[]>();

  for (const node of parsed.nodes) {
    const parentName = parsed.parents.get(node)?.name;
    if (node.name !== 'LinkLabel' || parentName !== 'LinkReference') {
      continue;
    }
    const key = normalizeReferenceLabel(source.slice(node.from + 1, node.to - 1));
    if (key === '') {
      continue;
    }
    const ranges = referenceDefinitionLabels.get(key) ?? [];
    ranges.push(findAncestorRange(node, 'LinkReference', parsed));
    referenceDefinitionLabels.set(key, ranges);
  }

  for (const [key, definitions] of referenceDefinitionLabels) {
    labels.set(key, { definitions, uses: [] });
  }

  for (const node of parsed.nodes) {
    if (
      (node.name !== 'Image' && node.name !== 'Link')
      || isProtected(node.from, parsed.protectedRanges)
      || hasDirectUrlChild(node, parsed)
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
    if (!isRelativeLinkpath(split.linkpath)) {
      continue;
    }

    targets.push({
      explicitMarkdownExtension: /\.md$/iu.test(split.linkpath),
      from,
      kind,
      linkpath: split.linkpath,
      subpath: split.subpath,
      to
    });
  }

  return targets;
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

function findAncestorRange(
  node: MarkdownNode,
  ancestorName: string,
  parsed: ParsedMarkdown
): MarkdownRange {
  let current: MarkdownNode | undefined = node;
  while (current !== undefined) {
    if (current.name === ancestorName) {
      return { from: current.from, to: current.to };
    }
    current = findParentNode(current, parsed);
  }
  return { from: node.from, to: node.to };
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

function getFootnoteDefinitionEnd(source: string, openingLineEnd: number): number {
  let definitionEnd = openingLineEnd;
  let lineStart = source[openingLineEnd] === '\n'
    ? openingLineEnd + 1
    : source.length;

  while (lineStart < source.length) {
    const newline = source.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd).replace(/\r$/u, '');
    if (line.trim() === '') {
      lineStart = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (!FOOTNOTE_CONTINUATION.test(line)) {
      break;
    }
    definitionEnd = lineEnd;
    lineStart = newline === -1 ? source.length : newline + 1;
  }

  return definitionEnd;
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
  sectionRange: MarkdownRange
): boolean {
  const parsed = parseMarkdown(source);
  const labels = collectReferenceOccurrences(source, parsed);
  collectFootnoteOccurrences(source, parsed.protectedRanges, labels);

  for (const occurrences of labels.values()) {
    if (occurrences.definitions.length === 0) {
      continue;
    }

    const sides = [...occurrences.definitions, ...occurrences.uses].map(
      (range) => getBoundarySide(range, sectionRange)
    );
    if (sides.includes('crossing') || new Set(sides).size > 1) {
      return true;
    }
  }
  return false;
}

function hasDirectUrlChild(node: MarkdownNode, parsed: ParsedMarkdown): boolean {
  return parsed.nodes.some((candidate) => candidate.name === 'URL' && findParentNode(candidate, parsed) === node);
}

function isEscaped(source: string, offset: number): boolean {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && source[index] === '\\'; index -= 1) {
    backslashes += 1;
  }
  return backslashes % LABEL_SEPARATOR_LENGTH === 1;
}

function isProtected(
  offset: number,
  protectedRanges: readonly MarkdownRange[]
): boolean {
  return protectedRanges.some((range) => range.from <= offset && offset < range.to);
}

function isRelativeLinkpath(linkpath: string): boolean {
  return linkpath !== ''
    && !linkpath.startsWith('/')
    && !linkpath.startsWith('#')
    && !linkpath.startsWith('^')
    && !URI_SCHEME.test(linkpath);
}

function isWikilinkLike(source: string, node: MarkdownNode): boolean {
  return source[node.from - 1] === '[' || source[node.to] === ']';
}

function normalizeReferenceLabel(label: string): string {
  return label
    .replaceAll(
      /\\(?<escapedPunctuation>[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/gu,
      '$<escapedPunctuation>'
    )
    .replaceAll(REFERENCE_WHITESPACE, ' ')
    .trim()
    .toLowerCase();
}

function parseMarkdown(markdown: string): ParsedMarkdown {
  const nodes: MarkdownNode[] = [];
  const parents = new Map<MarkdownNode, MarkdownNode | undefined>();
  const nodeStack: MarkdownNode[] = [];
  const codeRanges: MarkdownRange[] = [];

  parser.parse(markdown).iterate({
    enter(node) {
      const parsedNode = { from: node.from, name: node.name, to: node.to };
      nodes.push(parsedNode);
      parents.set(parsedNode, nodeStack.at(-1));
      nodeStack.push(parsedNode);
      if (CODE_NODE_NAMES.has(node.name)) {
        codeRanges.push({ from: node.from, to: node.to });
      }
    },
    leave() {
      nodeStack.pop();
    }
  });

  return {
    nodes,
    parents,
    protectedRanges: [
      ...parseMarkdownStructure(markdown).protectedRanges,
      ...codeRanges
    ]
  };
}

function splitDestination(destination: string): SplitDestination {
  let backslashes = 0;
  for (let index = 0; index < destination.length; index += 1) {
    const character = destination[index];
    if (character === '\\') {
      backslashes += 1;
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
