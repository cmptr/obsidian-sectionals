/* eslint-disable perfectionist/sort-modules -- Keep the approved public contracts first and transaction helpers near their consumers. */

import type { Editor } from 'obsidian';

import type {
  DestinationFile,
  DestinationFolder,
  DestinationPreparation,
  ExtractionDestinationServices
} from './section-extraction-destination.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner type imports compact.
import type { ExtractionSourceEdit, SectionExtractionDraft } from './section-extraction-planner.ts';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible destination imports compact.
import { createExtractionWikilink, prepareExtractionDestination } from './section-extraction-destination.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible planner imports compact.
import { createExtractionSourceEdit, planSectionExtraction } from './section-extraction-planner.ts';

const MAXIMUM_SUFFIX_ATTEMPTS = 10_000;

export interface ExtractionEditor {
  readonly getCursor: Editor['getCursor'];
  readonly getValue: Editor['getValue'];
  readonly offsetToPos: Editor['offsetToPos'];
  readonly posToOffset: Editor['posToOffset'];
  readonly replaceRange: Editor['replaceRange'];
  readonly setCursor: Editor['setCursor'];
}

export interface ExtractionFile {
  readonly basename: string;
  readonly path: string;
}

export interface ExtractionRuntime<File extends ExtractionFile> {
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly create: (path: string, content: string) => Promise<File>;
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly delete: (file: File) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly fileExists: (path: string) => boolean;
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly getLinktext: (file: File, sourcePath: string) => string;
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly getNewFileParent: (
    sourcePath: string,
    candidateFilename: string
  ) => DestinationFolder;
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly read: (file: File) => Promise<string>;
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly resolveLink: (
    linkpath: string,
    sourcePath: string
  ) => DestinationFile | null;
}

export type ExtractionNotice =
  | 'create-failed'
  | 'cross-boundary-reference'
  | 'destination-changed'
  | 'indeterminate-source-mutation'
  | 'rollback-failed'
  | 'source-changed'
  | 'source-edit-failed'
  | 'unresolved-relative-link'
  | 'unusable-title';

export interface ExtractionNoticeDetails {
  readonly kind: ExtractionNotice;
  readonly path?: string;
}

interface DestinationReadyDiscriminant {
  readonly kind: 'ready';
}

type ReadyDestinationPreparation = Extract<
  DestinationPreparation,
  DestinationReadyDiscriminant
>;

interface CreatedDestination<File extends ExtractionFile> {
  readonly file: File;
  readonly kind: 'created';
  readonly preparation: ReadyDestinationPreparation;
}

interface DeletedRollbackResult {
  readonly kind: 'deleted';
}

interface DestinationCreationFailure {
  readonly kind: 'failed';
  readonly notice: ExtractionNoticeDetails;
}

interface RetainedRollbackNotice extends ExtractionNoticeDetails {
  readonly kind: 'destination-changed' | 'rollback-failed';
  readonly path: string;
}

interface RetainedRollbackResult {
  readonly kind: 'retained';
  readonly notice: RetainedRollbackNotice;
}

type DestinationCreationResult<File extends ExtractionFile> =
  | CreatedDestination<File>
  | DestinationCreationFailure;

type RollbackResult = DeletedRollbackResult | RetainedRollbackResult;

// eslint-disable-next-line unicorn/consistent-boolean-name -- The approved executor name describes an action whose result reports handling.
export async function executeSectionExtraction<File extends ExtractionFile>(
  editor: ExtractionEditor,
  sourcePath: string,
  runtime: ExtractionRuntime<File>,
  notify: (details: ExtractionNoticeDetails) => void,
  planner: typeof planSectionExtraction = planSectionExtraction
): Promise<boolean> {
  const originalSource = editor.getValue();
  const cursorOffset = editor.posToOffset(editor.getCursor('head'));
  const plan = planner(originalSource, cursorOffset);
  if (plan.kind === 'unavailable') {
    return false;
  }
  if (plan.kind === 'invalid') {
    notify({ kind: plan.reason });
    return true;
  }

  const creation = await createDestination(
    plan.draft,
    sourcePath,
    runtime
  );
  if (creation.kind === 'failed') {
    notify(creation.notice);
    return true;
  }

  const { file, preparation } = creation;
  let edit: ExtractionSourceEdit;
  try {
    const linktext = runtime.getLinktext(file, sourcePath);
    const wikilink = createExtractionWikilink(
      linktext,
      plan.draft.displayTitle,
      file.basename
    );
    edit = createExtractionSourceEdit(
      originalSource.length,
      plan.draft,
      wikilink
    );
  } catch {
    await notifyAfterRollback(
      runtime,
      file,
      preparation.content,
      { kind: 'source-edit-failed' },
      notify
    );
    return true;
  }

  if (
    !await doesSourceSnapshotMatchOrNotify(
      editor,
      originalSource,
      runtime,
      file,
      preparation.content,
      notify
    )
  ) {
    return true;
  }

  let destinationContent: string;
  try {
    destinationContent = await runtime.read(file);
  } catch {
    notify({ kind: 'rollback-failed', path: file.path });
    return true;
  }
  if (destinationContent !== preparation.content) {
    notify({ kind: 'destination-changed', path: file.path });
    return true;
  }
  if (
    !await doesSourceSnapshotMatchOrNotify(
      editor,
      originalSource,
      runtime,
      file,
      preparation.content,
      notify
    )
  ) {
    return true;
  }

  let from: ReturnType<ExtractionEditor['offsetToPos']>;
  let to: ReturnType<ExtractionEditor['offsetToPos']>;
  try {
    from = editor.offsetToPos(edit.range.from);
    to = editor.offsetToPos(edit.range.to);
  } catch {
    await notifyAfterRollback(
      runtime,
      file,
      preparation.content,
      { kind: 'source-edit-failed' },
      notify
    );
    return true;
  }

  const expectedSource = originalSource.slice(0, edit.range.from)
    + edit.replacement
    + originalSource.slice(edit.range.to);
  let didReplacementThrow = false;
  try {
    editor.replaceRange(edit.replacement, from, to);
  } catch {
    didReplacementThrow = true;
  }

  let sourceAfterReplacement: string;
  try {
    sourceAfterReplacement = editor.getValue();
  } catch {
    notify({ kind: 'indeterminate-source-mutation', path: file.path });
    return true;
  }
  if (sourceAfterReplacement === originalSource) {
    await notifyAfterRollback(
      runtime,
      file,
      preparation.content,
      { kind: 'source-edit-failed' },
      notify
    );
    return true;
  }
  if (sourceAfterReplacement !== expectedSource) {
    notify({ kind: 'indeterminate-source-mutation', path: file.path });
    return true;
  }
  if (didReplacementThrow) {
    notify({ kind: 'source-edit-failed' });
    return true;
  }

  try {
    editor.setCursor(editor.offsetToPos(edit.cursorOffset));
  } catch {
    notify({ kind: 'source-edit-failed' });
  }
  return true;
}

