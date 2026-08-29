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

export class ExtractionSourceChangedError extends Error {
  public constructor() {
    super('Extraction source identity changed.');
    this.name = 'ExtractionSourceChangedError';
  }
}

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

interface CommitNoticeResult {
  readonly kind: 'notice';
  readonly notice: ExtractionNoticeDetails;
}

interface CommitRollbackResult {
  readonly kind: 'rollback';
  readonly notice: ExtractionNoticeDetails;
}

interface CommitSuccessResult {
  readonly kind: 'success';
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
  readonly intendedBasename: string;
  readonly intendedPath: string;
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

interface RollbackFailureNotice extends ExtractionNoticeDetails {
  readonly kind: 'destination-changed' | 'rollback-failed';
  readonly path: string;
}

interface FailedRollbackResult {
  readonly kind: 'failed';
  readonly notice: RollbackFailureNotice;
}

type CommitResult =
  | CommitNoticeResult
  | CommitRollbackResult
  | CommitSuccessResult;

type DestinationCreationResult<File extends ExtractionFile> =
  | CreatedDestination<File>
  | DestinationCreationFailure;

type RollbackResult = DeletedRollbackResult | FailedRollbackResult;

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
  if (!doesCreatedDestinationMatch(creation)) {
    notify(createDestinationChangedNotice(creation.intendedPath));
    return true;
  }

  let initialEdit: ExtractionSourceEdit;
  try {
    initialEdit = buildSourceEdit(
      creation.file,
      sourcePath,
      originalSource.length,
      plan.draft,
      runtime
    );
  } catch {
    if (!doesCreatedDestinationMatch(creation)) {
      notify(createDestinationChangedNotice(creation.intendedPath));
      return true;
    }
    await notifyAfterRollback(
      runtime,
      creation,
      { kind: 'source-edit-failed' },
      notify
    );
    return true;
  }
  if (!doesCreatedDestinationMatch(creation)) {
    notify(createDestinationChangedNotice(creation.intendedPath));
    return true;
  }

  const initialSourceFailure = getSourceSnapshotFailure(
    editor,
    originalSource
  );
  if (initialSourceFailure !== null) {
    await notifyAfterRollback(
      runtime,
      creation,
      initialSourceFailure,
      notify
    );
    return true;
  }
  if (!doesCreatedDestinationMatch(creation)) {
    notify(createDestinationChangedNotice(creation.intendedPath));
    return true;
  }

  let destinationContent: string;
  try {
    destinationContent = await runtime.read(creation.file);
  } catch {
    notify(createRollbackFailedNotice(creation.intendedPath));
    return true;
  }
  if (!doesCreatedDestinationMatch(creation)) {
    notify(createDestinationChangedNotice(creation.intendedPath));
    return true;
  }
  if (destinationContent !== creation.preparation.content) {
    notify(createDestinationChangedNotice(creation.intendedPath));
    return true;
  }

  const commit = commitSourceExtraction(
    editor,
    originalSource,
    sourcePath,
    plan.draft,
    initialEdit,
    runtime,
    creation
  );
  if (commit.kind === 'success') {
    return true;
  }
  if (commit.kind === 'notice') {
    notify(commit.notice);
    return true;
  }

  await notifyAfterRollback(
    runtime,
    creation,
    commit.notice,
    notify
  );
  return true;
}

function areSourceEditsEqual(
  first: ExtractionSourceEdit,
  second: ExtractionSourceEdit
): boolean {
  return first.cursorOffset === second.cursorOffset
    && first.range.from === second.range.from
    && first.range.to === second.range.to
    && first.replacement === second.replacement;
}

function buildSourceEdit<File extends ExtractionFile>(
  file: File,
  sourcePath: string,
  sourceLength: number,
  draft: SectionExtractionDraft,
  runtime: ExtractionRuntime<File>
): ExtractionSourceEdit {
  const linktext = runtime.getLinktext(file, sourcePath);
  const wikilink = createExtractionWikilink(
    linktext,
    draft.displayTitle,
    file.basename
  );
  return createExtractionSourceEdit(sourceLength, draft, wikilink);
}

