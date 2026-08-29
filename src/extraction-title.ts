import { parser } from '@lezer/markdown';

import { decodeMarkdownCharacterReference } from './markdown-character-reference.ts';

export const MAX_FILENAME_STEM_BYTES = 180;

export interface ExtractionTitle {
  readonly displayTitle: string;
  readonly headingMarkup: string;
}

interface MarkdownRange {
  readonly from: number;
  readonly to: number;
}

interface VisibleTextReplacement extends MarkdownRange {
  readonly text: string;
}

const HIDDEN_INLINE_NODE_NAMES = new Set([
  'CodeMark',
  'Comment',
  'EmphasisMark',
  'HTMLTag',
  'LinkLabel',
  'LinkMark',
  'LinkTitle',
  'ProcessingInstruction'
]);
const PROTECTED_HEADING_MARKUP_NODE_NAMES = new Set([
  'Comment',
  'HTMLTag',
  'InlineCode',
  'LinkLabel',
  'LinkTitle',
  'ProcessingInstruction',
  'URL'
]);
const C0_CONTROL_CHARACTER_MAX = 0x1F;
const C1_CONTROL_CHARACTER_MAX = 0x9F;
const C1_CONTROL_CHARACTER_MIN = 0x7F;
const FILENAME_EXTENSION = '.md';
const RESERVED_FILENAME_CHARACTERS = new Set(String.raw`/\:*?"<>|#^[]`);
const TERMINAL_BLOCK_ID = /\s+\^[a-z\d-]+\s*$/iu;
const TITLE_WHITESPACE = /\s+/gu;
const TRIMMABLE_FILENAME_EDGES = /^[. ]+|[. ]+$/gu;
const UTF8_ENCODER = new TextEncoder();

export function createNumberedFilename(
  baseStem: string,
  collisionIndex: number
): string {
  if (!Number.isSafeInteger(collisionIndex) || collisionIndex < 0) {
    throw new RangeError('Collision index must be a non-negative safe integer.');
  }

  const suffix = collisionIndex === 0 ? '' : ` ${String(collisionIndex)}`;
  const availableBaseBytes = MAX_FILENAME_STEM_BYTES - utf8ByteLength(suffix);
  const shortenedBase = shortenFilenameStem(baseStem, availableBaseBytes);

  return `${shortenedBase}${suffix}${FILENAME_EXTENSION}`;
}

export function deriveExtractionTitle(headingMarkup: string): ExtractionTitle {
  const markupWithoutBlockId = headingMarkup.replace(TERMINAL_BLOCK_ID, '');
  const normalizedMarkup = normalizeHeadingMarkup(markupWithoutBlockId);

  return {
    displayTitle: deriveVisibleText(normalizedMarkup),
    headingMarkup: normalizedMarkup
  };
}

export function sanitizeFilenameStem(displayTitle: string): null | string {
  const portableCharacters = Array.from(
    displayTitle,
    (character) => isFilenameCharacterReserved(character) ? ' ' : character
  ).join('');
  const filenameStem = normalizeTitleWhitespace(portableCharacters).replaceAll(
    TRIMMABLE_FILENAME_EDGES,
    ''
  );

  return filenameStem === '' ? null : filenameStem;
}

function collapseTitleWhitespace(title: string): string {
  return title.replaceAll(TITLE_WHITESPACE, ' ');
}

function deriveVisibleText(headingMarkup: string): string {
  const replacements: VisibleTextReplacement[] = [];

  parser.parse(headingMarkup).iterate({
    enter(node) {
      if (
        HIDDEN_INLINE_NODE_NAMES.has(node.name)
        || (node.name === 'URL' && node.node.parent?.name !== 'Autolink')
      ) {
        replacements.push({ from: node.from, text: '', to: node.to });
      } else if (node.name === 'Entity') {
        replacements.push({
          from: node.from,
          text: decodeMarkdownCharacterReference(
            headingMarkup.slice(node.from, node.to)
          ),
          to: node.to
        });
      } else if (node.name === 'Escape') {
        replacements.push({
          from: node.from,
          text: headingMarkup.slice(node.from + 1, node.to),
          to: node.to
        });
      }
    }
  });

  let sourceOffset = 0;
  let visibleText = '';
  for (const replacement of replacements) {
    visibleText += headingMarkup.slice(sourceOffset, replacement.from);
    visibleText += replacement.text;
    sourceOffset = replacement.to;
  }
  visibleText += headingMarkup.slice(sourceOffset);

  return normalizeTitleWhitespace(visibleText);
}

function isFilenameCharacterReserved(character: string): boolean {
  const characterCode = character.codePointAt(0);
  if (characterCode === undefined) {
    return false;
  }
  return (
    characterCode <= C0_CONTROL_CHARACTER_MAX
    || (
      characterCode >= C1_CONTROL_CHARACTER_MIN
      && characterCode <= C1_CONTROL_CHARACTER_MAX
    )
    || RESERVED_FILENAME_CHARACTERS.has(character)
  );
}

function normalizeHeadingMarkup(headingMarkup: string): string {
  const protectedRanges: MarkdownRange[] = [];
  parser.parse(headingMarkup).iterate({
    enter(node) {
      if (PROTECTED_HEADING_MARKUP_NODE_NAMES.has(node.name)) {
        protectedRanges.push({ from: node.from, to: node.to });
      }
    }
  });

  let normalizedMarkup = '';
  let sourceOffset = 0;
  for (const range of protectedRanges) {
    normalizedMarkup += collapseTitleWhitespace(
      headingMarkup.slice(sourceOffset, range.from)
    );
    normalizedMarkup += headingMarkup.slice(range.from, range.to);
    sourceOffset = range.to;
  }
  normalizedMarkup += collapseTitleWhitespace(headingMarkup.slice(sourceOffset));
  return normalizedMarkup.trim();
}

function normalizeTitleWhitespace(title: string): string {
  return collapseTitleWhitespace(title).trim();
}

function shortenFilenameStem(filenameStem: string, maximumBytes: number): string {
  if (utf8ByteLength(filenameStem) <= maximumBytes) {
    return filenameStem;
  }

  let shortenedStem = '';
  let shortenedBytes = 0;
  for (const character of filenameStem) {
    const characterBytes = utf8ByteLength(character);
    if (shortenedBytes + characterBytes > maximumBytes) {
      break;
    }
    shortenedStem += character;
    shortenedBytes += characterBytes;
  }

  const wordBoundary = shortenedStem.lastIndexOf(' ');
  if (wordBoundary > 0) {
    return shortenedStem
      .slice(0, wordBoundary)
      .replaceAll(TRIMMABLE_FILENAME_EDGES, '');
  }
  return shortenedStem.replaceAll(TRIMMABLE_FILENAME_EDGES, '');
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}
