# Sectionals

Remove whole parts of a note without selecting them first.

Sectionals helps you clean up and organize Markdown notes from wherever your cursor already is. Use the command palette or assigned hotkeys to remove outdated material, move topics, or extract a section into its own linked note.

## Installation

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse**, search for **Sectionals**, and install it.
3. Enable Sectionals from the installed plugins list.

For a manual installation, download `main.js` and `manifest.json` from the latest GitHub release. Copy both files into `<vault>/.obsidian/plugins/sectionals/`, then reload Obsidian and enable Sectionals under **Community plugins**.

## Usage

Place the cursor inside the part of the note you want to change. Open the command palette, search for **Sectionals**, and choose an action.

Movement commands carry the complete current topic and its nested subsections, along with the cursor.

**Extract current section to linked note** moves the complete current section, including its heading and nested subsections, into a new note. It replaces the section in the source with one wikilink paragraph and keeps the source note open.

**Extract current section to new note** moves the same complete section without leaving a source placeholder, then opens the created note in the same tab. This command is available only from a normal Markdown note view. Both extraction commands use Obsidian's configured location for new notes, start the new note with the original heading text as a level-one heading, and use numbered names such as `Name 1` when needed.

Both commands check only the deepest section at the cursor. They are unavailable if that section is empty or its heading is inside a blockquote or callout, and they do not fall back to an enclosing section. Relative Markdown links and embeds are rewritten to keep pointing to the same files. Extraction stops if one cannot be resolved, or if a reference link or footnote connects the moved section to text outside it. Links elsewhere in the vault to moved descendant headings or block IDs are not updated. Extraction does not replace the movement remembered by **Repeat last structural action**.

> [!warning] Undo limitation
> Native Undo restores the source section for either extraction command but does not delete the created note. If opening the new note fails, Sectionals keeps the source removal and created note and reports the note's path.

Commands have no default hotkeys. For a faster keyboard workflow, assign them under **Settings → Hotkeys**. If several structures contain the cursor, use **Delete current structure…** to choose how much to remove.

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
