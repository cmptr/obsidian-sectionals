import { execFileSync } from 'node:child_process';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Node imports compact.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Node imports compact.
import { join, resolve } from 'node:path';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import type { ReleaseFiles } from './release.ts';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible release imports compact.
import { assertReleaseBranch, incrementStableVersion, prepareReleaseFiles, validateReleaseFiles } from './release.ts';

const EXECUTABLE_FILE_MODE = 0o755;
const JSON_INDENT = 2;
const EXPECTED_DESCRIPTION = 'Edit complete Markdown structures at the cursor without selecting exact lines.';
const EXPECTED_MINIMUM_APP_VERSION = '1.8.9';
const STABLE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const HISTORICAL_VERSION_MAPPINGS = {
  '0.1.0': EXPECTED_MINIMUM_APP_VERSION,
  '0.1.1': EXPECTED_MINIMUM_APP_VERSION,
  '0.1.2': EXPECTED_MINIMUM_APP_VERSION,
  '0.2.0': EXPECTED_MINIMUM_APP_VERSION,
  '0.2.1': EXPECTED_MINIMUM_APP_VERSION
} as const;

const releaseFiles = {
  changelog: '# Changelog\n\n## Unreleased\n\n- Add structural deletion.\n\n## 0.1.0\n\n- Initial release.\n',
  manifest: '{\n  "id": "sectionals",\n  "version": "0.1.0",\n  "minAppVersion": "1.8.9"\n}\n',
  packageJson: '{\n  "name": "sectionals",\n  "version": "0.1.0"\n}\n',
  versions: '{\n  "0.1.0": "1.8.9"\n}\n'
} as const;

const pre030ReleaseFiles = {
  changelog: '# Changelog\n\n## Unreleased\n\n- Add release hardening.\n\n## 0.2.1\n\n- Previous release.\n',
  manifest: `${
    JSON.stringify(
      {
        author: 'Aaron Bell',
        description: EXPECTED_DESCRIPTION,
        id: 'sectionals',
        isDesktopOnly: false,
        minAppVersion: EXPECTED_MINIMUM_APP_VERSION,
        name: 'Sectionals',
        version: '0.2.1'
      },
      null,
      JSON_INDENT
    )
  }\n`,
  packageJson: `${
    JSON.stringify(
      {
        description: EXPECTED_DESCRIPTION,
        name: 'sectionals',
        version: '0.2.1'
      },
      null,
      JSON_INDENT
    )
  }\n`,
  versions: `${JSON.stringify(HISTORICAL_VERSION_MAPPINGS, null, JSON_INDENT)}\n`
} as const;

function assertReleaseMetadata(root: string): void {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8')) as Record<string, unknown>;
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as Record<string, unknown>;
  const versions = JSON.parse(readFileSync(join(root, 'versions.json'), 'utf-8')) as Record<string, unknown>;
  const currentVersion = manifest['version'];

  expect(currentVersion).toBeTypeOf('string');
  if (typeof currentVersion !== 'string') {
    throw new TypeError('manifest.json version must be a string');
  }

  expect(currentVersion).toMatch(STABLE_VERSION);
  expect(packageJson['version']).toBe(currentVersion);
  expect({
    manifest: {
      description: manifest['description'],
      id: manifest['id'],
      minAppVersion: manifest['minAppVersion'],
      name: manifest['name']
    },
    package: {
      description: packageJson['description'],
      name: packageJson['name']
    }
  }).toEqual({
    manifest: {
      description: EXPECTED_DESCRIPTION,
      id: 'sectionals',
      minAppVersion: EXPECTED_MINIMUM_APP_VERSION,
      name: 'Sectionals'
    },
    package: {
      description: EXPECTED_DESCRIPTION,
      name: 'sectionals'
    }
  });
  expect(versions).toMatchObject(HISTORICAL_VERSION_MAPPINGS);
  for (const [version, minimumAppVersion] of Object.entries(versions)) {
    expect(version).toMatch(STABLE_VERSION);
    expect(minimumAppVersion).toEqual(expect.stringMatching(STABLE_VERSION));
  }
  expect(versions[currentVersion]).toBe(manifest['minAppVersion']);
}

function readReleaseFilesAt(root: string): ReleaseFiles {
  return {
    changelog: readFileSync(join(root, 'CHANGELOG.md'), 'utf-8'),
    manifest: readFileSync(join(root, 'manifest.json'), 'utf-8'),
    packageJson: readFileSync(join(root, 'package.json'), 'utf-8'),
    versions: readFileSync(join(root, 'versions.json'), 'utf-8')
  };
}

