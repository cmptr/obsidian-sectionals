# Sectionals

Delete the Markdown section or structural block containing the cursor without selecting it first.

Sectionals is an Obsidian plugin for deleting whole pieces of Markdown based on where your cursor is. Put the cursor inside a section, heading block, fenced code block, callout, or blockquote, then run the matching command. Sectionals finds the boundaries and removes the whole thing in one undoable edit.

## Commands

- **Delete current section** removes the current heading, its contents, and all of its subsections. It stops at the next heading of the same or a higher level.
- **Delete current heading block** removes the current heading and its contents but leaves its subsections alone. It stops at the next heading of any level.
- **Delete current fenced code block** removes the whole fenced block, whether it uses backticks or tildes.
- **Delete current callout** removes the callout around the cursor.
- **Delete current blockquote** removes the plain blockquote around the cursor without treating callouts as blockquotes.
- **Delete current structure…** shows everything Sectionals can delete at the cursor, ordered from smallest to largest. If a section and heading block cover the same text, they appear as one choice.

Use the picker when you want to see your options. It always waits for you to choose, even when there is only one choice. For a faster workflow, run a direct command or give it a hotkey.

If you have text selected, Sectionals uses the cursor at the active end of the selection. The fenced code block, callout, and blockquote commands only appear when the cursor is inside the matching structure. When structures overlap, Sectionals keeps each distinct choice available so you decide exactly how much to remove. Deleting a section also removes any fenced code blocks, blockquotes, or callouts inside it.
