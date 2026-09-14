/* eslint-disable perfectionist/sort-modules -- Preserve the approved public contract order. */

import { planSectionDeletion } from './deletion-planner.ts';

export type SectionClipboardMode = 'copy' | 'cut';

export interface ClipboardEditorPosition {
  readonly ch: number;
  readonly line: number;
}

export interface SectionClipboardEditor {
  getValue(): string;
  offsetToPos(offset: number): ClipboardEditorPosition;
  replaceRange(
    replacement: string,
    from: ClipboardEditorPosition,
    to: ClipboardEditorPosition
  ): void;
  setCursor(position: ClipboardEditorPosition): void;
}

export interface SectionClipboardRuntime {
  isOriginCurrent(): boolean;
  writeText(text: string): Promise<void>;
}

/* eslint-disable no-restricted-syntax, perfectionist/sort-union-types -- Preserve the approved result contract verbatim. */
export type SectionClipboardResult =
  | { readonly status: 'unavailable' }
  | { readonly status: 'operation-failed' }
  | { readonly status: 'copied' }
  | { readonly status: 'clipboard-failed' }
  | { readonly status: 'cut' }
  | { readonly status: 'source-changed' }
  | { readonly status: 'cut-failed' }
  | { readonly status: 'cut-unverified' }
  | { readonly status: 'cut-cursor-failed' };
/* eslint-enable no-restricted-syntax, perfectionist/sort-union-types -- Approved result contract is complete. */

interface CutPreparation {
  readonly expectedSource: string;
  readonly from: ClipboardEditorPosition;
  readonly to: ClipboardEditorPosition;
}

export async function executeSectionClipboard(
  editor: SectionClipboardEditor,
  cursorOffset: number,
  mode: SectionClipboardMode,
  runtime: SectionClipboardRuntime,
  planner: typeof planSectionDeletion = planSectionDeletion
): Promise<SectionClipboardResult> {
  let source: string;
  let range: ReturnType<typeof planSectionDeletion>;
  try {
    source = editor.getValue();
    range = planner(source, cursorOffset, 'section');
  } catch {
    return { status: 'operation-failed' };
  }
  if (range === null) {
    return { status: 'unavailable' };
  }

  const text = source.slice(range.from, range.to);
  let cutPreparation: CutPreparation | null = null;
  if (mode === 'cut') {
    try {
      cutPreparation = {
        expectedSource: source.slice(0, range.from) + source.slice(range.to),
        from: editor.offsetToPos(range.from),
        to: editor.offsetToPos(range.to)
      };
    } catch {
      return { status: 'operation-failed' };
    }
  }

  try {
    await runtime.writeText(text);
  } catch {
    return { status: 'clipboard-failed' };
  }

  if (cutPreparation === null) {
    return { status: 'copied' };
  }

  try {
    if (!runtime.isOriginCurrent() || editor.getValue() !== source) {
      return { status: 'source-changed' };
    }
  } catch {
    return { status: 'source-changed' };
  }

  try {
    editor.replaceRange('', cutPreparation.from, cutPreparation.to);
  } catch {
    // The editor may mutate before reporting failure; classify observed state below.
  }

  let observedSource: string;
  try {
    observedSource = editor.getValue();
  } catch {
    return { status: 'cut-unverified' };
  }
  if (observedSource === cutPreparation.expectedSource) {
    try {
      editor.setCursor(cutPreparation.from);
    } catch {
      return { status: 'cut-cursor-failed' };
    }
    return { status: 'cut' };
  }
  if (observedSource === source) {
    return { status: 'cut-failed' };
  }
  return { status: 'cut-unverified' };
}

/* eslint-enable perfectionist/sort-modules -- Clipboard executor definitions are complete. */
