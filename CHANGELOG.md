# Changelog

## Unreleased

- Add **Go to parent section**, **Go to previous sibling section**, **Go to next sibling section**, and **Go to first child section**, with centered destination scrolling.

## 0.4.0

- Add commands to copy or cut the current section, with clipboard completion required before Cut removes source text.

## 0.3.0

- Add commands to promote or demote complete section hierarchies and repeat those changes.
- Keep created extraction notes when a concurrent change makes automatic cleanup unsafe.
- Harden CI and release publication with least-privilege jobs, pinned actions, production dependency audits, and verified release artifact hashes.
- Add automated compatibility checks against Obsidian 1.8.7 declarations and ES2020 output.

## 0.2.1

- Respect Obsidian's file deletion preference when rolling back a failed extraction.
- Replace generated Unicode case-folding data with compact reference-label normalization and readable UTF-8 build output.

## 0.2.0

- Add commands to extract the current section into a linked note or into a new note opened in the current tab.
- Add commands to move the current section within its sibling group and repeat the last movement.

## 0.1.2

- Place production build artifacts in `dist/` so automated build verification can find `main.js`.

## 0.1.1

- Correct release provenance and packaging, and add installation and usage instructions.

## 0.1.0

- Add context-sensitive commands for deleting fenced code blocks, callouts, and plain blockquotes.
- Keep overlapping structural and heading deletion targets available as explicit commands.
- Added **Delete current structure…**, a native searchable scope picker that lists valid deletion targets from smallest to largest while preserving all direct commands.
- Add commands to delete the current logical section or heading block.
- Support ATX, Setext, blockquote, and callout headings.
- Ignore heading-like text in code, frontmatter, HTML comments, and Obsidian comments.
