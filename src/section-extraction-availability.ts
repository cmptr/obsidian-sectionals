import type { StructuralPlanningContext } from './structural-planning-context.ts';

import { findMarkdownSection } from './section-query.ts';
import { createStructuralPlanningContext } from './structural-planning-context.ts';

const CRLF_LENGTH = 2;

export function isSectionExtractionAvailable(
  source: string,
  cursorOffset: number
): boolean {
  return isSectionExtractionAvailableWithContext(
    createStructuralPlanningContext(source),
    cursorOffset
  );
}

export function isSectionExtractionAvailableWithContext(
  context: StructuralPlanningContext,
  cursorOffset: number
): boolean {
  const section = findMarkdownSection(
    context.source.length,
    context.sections,
    cursorOffset
  );
  if (section?.heading.container.depth !== 0) {
    return false;
  }

  let bodyStart = section.heading.syntaxEnd;
  if (context.source.startsWith('\r\n', bodyStart)) {
    bodyStart += CRLF_LENGTH;
  } else if (context.source[bodyStart] === '\n') {
    bodyStart += 1;
  }
  return context.source.slice(bodyStart, section.range.to).trim() !== '';
}
