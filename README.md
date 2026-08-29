# Sectionals

Manage entire Markdown sections and elements without selecting them first.

Sectionals works with headings, code blocks, callouts, and quotes. Remove what no longer belongs, reorder sections as a note changes, or move a section into a note of its own.

## Installation

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse**, search for **Sectionals**, and install it.
3. Enable Sectionals from the installed plugins list.

For a manual installation, download `main.js` and `manifest.json` from the latest GitHub release. Copy both files into `<vault>/.obsidian/plugins/sectionals/`, then reload Obsidian and enable Sectionals under **Community plugins**.

## Usage

Open the command palette, search for **Sectionals**, and choose an action. Commands have no default hotkeys, but you can assign your own under **Settings → Hotkeys**.

Deletion commands remove the structure around the cursor. If several structures overlap, **Delete current structure…** lets you choose which one to remove.

Movement commands carry the current section and all its subsections. The cursor follows the text. **Repeat last structural action** runs the last successful movement again, even in another note.

**Extract current section to linked note** moves the whole section into a new note, leaves one wikilink in its place, and keeps the source note open.

**Extract current section to new note** moves the whole section without leaving a link, then opens the new note in the same tab. It is available only in a normal Markdown note view.

New notes go to Obsidian's configured new-note location. They start with the original heading as a level-one heading. If the name is taken, Sectionals adds a number such as `Name 1`.

Extraction works on the deepest section at the cursor. If that section is empty, or its heading is inside a blockquote or callout, the command is not available. It will not grab a larger section instead.

Relative Markdown links and embeds keep pointing to the same files after the move. If Sectionals cannot resolve one, or a reference link or footnote is shared with text outside the section, it leaves the source note alone. Links elsewhere in the vault to headings or block IDs inside the moved section are not updated. Extraction does not replace the movement remembered by **Repeat last structural action**.

> [!warning] Undo after extraction
> Undo puts the section back in the source note, but it does not delete the note Sectionals created. If the new note cannot be opened, the source section stays removed and Sectionals tells you where it created the note.

## Commands

| When you want to…                                        | Command                                    |
| -------------------------------------------------------- | ------------------------------------------ |
| Remove a topic and everything nested beneath it          | **Delete current section**                 |
| Move a section one position earlier among its siblings   | **Move current section up**                |
| Move a section one position later among its siblings     | **Move current section down**              |
| Move a section to the start of its sibling group         | **Move current section to start**          |
| Move a section to the end of its sibling group           | **Move current section to end**            |
| Run the last successful movement again at the cursor     | **Repeat last structural action**          |
| Move a section into its own linked note                  | **Extract current section to linked note** |
| Move a section into its own note and open it in this tab | **Extract current section to new note**    |
| Remove one heading block while keeping its subsections   | **Delete current heading block**           |
| Clear a complete code or configuration example           | **Delete current fenced code block**       |
| Remove a reminder, warning, or aside                     | **Delete current callout**                 |
| Remove a quoted passage formatted as a plain blockquote  | **Delete current blockquote**              |
| See the available choices before removing anything       | **Delete current structure…**              |

Every deletion is one undoable edit.
