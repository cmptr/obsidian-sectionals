// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import {
  isSectionExtractionAvailable,
  isSectionExtractionAvailableWithContext
} from './section-extraction-availability.ts';
import { planSectionExtraction } from './section-extraction-planner.ts';
import { createStructuralPlanningContext } from './structural-planning-context.ts';

interface AvailabilityCase {
  readonly cursorOffset: number;
  readonly name: string;
  readonly source: string;
}

const AVAILABILITY_CASES: readonly AvailabilityCase[] = [
  {
    cursorOffset: -1,
    name: 'negative cursor',
    source: '# Heading\nbody\n'
  },
  {
    cursorOffset: 16,
    name: 'cursor beyond EOF',
    source: '# Heading\nbody\n'
  },
  {
    cursorOffset: 0.5,
    name: 'fractional cursor',
    source: '# Heading\nbody\n'
  },
  {
    cursorOffset: NaN,
    name: 'NaN cursor',
    source: '# Heading\nbody\n'
  },
  {
    cursorOffset: 2,
    name: 'plain text',
    source: 'plain text\n'
  },
  {
    cursorOffset: 3,
    name: 'empty ATX section',
    source: '# Empty\n'
  },
  {
    cursorOffset: 8,
    name: 'whitespace-only section',
    source: '# Empty\n \t \n'
  },
  {
    cursorOffset: 2,
    name: 'section containing only a descendant heading',
    source: '# Parent\n## Child\n'
  },
  {
    cursorOffset: 24,
    name: 'empty deepest child beneath a non-empty parent',
    source: '# Parent\nparent body\n## Empty child\n'
  },
  {
    cursorOffset: 6,
    name: 'root ATX section',
    source: '# ATX\nbody\n'
  },
  {
    cursorOffset: 16,
    name: 'root Setext section',
    source: 'Setext\n======\nbody\n'
  },
  {
    cursorOffset: 16,
    name: 'quoted section',
    source: '> ## Quoted\n> body\n'
  },
  {
    cursorOffset: 27,
    name: 'callout section',
    source: '> [!note]\n> ## Callout\n> body\n'
  },
  {
    cursorOffset: 8,
    name: 'CRLF section',
    source: '# CRLF\r\nbody\r\n'
  },
  {
    cursorOffset: 9,
    name: 'unusable but explainable title',
    source: '# /:*?\nbody\n'
  },
  {
    cursorOffset: 10,
    name: 'unresolved relative link handled during execution',
    source: '# Links\n[missing](missing.md)\n'
  },
  {
    cursorOffset: 2,
    name: 'cross-boundary reference',
    source: '# Extract\n[inside][shared]\n# Keep\n[shared]: note.md\n'
  }
];

describe('section extraction availability', () => {
  it.each(AVAILABILITY_CASES)(
    'matches full-planner availability for $name',
    ({ cursorOffset, source }) => {
      expect(isSectionExtractionAvailable(source, cursorOffset)).toBe(
        planSectionExtraction(source, cursorOffset).kind !== 'unavailable'
      );
    }
  );

  it.each(
    [
      ['unusable title', '# /:*?\nbody\n', 9],
      [
        'cross-boundary dependency',
        '# Extract\n[inside][shared]\n# Keep\n[shared]: note.md\n',
        2
      ]
    ] as const
  )('keeps an invalid-but-explainable %s available', (
    _name,
    source,
    cursorOffset
  ) => {
    expect(planSectionExtraction(source, cursorOffset).kind).toBe('invalid');
    expect(isSectionExtractionAvailable(source, cursorOffset)).toBe(true);
  });

  it('uses a supplied structural context for the deepest root-container section', () => {
    const source = '# Parent\nparent body\n## Child\nchild body\n';
    const context = createStructuralPlanningContext(source);

    expect(
      isSectionExtractionAvailableWithContext(
        context,
        source.indexOf('child body')
      )
    ).toBe(true);
  });
});
