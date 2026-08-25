import { build } from 'obsidian-dev-utils/script-utils/bundlers/esbuild';
import { wrapCliTask } from 'obsidian-dev-utils/script-utils/cli-utils';

import { removePnpmOnlyNpmConfig } from './npm-environment.ts';

removePnpmOnlyNpmConfig();
await wrapCliTask(() => build());
