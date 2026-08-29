# Sectionals

Edit Markdown by structure, not selection.

Sectionals gives Obsidian a small set of commands for acting on complete parts of a note. Delete a callout, move a section, extract a section into another note, or repeat a movement without selecting the exact lines first.

## Installation

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse**, search for **Sectionals**, and install it.
3. Enable Sectionals from the installed plugins list.

For a manual installation, download `main.js` and `manifest.json` from the latest GitHub release. Copy both files into `<vault>/.obsidian/plugins/sectionals/`, then reload Obsidian and enable Sectionals under **Community plugins**.

## How it works

Sectionals treats Markdown structures as complete editing units:

- **Delete** a section, heading block, code block, callout, or blockquote.
- **Move** a section earlier or later among its siblings.
- **Extract** a section into a note of its own.
- **Repeat** the last successful section movement somewhere else.

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

### Move

| Command                           | Result                                               |
| --------------------------------- | ---------------------------------------------------- |
| **Move current section up**       | Moves the section one place earlier.                 |
| **Move current section down**     | Moves the section one place later.                   |
| **Move current section to start** | Moves the section to the start of its sibling group. |
| **Move current section to end**   | Moves the section to the end of its sibling group.   |
| **Repeat last structural action** | Runs the last successful movement again.             |

Movement carries the complete section, including its nested subsections. The cursor follows the moved text. Repeat works across notes for the rest of the current Obsidian session.

### Extract

| Command                                    | Result                                                          |
| ------------------------------------------ | --------------------------------------------------------------- |
| **Extract current section to linked note** | Moves the section into a new note and leaves a wikilink behind. |
| **Extract current section to new note**    | Moves the section into a new note and opens it in the same tab. |

New notes go to Obsidian's configured new-note location. Each one starts with the original section heading as its level-one heading. If the name is already taken, Sectionals adds a number such as `Name 1`.

## Extraction notes

Sectionals extracts the deepest eligible section. It does not substitute a larger parent section when the intended section is empty or unavailable.

Relative Markdown links and embeds continue pointing to the same files after extraction. Sectionals leaves the source note unchanged if it cannot safely resolve a link, reference, or footnote shared with text outside the section.

Links elsewhere in the vault to headings or block IDs inside the extracted section are not updated. Extraction also does not replace the movement remembered by **Repeat last structural action**.

> [!warning] Undo after extraction
> Undo puts the section back in the source note, but it does not delete the note Sectionals created. If the new note cannot be opened, the source section stays removed and Sectionals tells you where it created the note.
