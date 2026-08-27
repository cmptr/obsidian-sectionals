// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Node imports compact.
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'obsidian-dev-utils/script-utils/bundlers/esbuild';
import { wrapCliTask } from 'obsidian-dev-utils/script-utils/cli-utils';

import { addVersionBanner } from './build-version-banner.ts';
import { removePnpmOnlyNpmConfig } from './npm-environment.ts';

removePnpmOnlyNpmConfig();
await wrapCliTask(async () => {
  await build();
  await addVersionBannerToBundle();
});

async function addVersionBannerToBundle(): Promise<void> {
  const bundlePath = 'dist/build/main.js';
  const bundle = await readFile(bundlePath, 'utf-8');
  const manifestSource = await readFile('manifest.json', 'utf-8');
  await writeFile(bundlePath, addVersionBanner(bundle, manifestSource));
}
