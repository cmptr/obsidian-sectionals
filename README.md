# Sectionals

Remove whole parts of a note without selecting them first.

Sectionals helps you clean up and restructure Markdown notes from wherever your cursor already is. Use the command palette or assign hotkeys to remove outdated topics, stale examples, callouts, and quoted passages.

## Installation

Once Sectionals is available in the community plugin directory:

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse**, search for **Sectionals**, and install it.
3. Enable Sectionals from the installed plugins list.

For a manual installation, download `main.js` and `manifest.json` from the latest GitHub release. Copy both files into `<vault>/.obsidian/plugins/sectionals/`, then reload Obsidian and enable Sectionals under **Community plugins**.

## Usage

Place the cursor inside the part of the note you want to remove. Open the command palette, search for **Sectionals**, and choose an action.

For a faster keyboard workflow, assign hotkeys under **Settings → Hotkeys**. If several structures contain the cursor, use **Delete current structure…** to choose how much to remove.

## Commands

| When you want to…                                       | Command                              |
| ------------------------------------------------------- | ------------------------------------ |
| Remove a topic and everything nested beneath it         | **Delete current section**           |
| Remove one heading block while keeping its subsections  | **Delete current heading block**     |
| Clear a complete code or configuration example          | **Delete current fenced code block** |
| Remove a reminder, warning, or aside                    | **Delete current callout**           |
| Remove a quoted passage formatted as a plain blockquote | **Delete current blockquote**        |
| See the available choices before removing anything      | **Delete current structure…**        |

Every deletion is one undoable edit.
