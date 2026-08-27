// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Node imports compact.
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'obsidian-dev-utils/script-utils/bundlers/esbuild';
import { wrapCliTask } from 'obsidian-dev-utils/script-utils/cli-utils';

import { addVersionBanner } from './build-version-banner.ts';
import { removePnpmOnlyNpmConfig } from './npm-environment.ts';

removePnpmOnlyNpmConfig();
await wrapCliTask(async () => {
  await build();
  await finalizeBuildArtifacts();
});

async function finalizeBuildArtifacts(): Promise<void> {
  const bundle = await readFile('dist/build/main.js', 'utf-8');
  const manifestSource = await readFile('dist/build/manifest.json', 'utf-8');
  await writeFile('dist/main.js', addVersionBanner(bundle, manifestSource));
  await writeFile('dist/manifest.json', manifestSource);
}
