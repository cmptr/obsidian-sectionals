import { deepStrictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Node imports compact.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ATTEST_REFERENCE = 'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6';
const CHECKOUT_REFERENCE = 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803';
const DOWNLOAD_ARTIFACT_REFERENCE = 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093';
const NODE_SETUP_REFERENCE = 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38';
const PNPM_SETUP_REFERENCE = 'pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320';
const UPLOAD_ARTIFACT_REFERENCE = 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02';
const FULL_ACTION_SHA = /@[0-9a-f]{40}$/u;
const SECRET_INTERPOLATION = /\$\{\{\s*secrets(?:\.|\[)/iu;
const VALID_MAIN_DIGEST = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VALID_MANIFEST_DIGEST = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER_VALID_DIGEST = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const MATCHING_SHA256SUM = [
  'case "$1" in',
  `  dist/main.js) digest='${VALID_MAIN_DIGEST}' ;;`,
  `  dist/manifest.json) digest='${VALID_MANIFEST_DIGEST}' ;;`,
  '  *) exit 74 ;;',
  'esac',
  String.raw`printf '%s  %s\n' "$digest" "$1"`
].join('\n');
const RELEASE_COMMANDS = [
  /\bgit\s+(?:push|tag)\b/iu,
  /\bgh\s+release\b/iu,
  /\b(?:npm|pnpm)\s+(?:publish|version)\b/iu,
  /\bmake\s+(?:release|tag-release)\b/iu
] as const;
const EXPECTED_WORKFLOW_SOURCE = `name: Check
on:
  pull_request:
  push:
    branches:
      - master
permissions: {}
jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Check out repository
        uses: ${CHECKOUT_REFERENCE}
        with:
          persist-credentials: false
      - name: Install pnpm
        uses: ${PNPM_SETUP_REFERENCE}
        with:
          version: 10.20.0
      - name: Set up Node.js
        uses: ${NODE_SETUP_REFERENCE}
        with:
          node-version: 24
          package-manager-cache: false
      - name: Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts
      - name: Audit production dependencies
        run: pnpm audit:prod
      - name: Run project checks
        run: make check
`;
const EXPECTED_WORKFLOW: unknown = parse(EXPECTED_WORKFLOW_SOURCE);
const EXPECTED_RELEASE_WORKFLOW_SOURCE = `name: Release Obsidian plugin
on:
  push:
    tags:
      - "[0-9]+.[0-9]+.[0-9]+"
concurrency:
  group: release-\${{ github.ref }}
  cancel-in-progress: false
permissions: {}
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      main-sha256: \${{ steps.hashes.outputs.main }}
      manifest-sha256: \${{ steps.hashes.outputs.manifest }}
    steps:
      - name: Check out repository
        uses: ${CHECKOUT_REFERENCE}
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: Verify release commit is on master
        run: git merge-base --is-ancestor "$GITHUB_SHA" origin/master
      - name: Install pnpm
        uses: ${PNPM_SETUP_REFERENCE}
        with:
          version: 10.20.0
      - name: Set up Node.js
        uses: ${NODE_SETUP_REFERENCE}
        with:
          node-version: 24
          package-manager-cache: false
      - name: Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts
      - name: Audit production dependencies
        run: pnpm audit:prod
      - name: Validate release version
        env:
          RELEASE_TAG: \${{ github.ref_name }}
        run: pnpm exec jiti scripts/release.ts validate "$RELEASE_TAG"
      - name: Build release artifacts
        run: make release
      - name: Calculate release asset hashes
        id: hashes
        run: |
          test -f dist/main.js
          test -f dist/manifest.json
          main_sha256="$(sha256sum dist/main.js | cut -d ' ' -f 1)"
          manifest_sha256="$(sha256sum dist/manifest.json | cut -d ' ' -f 1)"
          [[ "$main_sha256" =~ ^[[:xdigit:]]{64}$ ]]
          [[ "$manifest_sha256" =~ ^[[:xdigit:]]{64}$ ]]
          printf 'main=%s\\n' "$main_sha256" >> "$GITHUB_OUTPUT"
          printf 'manifest=%s\\n' "$manifest_sha256" >> "$GITHUB_OUTPUT"
      - name: Upload release assets
        uses: ${UPLOAD_ARTIFACT_REFERENCE}
        with:
          name: release-assets
          path: |
            dist/main.js
            dist/manifest.json
          if-no-files-found: error
          retention-days: 1
          include-hidden-files: false
  publish:
    needs: build
    runs-on: ubuntu-latest
    environment: release
    permissions:
      contents: write
      id-token: write
      attestations: write
    steps:
      - name: Download release assets
        uses: ${DOWNLOAD_ARTIFACT_REFERENCE}
        with:
          name: release-assets
          path: dist
      - name: Verify release asset hashes
        env:
          EXPECTED_MAIN_SHA256: \${{ needs.build.outputs.main-sha256 }}
          EXPECTED_MANIFEST_SHA256: \${{ needs.build.outputs.manifest-sha256 }}
        run: |
          test -f dist/main.js
          test -f dist/manifest.json
          [[ "$EXPECTED_MAIN_SHA256" =~ ^[[:xdigit:]]{64}$ ]]
          [[ "$EXPECTED_MANIFEST_SHA256" =~ ^[[:xdigit:]]{64}$ ]]
          actual_main_sha256="$(sha256sum dist/main.js | cut -d ' ' -f 1)"
          actual_manifest_sha256="$(sha256sum dist/manifest.json | cut -d ' ' -f 1)"
          [[ "$actual_main_sha256" =~ ^[[:xdigit:]]{64}$ ]]
          [[ "$actual_manifest_sha256" =~ ^[[:xdigit:]]{64}$ ]]
          test "$actual_main_sha256" = "$EXPECTED_MAIN_SHA256"
          test "$actual_manifest_sha256" = "$EXPECTED_MANIFEST_SHA256"
      - name: Attest main.js provenance
        uses: ${ATTEST_REFERENCE}
        with:
          subject-path: dist/main.js
      - name: Attest manifest.json provenance
        uses: ${ATTEST_REFERENCE}
        with:
          subject-path: dist/manifest.json
      - name: Publish GitHub release
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          gh release create "$GITHUB_REF_NAME" \\
            --verify-tag \\
            --title "$GITHUB_REF_NAME" \\
            --generate-notes \\
            dist/main.js \\
            dist/manifest.json
`;
const EXPECTED_RELEASE_WORKFLOW: unknown = parse(EXPECTED_RELEASE_WORKFLOW_SOURCE);
const EXECUTABLE_FILE_MODE = 0o755;
const SHA256_HEX_LENGTH = 64;

type FixtureEntry = 'directory' | 'file';

interface ShellFixtureOptions {
  readonly expectedMain?: string;
  readonly expectedManifest?: string;
  readonly main?: FixtureEntry;
  readonly manifest?: FixtureEntry;
  readonly sha256sum?: string;
}

interface ShellResult {
  readonly githubOutput: string;
  readonly hashLog: string;
  readonly status: null | number;
}

function assertNoWritePermissions(value: unknown, path: string): void {
  if (value === 'write-all') {
    throw new Error(`Workflow grants write-all at ${path}.`);
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [scope, access] of Object.entries(value)) {
    if (access === 'write') {
      throw new Error(`Workflow grants write permission at ${path}.${scope}.`);
    }
  }
}

function assertPinnedActions(value: unknown, path = 'workflow'): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertPinnedActions(item, `${path}[${String(index)}]`);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;

    if (key === 'uses' && (typeof child !== 'string' || !FULL_ACTION_SHA.test(child))) {
      throw new Error(`Workflow action at ${childPath} is not pinned to a full commit SHA.`);
    }

    assertPinnedActions(child, childPath);
  }
}

function assertReleaseWorkflowContract(source: string): void {
  const parsed: unknown = parse(source);

  assertPinnedActions(parsed);
  deepStrictEqual(parsed, EXPECTED_RELEASE_WORKFLOW);
}

function assertSecurityPolicy(value: unknown, path = 'workflow'): void {
  if (typeof value === 'string') {
    if (SECRET_INTERPOLATION.test(value)) {
      throw new Error(`Workflow interpolates a secret at ${path}.`);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertSecurityPolicy(item, `${path}[${String(index)}]`);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;

    if (key === 'permissions') {
      assertNoWritePermissions(child, childPath);
    }

    if (key === 'run' && typeof child === 'string' && RELEASE_COMMANDS.some((pattern) => pattern.test(child))) {
      throw new Error(`Workflow invokes a release command at ${childPath}.`);
    }

    assertSecurityPolicy(child, childPath);
  }
}

function assertWorkflowContract(source: string): void {
  const parsed: unknown = parse(source);

  assertPinnedActions(parsed);
  assertSecurityPolicy(parsed);
  deepStrictEqual(parsed, EXPECTED_WORKFLOW);
}

function getStepRun(source: string, jobName: string, stepName: string): string {
  const parsed: unknown = parse(source);
  const jobs = isRecord(parsed) ? parsed['jobs'] : undefined;
  const job = isRecord(jobs) ? jobs[jobName] : undefined;
  const steps = isRecord(job) ? job['steps'] : undefined;

  if (!Array.isArray(steps)) {
    throw new TypeError(`Workflow job ${jobName} has no steps.`);
  }

  const safeSteps: readonly unknown[] = steps;
  const step = safeSteps.find((candidate) => isRecord(candidate) && candidate['name'] === stepName);
  const run = isRecord(step) ? step['run'] : undefined;

  if (typeof run !== 'string') {
    throw new TypeError(`Workflow step ${jobName}.${stepName} has no shell script.`);
  }

  return run;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function materializeFixtureEntry(path: string, entry: FixtureEntry, contents: string): void {
  if (entry === 'directory') {
    mkdirSync(path);
    return;
  }

  writeFileSync(path, contents);
}

function replaceExactlyOnce(source: string, search: string, replacement: string): string {
  const firstIndex = source.indexOf(search);
  const secondIndex = source.indexOf(search, firstIndex + search.length);

  if (firstIndex === -1) {
    throw new Error('Expected one mutation target, found none.');
  }

  if (secondIndex !== -1) {
    throw new Error('Expected one mutation target, found multiple.');
  }

  return `${source.slice(0, firstIndex)}${replacement}${source.slice(firstIndex + search.length)}`;
}

function runWorkflowShell(script: string, options: ShellFixtureOptions = {}): ShellResult {
  const root = mkdtempSync(join(tmpdir(), 'sectionals-workflow-'));

  try {
    const dist = join(root, 'dist');
    const githubOutput = join(root, 'github-output');
    const hashLog = join(root, 'hash-log');

    mkdirSync(dist);
    materializeFixtureEntry(join(dist, 'main.js'), options.main ?? 'file', 'main\n');
    materializeFixtureEntry(join(dist, 'manifest.json'), options.manifest ?? 'file', '{}\n');
    writeFileSync(githubOutput, '');
    writeFileSync(hashLog, '');

    let path = process.env['PATH'] ?? '';

    if (options.sha256sum !== undefined) {
      const bin = join(root, 'bin');
      const executable = join(bin, 'sha256sum');

      mkdirSync(bin);
      writeFileSync(executable, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$HASH_LOG"\n${options.sha256sum}\n`);
      chmodSync(executable, EXECUTABLE_FILE_MODE);
      path = `${bin}:${path}`;
    }

    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
      cwd: root,
      encoding: 'utf-8',
      env: {
        ...process.env,
        EXPECTED_MAIN_SHA256: options.expectedMain ?? '',
        EXPECTED_MANIFEST_SHA256: options.expectedManifest ?? '',
        GITHUB_OUTPUT: githubOutput,
        HASH_LOG: hashLog,
        PATH: path
      }
    });

    if (result.error !== undefined) {
      throw result.error;
    }

    return {
      githubOutput: readFileSync(githubOutput, 'utf-8'),
      hashLog: readFileSync(hashLog, 'utf-8'),
      status: result.status
    };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf-8');
const workflow = readFileSync('.github/workflows/ci.yml', 'utf-8');

describe('release workflow privilege boundary', () => {
  it('matches the complete isolated build and publish contract', () => {
    expect(() => {
      assertReleaseWorkflowContract(releaseWorkflow);
    }).not.toThrow();
  });

  it('rejects write permission in the build job', () => {
    const mutated = replaceExactlyOnce(
      EXPECTED_RELEASE_WORKFLOW_SOURCE,
      '    permissions:\n      contents: read\n',
      '    permissions:\n      contents: write\n'
    );

    expect(() => {
      assertReleaseWorkflowContract(mutated);
    }).toThrow();
  });

  it('rejects source execution in the publish job', () => {
    const mutated = replaceExactlyOnce(
      EXPECTED_RELEASE_WORKFLOW_SOURCE,
      '    steps:\n      - name: Download release assets\n',
      '    steps:\n      - name: Rebuild from repository source\n        run: pnpm exec jiti scripts/release.ts validate\n'
        + '      - name: Download release assets\n'
    );

    expect(() => {
      assertReleaseWorkflowContract(mutated);
    }).toThrow();
  });

  it('rejects an unexpected uploaded artifact path', () => {
    const mutated = replaceExactlyOnce(
      EXPECTED_RELEASE_WORKFLOW_SOURCE,
      '            dist/main.js\n            dist/manifest.json\n',
      '            dist/main.js\n            dist/manifest.json\n            dist/release.zip\n'
    );

    expect(() => {
      assertReleaseWorkflowContract(mutated);
    }).toThrow();
  });

  it('rejects an unpinned artifact action', () => {
    const mutated = replaceExactlyOnce(
      EXPECTED_RELEASE_WORKFLOW_SOURCE,
      DOWNLOAD_ARTIFACT_REFERENCE,
      'actions/download-artifact@v4'
    );

    expect(() => {
      assertReleaseWorkflowContract(mutated);
    }).toThrow('not pinned to a full commit SHA');
  });

  it('rejects release publication of an unexpected asset', () => {
    const mutated = replaceExactlyOnce(
      EXPECTED_RELEASE_WORKFLOW_SOURCE,
      '            dist/main.js \\\n            dist/manifest.json\n',
      '            dist/main.js \\\n            dist/manifest.json \\\n            dist/release.zip\n'
    );

    expect(() => {
      assertReleaseWorkflowContract(mutated);
    }).toThrow();
  });

  it('rejects removal of the pre-upload regular-file boundary', () => {
    const mutated = replaceExactlyOnce(
      EXPECTED_RELEASE_WORKFLOW_SOURCE,
      '      - name: Calculate release asset hashes\n        id: hashes\n        run: |\n'
        + '          test -f dist/main.js\n          test -f dist/manifest.json\n',
      '      - name: Calculate release asset hashes\n        id: hashes\n        run: |\n'
    );

    expect(() => {
      assertReleaseWorkflowContract(mutated);
    }).toThrow();
  });

  it('rejects removal of the post-download regular-file boundary', () => {
    const mutated = replaceExactlyOnce(
      EXPECTED_RELEASE_WORKFLOW_SOURCE,
      '        run: |\n          test -f dist/main.js\n          test -f dist/manifest.json\n'
        + '          [[ "$EXPECTED_MAIN_SHA256" =~ ^[[:xdigit:]]{64}$ ]]\n',
      '        run: |\n          [[ "$EXPECTED_MAIN_SHA256" =~ ^[[:xdigit:]]{64}$ ]]\n'
    );

    expect(() => {
      assertReleaseWorkflowContract(mutated);
    }).toThrow();
  });

  it('rejects hashing nested inside successful output commands', () => {
    const mutated = replaceExactlyOnce(
      EXPECTED_RELEASE_WORKFLOW_SOURCE,
      '          main_sha256="$(sha256sum dist/main.js | cut -d \' \' -f 1)"\n'
        + '          manifest_sha256="$(sha256sum dist/manifest.json | cut -d \' \' -f 1)"\n'
        + '          [[ "$main_sha256" =~ ^[[:xdigit:]]{64}$ ]]\n'
        + '          [[ "$manifest_sha256" =~ ^[[:xdigit:]]{64}$ ]]\n'
        + '          printf \'main=%s\\n\' "$main_sha256" >> "$GITHUB_OUTPUT"\n'
        + '          printf \'manifest=%s\\n\' "$manifest_sha256" >> "$GITHUB_OUTPUT"\n',
      '          printf \'main=%s\\n\' "$(sha256sum dist/main.js | cut -d \' \' -f 1)" >> "$GITHUB_OUTPUT"\n'
        + '          printf \'manifest=%s\\n\' "$(sha256sum dist/manifest.json | cut -d \' \' -f 1)" >> "$GITHUB_OUTPUT"\n'
    );

    expect(() => {
      assertReleaseWorkflowContract(mutated);
    }).toThrow();
  });

  it('rejects removal of expected and actual digest validation', () => {
    const withoutExpectedValidation = replaceExactlyOnce(
      EXPECTED_RELEASE_WORKFLOW_SOURCE,
      '          [[ "$EXPECTED_MAIN_SHA256" =~ ^[[:xdigit:]]{64}$ ]]\n',
      ''
    );
    const withoutActualValidation = replaceExactlyOnce(
      EXPECTED_RELEASE_WORKFLOW_SOURCE,
      '          [[ "$actual_manifest_sha256" =~ ^[[:xdigit:]]{64}$ ]]\n',
      ''
    );

    expect(() => {
      assertReleaseWorkflowContract(withoutExpectedValidation);
    }).toThrow();
    expect(() => {
      assertReleaseWorkflowContract(withoutActualValidation);
    }).toThrow();
  });

  it('rejects combining the two digest comparisons', () => {
    const mutated = replaceExactlyOnce(
      EXPECTED_RELEASE_WORKFLOW_SOURCE,
      '          test "$actual_main_sha256" = "$EXPECTED_MAIN_SHA256"\n'
        + '          test "$actual_manifest_sha256" = "$EXPECTED_MANIFEST_SHA256"\n',
      '          test "$actual_main_sha256" = "$EXPECTED_MAIN_SHA256"'
        + ' && test "$actual_manifest_sha256" = "$EXPECTED_MANIFEST_SHA256"\n'
    );

    expect(() => {
      assertReleaseWorkflowContract(mutated);
    }).toThrow();
  });
});

describe('release workflow hash behavior', () => {
  it('propagates a failed build hash without emitting outputs', () => {
    const script = getStepRun(releaseWorkflow, 'build', 'Calculate release asset hashes');
    const result = runWorkflowShell(script, { sha256sum: 'exit 73' });

    expect(result.status).not.toBe(0);
    expect(result.githubOutput).toBe('');
  });

  it('rejects a directory before build hashing', () => {
    const script = getStepRun(releaseWorkflow, 'build', 'Calculate release asset hashes');
    const result = runWorkflowShell(script, {
      main: 'directory',
      sha256sum: String.raw`printf '%s  %s\n' '${VALID_MAIN_DIGEST}' "$1"`
    });

    expect(result.status).not.toBe(0);
    expect(result.hashLog).toBe('');
    expect(result.githubOutput).toBe('');
  });

  it('rejects a directory before publish hashing', () => {
    const script = getStepRun(releaseWorkflow, 'publish', 'Verify release asset hashes');
    const result = runWorkflowShell(script, {
      expectedMain: VALID_MAIN_DIGEST,
      expectedManifest: VALID_MANIFEST_DIGEST,
      main: 'directory',
      sha256sum: MATCHING_SHA256SUM
    });

    expect(result.status).not.toBe(0);
    expect(result.hashLog).toBe('');
  });

  it.each(['', 'abc', 'gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg', `${VALID_MAIN_DIGEST}a`])(
    'rejects matching malformed expected and actual hashes %#',
    (digest) => {
      const script = getStepRun(releaseWorkflow, 'publish', 'Verify release asset hashes');
      const result = runWorkflowShell(script, {
        expectedMain: digest,
        expectedManifest: digest,
        sha256sum: String.raw`printf '%s  %s\n' "$EXPECTED_MAIN_SHA256" "$1"`
      });

      expect(result.status).not.toBe(0);
      expect(result.hashLog).toBe('');
    }
  );

  it.each(['', 'short', 'z'.repeat(SHA256_HEX_LENGTH)])('rejects a malformed recomputed hash %#', (digest) => {
    const script = getStepRun(releaseWorkflow, 'publish', 'Verify release asset hashes');
    const result = runWorkflowShell(script, {
      expectedMain: VALID_MAIN_DIGEST,
      expectedManifest: VALID_MANIFEST_DIGEST,
      sha256sum: String.raw`printf '%s  %s\n' '${digest}' "$1"`
    });

    expect(result.status).not.toBe(0);
  });

  it('compares each validated downloaded hash independently', () => {
    const script = getStepRun(releaseWorkflow, 'publish', 'Verify release asset hashes');
    const matching = runWorkflowShell(script, {
      expectedMain: VALID_MAIN_DIGEST,
      expectedManifest: VALID_MANIFEST_DIGEST,
      sha256sum: MATCHING_SHA256SUM
    });
    const wrongMain = runWorkflowShell(script, {
      expectedMain: OTHER_VALID_DIGEST,
      expectedManifest: VALID_MANIFEST_DIGEST,
      sha256sum: MATCHING_SHA256SUM
    });
    const wrongManifest = runWorkflowShell(script, {
      expectedMain: VALID_MAIN_DIGEST,
      expectedManifest: OTHER_VALID_DIGEST,
      sha256sum: MATCHING_SHA256SUM
    });

    expect(matching.status).toBe(0);
    expect(wrongMain.status).not.toBe(0);
    expect(wrongManifest.status).not.toBe(0);
  });
});

describe('ordinary change workflow', () => {
  it('matches the complete read-only workflow contract', () => {
    expect(() => {
      assertWorkflowContract(workflow);
    }).not.toThrow();
  });

  it('rejects an unexpected job', () => {
    const mutated = `${workflow}  unexpected:\n    runs-on: ubuntu-latest\n    steps: []\n`;

    expect(() => {
      assertWorkflowContract(mutated);
    }).toThrow();
  });

  it('rejects an inline write permission', () => {
    const mutated = replaceExactlyOnce(
      workflow,
      '    permissions:\n      contents: read\n',
      '    permissions: { contents: write }\n'
    );

    expect(() => {
      assertWorkflowContract(mutated);
    }).toThrow('grants write permission');
  });

  it('rejects an unpinned action expressed with a folded key', () => {
    const foldedAction = [
      '      - name: Run project checks\n        run: make check\n\n',
      '      - name: Unpinned folded action\n',
      '        ? >-\n',
      '          uses\n',
      '        : attacker/example@main\n'
    ].join('');
    const mutated = replaceExactlyOnce(
      workflow,
      '      - name: Run project checks\n        run: make check\n',
      foldedAction
    );

    expect(() => {
      assertWorkflowContract(mutated);
    }).toThrow('not pinned to a full commit SHA');
  });

  it('rejects a required checkout setting moved under env', () => {
    const mutated = replaceExactlyOnce(
      workflow,
      '        with:\n          persist-credentials: false\n',
      '        env:\n          persist-credentials: false\n'
    );

    expect(() => {
      assertWorkflowContract(mutated);
    }).toThrow();
  });

  it('rejects reordered required steps', () => {
    const install =
      '      - name: Install dependencies\n        run: pnpm install --frozen-lockfile --ignore-scripts\n\n';
    const audit = '      - name: Audit production dependencies\n        run: pnpm audit:prod\n\n';
    const mutated = replaceExactlyOnce(workflow, `${install}${audit}`, `${audit}${install}`);

    expect(() => {
      assertWorkflowContract(mutated);
    }).toThrow();
  });

  it('rejects secret interpolation', () => {
    const secretStep = [
      '        run: make check\n        env:\n          TOKEN: $',
      '{{ secrets.RELEASE_TOKEN }}\n'
    ].join('');
    const mutated = replaceExactlyOnce(workflow, '        run: make check\n', secretStep);

    expect(() => {
      assertWorkflowContract(mutated);
    }).toThrow('interpolates a secret');
  });

  it('rejects release commands in executable steps', () => {
    const mutated = replaceExactlyOnce(
      workflow,
      '        run: make check\n',
      '        run: gh release create draft\n'
    );

    expect(() => {
      assertWorkflowContract(mutated);
    }).toThrow('invokes a release command');
  });
});

describe('production audit script', () => {
  it('keeps the network audit separate from the offline check script', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as Record<string, unknown>;
    const scripts = packageJson['scripts'];

    expect(Reflect.get(scripts ?? {}, 'audit:prod')).toBe('pnpm audit --prod --audit-level high');
    expect(Reflect.get(scripts ?? {}, 'check')).not.toContain('audit');
  });
});
