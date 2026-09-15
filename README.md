# Sectionals

Edit Markdown by structure, not selection.

Sectionals gives Obsidian 21 commands for acting on complete parts of a note. Delete a callout, copy a section, move a section, extract a section into another note, or repeat a movement without selecting the exact lines first.

## Installation

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse**, search for **Sectionals**, and install it.
3. Enable Sectionals from the installed plugins list.

For a manual installation, download `main.js` and `manifest.json` from the latest GitHub release. Copy both files into `<vault>/.obsidian/plugins/sectionals/`, then reload Obsidian and enable Sectionals under **Community plugins**.

## How it works

Sectionals treats Markdown structures as complete editing units:

- **Delete** a section, heading block, code block, callout, or blockquote.
- **Move** a section earlier or later among its siblings.
- **Promote or demote** a complete section hierarchy.
- **Extract** a section into a note of its own.
- **Repeat** the last successful movement or hierarchy change somewhere else.

Open the command palette and search for **Sectionals** to see the available actions. Commands have no default hotkeys, but you can assign your own under **Settings → Hotkeys**.

A section includes its heading, body, and nested subsections. A heading block includes only the heading and its body, leaving nested subsections in place.

## Commands

### Delete

| Command                              | Result                                                   |
| ------------------------------------ | -------------------------------------------------------- |
| **Delete current section**           | Removes a section and everything nested beneath it.      |
| **Delete current heading block**     | Removes one heading block but keeps its subsections.     |
| **Delete current fenced code block** | Removes the complete fenced code block.                  |
| **Delete current callout**           | Removes the complete callout.                            |
| **Delete current blockquote**        | Removes the complete plain blockquote.                   |
| **Delete current structure…**        | Lets you choose when several removable structures apply. |

Every deletion is one undoable edit.

### Clipboard

| Command                  | Result                                                         |
| ------------------------ | -------------------------------------------------------------- |
| **Copy current section** | Copies the complete section exactly as written.                |
| **Cut current section**  | Copies the complete section, then removes it in one undo step. |

Quoted and callout sections use the same scope as **Delete current section**. If the note changes while clipboard access is pending, Cut cancels the deletion. Neither Copy nor Cut changes the action remembered by **Repeat last structural action**.

### Move

| Command                           | Result                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| **Move current section up**       | Moves the section one place earlier.                         |
| **Move current section down**     | Moves the section one place later.                           |
| **Move current section to start** | Moves the section to the start of its sibling group.         |
| **Move current section to end**   | Moves the section to the end of its sibling group.           |
| **Repeat last structural action** | Runs the last successful movement or hierarchy change again. |

Movement carries the complete section, including its nested subsections. The cursor follows the moved text.

### Navigate

| Command                            | Result                                              |
| ---------------------------------- | --------------------------------------------------- |
| **Go to parent section**           | Moves the cursor to the parent section's heading.   |
| **Go to previous sibling section** | Moves the cursor to the previous sibling's heading. |
| **Go to next sibling section**     | Moves the cursor to the next sibling's heading.     |
| **Go to first child section**      | Moves the cursor to the first child's heading.      |

Navigation starts from the deepest section at the head of the active selection. It collapses the selection, stays in the same Markdown container, and lands in the destination heading title. It does not change note content or add anything to Undo, and it does not replace the action remembered by **Repeat last structural action**.

### Hierarchy

| Command                     | Result                                                     |
| --------------------------- | ---------------------------------------------------------- |
| **Promote current section** | Promotes the section and its nested subsections one level. |
| **Demote current section**  | Demotes the section and its nested subsections one level.  |

Promotion and demotion shift the complete section, including every nested subsection. Actions are unavailable at invalid boundaries, including promoting an H1, demoting a subtree containing an H6, or demoting without a preceding sibling.

**Repeat last structural action** remembers the last successful movement or hierarchy change and can replay it across notes for the rest of the current Obsidian session.

### Extract

| Command                                    | Result                                                          |
| ------------------------------------------ | --------------------------------------------------------------- |
| **Extract current section to linked note** | Moves the section into a new note and leaves a wikilink behind. |
| **Extract current section to new note**    | Moves the section into a new note and opens it in the same tab. |

New notes go to Obsidian's configured new-note location. Each one starts with the original section heading as its level-one heading. If the name is already taken, Sectionals adds a number such as `Name 1`.

## Extraction notes

Sectionals extracts the deepest eligible section. It does not substitute a larger parent section when the intended section is empty or unavailable.

Relative Markdown links and embeds continue pointing to the same files after extraction. Sectionals leaves the source note unchanged if it cannot safely resolve a link, reference, or footnote shared with text outside the section.

Links elsewhere in the vault to headings or block IDs inside the extracted section are not updated. Extraction also does not replace the movement or hierarchy change remembered by **Repeat last structural action**.

> [!warning] Undo after extraction
> Undo puts the section back in the source note, but it does not delete the note Sectionals created. If the new note cannot be opened, the source section stays removed and Sectionals tells you where it created the note. When extraction is cancelled after creating a note, Sectionals retains that note and reports its path rather than risking deletion of changed content.
