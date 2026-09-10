import type { MarkdownStructure } from './markdown-structure.ts';
import type { MarkdownSection } from './section-query.ts';

import { parseMarkdownStructure } from './markdown-structure.ts';
import { collectMarkdownSections } from './section-query.ts';

export type StructuralParser = (source: string) => MarkdownStructure;

export interface StructuralPlanningContext {
  readonly sections: readonly MarkdownSection[];
  readonly source: string;
  readonly structure: MarkdownStructure;
}

export function createStructuralPlanningContext(
  source: string,
  parse: StructuralParser = parseMarkdownStructure
): StructuralPlanningContext {
  const structure = parse(source);
  return {
    sections: collectMarkdownSections(structure),
    source,
    structure
  };
}
