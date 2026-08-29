import { normalizePath } from 'obsidian';

import type { SectionExtractionDraft } from './section-extraction-planner.ts';

import { rewriteMarkdownTargets } from './extraction-dependencies.ts';
import { createNumberedFilename } from './extraction-title.ts';

export interface DestinationFile {
  readonly extension: string;
  readonly path: string;
}

export interface DestinationFolder {
  readonly path: string;
}

export interface ExtractionDestinationServices {
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly fileExists: (normalizedPath: string) => boolean;
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly getNewFileParent: (
    sourcePath: string,
    candidateFilename: string
  ) => DestinationFolder;
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly resolveLink: (
    linkpath: string,
    sourcePath: string
  ) => DestinationFile | null;
}

// eslint-disable-next-line perfectionist/sort-modules -- Keep the approved public interface order.
export type DestinationPreparation =
  // eslint-disable-next-line no-restricted-syntax -- The approved API uses a compact discriminated union.
  | { readonly kind: 'invalid'; readonly reason: 'unresolved-relative-link' }
  // eslint-disable-next-line no-restricted-syntax, perfectionist/sort-union-types -- Keep the approved compact union order.
  | {
    readonly content: string;
    readonly filename: string;
    readonly kind: 'ready';
    readonly path: string;
    readonly suffixIndex: number;
  };

export function createExtractionWikilink(
  shortestLinktext: string,
  displayTitle: string,
  createdBasename: string
): string {
  if (shortestLinktext.trim() === '' || displayTitle.trim() === '') {
    throw new TypeError('Wikilink target and display title must be non-empty.');
  }

  const target = escapeWikilinkComponent(shortestLinktext);
  if (
    shortestLinktext === displayTitle
    && createdBasename === displayTitle
  ) {
    return `[[${target}]]`;
  }
  return `[[${target}|${escapeWikilinkComponent(displayTitle)}]]`;
}

export function prepareExtractionDestination(
  draft: SectionExtractionDraft,
  sourcePath: string,
  services: ExtractionDestinationServices,
  startingSuffixIndex = 0
): DestinationPreparation {
  let suffixIndex = startingSuffixIndex;
  for (;;) {
    const filename = createNumberedFilename(draft.filenameStem, suffixIndex);
    assertFilenameComponent(filename);
    const parent = services.getNewFileParent(sourcePath, filename);
    const joinedPath = parent.path === ''
      ? filename
      : `${parent.path}/${filename}`;
    const path = normalizePosixPath(normalizePath(joinedPath));

    if (!services.fileExists(path)) {
      const destinationParentPath = getParentPath(path);
      const content = rewriteMarkdownTargets(
        draft.destinationContent,
        draft.relativeTargets,
        (target) => {
          const destinationFile = services.resolveLink(
            target.linkpath,
            sourcePath
          );
          if (destinationFile === null) {
            return null;
          }
          const targetPath = getWrittenTargetPath(
            destinationFile,
            target.explicitMarkdownExtension
          );
          return createRelativeMarkdownPath(destinationParentPath, targetPath);
        }
      );
      if (content === null) {
        return { kind: 'invalid', reason: 'unresolved-relative-link' };
      }
      return {
        content,
        filename,
        kind: 'ready',
        path,
        suffixIndex
      };
    }
    suffixIndex += 1;
  }
}

function assertFilenameComponent(filename: string): void {
  if (filename.includes('/') || filename.includes('\\')) {
    throw new TypeError('Extraction filename must not contain path separators.');
  }
}

function createRelativeMarkdownPath(
  fromFolderPath: string,
  targetPath: string
): string {
  const fromSegments = splitPath(fromFolderPath);
  const targetSegments = splitPath(targetPath);
  let commonSegmentCount = 0;
  while (
    commonSegmentCount < fromSegments.length
    && commonSegmentCount < targetSegments.length
    && fromSegments[commonSegmentCount]
      === targetSegments[commonSegmentCount]
  ) {
    commonSegmentCount += 1;
  }

  const parentSegments = Array.from(
    { length: fromSegments.length - commonSegmentCount },
    () => '..'
  );
  const relativeTargetSegments = targetSegments
    .slice(commonSegmentCount)
    .map((segment) => encodeMarkdownPathSegment(segment));
  return [...parentSegments, ...relativeTargetSegments].join('/');
}

function encodeMarkdownPathSegment(segment: string): string {
  const hexadecimalRadix = 16;
  return encodeURIComponent(segment).replaceAll(
    /[!'()*]/gu,
    (character) => `%${character.codePointAt(0)?.toString(hexadecimalRadix).toUpperCase() ?? ''}`
  );
}

function escapeWikilinkComponent(value: string): string {
  const escapedBackslashes = value.replaceAll('\\', '\\\\');
  return escapedBackslashes
    // eslint-disable-next-line unicorn/prefer-string-raw -- Escaping the delimiter requires a literal backslash prefix.
    .replaceAll('|', '\\|')
    // eslint-disable-next-line unicorn/prefer-string-raw -- Escaping the delimiter requires a literal backslash prefix.
    .replaceAll(']', '\\]');
}

function getParentPath(path: string): string {
  const finalSeparator = path.lastIndexOf('/');
  return finalSeparator === -1 ? '' : path.slice(0, finalSeparator);
}

function getWrittenTargetPath(
  file: DestinationFile,
  hasExplicitMarkdownExtension: boolean
): string {
  const normalizedPath = normalizePosixPath(normalizePath(file.path));
  if (hasExplicitMarkdownExtension || file.extension.toLowerCase() !== 'md') {
    return normalizedPath;
  }

  const extension = `.${file.extension}`;
  return normalizedPath.toLowerCase().endsWith(extension.toLowerCase())
    ? normalizedPath.slice(0, -extension.length)
    : normalizedPath;
}

function normalizePosixPath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        throw new TypeError('Vault path must not escape its root.');
      }
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

function splitPath(path: string): readonly string[] {
  return path === '' ? [] : path.split('/');
}
