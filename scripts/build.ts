// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Node imports compact.
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'obsidian-dev-utils/script-utils/bundlers/esbuild';
import { wrapCliTask } from 'obsidian-dev-utils/script-utils/cli-utils';

import { assertReadableJavaScript } from './build-output.ts';
import { addVersionBanner } from './build-version-banner.ts';
import { removePnpmOnlyNpmConfig } from './npm-environment.ts';

const DENSITY_DECIMAL_PLACES = 3;

removePnpmOnlyNpmConfig();
await wrapCliTask(async () => {
  await build({
    customizeEsbuildOptions(options) {
      // eslint-disable-next-line unicorn/text-encoding-identifier-case -- esbuild names this option value `utf8`.
      options.charset = 'utf8';
    }
  });
  await finalizeBuildArtifacts();
});

async function finalizeBuildArtifacts(): Promise<void> {
  const bundle = await readFile('dist/build/main.js', 'utf-8');
  const manifestSource = await readFile('dist/build/manifest.json', 'utf-8');
  const mainJavaScript = addVersionBanner(bundle, manifestSource);
  const escapeStats = assertReadableJavaScript(mainJavaScript);
  await writeFile('dist/main.js', mainJavaScript);
  await writeFile('dist/manifest.json', manifestSource);
  process.stdout.write(
    `Unicode escape density: ${escapeStats.density.toFixed(DENSITY_DECIMAL_PLACES)} per 1000 characters (${
      String(escapeStats.count)
    } occurrences).\n`
  );
}
