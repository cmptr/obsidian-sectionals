// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible TypeScript imports compact.
import type { Diagnostic, ParsedCommandLine } from 'typescript';

// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Node imports compact.
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Node imports compact.
import { dirname, join, resolve } from 'node:path';
import {
  createProgram,
  flattenDiagnosticMessageText,
  getPreEmitDiagnostics,
  parseJsonConfigFileContent,
  readConfigFile,
  resolveModuleName,
  sys
} from 'typescript';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Vitest imports compact.
import { describe, expect, it } from 'vitest';

import type { MutableBuildOptions } from './build-options.ts';

import { customizeBuildOptions } from './build-options.ts';
// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible build output imports compact.
import { assertMobileCompatibleJavaScript, assertReadableJavaScript, inspectUnicodeEscapes } from './build-output.ts';
import { addVersionBanner } from './build-version-banner.ts';

const AMBIENT_PROBE_DIAGNOSTIC_COUNT = 3;

interface CompatibilityManifest {
  readonly minAppVersion: string;
}

interface CompatibilityObsidianPackage {
  readonly version: string;
}

interface CompatibilityPackageJson {
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
}

interface MinimumCompilerOptions {
  readonly lib: readonly string[];
  readonly paths: MinimumPaths;
  readonly types: readonly string[];
}

interface MinimumPaths {
  readonly obsidian: readonly string[];
}

interface MinimumTypeScriptConfig {
  readonly compilerOptions: MinimumCompilerOptions;
  readonly exclude: readonly string[];
  readonly include: readonly string[];
}

function formatDiagnostics(diagnostics: readonly Diagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

function loadMinimumConfig(): ParsedCommandLine {
  const configPath = resolve('tsconfig.minimum.json');
  const configFile = readConfigFile(configPath, (path) => sys.readFile(path));
  if (configFile.error !== undefined) {
    throw new Error(formatDiagnostics([configFile.error]).join('\n'));
  }
  const config = parseJsonConfigFileContent(
    configFile.config,
    sys,
    dirname(configPath),
    undefined,
    configPath
  );
  if (config.errors.length > 0) {
    throw new Error(formatDiagnostics(config.errors).join('\n'));
  }
  return config;
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
    expect(minimum.compilerOptions.types).toEqual([]);
    expect(minimum.include).toEqual(['src/**/*.ts']);
    expect(minimum.exclude).toEqual(['src/**/*.test.ts']);
    // eslint-disable-next-line unicorn/text-encoding-identifier-case -- esbuild names this option value `utf8`.
    expect(options).toEqual({ charset: 'utf8', target: 'es2020' });
  });

  it('typechecks runtime source with the minimum project', () => {
    const config = loadMinimumConfig();
    const program = createProgram({
      options: config.options,
      rootNames: config.fileNames
    });

    expect(formatDiagnostics(getPreEmitDiagnostics(program))).toEqual([]);
  });

  it('resolves Obsidian declarations to version 1.8.7', async () => {
    const config = loadMinimumConfig();
    const importer = config.fileNames.find((fileName) => fileName.endsWith(join('src', 'main.ts')));
    if (importer === undefined) {
      throw new Error('Minimum TypeScript project does not include src/main.ts.');
    }
    const resolvedObsidian = resolveModuleName(
      'obsidian',
      importer,
      config.options,
      sys
    ).resolvedModule?.resolvedFileName;
    if (resolvedObsidian === undefined) {
      throw new Error('Minimum TypeScript project cannot resolve Obsidian.');
    }
    const declarationPath = await realpath(resolvedObsidian);
    const packageJson = await readJson<CompatibilityObsidianPackage>(
      join(dirname(declarationPath), 'package.json')
    );

    expect(packageJson.version).toBe('1.8.7');
  });

  it('does not expose Node or post-ES2020 ambient APIs', async () => {
    const config = loadMinimumConfig();
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'sectionals-minimum-compatibility-')
    );
    const probePath = join(temporaryDirectory, 'ambient-probe.ts');
    try {
      await writeFile(
        probePath,
        'void process;\nvoid Float16Array;\nvoid Symbol.dispose;\n'
      );
      const program = createProgram({
        options: config.options,
        rootNames: [...config.fileNames, probePath]
      });
      const probeDiagnostics = formatDiagnostics(
        getPreEmitDiagnostics(program).filter(
          (diagnostic) => diagnostic.file?.fileName === probePath
        )
      );
      const diagnosticText = probeDiagnostics.join('\n');

      expect(probeDiagnostics).toHaveLength(AMBIENT_PROBE_DIAGNOSTIC_COUNT);
      expect(diagnosticText).toContain('Cannot find name \'process\'');
      expect(diagnosticText).toContain('Cannot find name \'Float16Array\'');
      expect(diagnosticText).toContain(
        'Property \'dispose\' does not exist on type \'SymbolConstructor\''
      );
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it.each([
    'let a=/(?<=x)y/;',
    'let a=/(?<!x)y/;'
  ])('rejects regex lookbehind literals: %s', (source) => {
    expect(() => {
      assertMobileCompatibleJavaScript(source);
    }).toThrow('regex lookbehind');
  });

  it('allows lookbehind text in strings, templates, and comments', () => {
    const source = [
      'const string = "/(?<=x)y/";',
      'const template = `/(?<!x)y/`;',
      '// /(?<=x)y/',
      '/* /(?<!x)y/ */'
    ].join('\n');

    expect(() => {
      assertMobileCompatibleJavaScript(source);
    }).not.toThrow();
  });

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
