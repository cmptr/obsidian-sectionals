// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible type imports compact.
import type { MoveSectionAction, StructuralEditPlan } from './structural-action.ts';

import { parseMarkdownStructure } from './markdown-structure.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible query imports compact.
import { collectMarkdownSections, findMarkdownSection, findSiblingSections } from './section-query.ts';

export function planSectionMovement(
  source: string,
  cursorOffset: number,
  action: MoveSectionAction
): null | StructuralEditPlan {
  if (
    !Number.isSafeInteger(cursorOffset)
    || cursorOffset < 0
    || cursorOffset > source.length
  ) {
    return null;
  }

  const sections = collectMarkdownSections(parseMarkdownStructure(source));
  let target = findMarkdownSection(source.length, sections, cursorOffset);
  if (target === null) {
    return null;
  }

  let siblings = findSiblingSections(sections, target);
  if (siblings.length === 1 && target.parent !== null) {
    const parentHeading = target.parent;
    const parent = sections.find((section) => section.heading === parentHeading);
    if (parent !== undefined) {
      target = parent;
      siblings = findSiblingSections(sections, target);
    }
  }

  const sourceIndex = siblings.indexOf(target);
  let destinationIndex: number;
  switch (action.mode) {
    case 'down': {
      destinationIndex = sourceIndex + 1;
      break;
    }
    case 'end': {
      destinationIndex = siblings.length - 1;
      break;
    }
    case 'start': {
      destinationIndex = 0;
      break;
    }
    case 'up': {
      destinationIndex = sourceIndex - 1;
      break;
    }
    default: {
      return null;
    }
  }

  const destination = siblings[destinationIndex];
  if (
    sourceIndex === -1
    || destination === undefined
    || destinationIndex === sourceIndex
  ) {
    return null;
  }

  const targetText = source.slice(target.range.from, target.range.to);
  let from: number;
  let movedStart: number;
  let replacement: string;
  let to: number;
  if (sourceIndex > destinationIndex) {
    from = destination.range.from;
    to = target.range.to;
    replacement = targetText
      + source.slice(destination.range.from, target.range.from);
    movedStart = destination.range.from;
  } else {
    const intervening = source.slice(target.range.to, destination.range.to);
    from = target.range.from;
    to = destination.range.to;
    replacement = intervening + targetText;
    movedStart = target.range.from + intervening.length;
  }

  const mappedCursor = movedStart + (cursorOffset - target.range.from);
  return {
    action,
    cursorOffset: mappedCursor,
    range: { from, to },
    replacement
  };
}
