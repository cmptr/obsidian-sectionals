# Sectionals

Sectionals is a set of commands for acting on individual sections of a note in Markdown. Delete a callout, copy or move a section, jump to a related section, change heading levels, or move a section into another note without selecting exact lines first.

## Installation

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse**, search for **Sectionals**, and install it.
3. Enable Sectionals from the installed plugins list.

For a manual installation, download `main.js` and `manifest.json` from the latest GitHub release. Copy both files into the `.obsidian/plugins/sectionals/` folder inside your vault, which is the folder containing your Obsidian notes. Then reload Obsidian and enable Sectionals under **Community plugins**.

## How sections work

A section is a heading, the content below it, and any nested headings. It ends at the next heading of the same or a higher level, or at the end of the note, blockquote, or callout that contains it.

Sectionals uses the most specific section at the cursor. If the cursor is inside a nested section, it acts on that smaller section instead of the larger section around it. If text is selected, Sectionals uses the end where you last moved the cursor.

A parent is the section that contains the current section. A child is a section nested directly inside it. Siblings are sections at the same level under the same parent.

A heading block is narrower than a section. It includes the heading and its own content, but not nested headings.

Open the command palette and search for **Sectionals**. Some commands appear only when they can run at the cursor. Commands have no default hotkeys. You can assign your own under **Settings → Hotkeys**.

## Commands

### Delete

A fenced code block starts with a line of three or more backticks or tildes and continues through its closing fence, or through the rest of its surrounding note or quote when no closing fence exists. Callouts use Obsidian's `> [!type]` syntax. Plain blockquotes are quoted passages that are not callouts.

| Command                              | Result                                                   |
| ------------------------------------ | -------------------------------------------------------- |
| **Delete current section**           | Removes the section and everything nested beneath it.    |
| **Delete current heading block**     | Removes the heading block but keeps its nested sections. |
| **Delete current fenced code block** | Removes the fenced code block around the cursor.         |
| **Delete current callout**           | Removes the callout around the cursor.                   |
| **Delete current blockquote**        | Removes the plain blockquote around the cursor.          |
| **Delete current structure…**        | Shows the removable structures at the cursor to choose.  |

### Clipboard

| Command                  | Result                                             |
| ------------------------ | -------------------------------------------------- |
| **Copy current section** | Copies the section exactly as written.             |
| **Cut current section**  | Copies the section, then removes it from the note. |

Quoted and callout sections use the same boundaries as **Delete current section**.

### Move

| Command                           | Result                                               |
| --------------------------------- | ---------------------------------------------------- |
| **Move current section up**       | Moves the section one sibling earlier.               |
| **Move current section down**     | Moves the section one sibling later.                 |
| **Move current section to start** | Moves the section to the start of its sibling group. |
| **Move current section to end**   | Moves the section to the end of its sibling group.   |

Movement carries the current section and every section nested inside it. It stays within the same parent and keeps the cursor with the moved text.

### Navigate

| Command                            | Result                                              |
| ---------------------------------- | --------------------------------------------------- |
| **Go to parent section**           | Moves the cursor to the parent section's heading.   |
| **Go to previous sibling section** | Moves the cursor to the previous sibling's heading. |
| **Go to next sibling section**     | Moves the cursor to the next sibling's heading.     |
| **Go to first child section**      | Moves the cursor to the first child's heading.      |

Navigation stays within the note body, blockquote, or callout that contains the current section. It places the cursor at the start of the heading text and centers that heading in the editor. If the heading has no title, the cursor lands after its `#` marks.

### Hierarchy

| Command                     | Result                                                   |
| --------------------------- | -------------------------------------------------------- |
| **Promote current section** | Raises the section and all nested headings by one level. |
| **Demote current section**  | Lowers the section and all nested headings by one level. |

Promotion is unavailable for a level-one heading. Demotion is unavailable without a preceding sibling, or when the section contains a level-six heading.

### Repeat

| Command                           | Result                                                    |
| --------------------------------- | --------------------------------------------------------- |
| **Repeat last structural action** | Repeats the last successful movement or hierarchy change. |

The remembered action lasts for the current Obsidian session and works across notes. Delete, clipboard, navigation, and extraction actions do not replace it.

### Extract

| Command                                    | Result                                                           |
| ------------------------------------------ | ---------------------------------------------------------------- |
| **Extract current section to linked note** | Replaces the source section with a link to a new note.           |
| **Extract current section to new note**    | Removes the source section and opens a new note in the same tab. |

Extraction uses the most specific non-empty section in the note body. It is unavailable inside blockquotes or callouts. It does not use a larger parent when the section at the cursor is empty.

The new note goes to Obsidian's configured new-note location and starts with the section title as a level-one heading. Inline Markdown in the title is kept, and nested headings shift together to preserve their relative levels. If the filename exists, Sectionals tries numbered names such as `Name 1`.

A linked extraction creates the shortest link that points only to the new note. When that link text or the new filename differs from the section title, the link still displays the original title.

Sectionals updates relative links and embeds, such as `../Images/photo.png`, so they still point to the same files. It cancels extraction before changing the original note if it cannot resolve one of those paths, or if a reference-style link or footnote depends on text outside the section. Existing links elsewhere in the vault are not updated.

## Safety and undo

- Each deletion takes one Undo. Cut copies first, then deletes in one Undo. If the note changes before copying finishes, Sectionals does not delete it.
- Navigation changes no content, adds nothing to Undo, and leaves the remembered repeat action unchanged.
- Undo restores an extracted section in the original note but does not delete the new note.
- If Sectionals creates a note but cannot finish, it keeps that note and shows its location. If the new note cannot be opened, the original section remains removed and Sectionals shows where the note was created.
