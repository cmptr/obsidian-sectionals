import { execFileSync } from 'node:child_process';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Node imports compact.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export interface ReleaseFiles {
  readonly changelog: string;
  readonly manifest: string;
  readonly packageJson: string;
  readonly versions: string;
}

const STABLE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const ARCHIVE_ENTRIES = ['main.js', 'manifest.json'] as const;
const RELEASE_FILE_PATHS = ['CHANGELOG.md', 'manifest.json', 'package.json', 'versions.json'] as const;
const JSON_INDENT = 2;
const CLI_ARGUMENT_START_INDEX = 2;

export function assertArchiveEntries(entries: readonly string[]): void {
  if (entries.length !== ARCHIVE_ENTRIES.length || entries.some((entry, index) => entry !== ARCHIVE_ENTRIES[index])) {
    throw new Error('Release archive must contain exactly main.js, then manifest.json');
  }
}

export function assertReleaseBranch(branch: string): void {
  if (branch !== 'master') {
    throw new Error(`Release tags must be created from the master branch, received: ${branch || '<detached HEAD>'}`);
  }
}

export function incrementStableVersion(version: string, bump: string): string {
  assertStableVersion(version);
  if (bump !== 'patch' && bump !== 'minor' && bump !== 'major') {
    throw new Error(`Bump must be patch, minor, or major, received: ${bump}`);
  }

  const [major, minor, patch] = version.split('.').map(Number) as [number, number, number];
  switch (bump) {
    case 'major': {
      return `${String(major + 1)}.0.0`;
    }
    case 'minor': {
      return `${String(major)}.${String(minor + 1)}.0`;
    }
    case 'patch': {
      return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
    }
    default: {
      throw new Error('Unsupported release bump');
    }
  }
}

export function prepareReleaseFiles(files: ReleaseFiles, version: string): ReleaseFiles {
  assertStableVersion(version);

  const manifest = parseJsonRecord(files.manifest, 'manifest.json');
  const packageJson = parseJsonRecord(files.packageJson, 'package.json');
  const versions = parseJsonRecord(files.versions, 'versions.json');
  const currentVersion = manifest['version'];
  const minimumAppVersion = manifest['minAppVersion'];

  if (typeof currentVersion !== 'string') {
    throw new TypeError('manifest.json version must be a string');
  }
  validateReleaseFiles(files, currentVersion);
  if (version === currentVersion) {
    throw new Error(`Release version is already ${version}`);
  }
  if (Object.hasOwn(versions, version)) {
    throw new Error(`versions.json already contains version ${version}`);
  }
  if (typeof minimumAppVersion !== 'string') {
    throw new TypeError('manifest.json minAppVersion must be a string');
  }

  manifest['version'] = version;
  packageJson['version'] = version;
  versions[version] = minimumAppVersion;

  return {
    changelog: moveUnreleasedNotes(files.changelog, version),
    manifest: formatJson(manifest),
    packageJson: formatJson(packageJson),
    versions: formatJson(versions)
  };
}

export function validateReleaseFiles(files: ReleaseFiles, expectedVersion: string): void {
  assertStableVersion(expectedVersion);

  const manifest = parseJsonRecord(files.manifest, 'manifest.json');
  const packageJson = parseJsonRecord(files.packageJson, 'package.json');
  const versions = parseJsonRecord(files.versions, 'versions.json');
  const manifestVersion = manifest['version'];
  const packageVersion = packageJson['version'];
  const minimumAppVersion = manifest['minAppVersion'];

  if (manifestVersion !== expectedVersion) {
    throw new Error(`manifest.json version ${String(manifestVersion)} does not match release ${expectedVersion}`);
  }
  if (packageVersion !== expectedVersion) {
    throw new Error(`package.json version ${String(packageVersion)} does not match release ${expectedVersion}`);
  }
  if (typeof minimumAppVersion !== 'string' || minimumAppVersion.length === 0) {
    throw new Error('manifest.json minAppVersion must be a non-empty string');
  }
  if (versions[expectedVersion] !== minimumAppVersion) {
    throw new Error(`versions.json must map ${expectedVersion} to minAppVersion ${minimumAppVersion}`);
  }
  if (!files.changelog.includes(`## ${expectedVersion}\n`)) {
    throw new Error(`CHANGELOG.md must contain a ## ${expectedVersion} release heading`);
  }
}

function assertCleanWorktree(): void {
  if (gitOutput(['status', '--porcelain']).length > 0) {
    throw new Error('Working tree must be clean before preparing or tagging a release');
  }
}

function assertStableVersion(version: string): void {
  if (!STABLE_VERSION.test(version)) {
    throw new Error(`Release version must be a stable semantic version without a v prefix, received: ${version}`);
  }
}

function assertTagDoesNotExist(version: string): void {
  const tag = gitOutput(['tag', '--list', version]);
  if (tag.length > 0) {
    throw new Error(`Tag ${version} already exists`);
  }
}

