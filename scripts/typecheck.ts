import { buildCompileTypeScript } from 'obsidian-dev-utils/script-utils/build';
import { wrapCliTask } from 'obsidian-dev-utils/script-utils/cli-utils';

import { removePnpmOnlyNpmConfig } from './npm-environment.ts';

removePnpmOnlyNpmConfig();
await wrapCliTask(() => buildCompileTypeScript());
