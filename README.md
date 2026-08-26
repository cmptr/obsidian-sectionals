# Sectionals

Delete the Markdown section or structural block containing the cursor without selecting it first.

## Commands

- **Delete current section** deletes the current heading and its subsections, stopping before the next heading of the same or a higher level.
- **Delete current heading block** deletes the current heading block, stopping before the next heading at any level.
- **Delete current fenced code block** deletes the enclosing backtick or tilde fenced block.
- **Delete current callout** deletes the nearest enclosing callout.
- **Delete current blockquote** deletes the nearest enclosing non-callout blockquote.

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

## License

MIT
