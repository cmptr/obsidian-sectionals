import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const CHECKOUT_REFERENCE = 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803';
const NODE_SETUP_REFERENCE = 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38';
const PNPM_SETUP_REFERENCE = 'pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320';
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

    if (key === 'uses' && (typeof child !== 'string' || !FULL_ACTION_SHA.test(child))) {
      throw new Error(`Workflow action at ${childPath} is not pinned to a full commit SHA.`);
    }

    if (key === 'run' && typeof child === 'string' && RELEASE_COMMANDS.some((pattern) => pattern.test(child))) {
      throw new Error(`Workflow invokes a release command at ${childPath}.`);
    }

    assertSecurityPolicy(child, childPath);
  }
}

function assertWorkflowContract(source: string): void {
  const parsed: unknown = parse(source);

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

const workflow = readFileSync('.github/workflows/ci.yml', 'utf-8');

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