function createSourceOperationFailure(
  error: unknown
): ExtractionNoticeDetails {
  return {
    kind: error instanceof ExtractionSourceChangedError
      ? 'source-changed'
      : 'source-edit-failed'
  };
}

function getPreReplacementFailure<File extends ExtractionFile>(
  error: unknown,
  creation: CreatedDestination<File>
): CommitResult | null {
  if (!doesCreatedDestinationMatch(creation)) {
    return createCommitDestinationChanged(creation.intendedPath);
  }
  return error instanceof ExtractionSourceChangedError
    ? { kind: 'rollback', notice: { kind: 'source-changed' } }
    : null;
}

function commitSourceExtraction<File extends ExtractionFile>(
  editor: ExtractionEditor,
  originalSource: string,
  sourcePath: string,
  draft: SectionExtractionDraft,
  initialEdit: ExtractionSourceEdit,
  runtime: ExtractionRuntime<File>,
  creation: CreatedDestination<File>
): CommitResult {
  if (!doesCreatedDestinationMatch(creation)) {
    return createCommitDestinationChanged(creation.intendedPath);
  }

  const sourceFailure = getSourceSnapshotFailure(editor, originalSource);
  if (sourceFailure !== null) {
    return { kind: 'rollback', notice: sourceFailure };
  }

  let finalEdit: ExtractionSourceEdit;
  try {
    finalEdit = buildSourceEdit(
      creation.file,
      sourcePath,
      originalSource.length,
      draft,
      runtime
    );
  } catch {
    if (!doesCreatedDestinationMatch(creation)) {
      return createCommitDestinationChanged(creation.intendedPath);
    }
    return { kind: 'rollback', notice: { kind: 'source-edit-failed' } };
  }
  if (!doesCreatedDestinationMatch(creation)) {
    return createCommitDestinationChanged(creation.intendedPath);
  }
  const edit = areSourceEditsEqual(initialEdit, finalEdit)
    ? initialEdit
    : finalEdit;

  let from: ReturnType<ExtractionEditor['offsetToPos']>;
  let to: ReturnType<ExtractionEditor['offsetToPos']>;
  try {
    from = editor.offsetToPos(edit.range.from);
    to = editor.offsetToPos(edit.range.to);
  } catch (error) {
    if (!doesCreatedDestinationMatch(creation)) {
      return createCommitDestinationChanged(creation.intendedPath);
    }
    return { kind: 'rollback', notice: createSourceOperationFailure(error) };
  }
  if (!doesCreatedDestinationMatch(creation)) {
    return createCommitDestinationChanged(creation.intendedPath);
  }

  const finalSourceFailure = getSourceSnapshotFailure(editor, originalSource);
  if (finalSourceFailure !== null) {
    return { kind: 'rollback', notice: finalSourceFailure };
  }
  if (!doesCreatedDestinationMatch(creation)) {
    return createCommitDestinationChanged(creation.intendedPath);
  }

  const expectedSource = originalSource.slice(0, edit.range.from)
    + edit.replacement
    + originalSource.slice(edit.range.to);
  let didReplacementThrow = false;
  try {
    editor.replaceRange(edit.replacement, from, to);
  } catch (error) {
    const replacementFailure = getPreReplacementFailure(error, creation);
    if (replacementFailure !== null) {
      return replacementFailure;
    }
    didReplacementThrow = true;
  }

  let sourceAfterReplacement: string;
  try {
    sourceAfterReplacement = editor.getValue();
  } catch {
    return createIndeterminateCommitNotice(creation.intendedPath);
  }
  if (!doesCreatedDestinationMatch(creation)) {
    return createCommitDestinationChanged(creation.intendedPath);
  }
  if (sourceAfterReplacement === originalSource) {
    return {
      kind: 'rollback',
      notice: { kind: 'source-edit-failed' }
    };
  }
  if (sourceAfterReplacement !== expectedSource) {
    return createIndeterminateCommitNotice(creation.intendedPath);
  }
  if (didReplacementThrow) {
    return { kind: 'notice', notice: { kind: 'source-edit-failed' } };
  }

  try {
    editor.setCursor(editor.offsetToPos(edit.cursorOffset));
  } catch {
    return { kind: 'notice', notice: { kind: 'source-edit-failed' } };
  }
  return { kind: 'success' };
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

    let file: File;
    try {
      file = await runtime.create(preparation.path, preparation.content);
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
      continue;
    }

    const creation: CreatedDestination<File> = {
      file,
      intendedBasename: getExpectedBasename(preparation.filename),
      intendedPath: preparation.path,
      kind: 'created',
      preparation
    };
    if (!doesCreatedDestinationMatch(creation)) {
      return {
        kind: 'failed',
        notice: createDestinationChangedNotice(creation.intendedPath)
      };
    }
    return creation;
  }
}

