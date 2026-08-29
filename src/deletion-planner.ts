// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible structure imports compact.
import type { MarkdownBlock, MarkdownBlockKind, MarkdownHeading, MarkdownStructure } from './markdown-structure.ts';
import type { MarkdownSection } from './section-query.ts';

import { parseMarkdownStructure } from './markdown-structure.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible query imports compact.
import { collectMarkdownSections, findMarkdownSection } from './section-query.ts';

export type DeletionMode = 'heading-block' | 'section';

export interface DeletionRange {
  readonly from: number;
  readonly to: number;
}

export interface DeletionTarget {
  readonly detail: null | string;
  readonly kinds: readonly [
    DeletionTargetKind,
    ...DeletionTargetKind[]
  ];
  readonly lineCount: number;
  readonly range: DeletionRange;
}

export type DeletionTargetKind = DeletionMode | MarkdownBlockKind;

interface DeletionCandidate {
  readonly detail: null | string;
  readonly kind: DeletionTargetKind;
  readonly range: DeletionRange;
}

interface MutableDeletionTargetGroup {
  detail: null | string;
  readonly kinds: DeletionTargetKind[];
  readonly range: DeletionRange;
}

interface PlannedHeadingDeletion {
  readonly heading: MarkdownHeading;
  readonly range: DeletionRange;
}

interface PlanningContext {
  readonly cursorOffset: number;
  readonly sections: readonly MarkdownSection[];
  readonly source: string;
  readonly structure: MarkdownStructure;
}

const CONTEXTUAL_TARGET_KINDS = [
  'fenced-code',
  'callout',
  'blockquote'
] as const satisfies readonly MarkdownBlockKind[];

const TARGET_KIND_PRIORITY = [
  'fenced-code',
  'callout',
  'blockquote',
  'section',
  'heading-block'
] as const satisfies readonly DeletionTargetKind[];

const TARGET_KIND_LABELS = {
  'blockquote': 'blockquote',
  'callout': 'callout',
  'fenced-code': 'fenced code',
  'heading-block': 'heading block',
  'section': 'section'
} as const satisfies Readonly<Record<DeletionTargetKind, string>>;

export function collectDeletionTargets(
  source: string,
  cursorOffset: number
): readonly DeletionTarget[] {
  const context = createPlanningContext(source, cursorOffset);
  if (context === null) {
    return [];
  }

  const candidates: DeletionCandidate[] = [];
  for (const kind of CONTEXTUAL_TARGET_KINDS) {
    const block = findContextualBlock(context, kind);
    if (block !== null) {
      candidates.push({
        detail: getBlockDetail(source, block),
        kind,
        range: { from: block.start, to: block.end }
      });
    }
  }

  for (const mode of ['section', 'heading-block'] as const) {
    const planned = planHeadingDeletion(context, mode);
    if (planned !== null) {
      candidates.push({
        detail: getHeadingDetail(source, planned.heading),
        kind: mode,
        range: planned.range
      });
    }
  }

  return mergeDeletionCandidates(source, candidates);
}

export function formatDeletionTarget(target: DeletionTarget): string {
  const lineLabel = target.lineCount === 1
    ? '1 line'
    : `${String(target.lineCount)} lines`;
  return [formatTargetKinds(target.kinds), target.detail, lineLabel]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
}

export function planContextualDeletion(
  source: string,
  cursorOffset: number,
  kind: MarkdownBlockKind
): DeletionRange | null {
  const context = createPlanningContext(source, cursorOffset);
  const block = context === null ? null : findContextualBlock(context, kind);
  return block === null ? null : { from: block.start, to: block.end };
}