function formatJson(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

function gitOutput(arguments_: readonly string[]): string {
  return execFileSync('git', arguments_, { encoding: 'utf-8' }).trim();
}

function main(): void {
  const [command, argument] = process.argv.slice(CLI_ARGUMENT_START_INDEX);

  switch (command) {
    case 'cut': {
      const bump = requireArgument(argument, 'release.ts cut <patch|minor|major>');
      assertCleanWorktree();
      assertReleaseBranch(gitOutput(['branch', '--show-current']));

      const files = readReleaseFiles();
      const manifest = parseJsonRecord(files.manifest, 'manifest.json');
      const currentVersion = manifest['version'];
      if (typeof currentVersion !== 'string') {
        throw new TypeError('manifest.json version must be a string');
      }

      const version = incrementStableVersion(currentVersion, bump);
      assertTagDoesNotExist(version);
      writeReleaseFiles(prepareReleaseFiles(files, version));
      execFileSync('make', ['release', `VERSION=${version}`], { stdio: 'inherit' });
      gitOutput(['add', ...RELEASE_FILE_PATHS]);
      gitOutput(['commit', '-m', `chore: release ${version}`]);
      assertCleanWorktree();
      gitOutput(['tag', '-a', version, '-m', `Sectionals ${version}`]);
      writeOutput(`Created release commit and tag ${version}. Push explicitly with: git push origin master ${version}`);
      return;
    }
    case 'prepare': {
      const version = requireArgument(argument, 'release.ts prepare <version>');
      assertCleanWorktree();
      assertTagDoesNotExist(version);
      writeReleaseFiles(prepareReleaseFiles(readReleaseFiles(), version));
      writeOutput(`Prepared release ${version}. Review and commit the four changed release files.`);
      return;
    }
    case 'pretag': {
      const version = requireArgument(argument, 'release.ts pretag <version>');
      assertCleanWorktree();
      assertReleaseBranch(gitOutput(['branch', '--show-current']));
      assertTagDoesNotExist(version);
      validateReleaseFiles(readReleaseFiles(), version);
      writeOutput(`Release ${version} is ready to build and tag.`);
      return;
    }
    case 'validate': {
      const version = requireArgument(argument, 'release.ts validate <version>');
      validateReleaseFiles(readReleaseFiles(), version);
      writeOutput(`Release files match ${version}.`);
      return;
    }
    case 'verify-archive': {
      verifyArchive(requireArgument(argument, 'release.ts verify-archive <path>'));
      writeOutput(`Release archive has the expected entries: ${ARCHIVE_ENTRIES.join(', ')}.`);
      return;
    }
    default: {
      throw new Error('Usage: release.ts <cut|prepare|validate|pretag|verify-archive> <value>');
    }
  }
}

function moveUnreleasedNotes(changelog: string, version: string): string {
  const marker = '## Unreleased\n\n';
  const markerIndex = changelog.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error('CHANGELOG.md must contain an empty-line-separated ## Unreleased heading');
  }

  const notesStart = markerIndex + marker.length;
  const nextHeadingIndex = changelog.indexOf('\n## ', notesStart);
  const notesEnd = nextHeadingIndex === -1 ? changelog.length : nextHeadingIndex;
  const notes = changelog.slice(notesStart, notesEnd).trim();
  if (notes.length === 0) {
    throw new Error('CHANGELOG.md has no Unreleased notes to release');
  }
  if (changelog.includes(`## ${version}\n`)) {
    throw new Error(`CHANGELOG.md already contains version ${version}`);
  }

  const beforeNotes = changelog.slice(0, notesStart);
  const previousReleases = nextHeadingIndex === -1 ? '' : changelog.slice(nextHeadingIndex + 1).trimStart();
  const previousSection = previousReleases.length === 0 ? '' : `\n\n${previousReleases.trimEnd()}`;
  return `${beforeNotes}## ${version}\n\n${notes}${previousSection}\n`;
}

function parseJsonRecord(source: string, fileName: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${fileName} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

function readReleaseFiles(): ReleaseFiles {
  return {
    changelog: readFileSync('CHANGELOG.md', 'utf-8'),
    manifest: readFileSync('manifest.json', 'utf-8'),
    packageJson: readFileSync('package.json', 'utf-8'),
    versions: readFileSync('versions.json', 'utf-8')
  };
}

function requireArgument(value: string | undefined, usage: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Usage: ${usage}`);
  }
  return value;
}

function verifyArchive(path: string): void {
  const output = execFileSync(
    'python3',
    ['-c', 'import json, sys, zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', path],
    { encoding: 'utf-8' }
  );
  const entries: unknown = JSON.parse(output);
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Unable to read archive entries from ${path}`);
  }
  assertArchiveEntries(entries as string[]);
}

function writeOutput(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeReleaseFiles(files: ReleaseFiles): void {
  writeFileSync('CHANGELOG.md', files.changelog);
  writeFileSync('manifest.json', files.manifest);
  writeFileSync('package.json', files.packageJson);
  writeFileSync('versions.json', files.versions);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