function createCommitDestinationChanged(path: string): CommitNoticeResult {
  return { kind: 'notice', notice: createDestinationChangedNotice(path) };
}

function createDestinationChangedNotice(
  path: string
): RollbackFailureNotice {
  return { kind: 'destination-changed', path };
}

function createIndeterminateCommitNotice(path: string): CommitNoticeResult {
  return {
    kind: 'notice',
    notice: { kind: 'indeterminate-source-mutation', path }
  };
}

function createRollbackFailedNotice(path: string): RollbackFailureNotice {
  return { kind: 'rollback-failed', path };
}

function doesCreatedDestinationMatch<File extends ExtractionFile>(
  creation: CreatedDestination<File>
): boolean {
  try {
    return creation.file.path === creation.intendedPath
      && creation.file.basename === creation.intendedBasename;
  } catch {
    return false;
  }
}

function getExpectedBasename(filename: string): string {
  const markdownExtension = '.md';
  return filename.endsWith(markdownExtension)
    ? filename.slice(0, -markdownExtension.length)
    : filename;
}

function getSourceSnapshotFailure(
  editor: ExtractionEditor,
  originalSource: string
): ExtractionNoticeDetails | null {
  try {
    return editor.getValue() === originalSource
      ? null
      : { kind: 'source-changed' };
  } catch (error) {
    return createSourceOperationFailure(error);
  }
}

async function notifyAfterRollback<File extends ExtractionFile>(
  runtime: ExtractionRuntime<File>,
  creation: CreatedDestination<File>,
  successNotice: ExtractionNoticeDetails,
  notify: (details: ExtractionNoticeDetails) => void
): Promise<void> {
  const rollback = await rollbackCreatedFile(runtime, creation);
  notify(rollback.kind === 'deleted' ? successNotice : rollback.notice);
}

async function rollbackCreatedFile<File extends ExtractionFile>(
  runtime: ExtractionRuntime<File>,
  creation: CreatedDestination<File>
): Promise<RollbackResult> {
  if (!doesCreatedDestinationMatch(creation)) {
    return {
      kind: 'failed',
      notice: createDestinationChangedNotice(creation.intendedPath)
    };
  }

  let liveContent: string;
  try {
    liveContent = await runtime.read(creation.file);
  } catch {
    return {
      kind: 'failed',
      notice: createRollbackFailedNotice(creation.intendedPath)
    };
  }
  if (!doesCreatedDestinationMatch(creation)) {
    return {
      kind: 'failed',
      notice: createDestinationChangedNotice(creation.intendedPath)
    };
  }
  if (liveContent !== creation.preparation.content) {
    return {
      kind: 'failed',
      notice: createDestinationChangedNotice(creation.intendedPath)
    };
  }
  if (!doesCreatedDestinationMatch(creation)) {
    return {
      kind: 'failed',
      notice: createDestinationChangedNotice(creation.intendedPath)
    };
  }

  try {
    await runtime.delete(creation.file);
  } catch {
    return {
      kind: 'failed',
      notice: createRollbackFailedNotice(creation.intendedPath)
    };
  }
  if (!doesCreatedDestinationMatch(creation)) {
    return {
      kind: 'failed',
      notice: createRollbackFailedNotice(creation.intendedPath)
    };
  }
  return { kind: 'deleted' };
}

/* eslint-enable perfectionist/sort-modules -- Transaction module definitions are complete. */
