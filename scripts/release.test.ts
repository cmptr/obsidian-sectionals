import { readFileSync } from 'node:fs';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible release imports compact.
import { assertArchiveEntries, assertReleaseBranch, prepareReleaseFiles, validateReleaseFiles } from './release.ts';

const releaseFiles = {
  changelog: '# Changelog\n\n## Unreleased\n\n- Add structural deletion.\n\n## 0.1.0\n\n- Initial release.\n',
  manifest: '{\n  "id": "sectionals",\n  "version": "0.1.0",\n  "minAppVersion": "1.8.9"\n}\n',
  packageJson: '{\n  "name": "sectionals",\n  "version": "0.1.0"\n}\n',
  versions: '{\n  "0.1.0": "1.8.9"\n}\n'
} as const;

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
