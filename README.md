# Sectionals

Delete the Markdown section or structural block containing the cursor without selecting it first.

## Commands

- **Delete current section** deletes the current heading and its subsections, stopping before the next heading of the same or a higher level.
- **Delete current heading block** deletes the current heading block, stopping before the next heading at any level.
- **Delete current fenced code block** deletes the enclosing backtick or tilde fenced block.
- **Delete current callout** deletes the nearest enclosing callout.
- **Delete current blockquote** deletes the nearest enclosing non-callout blockquote.
- **Delete current structure…** opens a searchable picker containing every valid deletion scope under the cursor, ordered from smallest to largest. Identical section and heading-block ranges appear as one choice.

The picker always asks you to choose a scope, even when only one target is available. Existing direct commands remain available for zero-dialog deletion and custom hotkeys.

All commands use the active selection head. The three structural-block commands appear only when their target exists at the cursor. When targets overlap, each distinct command is available so the deletion scope remains explicit. The heading commands retain their broader behavior: deleting a section also deletes any fenced code blocks, blockquotes, or callouts contained in that section.

Heading detection supports ATX and Setext headings in root notes, blockquotes, and callouts while ignoring heading-like text in code and comments. If there is no containing heading, a heading command leaves the note unchanged.

## Development

```sh
make install
make check
make symlink
make reload
```

`VAULT` defaults to `~/Obsidian/SELF`. Override it with `make symlink VAULT=/path/to/vault` or set `OBSIDIAN_VAULT` in `.env`.

Run `make help` for all available commands.

## Manual smoke checklist

Test on desktop and mobile with a disposable note:

- Discover both heading commands in the command palette.
- Confirm each structural-block command appears only when the cursor has a matching target.
- Delete an ATX section containing nested subheadings.
- Delete only a heading block before a nested subheading.
- Delete a Setext section.
- Delete a multiline fenced code block without deleting its enclosing section or callout.
- Delete a plain blockquote without affecting adjacent content.
- Delete a callout without affecting its enclosing section or blockquote.
- Confirm overlapping fenced-block, callout, and heading targets remain separately available.
- Confirm heading-like lines in fenced code and `%%` comments are ignored.
- Run a heading command before the first heading and confirm the no-target notice appears without an edit.
- Undo a successful deletion once and confirm the entire target returns.
- Open **Delete current structure…** inside a fence nested in a callout, blockquote, and section; confirm choices appear from smallest to largest.
- Type part of a structure type or detail and confirm native fuzzy filtering finds it.
- Use arrow keys and Enter to choose a target; reopen and press Escape to confirm no edit occurs.
- Invoke the picker where section and heading-block ranges match; confirm one **Section + heading block** choice appears.
- Invoke the picker with one valid target and confirm it still waits for selection.
- Change the note while the picker is open and confirm the stale-source notice prevents deletion.
- Repeat picker selection by touch in mobile emulation and confirm native undo restores the deletion once.

## License

MIT
