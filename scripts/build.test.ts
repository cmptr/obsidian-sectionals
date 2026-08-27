import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

const BUILD_TEST_TIMEOUT_MS = 15_000;

interface Manifest {
  readonly name: string;
  readonly version: string;
}

describe('production build', () => {
  it('starts main.js with the plugin name and version', () => {
    execFileSync('pnpm', ['exec', 'jiti', 'scripts/build.ts'], { stdio: 'pipe' });

    const manifest = JSON.parse(readFileSync('manifest.json', 'utf-8')) as Manifest;
    const bundle = readFileSync('dist/build/main.js', 'utf-8');

    expect(bundle.startsWith(`// ${manifest.name} ${manifest.version}\n`)).toBe(true);
  }, BUILD_TEST_TIMEOUT_MS);
});
