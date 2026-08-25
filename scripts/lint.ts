import { wrapCliTask } from 'obsidian-dev-utils/script-utils/cli-utils';
import { lint } from 'obsidian-dev-utils/script-utils/linters/eslint';

import { removePnpmOnlyNpmConfig } from './npm-environment.ts';

removePnpmOnlyNpmConfig();
await wrapCliTask(() => lint({ paths: [] }));
