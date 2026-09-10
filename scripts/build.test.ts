import { readFile } from 'node:fs/promises';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import type { MutableBuildOptions } from './build-options.ts';

import { customizeBuildOptions } from './build-options.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible build output imports compact.
import { assertMobileCompatibleJavaScript, assertReadableJavaScript, inspectUnicodeEscapes } from './build-output.ts';
import { addVersionBanner } from './build-version-banner.ts';

interface CompatibilityManifest {
  readonly minAppVersion: string;
}

interface CompatibilityPackageJson {
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
}

interface MinimumCompilerOptions {
  readonly lib: readonly string[];
  readonly paths: MinimumPaths;
}

interface MinimumPaths {
  readonly obsidian: readonly string[];
}

interface MinimumTypeScriptConfig {
  readonly compilerOptions: MinimumCompilerOptions;
  readonly exclude: readonly string[];
  readonly include: readonly string[];
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T;
}

describe('compatibility floor', () => {
  it('pins the conservative API and ES2020 runtime floors', async () => {
    const packageJson = await readJson<CompatibilityPackageJson>('package.json');
    const minimum = await readJson<MinimumTypeScriptConfig>('tsconfig.minimum.json');
    const manifest = await readJson<CompatibilityManifest>('manifest.json');
    const options: MutableBuildOptions = {};

    customizeBuildOptions(options);

    expect(manifest.minAppVersion).toBe('1.8.9');
    expect(packageJson.devDependencies['obsidian-minimum']).toBe(
      'npm:obsidian@1.8.7'
    );
    expect(packageJson.scripts['typecheck:minimum']).toBe(
      'tsc --project tsconfig.minimum.json --noEmit'
    );
    expect(minimum.compilerOptions.lib).toEqual([
      'DOM',
      'DOM.Iterable',
      'ES2020'
    ]);
    expect(minimum.compilerOptions.paths.obsidian).toEqual([
      './node_modules/obsidian-minimum/obsidian.d.ts'
    ]);
    expect(minimum.include).toEqual(['src/**/*.ts']);
    expect(minimum.exclude).toEqual(['src/**/*.test.ts']);
    // eslint-disable-next-line unicorn/text-encoding-identifier-case -- esbuild names this option value `utf8`.
    expect(options).toEqual({ charset: 'utf8', target: 'es2020' });
  });

  it.each(['const x = /(?<=a)b/u;', 'const x = /(?<!a)b/u;'])(
    'rejects unsupported mobile syntax: %s',
    (source) => {
      expect(() => {
        assertMobileCompatibleJavaScript(source);
      }).toThrow('regex lookbehind');
    }
  );

  it('accepts ordinary ES2020 JavaScript', () => {
    expect(() => {
      assertMobileCompatibleJavaScript(
        'const value = items[items.length - 1]?.name ?? null;'
      );
    }).not.toThrow();
  });
});

describe('build output scanning', () => {
  it('rejects JavaScript with dense Unicode escapes', () => {
    const source = String.raw`const hidden = '\u0068\u0069\u0064\u0065';`;

    expect(() => assertReadableJavaScript(source)).toThrow('4 Unicode escapes');
  });

  it('accepts readable Unicode and reports no escapes', () => {
    const source = 'const labels = \'straße Σ 東京\';';

    expect(inspectUnicodeEscapes(source)).toEqual({ count: 0, density: 0 });
    expect(() => assertReadableJavaScript(source)).not.toThrow();
  });
});

describe('addVersionBanner', () => {
  it('prepends the plugin name and version without changing the bundle', () => {
    const manifest = JSON.stringify({ name: 'Sectionals', version: '0.1.1' });

    expect(addVersionBanner('const plugin = true;\n', manifest)).toBe(
      '// Sectionals 0.1.1\nconst plugin = true;\n'
    );
  });
});
