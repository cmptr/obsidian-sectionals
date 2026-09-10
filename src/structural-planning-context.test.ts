// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it, vi } from 'vitest';

import { parseMarkdownStructure } from './markdown-structure.ts';
import { collectMarkdownSections } from './section-query.ts';
import { createStructuralPlanningContext } from './structural-planning-context.ts';

describe('structural planning context', () => {
  it('parses exactly once and derives sections from that structure', () => {
    const source = '# Root\n\n## Child\nBody\n';
    const structure = parseMarkdownStructure(source);
    const parse = vi.fn(() => structure);

    const context = createStructuralPlanningContext(source, parse);

    expect(parse).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledWith(source);
    expect(context).toEqual({
      sections: collectMarkdownSections(structure),
      source,
      structure
    });

    if (context.source !== source) {
      // @ts-expect-error -- Structural planning source is immutable.
      context.source = '';
      // @ts-expect-error -- Structural planning structure is immutable.
      context.structure = parseMarkdownStructure('');
      // @ts-expect-error -- Structural planning sections are immutable.
      context.sections = [];
      const [section] = context.sections;
      if (section !== undefined) {
        // @ts-expect-error -- Structural planning section collections are immutable.
        context.sections[0] = section;
      }
    }
  });

  it.each([
    {
      name: 'root source',
      source: '# Root\n\n## Child\nBody\n'
    },
    {
      name: 'quoted source',
      source: '> # Root\n>\n> ## Child\n> Body\n'
    },
    {
      name: 'protected source',
      source: '# Root\n\n```md\n## Protected\n```\n\n## Visible\n'
    },
    {
      name: 'CRLF source',
      source: '# Root\r\n\r\n## Child\r\nBody\r\n'
    },
    {
      name: 'empty source',
      source: ''
    }
  ])('matches direct parsing and section collection for $name', ({ source }) => {
    const structure = parseMarkdownStructure(source);

    expect(createStructuralPlanningContext(source)).toEqual({
      sections: collectMarkdownSections(structure),
      source,
      structure
    });
  });
});
