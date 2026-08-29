import type { RelativeMarkdownTarget } from './extraction-dependencies.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible structure imports compact.
import type { MarkdownHeading, MarkdownRange } from './markdown-structure.ts';

import { analyzeExtractionDependencies } from './extraction-dependencies.ts';
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
  readonly relativeTargets: readonly RelativeMarkdownTarget[];
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
  if (!isCanonicalExtractionWikilink(wikilink)) {
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
  const destinationContent = `# ${title.headingMarkup}${lineEnding}${lineEnding}${destinationBody}`;
  const dependencyAnalysis = analyzeExtractionDependencies(
    source,
    section.range,
    destinationContent
  );
  if (dependencyAnalysis.kind === 'invalid') {
    return dependencyAnalysis;
  }

  return {
    draft: {
      destinationContent,
      displayTitle: title.displayTitle,
      filenameStem,
      lineEnding,
      relativeTargets: dependencyAnalysis.targets,
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

function isAllowedWikilinkEscape(
  escapedCharacter: string | undefined,
  isAlias: boolean
): boolean {
  return escapedCharacter === '\\'
    || escapedCharacter === '|'
    || escapedCharacter === ']'
    || (!isAlias && (escapedCharacter === '#' || escapedCharacter === '^'));
}

function isCanonicalExtractionWikilink(wikilink: string): boolean {
  const openingDelimiter = '[[';
  const closingDelimiter = ']]';
  if (
    !wikilink.startsWith(openingDelimiter)
    || !wikilink.endsWith(closingDelimiter)
  ) {
    return false;
  }

  const payload = wikilink.slice(
    openingDelimiter.length,
    -closingDelimiter.length
  );
  let componentFrom = 0;
  let isAlias = false;
  for (let index = 0; index < payload.length; index += 1) {
    const character = payload[index];
    if (character === '\\') {
      const escapedCharacter = payload[index + 1];
      if (!isAllowedWikilinkEscape(escapedCharacter, isAlias)) {
        return false;
      }
      index += 1;
    } else if (character === '|') {
      if (isAlias || payload.slice(componentFrom, index).trim() === '') {
        return false;
      }
      isAlias = true;
      componentFrom = index + 1;
    } else if (
      character === ']'
      || character === '\r'
      || character === '\n'
      || (!isAlias && (character === '#' || character === '^'))
    ) {
      return false;
    }
  }

  return payload.slice(componentFrom).trim() !== '';
}