export function planSectionDeletion(
  source: string,
  cursorOffset: number,
  mode: DeletionMode
): DeletionRange | null {
  const context = createPlanningContext(source, cursorOffset);
  return context === null ? null : planHeadingDeletion(context, mode)?.range ?? null;
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

function countDeletionLines(source: string, range: DeletionRange): number {
  const text = source.slice(range.from, range.to);
  if (text === '') {
    return 0;
  }

  let lineCount = 0;
  for (const character of text) {
    if (character === '\n') {
      lineCount += 1;
    }
  }
  return text.endsWith('\n') ? lineCount : lineCount + 1;
}

function createPlanningContext(
  source: string,
  cursorOffset: number
): null | PlanningContext {
  if (
    !Number.isSafeInteger(cursorOffset)
    || cursorOffset < 0
    || cursorOffset > source.length
  ) {
    return null;
  }

  const structure = parseMarkdownStructure(source);
  return {
    cursorOffset,
    sections: collectMarkdownSections(structure),
    source,
    structure
  };
}

function findBoundary(
  headings: readonly MarkdownHeading[],
  target: MarkdownHeading
): MarkdownHeading | null {
  return (
    headings.find(
      (heading) =>
        heading.lineStart > target.lineStart
        && heading.container.id === target.container.id
    ) ?? null
  );
}

function findContextualBlock(
  context: PlanningContext,
  kind: MarkdownBlockKind
): MarkdownBlock | null {
  const { cursorOffset, source, structure } = context;
  if (cursorOffset === source.length && source.endsWith('\n')) {
    return null;
  }
  if (
    structure.protectedRanges.some((range) => containsCursor(source.length, range.from, range.to, cursorOffset))
  ) {
    return null;
  }

  let target: MarkdownBlock | null = null;
  for (const block of structure.blocks) {
    if (
      block.kind !== kind
      || !containsCursor(source.length, block.start, block.end, cursorOffset)
    ) {
      continue;
    }
    if (
      target === null
      || block.depth > target.depth
      || (block.depth === target.depth
        && block.end - block.start < target.end - target.start)
    ) {
      target = block;
    }
  }
  return target;
}

function formatTargetKinds(kinds: DeletionTarget['kinds']): string {
  const joined = kinds.map((kind) => TARGET_KIND_LABELS[kind]).join(' + ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function getBlockDetail(
  source: string,
  block: MarkdownBlock
): null | string {
  const lines = sourceLines(source, { from: block.start, to: block.end });
  const normalized = lines.map((line) => stripQuotePrefixes(line).trim());

  if (block.kind === 'callout') {
    for (const line of normalized) {
      // eslint-disable-next-line prefer-named-capture-group -- Match the source-preserving callout type by its only capture.
      const match = /^\[!([a-z\d-]+)\]/iu.exec(line);
      if (match?.[1] !== undefined) {
        return match[1];
      }
    }
    return null;
  }

  if (block.kind === 'fenced-code') {
    const openingLine = normalized.find((line) => line !== '');
    if (openingLine === undefined) {
      return null;
    }
    const infoPattern = openingLine.startsWith('`')
      ? /^`{3,}[\t ]*(?<info>[^\s`]+)?/u
      : /^~{3,}[\t ]*(?<info>\S+)?/u;
    return infoPattern.exec(openingLine)?.groups?.['info'] ?? null;
  }

  return normalized.find((line) => line !== '') ?? null;
}

function getHeadingDetail(
  source: string,
  heading: MarkdownHeading
): null | string {
  const lines = source
    .slice(heading.lineStart, heading.syntaxEnd)
    .split('\n')
    .map((line) => stripQuotePrefixes(line.replace(/\r$/u, '')).trim());

  for (const line of lines) {
    if (line === '' || /^[=-]+$/u.test(line)) {
      continue;
    }
    const openingAtxPattern = /^#{1,6}(?:[\t ]+|$)/u;
    if (!openingAtxPattern.test(line)) {
      return line;
    }

    const body = line.replace(openingAtxPattern, '');
    if (/^#+$/u.test(body)) {
      return null;
    }
    return body.replace(/[\t ]+#+[\t ]*$/u, '').trim() || null;
  }
  return null;
}

function getTargetKindPriority(kind: DeletionTargetKind): number {
  return TARGET_KIND_PRIORITY.indexOf(kind);
}

function mergeDeletionCandidates(
  source: string,
  candidates: readonly DeletionCandidate[]
): readonly DeletionTarget[] {
  const groups = new Map<string, MutableDeletionTargetGroup>();
  for (const candidate of candidates) {
    const key = `${String(candidate.range.from)}:${String(candidate.range.to)}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        detail: candidate.detail,
        kinds: [candidate.kind],
        range: candidate.range
      });
      continue;
    }
    if (!group.kinds.includes(candidate.kind)) {
      group.kinds.push(candidate.kind);
    }
    group.detail ??= candidate.detail;
  }

  const targets: DeletionTarget[] = [];
  for (const group of groups.values()) {
    group.kinds.sort(
      (left, right) => getTargetKindPriority(left) - getTargetKindPriority(right)
    );
    const firstKind = group.kinds[0];
    if (firstKind === undefined) {
      continue;
    }
    const lineCount = countDeletionLines(source, group.range);
    if (lineCount < 1) {
      continue;
    }
    const kinds: [DeletionTargetKind, ...DeletionTargetKind[]] = [
      firstKind,
      ...group.kinds.slice(1)
    ];
    targets.push({
      detail: group.detail,
      kinds,
      lineCount,
      range: group.range
    });
  }

  return targets.sort((left, right) => {
    const spanDifference = left.range.to - left.range.from - (right.range.to - right.range.from);
    return spanDifference === 0
      ? getTargetKindPriority(left.kinds[0])
        - getTargetKindPriority(right.kinds[0])
      : spanDifference;
  });
}

function planHeadingDeletion(
  context: PlanningContext,
  mode: DeletionMode
): null | PlannedHeadingDeletion {
  const { cursorOffset, sections, source, structure } = context;
  const section = findMarkdownSection(
    source.length,
    sections,
    cursorOffset
  );
  if (section === null) {
    return null;
  }

  const { heading } = section;
  const boundary = mode === 'heading-block'
    ? findBoundary(structure.headings, heading)
    : null;
  const range = mode === 'section'
    ? section.range
    : {
      from: heading.lineStart,
      to: boundary?.lineStart ?? heading.container.end
    };
  if (
    range.from < 0
    || range.from >= range.to
    || range.to > source.length
    || range.to > heading.container.end
  ) {
    return null;
  }
  return { heading, range };
}

function sourceLines(source: string, range: DeletionRange): string[] {
  return source
    .slice(range.from, range.to)
    .split('\n')
    .map((line) => line.replace(/\r$/u, ''));
}

function stripQuotePrefixes(line: string): string {
  return line.replace(/^(?:[\t ]*>[\t ]?)*/u, '');
}