describe('incrementStableVersion', () => {
  it.each(
    [
      ['patch', '0.1.3'],
      ['minor', '0.2.0'],
      ['major', '1.0.0']
    ] as const
  )('increments the %s component and resets lower components', (bump, expected) => {
    expect(incrementStableVersion('0.1.2', bump)).toBe(expected);
  });

  it('rejects malformed versions and unknown bump names', () => {
    expect(() => incrementStableVersion('v0.1.2', 'patch')).toThrow('stable semantic version');
    expect(() => incrementStableVersion('0.1.2', 'revision')).toThrow('Bump must be patch, minor, or major');
  });
});

describe('prepareReleaseFiles', () => {
  it('updates synchronized versions and moves unreleased notes under the new version', () => {
    const prepared = prepareReleaseFiles(releaseFiles, '0.2.0');

    expect(JSON.parse(prepared.packageJson)).toMatchObject({ version: '0.2.0' });
    expect(JSON.parse(prepared.manifest)).toMatchObject({ version: '0.2.0' });
    expect(JSON.parse(prepared.versions)).toEqual({
      '0.1.0': '1.8.9',
      '0.2.0': '1.8.9'
    });
    expect(prepared.changelog).toBe(
      '# Changelog\n\n## Unreleased\n\n## 0.2.0\n\n- Add structural deletion.\n\n## 0.1.0\n\n- Initial release.\n'
    );
  });

  it('rejects tags with a v prefix or prerelease suffix', () => {
    expect(() => prepareReleaseFiles(releaseFiles, 'v0.2.0')).toThrow('stable semantic version');
    expect(() => prepareReleaseFiles(releaseFiles, '0.2.0-beta.1')).toThrow('stable semantic version');
  });
});

