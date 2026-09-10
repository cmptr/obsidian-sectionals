import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
          printf 'main=%s\\n' "$(sha256sum dist/main.js | cut -d ' ' -f 1)" >> "$GITHUB_OUTPUT"
          printf 'manifest=%s\\n' "$(sha256sum dist/manifest.json | cut -d ' ' -f 1)" >> "$GITHUB_OUTPUT"
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
          test "$(sha256sum dist/main.js | cut -d ' ' -f 1)" = "$EXPECTED_MAIN_SHA256"
          test "$(sha256sum dist/manifest.json | cut -d ' ' -f 1)" = "$EXPECTED_MANIFEST_SHA256"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
