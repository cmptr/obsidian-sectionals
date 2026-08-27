// eslint-disable-next-line @stylistic/object-curly-newline -- Keep formatter-compatible Node imports compact.
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'obsidian-dev-utils/script-utils/bundlers/esbuild';
import { wrapCliTask } from 'obsidian-dev-utils/script-utils/cli-utils';

import { removePnpmOnlyNpmConfig } from './npm-environment.ts';

removePnpmOnlyNpmConfig();
await wrapCliTask(async () => {
  await build();
  await addVersionBanner();
});

async function addVersionBanner(): Promise<void> {
  const manifest: unknown = JSON.parse(await readFile('manifest.json', 'utf-8'));
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new TypeError('manifest.json must contain a JSON object');
  }

  const { name, version } = manifest as Record<string, unknown>;
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw new TypeError('manifest.json name and version must be strings');
  }

  const bundlePath = 'dist/build/main.js';
  const bundle = await readFile(bundlePath, 'utf-8');
  await writeFile(bundlePath, `// ${name} ${version}\n${bundle}`);
}