describe('cut release command', () => {
  it('prepares, validates, commits, tags, and pushes the next release', () => {
    const repo = mkdtempSync(join(tmpdir(), 'sectionals-release-'));
    const remote = `${repo}-remote.git`;
    const binDirectory = join(repo, 'bin');
    const makeLog = join(repo, '.git', 'make.log');

    try {
      mkdirSync(binDirectory);
      writeFileSync(join(repo, 'CHANGELOG.md'), releaseFiles.changelog);
      writeFileSync(join(repo, 'manifest.json'), releaseFiles.manifest);
      writeFileSync(join(repo, 'package.json'), releaseFiles.packageJson);
      writeFileSync(join(repo, 'versions.json'), releaseFiles.versions);
      writeFileSync(join(binDirectory, 'make'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > "${makeLog}"\n`);
      chmodSync(join(binDirectory, 'make'), EXECUTABLE_FILE_MODE);

      execFileSync('git', ['init', '--initial-branch=master'], { cwd: repo });
      execFileSync('git', ['init', '--bare', remote]);
      execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: repo });
      execFileSync('git', ['config', 'user.email', 'release@example.com'], { cwd: repo });
      execFileSync('git', ['add', '.'], { cwd: repo });
      execFileSync('git', ['commit', '-m', 'Initial release'], { cwd: repo });
      execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
      execFileSync('git', ['push', '--set-upstream', 'origin', 'master'], { cwd: repo });

      execFileSync(resolve('node_modules/.bin/jiti'), [resolve('scripts/release.ts'), 'cut', 'patch'], {
        cwd: repo,
        env: { ...process.env, PATH: `${binDirectory}:${process.env['PATH'] ?? ''}` }
      });

      expect(JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf-8'))).toMatchObject({ version: '0.1.1' });
      expect(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repo, encoding: 'utf-8' }).trim()).toBe(
        'chore: release 0.1.1'
      );
      expect(execFileSync('git', ['tag', '--list'], { cwd: repo, encoding: 'utf-8' }).trim()).toBe('0.1.1');
      expect(execFileSync('git', ['--git-dir', remote, 'tag', '--list'], { encoding: 'utf-8' }).trim()).toBe('0.1.1');
      expect(
        execFileSync('git', ['--git-dir', remote, 'log', '-1', '--pretty=%s', 'master'], { encoding: 'utf-8' }).trim()
      )
        .toBe('chore: release 0.1.1');
      expect(readFileSync(makeLog, 'utf-8')).toBe('release VERSION=0.1.1\n');
    } finally {
      rmSync(repo, { force: true, recursive: true });
      rmSync(remote, { force: true, recursive: true });
    }
  });
});

describe('validateReleaseFiles', () => {
  it('rejects version files that do not match the expected release', () => {
    expect(() => {
      validateReleaseFiles(releaseFiles, '0.2.0');
    }).toThrow('manifest.json version 0.1.0');
  });
});

describe('assertReleaseBranch', () => {
  it('rejects release tags outside the master branch', () => {
    expect(() => {
      assertReleaseBranch('release-candidate');
    }).toThrow('master branch');
    expect(() => {
      assertReleaseBranch('master');
    }).not.toThrow();
  });
});

describe('release metadata', () => {
  it('keeps fixed plugin metadata synchronized with the current stable version', () => {
    assertReleaseMetadata('.');
  });

  it('accepts accumulated history when preparing 0.3.1 after 0.3.0 through the real release path', () => {
    const repo = mkdtempSync(join(tmpdir(), 'sectionals-prepare-release-'));

    try {
      mkdirSync(join(repo, 'scripts'));
      writeFileSync(join(repo, 'CHANGELOG.md'), pre030ReleaseFiles.changelog);
      writeFileSync(join(repo, 'manifest.json'), pre030ReleaseFiles.manifest);
      writeFileSync(join(repo, 'package.json'), pre030ReleaseFiles.packageJson);
      writeFileSync(join(repo, 'versions.json'), pre030ReleaseFiles.versions);
      writeFileSync(join(repo, 'Makefile'), readFileSync('Makefile', 'utf-8'));
      writeFileSync(join(repo, 'scripts', 'release.ts'), readFileSync('scripts/release.ts', 'utf-8'));

      execFileSync('git', ['init', '--initial-branch=master'], { cwd: repo });
      execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: repo });
      execFileSync('git', ['config', 'user.email', 'release@example.com'], { cwd: repo });
      execFileSync('git', ['add', '.'], { cwd: repo });
      execFileSync('git', ['commit', '-m', 'Release candidate'], { cwd: repo });
      writeFileSync(join(repo, '.git', 'info', 'exclude'), 'node_modules\n', { flag: 'a' });
      symlinkSync(resolve('node_modules'), join(repo, 'node_modules'));

      execFileSync('make', ['--no-print-directory', 'prepare-release', 'VERSION=0.3.0'], { cwd: repo });

      expect(() => {
        validateReleaseFiles(readReleaseFilesAt(repo), '0.3.0');
      }).not.toThrow();
      assertReleaseMetadata(repo);

      execFileSync('git', ['add', 'CHANGELOG.md', 'manifest.json', 'package.json', 'versions.json'], { cwd: repo });
      execFileSync('git', ['commit', '-m', 'Release 0.3.0'], { cwd: repo });
      writeFileSync(
        join(repo, 'CHANGELOG.md'),
        readFileSync(join(repo, 'CHANGELOG.md'), 'utf-8').replace(
          '## Unreleased\n\n',
          '## Unreleased\n\n- Fix release history validation.\n\n'
        )
      );
      execFileSync('git', ['add', 'CHANGELOG.md'], { cwd: repo });
      execFileSync('git', ['commit', '-m', 'Add 0.3.1 release note'], { cwd: repo });

      execFileSync('make', ['--no-print-directory', 'prepare-release', 'VERSION=0.3.1'], { cwd: repo });

      expect(() => {
        validateReleaseFiles(readReleaseFilesAt(repo), '0.3.1');
      }).not.toThrow();
      assertReleaseMetadata(repo);
    } finally {
      rmSync(repo, { force: true, recursive: true });
    }
  });
});

describe('build output', () => {
  it('places the plugin entry point where build verification can discover it', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as Record<string, unknown>;
    const makefile = readFileSync('Makefile', 'utf-8');

    expect(packageJson['main']).toBe('dist/main.js');
    expect(makefile).toContain('BUILD_DIR := dist\n');
  });
});

describe('release Make targets', () => {
  it('builds only the named release assets without creating a ZIP archive', () => {
    const output = execFileSync('make', ['--no-print-directory', '--dry-run', 'release'], { encoding: 'utf-8' });
    const assetLines = output.split('\n').filter((line) => line.startsWith('echo "Release assets:'));

    expect(assetLines).toEqual(['echo "Release assets: dist/main.js dist/manifest.json"']);
    expect(output).not.toContain('zipfile');
    expect(output).not.toContain('verify-archive');
  });

  it.each(
    [
      ['release-patch', 'patch'],
      ['release-minor', 'minor'],
      ['release-major', 'major']
    ] as const
  )('maps %s to the %s cut command', (target, bump) => {
    const output = execFileSync('make', ['--no-print-directory', '--dry-run', target], { encoding: 'utf-8' });

    expect(output).toContain(`scripts/release.ts cut ${bump}`);
  });
});

describe('release workflow', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf-8');

  it('requires release tags to point to commits on master', () => {
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/master');
  });

  it('attests each supported release asset separately', () => {
    expect(workflow.match(/subject-path: dist\/main\.js/g)).toHaveLength(1);
    expect(workflow.match(/subject-path: dist\/manifest\.json/g)).toHaveLength(1);
    expect(workflow).not.toContain('subject-path: |');
  });

  it('publishes only supported Obsidian release assets', () => {
    const publishStep = workflow.slice(workflow.indexOf('- name: Publish GitHub release'));

    expect(publishStep).toContain('dist/main.js');
    expect(publishStep).toContain('dist/manifest.json');
    expect(publishStep).not.toContain('dist/release');
  });
});
