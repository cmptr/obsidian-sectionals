/* eslint-disable perfectionist/sort-modules -- Keep the approved public contracts first and transaction helpers near their consumers. */

import type { Editor } from 'obsidian';

import type {
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

export class ExtractionPreDelegationSourceChangedError extends ExtractionSourceChangedError {
  public constructor() {
    super();
    this.name = 'ExtractionPreDelegationSourceChangedError';
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
  readonly extension: string;
  readonly path: string;
}

export type ExtractionCreateResult<File extends ExtractionFile> =
  // eslint-disable-next-line no-restricted-syntax -- The approved API uses a compact discriminated union.
  | { readonly file: File; readonly kind: 'created' }
  // eslint-disable-next-line no-restricted-syntax -- The approved API uses a compact discriminated union.
  | { readonly kind: 'collision' }
  // eslint-disable-next-line no-restricted-syntax -- The approved API uses a compact discriminated union.
  | { readonly kind: 'failed' };

export type ExtractionExecution<File extends ExtractionFile> =
  // eslint-disable-next-line no-restricted-syntax -- The approved API uses a compact discriminated union.
  | { readonly mode: 'linked' }
  // eslint-disable-next-line no-restricted-syntax -- The approved API uses a compact discriminated union.
  | {
    readonly mode: 'open';
    // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved execution contract uses a readonly function property.
    readonly openCreatedFile: (file: File) => Promise<void>;
  };

export interface ExtractionRuntime<File extends ExtractionFile> {
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly create: (
    path: string,
    content: string
  ) => Promise<ExtractionCreateResult<File>>;
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
  readonly isCurrentFile: (file: File, expectedNormalizedPath: string) => boolean;
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly read: (file: File) => Promise<string>;
  // eslint-disable-next-line @typescript-eslint/method-signature-style -- The approved service contract uses readonly function properties.
  readonly resolveLink: (
    linkpath: string,
    sourcePath: string
  ) => File | null;
}

export type ExtractionNotice =
  | 'create-failed'
  | 'cross-boundary-reference'
  | 'destination-changed'
  | 'destination-unverified'
  | 'indeterminate-source-mutation'
  | 'open-failed'
  | 'relative-link-target-changed'
  | 'source-changed-note-kept'
  | 'source-changed'
  | 'source-edit-failed-note-kept'
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

interface CommitSuccessResult {
  readonly edit: ExtractionSourceEdit;
  readonly kind: 'success';
  readonly sourceNotice?: ExtractionNoticeDetails;
}

type ReadyDestinationPreparation<File extends ExtractionFile> = Extract<
  DestinationPreparation<File>,
  // eslint-disable-next-line no-restricted-syntax -- The approved generic preparation contract uses a compact discriminant.
  { readonly kind: 'ready' }
>;

interface CreatedDestination<File extends ExtractionFile> {
  readonly file: File;
  readonly intendedBasename: string;
  readonly intendedPath: string;
  readonly kind: 'created';
  readonly preparation: ReadyDestinationPreparation<File>;
}

interface DestinationCreationFailure {
  readonly kind: 'failed';
  readonly notice: ExtractionNoticeDetails;
}

interface PathBearingExtractionNotice extends ExtractionNoticeDetails {
  readonly path: string;
}

type CommitResult = CommitNoticeResult | CommitSuccessResult;

type DestinationCreationResult<File extends ExtractionFile> =
  | CreatedDestination<File>
  | DestinationCreationFailure;

// eslint-disable-next-line unicorn/consistent-boolean-name -- The approved executor name describes an action whose result reports handling.
export async function executeSectionExtraction<File extends ExtractionFile>(
  editor: ExtractionEditor,
  sourcePath: string,
  execution: ExtractionExecution<File>,
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
  if (!areResolvedTargetsCurrent(runtime, creation)) {
    notify(createRelativeTargetChangedNotice(creation.intendedPath));
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
      originalSource,
      plan.draft,
      execution,
      runtime
    );
  } catch {
    if (!doesCreatedDestinationMatch(creation)) {
      notify(createDestinationChangedNotice(creation.intendedPath));
      return true;
    }
    notify(createSourceEditFailedNoteKeptNotice(creation.intendedPath));
    return true;
  }
  if (!doesCreatedDestinationMatch(creation)) {
    notify(createDestinationChangedNotice(creation.intendedPath));
    return true;
  }

  const initialSourceFailure = getSourceSnapshotFailure(
    editor,
    originalSource,
    creation.intendedPath
  );
  if (initialSourceFailure !== null) {
    notify(initialSourceFailure);
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
    notify(createDestinationUnverifiedNotice(creation.intendedPath));
    return true;
  }
  if (!areResolvedTargetsCurrent(runtime, creation)) {
    notify(createRelativeTargetChangedNotice(creation.intendedPath));
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
    execution,
    runtime,
    creation
  );
  if (commit.kind === 'success') {
    const notice = await finishCommittedExtraction(
      editor,
      execution,
      creation,
      commit
    );
    if (notice !== null) {
      notify(notice);
    }
    return true;
  }
  notify(commit.notice);
  return true;
}

function areSourceEditsEqual(
  first: ExtractionSourceEdit,
  second: ExtractionSourceEdit
): boolean {
  if (
    first.mode !== second.mode
    || first.range.from !== second.range.from
    || first.range.to !== second.range.to
    || first.replacement !== second.replacement
  ) {
    return false;
  }
  if (first.mode === 'open') {
    return true;
  }
  return second.mode === 'linked'
    && first.cursorOffset === second.cursorOffset;
}

function buildSourceEdit<File extends ExtractionFile>(
  file: File,
  sourcePath: string,
  originalSource: string,
  draft: SectionExtractionDraft,
  execution: ExtractionExecution<File>,
  runtime: ExtractionRuntime<File>
): ExtractionSourceEdit {
  if (execution.mode === 'open') {
    return createExtractionSourceEdit(originalSource, draft, { mode: 'open' });
  }
  const linktext = runtime.getLinktext(file, sourcePath);
  const wikilink = createExtractionWikilink(
    linktext,
    draft.displayTitle,
    file.basename
  );
  return createExtractionSourceEdit(originalSource, draft, {
    mode: 'linked',
    wikilink
  });
}

function createPostCreationSourceOperationFailure(
  error: unknown,
  path: string
): ExtractionNoticeDetails {
  return error instanceof ExtractionSourceChangedError
    ? createSourceChangedNoteKeptNotice(path)
    : createSourceEditFailedNoteKeptNotice(path);
}

function getPreDelegationReplacementFailure<File extends ExtractionFile>(
  error: unknown,
  creation: CreatedDestination<File>
): CommitNoticeResult | null {
  if (!(error instanceof ExtractionPreDelegationSourceChangedError)) {
    return null;
  }
  return doesCreatedDestinationMatch(creation)
    ? createCommitNotice(createSourceChangedNoteKeptNotice(creation.intendedPath))
    : createCommitDestinationChanged(creation.intendedPath);
}

function commitSourceExtraction<File extends ExtractionFile>(
  editor: ExtractionEditor,
  originalSource: string,
  sourcePath: string,
  draft: SectionExtractionDraft,
  initialEdit: ExtractionSourceEdit,
  execution: ExtractionExecution<File>,
  runtime: ExtractionRuntime<File>,
  creation: CreatedDestination<File>
): CommitResult {
  if (!doesCreatedDestinationMatch(creation)) {
    return createCommitDestinationChanged(creation.intendedPath);
  }

  const sourceFailure = getSourceSnapshotFailure(
    editor,
    originalSource,
    creation.intendedPath
  );
  if (sourceFailure !== null) {
    return createCommitNotice(sourceFailure);
  }

  let finalEdit: ExtractionSourceEdit;
  try {
    finalEdit = buildSourceEdit(
      creation.file,
      sourcePath,
      originalSource,
      draft,
      execution,
      runtime
    );
  } catch {
    if (!doesCreatedDestinationMatch(creation)) {
      return createCommitDestinationChanged(creation.intendedPath);
    }
    return createCommitNotice(
      createSourceEditFailedNoteKeptNotice(creation.intendedPath)
    );
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
    return createCommitNotice(
      createPostCreationSourceOperationFailure(error, creation.intendedPath)
    );
  }
  if (!doesCreatedDestinationMatch(creation)) {
    return createCommitDestinationChanged(creation.intendedPath);
  }

  const expectedSource = originalSource.slice(0, edit.range.from)
    + edit.replacement
    + originalSource.slice(edit.range.to);
  const finalSourceFailure = getSourceSnapshotFailure(
    editor,
    originalSource,
    creation.intendedPath
  );
  if (finalSourceFailure !== null) {
    return createCommitNotice(finalSourceFailure);
  }
  const destinationFailure = getCommitDestinationFailure(runtime, creation);
  if (destinationFailure !== null) {
    return destinationFailure;
  }

  let didReplacementThrow = false;
  try {
    editor.replaceRange(edit.replacement, from, to);
  } catch (error) {
    const preDelegationFailure = getPreDelegationReplacementFailure(
      error,
      creation
    );
    if (preDelegationFailure !== null) {
      return preDelegationFailure;
    }
    didReplacementThrow = true;
  }

  let sourceAfterReplacement: string;
  try {
    sourceAfterReplacement = editor.getValue();
  } catch {
    return createIndeterminateCommitNotice(creation.intendedPath);
  }
  if (sourceAfterReplacement === originalSource) {
    return doesCreatedDestinationMatch(creation)
      ? createCommitNotice(
        createSourceEditFailedNoteKeptNotice(creation.intendedPath)
      )
      : createCommitDestinationChanged(creation.intendedPath);
  }
  if (sourceAfterReplacement !== expectedSource) {
    return createIndeterminateCommitNotice(creation.intendedPath);
  }
  if (!doesCreatedDestinationMatch(creation)) {
    return createCommitDestinationChanged(creation.intendedPath);
  }
  return didReplacementThrow
    ? {
      edit,
      kind: 'success',
      sourceNotice: createSourceEditFailedNoteKeptNotice(
        creation.intendedPath
      )
    }
    : { edit, kind: 'success' };
}

async function finishCommittedExtraction<File extends ExtractionFile>(
  editor: ExtractionEditor,
  execution: ExtractionExecution<File>,
  creation: CreatedDestination<File>,
  commit: CommitSuccessResult
): Promise<ExtractionNoticeDetails | null> {
  if (execution.mode === 'open') {
    try {
      await execution.openCreatedFile(creation.file);
    } catch {
      return { kind: 'open-failed', path: creation.intendedPath };
    }
    return commit.sourceNotice ?? null;
  }

  if (commit.edit.mode !== 'linked') {
    throw new TypeError('Linked extraction requires a linked source edit.');
  }
  try {
    editor.setCursor(editor.offsetToPos(commit.edit.cursorOffset));
  } catch {
    return createSourceEditFailedNoteKeptNotice(creation.intendedPath);
  }
  return commit.sourceNotice ?? null;
}

async function createDestination<File extends ExtractionFile>(
  draft: SectionExtractionDraft,
  sourcePath: string,
  runtime: ExtractionRuntime<File>
): Promise<DestinationCreationResult<File>> {
  let suffixAttempts = 0;
  let startingSuffixIndex = 0;
  const services: ExtractionDestinationServices<File> = {
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
    let preparation: DestinationPreparation<File>;
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

    let result: ExtractionCreateResult<File>;
    try {
      result = await runtime.create(preparation.path, preparation.content);
    } catch {
      return { kind: 'failed', notice: { kind: 'create-failed' } };
    }
    if (result.kind === 'collision') {
      startingSuffixIndex = preparation.suffixIndex + 1;
      continue;
    }
    if (result.kind === 'failed') {
      return { kind: 'failed', notice: { kind: 'create-failed' } };
    }
    const file = result.file;

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

function areResolvedTargetsCurrent<File extends ExtractionFile>(
  runtime: ExtractionRuntime<File>,
  creation: CreatedDestination<File>
): boolean {
  try {
    return creation.preparation.resolvedRelativeTargets.every(
      ({ file, normalizedPath }) => runtime.isCurrentFile(file, normalizedPath)
    );
  } catch {
    return false;
  }
}

function createCommitDestinationChanged(path: string): CommitNoticeResult {
  return createCommitNotice(createDestinationChangedNotice(path));
}

function createCommitNotice(
  notice: ExtractionNoticeDetails
): CommitNoticeResult {
  return { kind: 'notice', notice };
}

function createCommitRelativeTargetChanged(path: string): CommitNoticeResult {
  return { kind: 'notice', notice: createRelativeTargetChangedNotice(path) };
}

function createDestinationChangedNotice(
  path: string
): PathBearingExtractionNotice {
  return { kind: 'destination-changed', path };
}

function createDestinationUnverifiedNotice(
  path: string
): PathBearingExtractionNotice {
  return { kind: 'destination-unverified', path };
}

function createIndeterminateCommitNotice(path: string): CommitNoticeResult {
  return {
    kind: 'notice',
    notice: { kind: 'indeterminate-source-mutation', path }
  };
}

function getCommitDestinationFailure<File extends ExtractionFile>(
  runtime: ExtractionRuntime<File>,
  creation: CreatedDestination<File>
): CommitNoticeResult | null {
  if (!doesCreatedDestinationMatch(creation)) {
    return createCommitDestinationChanged(creation.intendedPath);
  }
  try {
    if (!runtime.isCurrentFile(creation.file, creation.intendedPath)) {
      return createCommitDestinationChanged(creation.intendedPath);
    }
  } catch {
    return createCommitDestinationChanged(creation.intendedPath);
  }
  return areResolvedTargetsCurrent(runtime, creation)
    ? null
    : createCommitRelativeTargetChanged(creation.intendedPath);
}

function createRelativeTargetChangedNotice(
  path: string
): PathBearingExtractionNotice {
  return { kind: 'relative-link-target-changed', path };
}

function createSourceChangedNoteKeptNotice(
  path: string
): PathBearingExtractionNotice {
  return { kind: 'source-changed-note-kept', path };
}

function createSourceEditFailedNoteKeptNotice(
  path: string
): PathBearingExtractionNotice {
  return { kind: 'source-edit-failed-note-kept', path };
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
  originalSource: string,
  destinationPath: string
): ExtractionNoticeDetails | null {
  try {
    return editor.getValue() === originalSource
      ? null
      : createSourceChangedNoteKeptNotice(destinationPath);
  } catch (error) {
    return createPostCreationSourceOperationFailure(error, destinationPath);
  }
}

/* eslint-enable perfectionist/sort-modules -- Transaction module definitions are complete. */
