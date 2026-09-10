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

export type StructuralPlanningContextProvider = (
  editor: object,
  source: string
) => StructuralPlanningContext;

interface EphemeralStructuralPlanningContextEntry {
  readonly context: StructuralPlanningContext;
  readonly editor: object;
  readonly generation: number;
  readonly source: string;
}

export function createEphemeralStructuralPlanningContextProvider(
  factory: typeof createStructuralPlanningContext = createStructuralPlanningContext,
  defer: (expire: () => void) => void = queueMicrotask
): StructuralPlanningContextProvider {
  let current: EphemeralStructuralPlanningContextEntry | null = null;
  let generation = 0;

  return (editor, source) => {
    if (current?.editor === editor && current.source === source) {
      return current.context;
    }

    const context = factory(source);
    generation += 1;
    const entry = { context, editor, generation, source };
    current = entry;
    defer(() => {
      if (current?.generation === entry.generation) {
        current = null;
      }
    });
    return context;
  };
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
