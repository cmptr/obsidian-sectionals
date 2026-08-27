# Contributing to Sectionals

Thanks for helping improve Sectionals. Bug reports, focused fixes, tests, and documentation updates are welcome.

## Report an issue

Search the existing issues before opening a new one. For bugs, include:

- Your Obsidian and Sectionals versions
- Your operating system
- Steps that reproduce the problem
- What you expected and what happened instead
- A small Markdown example when the problem depends on note structure

Do not include private vault content. Reduce examples to the smallest note that still reproduces the problem.

## Set up the project

You need Node.js 24, pnpm 10.20.0, and Make.

```sh
git clone https://github.com/cmptr/obsidian-sectionals.git
cd obsidian-sectionals
pnpm install --frozen-lockfile
make check
```

The repository also includes a Nix flake and `.envrc` for direnv users.

## Develop locally

Use the Makefile for common tasks:

```sh
make build       # Build the production plugin
make test        # Run the test suite once
make test-watch  # Run tests while editing
make format      # Format supported files
make check       # Run formatting, lint, types, coverage, and the build
```

To run the development watcher against a vault:

```sh
make dev VAULT=/path/to/vault
```

You can use `make link` or `make symlink` with the same `VAULT` argument to install the current build. `make reload` requires the Hot Reload community plugin.

## Make a change

Keep each change focused. Add or update tests for behavior changes, and update user documentation when commands or workflows change. Do not commit generated files from `dist/`, coverage output, local environment files, or release archives.

Run the full check before opening a pull request:

```sh
make check
```

## Open a pull request

Describe the problem, the approach you took, and how you tested it. Link any related issue and call out user-visible changes. Keep unrelated cleanup in a separate pull request.

Maintainers handle version changes, release tags, attestations, and GitHub release assets.

By submitting a contribution, you agree that it may be distributed under the project's MIT license.
