import { execFileSync } from 'node:child_process';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Node imports compact.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Node imports compact.
import { join, resolve } from 'node:path';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import {
  assertArchiveEntries,
  assertReleaseBranch,
  incrementStableVersion,
  prepareReleaseFiles,
  validateReleaseFiles
} from './release.ts';

const EXECUTABLE_FILE_MODE = 0o755;

const releaseFiles = {
  changelog: '# Changelog\n\n## Unreleased\n\n- Add structural deletion.\n\n## 0.1.0\n\n- Initial release.\n',
  manifest: '{\n  "id": "sectionals",\n  "version": "0.1.0",\n  "minAppVersion": "1.8.9"\n}\n',
  packageJson: '{\n  "name": "sectionals",\n  "version": "0.1.0"\n}\n',
  versions: '{\n  "0.1.0": "1.8.9"\n}\n'
} as const;

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
  it('prepares, validates, commits, and tags the next local release without pushing', () => {
    const repo = mkdtempSync(join(tmpdir(), 'sectionals-release-'));
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
      execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: repo });
      execFileSync('git', ['config', 'user.email', 'release@example.com'], { cwd: repo });
      execFileSync('git', ['add', '.'], { cwd: repo });
      execFileSync('git', ['commit', '-m', 'Initial release'], { cwd: repo });

      execFileSync(resolve('node_modules/.bin/jiti'), [resolve('scripts/release.ts'), 'cut', 'patch'], {
        cwd: repo,
        env: { ...process.env, PATH: `${binDirectory}:${process.env['PATH'] ?? ''}` }
      });

      expect(JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf-8'))).toMatchObject({ version: '0.1.1' });
      expect(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repo, encoding: 'utf-8' }).trim()).toBe(
        'chore: release 0.1.1'
      );
      expect(execFileSync('git', ['tag', '--list'], { cwd: repo, encoding: 'utf-8' }).trim()).toBe('0.1.1');
      expect(readFileSync(makeLog, 'utf-8')).toBe('release VERSION=0.1.1\n');
    } finally {
      rmSync(repo, { force: true, recursive: true });
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

describe('assertArchiveEntries', () => {
  it('accepts only main.js followed by manifest.json', () => {
    expect(() => {
      assertArchiveEntries(['main.js', 'manifest.json']);
    }).not.toThrow();
    expect(() => {
      assertArchiveEntries(['manifest.json', 'main.js']);
    }).toThrow('exactly main.js, then manifest.json');
    expect(() => {
      assertArchiveEntries(['main.js', 'manifest.json', 'styles.css']);
    }).toThrow('exactly main.js, then manifest.json');
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
