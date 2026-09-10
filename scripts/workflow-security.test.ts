import { readFileSync } from 'node:fs';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

const CHECKOUT_REFERENCE = 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803';
const NODE_SETUP_REFERENCE = 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38';
const PNPM_SETUP_REFERENCE = 'pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320';

function extractActionStep(workflow: string, reference: string): string {
  const referenceIndex = workflow.indexOf(`uses: ${reference}`);
  const stepStart = workflow.lastIndexOf('      - name:', referenceIndex);
  const nextStep = workflow.indexOf('\n      - ', referenceIndex);

  if (referenceIndex === -1 || stepStart === -1) {
    return '';
  }

  return workflow.slice(stepStart, nextStep === -1 ? undefined : nextStep);
}

function extractUsesReferences(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*uses:\s*(?<reference>\S+)\s*(?:#.*)?$/gmu)].map(
    (match) => match.groups?.['reference'] ?? ''
  );
}

const workflow = readFileSync('.github/workflows/ci.yml', 'utf-8');

describe('ordinary change workflow', () => {
  it('runs for pull requests and pushes to master', () => {
    expect(workflow).toMatch(/^on:\n {2}pull_request:\n {2}push:\n {4}branches:\n {6}- master$/mu);
    expect(workflow).not.toContain('pull_request_target');
  });

  it('grants only read access to repository contents', () => {
    expect(workflow).toMatch(/^permissions: \{\}$/mu);
    expect(workflow).toMatch(/^ {4}permissions:\n {6}contents: read$/mu);
    expect(workflow).not.toMatch(/^\s*[a-z-]+:\s*write\s*$/mu);
    expect(workflow).not.toMatch(/^\s*permissions:\s*write-all\s*$/mu);
  });

  it('checks out without persisted credentials', () => {
    const checkoutStep = extractActionStep(workflow, CHECKOUT_REFERENCE);

    expect(checkoutStep).toContain(`uses: ${CHECKOUT_REFERENCE}`);
    expect(checkoutStep).toContain('persist-credentials: false');
  });

  it('installs the pinned package manager without enabling a Node cache', () => {
    const pnpmStep = extractActionStep(workflow, PNPM_SETUP_REFERENCE);
    const nodeStep = extractActionStep(workflow, NODE_SETUP_REFERENCE);

    expect(pnpmStep).toContain(`uses: ${PNPM_SETUP_REFERENCE}`);
    expect(pnpmStep).toContain('version: 10.20.0');
    expect(nodeStep).toContain(`uses: ${NODE_SETUP_REFERENCE}`);
    expect(nodeStep).toContain('node-version: 24');
    expect(nodeStep).toContain('package-manager-cache: false');
    expect(nodeStep).not.toMatch(/^\s*cache:/mu);
  });

  it('installs safely and runs validation plus the production audit', () => {
    expect(workflow).toContain('run: pnpm install --frozen-lockfile --ignore-scripts');
    expect(workflow).toContain('run: pnpm audit:prod');
    expect(workflow).toContain('run: make check');
  });

  it('does not interpolate secrets or invoke release commands', () => {
    expect(workflow).not.toMatch(/\$\{\{\s*secrets(?:\.|\[)/iu);
    for (const command of ['git tag', 'npm publish', 'pnpm publish', 'gh release create']) {
      expect(workflow).not.toContain(command);
    }
  });

  it('pins every action reference to a full commit SHA', () => {
    const references = extractUsesReferences(workflow);

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference).toMatch(/@[0-9a-f]{40}$/u);
    }
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
