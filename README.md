# Sectionals

Delete the Markdown section containing the cursor without selecting it first.

## Commands

- **Delete current section** deletes the current heading and its subsections, stopping before the next heading of the same or a higher level.
- **Delete current heading block** deletes the current heading block, stopping before the next heading at any level.

Both commands use the active selection head. They support ATX and Setext headings, blockquotes, and callouts, and ignore heading-like text in code and comments. If there is no containing heading, the note is unchanged.

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

- Discover both commands in the command palette.
- Delete an ATX section containing nested subheadings.
- Delete only a heading block before a nested subheading.
- Delete a Setext section.
- Delete a heading inside a blockquote and a callout without affecting content outside that container.
- Confirm heading-like lines in fenced code and `%%` comments are ignored.
- Run a command before the first heading and confirm the no-target notice appears without an edit.
- Undo a successful deletion once and confirm the entire section returns.

## License

MIT
