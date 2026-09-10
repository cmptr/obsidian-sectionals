import { readFileSync } from 'node:fs';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type UnknownRecord = Record<string, unknown>;

function dependencyVersions(snapshots: UnknownRecord, name: string): string[] {
  const versions = new Set<string>();

  for (const [snapshotName, snapshotValue] of Object.entries(snapshots)) {
    const snapshot = requireRecord(snapshotValue, `snapshot ${snapshotName}`);
    const dependenciesValue = snapshot['dependencies'];
    if (dependenciesValue === undefined) {
      continue;
    }

    const dependencies = requireRecord(dependenciesValue, `dependencies for ${snapshotName}`);
    const version = dependencies[name];
    if (version === undefined) {
      continue;
    }
    if (typeof version !== 'string') {
      throw new TypeError(`${name} version for ${snapshotName} must be a string`);
    }
    versions.add(version);
  }

  return [...versions].sort();
}

function packageKeys(packages: UnknownRecord, name: string): string[] {
  return Object.keys(packages).filter((key) => key.startsWith(`${name}@`)).sort();
}

function readLockfile(): UnknownRecord {
  const parsed: unknown = parse(readFileSync('pnpm-lock.yaml', 'utf-8'));
  return requireRecord(parsed, 'pnpm-lock.yaml');
}

function readPackageJson(): UnknownRecord {
  const parsed: unknown = JSON.parse(readFileSync('package.json', 'utf-8'));
  return requireRecord(parsed, 'package.json');
}

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

describe('dependency security policy', () => {
  it('uses only the reviewed same-major TOML override', () => {
    const packageJson = readPackageJson();
    const devDependencies = requireRecord(packageJson['devDependencies'], 'devDependencies');

    expect(packageJson['pnpm']).toEqual({
      overrides: {
        'smol-toml@<=1.7.0': '1.8.0'
      }
    });
    expect(devDependencies['yaml']).toBe('2.9.0');
  });

  it('locks the TOML remediation without changing the WebdriverIO merge major', () => {
    const lockfile = readLockfile();
    const importers = requireRecord(lockfile['importers'], 'importers');
    const rootImporter = requireRecord(importers['.'], 'root importer');
    const devDependencies = requireRecord(rootImporter['devDependencies'], 'root devDependencies');
    const packages = requireRecord(lockfile['packages'], 'packages');
    const snapshots = requireRecord(lockfile['snapshots'], 'snapshots');

    expect(lockfile['overrides']).toEqual({
      'smol-toml@<=1.7.0': '1.8.0'
    });
    expect(devDependencies['yaml']).toEqual({
      specifier: '2.9.0',
      version: '2.9.0'
    });
    expect(packageKeys(packages, 'smol-toml')).toEqual(['smol-toml@1.8.0']);
    expect(dependencyVersions(snapshots, 'smol-toml')).toEqual(['1.8.0']);
    expect(packageKeys(packages, 'deepmerge-ts')).toEqual(['deepmerge-ts@7.1.6']);
    expect(dependencyVersions(snapshots, 'deepmerge-ts')).toEqual(['7.1.6']);
  });
});