async function createDestination<File extends ExtractionFile>(
  draft: SectionExtractionDraft,
  sourcePath: string,
  runtime: ExtractionRuntime<File>
): Promise<DestinationCreationResult<File>> {
  let suffixAttempts = 0;
  let startingSuffixIndex = 0;
  const services: ExtractionDestinationServices = {
    fileExists(path) {
      if (suffixAttempts >= MAXIMUM_SUFFIX_ATTEMPTS) {
        throw new RangeError('Extraction suffix safety limit reached.');
      }
      suffixAttempts += 1;
      return runtime.fileExists(path);
    },
    getNewFileParent: runtime.getNewFileParent,
    resolveLink: runtime.resolveLink
  };

  for (;;) {
    let preparation: DestinationPreparation;
    try {
      preparation = prepareExtractionDestination(
        draft,
        sourcePath,
        services,
        startingSuffixIndex
      );
    } catch {
      return { kind: 'failed', notice: { kind: 'create-failed' } };
    }
    if (preparation.kind === 'invalid') {
      return { kind: 'failed', notice: { kind: preparation.reason } };
    }

    try {
      return {
        file: await runtime.create(preparation.path, preparation.content),
        kind: 'created',
        preparation
      };
    } catch {
      let isCollision = false;
      try {
        isCollision = runtime.fileExists(preparation.path);
      } catch {
        // A failed collision probe cannot justify another create attempt.
      }
      if (!isCollision || suffixAttempts >= MAXIMUM_SUFFIX_ATTEMPTS) {
        return { kind: 'failed', notice: { kind: 'create-failed' } };
      }
      startingSuffixIndex = preparation.suffixIndex + 1;
    }
  }
}

async function doesSourceSnapshotMatchOrNotify<
  File extends ExtractionFile
>(
  editor: ExtractionEditor,
  originalSource: string,
  runtime: ExtractionRuntime<File>,
  file: File,
  writtenContent: string,
  notify: (details: ExtractionNoticeDetails) => void
): Promise<boolean> {
  let failureNotice: ExtractionNoticeDetails;
  try {
    if (editor.getValue() === originalSource) {
      return true;
    }
    failureNotice = { kind: 'source-changed' };
  } catch {
    failureNotice = { kind: 'source-edit-failed' };
  }
  await notifyAfterRollback(
    runtime,
    file,
    writtenContent,
    failureNotice,
    notify
  );
  return false;
}

async function notifyAfterRollback<File extends ExtractionFile>(
  runtime: ExtractionRuntime<File>,
  file: File,
  writtenContent: string,
  successNotice: ExtractionNoticeDetails,
  notify: (details: ExtractionNoticeDetails) => void
): Promise<void> {
  const rollback = await rollbackCreatedFile(runtime, file, writtenContent);
  notify(rollback.kind === 'deleted' ? successNotice : rollback.notice);
}

async function rollbackCreatedFile<File extends ExtractionFile>(
  runtime: ExtractionRuntime<File>,
  file: File,
  writtenContent: string
): Promise<RollbackResult> {
  let liveContent: string;
  try {
    liveContent = await runtime.read(file);
  } catch {
    return {
      kind: 'retained',
      notice: { kind: 'rollback-failed', path: file.path }
    };
  }
  if (liveContent !== writtenContent) {
    return {
      kind: 'retained',
      notice: { kind: 'destination-changed', path: file.path }
    };
  }

  try {
    await runtime.delete(file);
  } catch {
    return {
      kind: 'retained',
      notice: { kind: 'rollback-failed', path: file.path }
    };
  }
  return { kind: 'deleted' };
}

/* eslint-enable perfectionist/sort-modules -- Transaction module definitions are complete. */
