// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible structure imports compact.
import type { HeadingLevel, MarkdownHeading, MarkdownRange, MarkdownStructure } from './markdown-structure.ts';

export interface MarkdownSection {
  readonly heading: MarkdownHeading;
  readonly parent: MarkdownHeading | null;
  readonly range: MarkdownRange;
}

export function collectMarkdownSections(
  structure: MarkdownStructure
): readonly MarkdownSection[] {
  const ends = collectSectionEnds(structure.headings);
  const stacksByContainer = new Map<string, MarkdownHeading[]>();

  return structure.headings.map((heading) => {
    const stack = stacksByContainer.get(heading.container.id) ?? [];
    while ((stack.at(-1)?.level ?? 0) >= heading.level) {
      stack.pop();
    }

    const parent = stack.at(-1) ?? null;
    stack.push(heading);
    stacksByContainer.set(heading.container.id, stack);

    return {
      heading,
      parent,
      range: {
        from: heading.lineStart,
        to: ends.get(heading) ?? heading.container.end
      }
    };
  });
}

export function findMarkdownSection(
  sourceLength: number,
  sections: readonly MarkdownSection[],
  cursorOffset: number
): MarkdownSection | null {
  if (
    !Number.isSafeInteger(cursorOffset)
    || cursorOffset < 0
    || cursorOffset > sourceLength
  ) {
    return null;
  }

  let target: MarkdownSection | null = null;
  for (const section of sections) {
    if (!containsCursor(sourceLength, section.range, cursorOffset)) {
      continue;
    }
    if (
      target === null
      || section.heading.container.depth > target.heading.container.depth
      || (
        section.heading.container.depth === target.heading.container.depth
        && section.heading.lineStart > target.heading.lineStart
      )
    ) {
      target = section;
    }
  }
  return target;
}

export function findSiblingSections(
  sections: readonly MarkdownSection[],
  target: MarkdownSection
): readonly MarkdownSection[] {
  return sections.filter((section) =>
    section.heading.container.id === target.heading.container.id
    && section.heading.level === target.heading.level
    && section.parent === target.parent
  );
}

function collectSectionEnds(
  headings: readonly MarkdownHeading[]
): ReadonlyMap<MarkdownHeading, number> {
  const ends = new Map<MarkdownHeading, number>();
  const nextStartsByContainer = new Map<string, Map<HeadingLevel, number>>();

  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const heading = headings[index];
    if (heading === undefined) {
      continue;
    }

    const nextStartsByLevel = nextStartsByContainer.get(heading.container.id)
      ?? new Map<HeadingLevel, number>();
    let end = heading.container.end;
    for (const [level, nextStart] of nextStartsByLevel) {
      if (level <= heading.level && nextStart < end) {
        end = nextStart;
      }
    }

    ends.set(heading, end);
    nextStartsByLevel.set(heading.level, heading.lineStart);
    nextStartsByContainer.set(heading.container.id, nextStartsByLevel);
  }
  return ends;
}

function containsCursor(
  sourceLength: number,
  range: MarkdownRange,
  cursorOffset: number
): boolean {
  return (
    range.from <= cursorOffset
    && (
      cursorOffset < range.to
      || (cursorOffset === sourceLength && range.to === sourceLength)
    )
  );
}
