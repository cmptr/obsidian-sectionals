import type { HeadingLevel } from './markdown-structure.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible action type imports compact.
import type { ChangeSectionHierarchyAction, StructuralEditPlan } from './structural-action.ts';
import type { StructuralPlanningContext } from './structural-planning-context.ts';

import { planHeadingLevelRewrite } from './heading-level-rewriter.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible query imports compact.
import { findHeadingsInSection, findMarkdownSection, findPreviousSiblingSection } from './section-query.ts';
import { createStructuralPlanningContext } from './structural-planning-context.ts';

const MAX_HEADING_LEVEL: HeadingLevel = 6;
const MIN_HEADING_LEVEL: HeadingLevel = 1;

export function planSectionHierarchyChange(
  source: string,
  cursorOffset: number,
  action: ChangeSectionHierarchyAction
): null | StructuralEditPlan {
  return planSectionHierarchyChangeWithContext(
    createStructuralPlanningContext(source),
    cursorOffset,
    action
  );
}

export function planSectionHierarchyChangeWithContext(
  context: StructuralPlanningContext,
  cursorOffset: number,
  action: ChangeSectionHierarchyAction
): null | StructuralEditPlan {
  const { sections, source, structure } = context;
  if (
    !Number.isSafeInteger(cursorOffset)
    || cursorOffset < 0
    || cursorOffset > source.length
  ) {
    return null;
  }

  const target = findMarkdownSection(source.length, sections, cursorOffset);
  if (target === null) {
    return null;
  }

  const delta = action.mode === 'promote' ? -1 : 1;
  if (
    (delta === -1 && target.heading.level === MIN_HEADING_LEVEL)
    || (
      delta === 1
      && findPreviousSiblingSection(sections, target) === null
    )
  ) {
    return null;
  }

  const headings = findHeadingsInSection(structure, target);
  if (
    headings.some((heading) =>
      heading.level + delta < MIN_HEADING_LEVEL
      || heading.level + delta > MAX_HEADING_LEVEL
    )
  ) {
    return null;
  }

  const rewrites = headings.map((heading) =>
    planHeadingLevelRewrite(
      source,
      heading,
      (heading.level + delta) as HeadingLevel
    )
  );
  let replacement = source.slice(target.range.from, target.range.to);
  for (const rewrite of [...rewrites].reverse()) {
    const from = rewrite.range.from - target.range.from;
    const to = rewrite.range.to - target.range.from;
    replacement = replacement.slice(0, from)
      + rewrite.replacement
      + replacement.slice(to);
  }

  let mappedCursor = cursorOffset;
  let accumulatedDelta = 0;
  for (const rewrite of rewrites) {
    const rewriteDelta = rewrite.replacement.length
      - (rewrite.range.to - rewrite.range.from);
    if (cursorOffset < rewrite.range.from) {
      break;
    }
    if (cursorOffset <= rewrite.range.to) {
      mappedCursor = rewrite.mapOffset(cursorOffset) + accumulatedDelta;
      break;
    }
    accumulatedDelta += rewriteDelta;
    mappedCursor = cursorOffset + accumulatedDelta;
  }

  return {
    action,
    cursorOffset: mappedCursor,
    range: target.range,
    replacement
  };
}
