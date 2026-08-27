SHELL := /usr/bin/env
.SHELLFLAGS := bash -eu -o pipefail -c
.DEFAULT_GOAL := help

-include .env
export

OBSIDIAN_VAULT ?= $(HOME)/Obsidian/SELF
VAULT ?= $(OBSIDIAN_VAULT)
VAULT_EXPANDED := $(subst ~,$(HOME),$(VAULT))
PLUGIN_ID := sectionals
PLUGIN_DIR := $(VAULT_EXPANDED)/.obsidian/plugins/$(PLUGIN_ID)
BUILD_DIR := dist/build
RELEASE_DIR := dist/release
VERSION := $(shell node -p "require('./manifest.json').version")
ZIP_NAME := $(PLUGIN_ID)-$(VERSION).zip
ARTIFACTS := main.js manifest.json

.PHONY: help install dev build typecheck lint format test test-watch check \
 validate-vault link symlink unlink reload prepare-release validate-release \
 release tag-release clean

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*?## "; printf "Usage: make <target> [VAULT=/path/to/vault]\n\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	pnpm install

dev: validate-vault ## Run the development watcher against the selected vault
	OBSIDIAN_CONFIG_FOLDER="$(VAULT_EXPANDED)/.obsidian" pnpm dev

build: ## Create the production bundle
	pnpm build

typecheck: ## Typecheck without emitting files
	pnpm typecheck

lint: ## Run ESLint
	pnpm lint

format: ## Rewrite source files with dprint
	pnpm format

test: ## Run tests once
	pnpm test

test-watch: ## Run tests in watch mode
	pnpm test:watch

check: ## Run formatting, lint, typecheck, coverage, and production build
	pnpm check

validate-vault:
	test -n "$(strip $(VAULT_EXPANDED))" || { echo "VAULT is empty"; exit 1; }
	test -d "$(VAULT_EXPANDED)/.obsidian" || { echo "Not an Obsidian vault: $(VAULT_EXPANDED)"; exit 1; }

link: build validate-vault ## Copy built artifacts into the vault plugin directory
	test ! -L "$(PLUGIN_DIR)" || rm -f "$(PLUGIN_DIR)"
	test ! -e "$(PLUGIN_DIR)" || test -d "$(PLUGIN_DIR)" || { echo "Plugin path is not a directory: $(PLUGIN_DIR)"; exit 1; }
	mkdir -p "$(PLUGIN_DIR)"
	rm -f $(addprefix "$(PLUGIN_DIR)/",$(ARTIFACTS)) "$(PLUGIN_DIR)/styles.css"
	cp $(addprefix "$(BUILD_DIR)/",$(ARTIFACTS)) "$(PLUGIN_DIR)/"
	@echo "Installed $(PLUGIN_ID) into $(PLUGIN_DIR)"

symlink: build validate-vault ## Symlink built artifacts into the vault plugin directory
	test ! -L "$(PLUGIN_DIR)" || rm -f "$(PLUGIN_DIR)"
	test ! -e "$(PLUGIN_DIR)" || test -d "$(PLUGIN_DIR)" || { echo "Plugin path is not a directory: $(PLUGIN_DIR)"; exit 1; }
	mkdir -p "$(PLUGIN_DIR)"
	rm -f $(addprefix "$(PLUGIN_DIR)/",$(ARTIFACTS)) "$(PLUGIN_DIR)/styles.css"
	ln -s "$(CURDIR)/$(BUILD_DIR)/main.js" "$(PLUGIN_DIR)/main.js"
	ln -s "$(CURDIR)/$(BUILD_DIR)/manifest.json" "$(PLUGIN_DIR)/manifest.json"
	@echo "Symlinked $(PLUGIN_ID) artifacts into $(PLUGIN_DIR)"

unlink: validate-vault ## Remove this plugin from the vault
	rm -rf "$(PLUGIN_DIR)"
	@echo "Removed $(PLUGIN_DIR)"

reload: symlink ## Refresh links and trigger the Hot Reload plugin
	touch "$(PLUGIN_DIR)/.hotreload"
	@echo "Reload triggered (requires the Hot Reload community plugin)"

prepare-release: ## Update release files (requires VERSION=x.y.z)
	test "$(origin VERSION)" = "command line" || { echo "Usage: make prepare-release VERSION=x.y.z"; exit 1; }
	pnpm exec jiti scripts/release.ts prepare "$(VERSION)"

validate-release: ## Verify synchronized release versions and changelog
	pnpm exec jiti scripts/release.ts validate "$(VERSION)"

release: validate-release check ## Build and package an Obsidian release zip
	command -v python3 >/dev/null || { echo "python3 is required to package releases"; exit 1; }
	rm -rf "$(RELEASE_DIR)"
	mkdir -p "$(RELEASE_DIR)"
	cp $(addprefix "$(BUILD_DIR)/",$(ARTIFACTS)) "$(RELEASE_DIR)/"
	cd "$(RELEASE_DIR)" && python3 -c "import zipfile; files=['main.js','manifest.json']; archive=zipfile.ZipFile('$(ZIP_NAME)', 'w', zipfile.ZIP_DEFLATED); [archive.write(file) for file in files]; archive.close()"
	pnpm exec jiti scripts/release.ts verify-archive "$(RELEASE_DIR)/$(ZIP_NAME)"
	@echo "Release artifact: $(RELEASE_DIR)/$(ZIP_NAME)"

tag-release: ## Validate, build, and create an annotated stable tag
	pnpm exec jiti scripts/release.ts pretag "$(VERSION)"
	$(MAKE) release
	git tag -a "$(VERSION)" -m "Sectionals $(VERSION)"
	@echo "Created tag $(VERSION). Push explicitly with: git push origin main $(VERSION)"

clean: ## Remove generated build and release artifacts
	rm -rf dist coverage
	@echo "Cleaned generated artifacts"
