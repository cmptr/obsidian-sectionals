// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible type imports compact.
import type { MarkdownHeading, MarkdownRange } from './markdown-structure.ts';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible title imports compact.
import { deriveExtractionTitle, sanitizeFilenameStem } from './extraction-title.ts';
import { parseMarkdownStructure } from './markdown-structure.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible query imports compact.
import { collectMarkdownSections, findMarkdownSection } from './section-query.ts';

export type ExtractionInvalidReason =
  | 'cross-boundary-reference'
  | 'unusable-title';

export type ExtractionLineEnding = '\n' | '\r\n';

export interface ExtractionSourceEdit {
  readonly cursorOffset: number;
  readonly range: MarkdownRange;
  readonly replacement: string;
}

export interface SectionExtractionDraft {
  readonly destinationContent: string;
  readonly displayTitle: string;
  readonly filenameStem: string;
  readonly lineEnding: ExtractionLineEnding;
  readonly sectionRange: MarkdownRange;
  readonly sourceBodyRange: MarkdownRange;
}

export type SectionExtractionPlan =
  // eslint-disable-next-line no-restricted-syntax -- The approved API uses a compact discriminated union.
  | { readonly draft: SectionExtractionDraft; readonly kind: 'ready' }
  // eslint-disable-next-line no-restricted-syntax -- The approved API uses a compact discriminated union.
  | { readonly kind: 'invalid'; readonly reason: ExtractionInvalidReason }
  // eslint-disable-next-line no-restricted-syntax -- The approved API uses a compact discriminated union.
  | { readonly kind: 'unavailable' };

export function createExtractionSourceEdit(
  sourceLength: number,
  draft: SectionExtractionDraft,
  wikilink: string
): ExtractionSourceEdit {
  // eslint-disable-next-line no-useless-escape -- Escaped brackets keep wikilink delimiters explicit.
  const wikilinkMatch = /^\[\[(?<target>[^\[\]\r\n|]+)(?:\|(?<alias>[^\[\]\r\n|]+))?\]\]$/u
    .exec(wikilink);
  const target = wikilinkMatch?.groups?.['target'];
  const alias = wikilinkMatch?.groups?.['alias'];
  if (
    target === undefined
    || target.trim() === ''
    || alias?.trim() === ''
  ) {
    throw new TypeError('Wikilink must contain a non-empty target.');
  }

  const paragraphPrefix = `${draft.lineEnding}${draft.lineEnding}`;
  const paragraphSuffix = draft.sourceBodyRange.to < sourceLength
    ? paragraphPrefix
    : draft.lineEnding;
  return {
    cursorOffset: draft.sourceBodyRange.from + paragraphPrefix.length,
    range: draft.sourceBodyRange,
    replacement: `${paragraphPrefix}${wikilink}${paragraphSuffix}`
  };
}

export function planSectionExtraction(
  source: string,
  cursorOffset: number
): SectionExtractionPlan {
  const structure = parseMarkdownStructure(source);
  const sections = collectMarkdownSections(structure);
  const section = findMarkdownSection(source.length, sections, cursorOffset);
  if (section?.heading.container.depth !== 0) {
    return { kind: 'unavailable' };
  }

  const sourceBodyRange = {
    from: section.heading.syntaxEnd,
    to: section.range.to
  };
  const body = source.slice(sourceBodyRange.from, sourceBodyRange.to);
  const lineEnding = detectLineEnding(source, sourceBodyRange.from);
  const bodyAfterHeadingLineEnding = body.slice(
    getOwnedLineEndingLength(source, sourceBodyRange.from, lineEnding)
  );
  if (bodyAfterHeadingLineEnding.trim() === '') {
    return { kind: 'unavailable' };
  }

  const title = deriveExtractionTitle(
    collapseHeadingLineBoundaries(
      extractHeadingMarkup(source, section.heading)
    )
  );
  const filenameStem = sanitizeFilenameStem(title.displayTitle);
  if (filenameStem === null) {
    return { kind: 'invalid', reason: 'unusable-title' };
  }

  const descendants = structure.headings.filter((heading) =>
    heading.container.id === section.heading.container.id
    && heading.lineStart > section.heading.lineStart
    && heading.lineStart < section.range.to
  );
  const destinationBody = createDestinationBody(
    source,
    sourceBodyRange,
    lineEnding,
    section.heading,
    descendants
  );

  return {
    draft: {
      destinationContent: `# ${title.headingMarkup}${lineEnding}${lineEnding}${destinationBody}`,
      displayTitle: title.displayTitle,
      filenameStem,
      lineEnding,
      sectionRange: section.range,
      sourceBodyRange
    },
    kind: 'ready'
  };
}

function collapseHeadingLineBoundaries(headingMarkup: string): string {
  return headingMarkup.replaceAll(/[\t ]*\r?\n[\t ]*/gu, ' ');
}

function createDestinationBody(
  source: string,
  sourceBodyRange: MarkdownRange,
  lineEnding: ExtractionLineEnding,
  targetHeading: MarkdownHeading,
  descendants: readonly MarkdownHeading[]
): string {
  const contentStart = sourceBodyRange.from
    + getOwnedLineEndingLength(source, sourceBodyRange.from, lineEnding);
  let destinationBody = source.slice(contentStart, sourceBodyRange.to);
  const levelOffset = 1 - targetHeading.level;

  for (let index = descendants.length - 1; index >= 0; index -= 1) {
    const heading = descendants[index];
    if (heading === undefined) {
      continue;
    }

    const replacementFrom = heading.lineStart - contentStart;
    const replacementTo = heading.syntaxEnd - contentStart;
    const headingMarkup = collapseHeadingLineBoundaries(
      extractHeadingMarkup(source, heading)
    );
    const replacement = `${'#'.repeat(heading.level + levelOffset)} ${headingMarkup}`;
    destinationBody = destinationBody.slice(0, replacementFrom)
      + replacement
      + destinationBody.slice(replacementTo);
  }

  const withoutLeadingBlankLines = destinationBody.replace(
    /^(?:[\t ]*\r?\n)+/u,
    ''
  );
  return withoutLeadingBlankLines.replace(/(?:\r?\n[\t ]*)+$/u, '')
    + lineEnding;
}

function detectLineEnding(
  source: string,
  headingSyntaxEnd: number
): ExtractionLineEnding {
  return source.startsWith('\r\n', headingSyntaxEnd) ? '\r\n' : '\n';
}

function extractHeadingMarkup(
  source: string,
  heading: MarkdownHeading
): string {
  const headingSyntax = source.slice(heading.syntaxStart, heading.syntaxEnd);
  if (/^[\t ]{0,3}#{1,6}(?:[\t ]+|$)/u.test(headingSyntax)) {
    return headingSyntax
      .replace(/^[\t ]{0,3}#{1,6}(?:[\t ]+|$)/u, '')
      .replace(/[\t ]+#+[\t ]*$/u, '');
  }

  const underlineStart = headingSyntax.lastIndexOf('\n');
  return headingSyntax.slice(0, underlineStart).replace(/\r$/u, '');
}

function getOwnedLineEndingLength(
  source: string,
  headingSyntaxEnd: number,
  lineEnding: ExtractionLineEnding
): number {
  return source.startsWith(lineEnding, headingSyntaxEnd)
    ? lineEnding.length
    : 1;
}
